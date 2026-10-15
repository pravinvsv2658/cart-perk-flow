import type { ActionFunctionArgs } from "react-router";
import { authenticate, getOrCreateStore } from "../shopify.server";
import prisma from "../db.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  let planId: string = "";
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    planId = String(body.planId || body.id || "").trim();
  } else {
    const formData = await request.formData();
    planId = String(formData.get("planId") || formData.get("id") || "").trim();
  }

  if (!planId) {
    return Response.json(
      { success: false, error: "Plan ID is required to change plan." },
      { status: 400 },
    );
  }

  // Find target plan by ID or by name
  let targetPlan = await prisma.plan.findUnique({
    where: { id: planId },
  });

  if (!targetPlan) {
    targetPlan = await prisma.plan.findFirst({
      where: {
        name: {
          equals: planId,
        },
      },
    });
  }

  if (!targetPlan) {
    return Response.json(
      { success: false, error: `Plan with ID or name "${planId}" not found.` },
      { status: 404 },
    );
  }

  try {
    // 1. Update store's planId in database
    const updatedStore = await prisma.store.update({
      where: { id: store.id },
      data: {
        planId: targetPlan.id,
      },
      include: {
        plan: true,
      },
    });

    // 2. Mark existing active subscriptions as CANCELLED/SUPERSEDED
    await prisma.subscription.updateMany({
      where: {
        shopId: store.id,
        status: "ACTIVE",
      },
      data: {
        status: "CANCELLED",
      },
    });

    // 3. Create new ACTIVE subscription record
    const subscription = await prisma.subscription.create({
      data: {
        shopId: store.id,
        planId: targetPlan.id,
        name: targetPlan.name,
        status: "ACTIVE",
        price: targetPlan.price,
        currency: targetPlan.currency || "USD",
        interval: targetPlan.billingInterval || "EVERY_30_DAYS",
        trialDays: targetPlan.trialDays || 0,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      include: {
        plan: true,
      },
    });

    return Response.json({
      success: true,
      message: `Plan successfully updated to ${targetPlan.name}!`,
      plan: targetPlan,
      subscription,
      store: updatedStore,
    });
  } catch (error: any) {
    console.error("Plan change error:", error);
    return Response.json(
      {
        success: false,
        error: error.message || "Failed to update plan in database.",
      },
      { status: 500 },
    );
  }
}
