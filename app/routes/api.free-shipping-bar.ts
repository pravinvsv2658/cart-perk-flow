import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }
  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: corsHeaders },
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(request.url);
    let shopDomain = url.searchParams.get("shop");

    // Authenticate App Proxy request if available to get shop domain
    try {
      const { session } = await authenticate.public.appProxy(request);
      if (session?.shop) {
        shopDomain = session.shop;
      }
    } catch {
      // App proxy might not be signed in local dev or direct call
    }

    // Find current store by shop domain
    const currentStore = shopDomain
      ? await prisma.store.findUnique({ where: { shop: shopDomain } })
      : await prisma.store.findFirst();

    const now = new Date();

    // Query active FREE_SHIPPING_BAR perk for the store
    const bundle = await prisma.bundle.findFirst({
      where: {
        ...(currentStore?.id ? { storeId: currentStore.id } : {}),
        status: "ACTIVE",
        bundleType: "FREE_SHIPPING_BAR",
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!bundle) {
      return Response.json(
        {
          success: true,
          active: false,
          data: null,
          message: "No active free shipping bar found",
        },
        { headers: corsHeaders },
      );
    }

    let shippingConfig: {
      targetAmount?: number;
      thresholds?: {
        id?: number;
        index?: number;
        amount?: number;
        discountPercentage?: number;
      }[];
      [key: string]: unknown;
    } = {};

    try {
      if (bundle.description) {
        const parsed = JSON.parse(bundle.description);
        if (parsed && typeof parsed === "object") {
          shippingConfig = parsed;
        }
      }
    } catch {
      // ignore
    }

    const targetAmount =
      Number(shippingConfig.targetAmount) || Number(bundle.discountValue) || 0;

    const thresholds = Array.isArray(shippingConfig.thresholds)
      ? shippingConfig.thresholds
      : [];

    return Response.json(
      {
        success: true,
        active: true,
        data: {
          id: bundle.id,
          bundleId: bundle.id,
          title: bundle.title,
          bundleTitle: bundle.title,
          description: bundle.description,
          targetAmount,
          thresholds,
          discountType: bundle.discountType,
          discountValue: bundle.discountValue,
        },
      },
      { headers: corsHeaders },
    );
  } catch (error: unknown) {
    console.error("Free Shipping Bar API Error:", error);
    return Response.json(
      {
        success: false,
        active: false,
        error: "Unable to load free shipping bar",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}
