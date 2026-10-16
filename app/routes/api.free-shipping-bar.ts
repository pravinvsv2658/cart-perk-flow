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
    let shopParam = url.searchParams.get("shop") || "";

    // Authenticate App Proxy request if available to get shop domain
    try {
      const proxyContext = await authenticate.public.appProxy(request);
      if (proxyContext.session?.shop) {
        shopParam = proxyContext.session.shop;
      }
    } catch {
      // App proxy might not be signed in local dev or direct call
    }

    const cleanShop = shopParam
      ? shopParam
          .replace(/^https?:\/\//, "")
          .split("/")[0]
          .split("?")[0]
          .trim()
          .toLowerCase()
      : "";

    // Find current store by shop domain
    let currentStore = cleanShop
      ? (await prisma.store.findFirst({
          where: {
            OR: [{ shop: cleanShop }, { shop: { contains: cleanShop } }],
          },
        })) || (await prisma.store.findFirst())
      : await prisma.store.findFirst();

    // 5-minute clock skew tolerance
    const now = new Date(Date.now() + 5 * 60 * 1000);

    // Query active FREE_SHIPPING_BAR perk for the store
    let bundle = await prisma.bundle.findFirst({
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
          message: "No active shipping bar found",
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
