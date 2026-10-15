import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getOrCreateStore } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  FreeShippingBarForm,
  type FreeShippingBarFormInitialData,
  type FreeShippingBarFormData,
} from "../components/bundle-creation";

function getCurrencySymbol(code: string): string {
  if (!code) return "$";
  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    });
    const parts = formatter.formatToParts(0);
    const symbolPart = parts.find((part) => part.type === "currency");
    return symbolPart ? symbolPart.value : code;
  } catch {
    return code || "$";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  const url = new URL(request.url);
  const bundleId = url.searchParams.get("id");

  let initialShippingData: FreeShippingBarFormInitialData | null = null;
  let isEditing = false;

  // 1. If an ID is provided, load that specific Free Shipping Bar
  if (bundleId) {
    const existing = await prisma.bundle.findFirst({
      where: {
        id: bundleId,
        storeId: store.id,
      },
    });

    if (existing) {
      isEditing = true;
      let shippingConfig: { targetAmount?: number; thresholds?: any[] } = {};
      try {
        if (existing.description) {
          shippingConfig = JSON.parse(existing.description);
        }
      } catch (err) {
        console.warn(
          "Could not parse existing shipping bar description JSON:",
          err,
        );
      }

      initialShippingData = {
        id: existing.id,
        bundleId: existing.id,
        bundleName: existing.title,
        title: existing.title,
        status: existing.status,
        startDate: existing.startDate,
        endDate: existing.endDate,
        targetAmount:
          shippingConfig.targetAmount || existing.discountValue || 50,
        thresholds: shippingConfig.thresholds || [],
      };
    }
  }

  // Active shipping bar state for store (excluding current bundleId if editing)
  const activeShippingBar = await prisma.bundle.findFirst({
    where: {
      storeId: store.id,
      status: "ACTIVE",
      bundleType: "FREE_SHIPPING_BAR",
      ...(bundleId ? { NOT: { id: bundleId } } : {}),
    },
    select: { id: true, title: true },
  });

  const hasActiveShippingBar = Boolean(activeShippingBar);
  const activeShippingBarId = activeShippingBar?.id || null;
  const activeShippingBarTitle = activeShippingBar?.title || null;

  // Plan limits check
  const bundleLimit = store.plan?.bundleLimit ?? 1;
  const activeBundleCount = await prisma.bundle.count({
    where: {
      storeId: store.id,
      status: "ACTIVE",
    },
  });

  const isLimitReached = activeBundleCount >= bundleLimit;
  const isFreePlan = store.plan?.name?.toLowerCase().includes("free") ?? true;

  // Store currency
  let currencyCode = store.currency || "USD";
  try {
    const response = await admin.graphql(
      `#graphql
      query getShopCurrency {
        shop {
          currencyCode
        }
      }`,
    );
    const json = await response.json();
    if (json.data?.shop?.currencyCode) {
      currencyCode = json.data.shop.currencyCode;
    }
  } catch (err) {
    console.warn("GraphQL shop currency fetch fallback:", err);
  }

  return {
    currencyCode,
    isEditing,
    initialShippingData,
    isLimitReached,
    activeBundleCount,
    bundleLimit,
    isFreePlan,
    hasActiveShippingBar,
    activeShippingBarId,
    activeShippingBarTitle,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  let payload: any;
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await request.json();
      payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    } else {
      const formData = await request.formData();
      const rawPayload = formData.get("payload");
      if (typeof rawPayload === "string") {
        payload = JSON.parse(rawPayload);
      } else {
        payload = Object.fromEntries(formData.entries());
      }
    }
  } catch (err: any) {
    console.error("Payload parsing error in free-shipping-bar action:", err);
    return data({ error: "Invalid payload format" }, { status: 400 });
  }

  const url = new URL(request.url);
  const bundleId =
    (typeof payload.bundleId === "string" ? payload.bundleId : "") ||
    (typeof payload.id === "string" ? payload.id : "") ||
    url.searchParams.get("id");

  // Validate target amount
  const targetAmount = parseFloat(
    String(payload.targetAmount || payload.discount?.value || "0"),
  );
  if (isNaN(targetAmount) || targetAmount <= 0) {
    return data(
      {
        error:
          "Free Shipping Bar target amount must be a valid number greater than 0.",
      },
      { status: 400 },
    );
  }

  // Validate & format optional progressive milestones
  const rawThresholds = Array.isArray(payload.thresholds)
    ? (payload.thresholds as {
        id?: number;
        amount?: string | number;
        discountPercentage?: string | number;
      }[])
    : [];

  for (let i = 0; i < rawThresholds.length; i++) {
    const amt = parseFloat(String(rawThresholds[i]?.amount || "0"));
    if (isNaN(amt) || amt <= 0) {
      return data(
        {
          error: `Milestone ${i + 1} amount must be a valid number greater than 0.`,
        },
        { status: 400 },
      );
    }
    const disc = parseFloat(
      String(rawThresholds[i]?.discountPercentage || "0"),
    );
    if (isNaN(disc) || disc <= 0 || disc > 100) {
      return data(
        {
          error: `Milestone ${i + 1} discount must be a valid percentage between 1 and 100.`,
        },
        { status: 400 },
      );
    }
  }

  const thresholds = rawThresholds.map((t, idx) => ({
    id: t.id || idx + 1,
    index: idx + 1,
    amount: parseFloat(String(t.amount)),
    discountPercentage: parseFloat(String(t.discountPercentage)),
  }));

  // Verify milestone progression: each milestone must be > previous
  let prevVal = targetAmount;
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i].amount <= prevVal) {
      return data(
        {
          error:
            i === 0
              ? `Milestone 1 ($${thresholds[i].amount}) must be greater than Free Shipping target ($${targetAmount}).`
              : `Milestone ${i + 1} ($${thresholds[i].amount}) must be greater than Milestone ${i} ($${prevVal}).`,
        },
        { status: 400 },
      );
    }
    prevVal = thresholds[i].amount;
  }

  const bundleName = (
    typeof payload.bundleName === "string"
      ? payload.bundleName
      : typeof payload.title === "string"
        ? payload.title
        : "Free Shipping Bar"
  ).trim();

  const requestedStatus = payload.status === "DRAFT" ? "DRAFT" : "ACTIVE";
  const startDate = payload.startDate
    ? new Date(payload.startDate)
    : new Date();
  const endDate = payload.endDate ? new Date(payload.endDate) : null;

  // Enforce max 1 active Free Shipping Bar per store
  const existingActiveShippingBar = await prisma.bundle.findFirst({
    where: {
      storeId: store.id,
      status: "ACTIVE",
      bundleType: "FREE_SHIPPING_BAR",
      ...(bundleId ? { NOT: { id: bundleId } } : {}),
    },
    select: { id: true, title: true },
  });

  let newStatus: "ACTIVE" | "DRAFT" = requestedStatus;
  let wasForcedDraft = false;

  if (existingActiveShippingBar) {
    // Save in draft only if one shipping bar is already active
    newStatus = "DRAFT";
    if (requestedStatus === "ACTIVE") {
      wasForcedDraft = true;
    }
  } else if (requestedStatus === "ACTIVE") {
    // Check active perk plan limit
    const bundleLimit = store.plan?.bundleLimit ?? 1;
    const activeBundleCount = await prisma.bundle.count({
      where: {
        storeId: store.id,
        status: "ACTIVE",
        ...(bundleId ? { NOT: { id: bundleId } } : {}),
      },
    });

    if (activeBundleCount >= bundleLimit) {
      return data(
        {
          error: `Active perk limit reached (${activeBundleCount}/${bundleLimit}). Please upgrade your plan in Settings or save this perk as Draft.`,
        },
        { status: 400 },
      );
    }
  }

  // Configuration JSON saved into bundle description
  const shippingBarConfig = {
    targetAmount,
    thresholds,
  };

  try {
    let savedBundle: any;

    if (bundleId) {
      savedBundle = await prisma.bundle.update({
        where: {
          id: bundleId,
          storeId: store.id,
        },
        data: {
          title: bundleName || "Free Shipping Bar",
          description: JSON.stringify(shippingBarConfig),
          bundleType: "FREE_SHIPPING_BAR",
          discountType: "PERCENTAGE",
          discountValue: targetAmount,
          status: newStatus,
          startDate,
          endDate,
          triggerType: "ALL",
          updatedAt: new Date(),
        },
      });

      return data({
        success: true,
        isEdit: true,
        bundle: savedBundle,
        wasForcedDraft,
      });
    } else {
      savedBundle = await prisma.bundle.create({
        data: {
          storeId: store.id,
          title: bundleName || "Free Shipping Bar",
          description: JSON.stringify(shippingBarConfig),
          bundleType: "FREE_SHIPPING_BAR",
          discountType: "PERCENTAGE",
          discountValue: targetAmount,
          status: newStatus,
          startDate,
          endDate,
          triggerType: "ALL",
        },
      });

      return data({
        success: true,
        isEdit: false,
        bundle: savedBundle,
        wasForcedDraft,
      });
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to save Free Shipping Bar in database";
    console.error("Error saving Free Shipping Bar in DB:", err);
    return data({ error: message }, { status: 400 });
  }
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function FreeShippingBarPage() {
  const {
    currencyCode,
    isEditing,
    initialShippingData,
    isLimitReached,
    activeBundleCount,
    bundleLimit,
    hasActiveShippingBar,
    activeShippingBarId,
    activeShippingBarTitle,
  } = useLoaderData<typeof loader>();

  const currencySymbol = getCurrencySymbol(currencyCode);
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    const res = fetcher.data as
      | {
          success: boolean;
          isEdit?: boolean;
          bundle: any;
          wasForcedDraft?: boolean;
        }
      | { error: string }
      | undefined;

    if (res && "success" in res && res.success) {
      const isEdit = res.isEdit;
      if (res.wasForcedDraft) {
        shopify.toast.show(
          "Another Free Shipping Bar is currently active. Saved as Draft.",
        );
      } else {
        shopify.toast.show(
          isEdit
            ? "Free Shipping Bar updated successfully!"
            : "Free Shipping Bar created successfully!",
        );
      }
      // Stay on same page: if creating new, update URL with bundle ID
      if (!isEdit && res.bundle?.id) {
        navigate(`?id=${res.bundle.id}`, { replace: true });
      }
    } else if (res && "error" in res && res.error) {
      shopify.toast.show(res.error, { isError: true });
    }
  }, [fetcher.data, navigate, shopify]);

  const handleSubmit = (formData: FreeShippingBarFormData) => {
    fetcher.submit({ payload: JSON.stringify(formData) }, { method: "POST" });
  };

  return (
    <s-page
      heading={
        isEditing
          ? "Edit Multiple Threshold Shipping Bar"
          : "Create Multiple Threshold Shipping Bar"
      }
    >
      <s-button
        commandFor="shippingbar-preview-modal"
        command="--show"
        slot="primary-action"
      >
        👁️ Preview Storefront
      </s-button>

      <FreeShippingBarForm
        key={initialShippingData?.id || "new-shipping-bar"}
        initialData={initialShippingData || undefined}
        currencySymbol={currencySymbol}
        isSubmitting={fetcher.state !== "idle"}
        submitButtonLabel={isEditing ? "Save Changes" : "Create Shipping Bar"}
        submittingLabel={
          isEditing ? "Saving Changes..." : "Creating Shipping Bar..."
        }
        onSubmit={handleSubmit}
        onCancel={() => navigate("/app")}
        pageTitle={
          isEditing
            ? "Edit Multiple Threshold Shipping Bar Settings"
            : "Multiple Threshold Shipping Bar Settings"
        }
        isLimitReached={isLimitReached}
        activeBundleCount={activeBundleCount}
        bundleLimit={bundleLimit}
        isEditing={isEditing}
        hasActiveShippingBar={hasActiveShippingBar}
        activeShippingBarId={activeShippingBarId}
        activeShippingBarTitle={activeShippingBarTitle}
      />
    </s-page>
  );
}
