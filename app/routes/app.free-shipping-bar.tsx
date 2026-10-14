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
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  FreeShippingBarForm,
  type FreeShippingBarFormInitialData,
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
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const bundleId = url.searchParams.get("id");

  let initialShippingData: FreeShippingBarFormInitialData | null = null;
  let isEditing = false;

  if (bundleId) {
    isEditing = true;
    initialShippingData = {
      id: bundleId,
      bundleId: bundleId,
      bundleName: "Free Shipping Bar",
      targetAmount: 50,
      thresholds: [],
    };
  }

  let currencyCode = "USD";
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
    currencyCode = json.data?.shop?.currencyCode || "USD";
  } catch (err) {
    console.warn("GraphQL shop currency fetch fallback:", err);
  }

  return {
    currencyCode,
    isEditing,
    initialShippingData,
    isLimitReached: false,
    activeBundleCount: 0,
    bundleLimit: 10,
    isFreePlan: false,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

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
    const disc = parseFloat(String(rawThresholds[i]?.discountPercentage || "0"));
    if (isNaN(disc) || disc <= 0 || disc > 100) {
      return data(
        {
          error: `Milestone ${i + 1} discount must be a valid percentage between 1 and 100.`,
        },
        { status: 400 },
      );
    }
  }

  const isEditing = Boolean(payload.id || payload.bundleId);

  return data({
    success: true,
    isEdit: isEditing,
    bundle: {
      id: payload.id || payload.bundleId || "mock_shipping_" + Date.now(),
    },
  });
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
  } = useLoaderData<typeof loader>();

  const currencySymbol = getCurrencySymbol(currencyCode);
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    const res = fetcher.data as
      { success: boolean; isEdit?: boolean; bundle: any } | { error: string } | undefined;

    if (res && "success" in res && res.success) {
      const isEdit = res.isEdit;
      shopify.toast.show(
        isEdit
          ? "Free Shipping Bar updated successfully!"
          : "Free Shipping Bar created successfully!",
      );
      navigate("/app");
    } else if (res && "error" in res && res.error) {
      shopify.toast.show(res.error, { isError: true });
    }
  }, [fetcher.data, navigate, shopify]);

  const handleSubmit = (formData: any) => {
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
      <FreeShippingBarForm
        initialData={initialShippingData || undefined}
        currencySymbol={currencySymbol}
        isSubmitting={fetcher.state !== "idle"}
        submitButtonLabel={
          isEditing
            ? "Save Changes"
            : "Create Multiple Threshold Shipping Bar"
        }
        submittingLabel={
          isEditing
            ? "Saving Changes..."
            : "Creating Multiple Threshold Shipping Bar..."
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
      />
    </s-page>
  );
}
