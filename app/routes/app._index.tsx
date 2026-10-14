import type {
  HeadersFunction,
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import {
  useNavigate,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { EmptyState } from "../components/EmptyState";
import { ConfirmModal } from "../components/ConfirmModal";

export interface ShippingBarItem {
  id: string;
  title: string;
  targetAmount: number;
  thresholds: {
    id: number;
    amount: number;
    discountPercentage: number;
  }[];
  status: "ACTIVE" | "DRAFT";
  createdAt: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const currentPlan = {
    id: "free",
    name: "Free",
    price: 0.0,
    currency: "USD",
    billingInterval: "EVERY_30_DAYS",
    trialDays: 0,
    shippingBarLimit: 1,
  };

  // Raw default shipping bar state (can be empty or set to initial active bar)
  const shippingBar: ShippingBarItem = {
    id: "fsb_1",
    title: "Free Shipping Bar",
    targetAmount: 50.0,
    thresholds: [
      { id: 1, amount: 75.0, discountPercentage: 10 },
      { id: 2, amount: 100.0, discountPercentage: 20 },
    ],
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };

  return {
    shop: session.shop,
    shippingBar,
    planInfo: {
      currentPlan,
      isFreePlan: true,
      hasActiveBar: true,
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  return Response.json({
    success: true,
    action: String(actionType || "none"),
  });
}

export default function FreeShippingBarDashboard() {
  const { shippingBar: initialShippingBar, planInfo } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [shippingBar, setShippingBar] = useState<ShippingBarItem | null>(
    initialShippingBar,
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    const data = fetcher.data as
      { success: boolean; action?: string; error?: string } | undefined;

    if (data?.success) {
      if (data.action === "delete") {
        setShippingBar(null);
        shopify.toast.show("Free Shipping Bar has been removed");
      } else if (data.action === "toggleStatus") {
        setShippingBar((prev) =>
          prev
            ? {
                ...prev,
                status: prev.status === "ACTIVE" ? "DRAFT" : "ACTIVE",
              }
            : null,
        );
        shopify.toast.show("Status updated successfully");
      }
    } else if (data?.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleToggleStatus = () => {
    if (!shippingBar) return;
    const newStatus = shippingBar.status === "ACTIVE" ? "DRAFT" : "ACTIVE";
    fetcher.submit(
      {
        action: "toggleStatus",
        status: newStatus,
      },
      { method: "post" },
    );
  };

  const handleConfirmDelete = () => {
    fetcher.submit(
      {
        action: "delete",
      },
      { method: "post" },
    );
    setShowDeleteModal(false);
  };

  return (
    <s-page heading="Free Shipping Bar Dashboard">
      {/* HEADER ACTIONS */}
      <s-button
        slot="primary-action"
        href="/app/free-shipping-bar"
        variant="primary"
      >
        {shippingBar ? "Edit Shipping Bar ✎" : "Configure Shipping Bar ＋"}
      </s-button>

      {/* METRICS SECTION */}
      <s-section heading="Overview & Performance Metrics">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          {/* 1. BAR STATUS */}
          <s-box
            background="base"
            border="base"
            borderRadius="base"
            padding="base"
          >
            <s-stack direction="block" gap="small">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-text tone="neutral">Bar Status</s-text>
                <s-badge
                  tone={
                    shippingBar?.status === "ACTIVE" ? "success" : "neutral"
                  }
                >
                  {shippingBar?.status === "ACTIVE"
                    ? "Active (1/1)"
                    : "Inactive"}
                </s-badge>
              </s-stack>

              <s-heading>
                {shippingBar?.status === "ACTIVE"
                  ? "Live on Store"
                  : "Disabled"}
              </s-heading>

              {shippingBar && (
                <s-button
                  variant="tertiary"
                  onClick={handleToggleStatus}
                  loading={fetcher.state !== "idle"}
                >
                  {shippingBar.status === "ACTIVE"
                    ? "Deactivate Bar →"
                    : "Activate Bar →"}
                </s-button>
              )}
            </s-stack>
          </s-box>

          {/* 2. FREE SHIPPING GOAL */}
          <s-box
            background="base"
            border="base"
            borderRadius="base"
            padding="base"
          >
            <s-stack direction="block" gap="small">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-text tone="neutral">Goal Target</s-text>
                <s-badge tone="info">Cart Total</s-badge>
              </s-stack>

              <s-heading>
                ${shippingBar ? shippingBar.targetAmount.toFixed(2) : "0.00"}
              </s-heading>

              <s-text tone="neutral">
                Free shipping unlocked at threshold
              </s-text>
            </s-stack>
          </s-box>

          {/* 3. MULTI-TIER MILESTONES */}
          <s-box
            background="base"
            border="base"
            borderRadius="base"
            padding="base"
          >
            <s-stack direction="block" gap="small">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-text tone="neutral">Milestones</s-text>
                <s-badge tone="success">
                  {shippingBar?.thresholds.length || 0} Tiers
                </s-badge>
              </s-stack>

              <s-heading>
                {shippingBar?.thresholds.length || 0} Reward Tier
                {shippingBar?.thresholds.length === 1 ? "" : "s"}
              </s-heading>

              <s-text tone="neutral">Progressive discount rewards</s-text>
            </s-stack>
          </s-box>

          {/* 4. PLAN CAPACITY */}
          <s-box
            background="subdued"
            border="base"
            borderRadius="base"
            padding="base"
          >
            <s-stack direction="block" gap="small">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-text tone="neutral">Plan</s-text>
                <s-badge tone="info">
                  ${planInfo.currentPlan.price.toFixed(2)}/mo
                </s-badge>
              </s-stack>

              <s-heading>{planInfo.currentPlan.name} Plan</s-heading>

              <s-button variant="tertiary" href="/app/settings">
                Settings ↗
              </s-button>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {/* QUICK LAUNCHPAD / PREVIEW CARD */}
      <s-section heading="Free Shipping Bar Setup">
        <s-box
          border="base"
          borderRadius="base"
          padding="base"
          background="base"
        >
          <s-grid
            gridTemplateColumns="1fr 280px"
            gap="base"
            alignItems="center"
          >
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-heading>Multiple Threshold Shipping Bar</s-heading>
                <s-badge tone="success">Live Perk</s-badge>
              </s-stack>

              <s-paragraph tone="neutral">
                Motivate customers to increase their average order value with a
                dynamic, interactive progress bar showing remaining amounts to
                free shipping and unlocked milestone discounts.
              </s-paragraph>

              <s-stack direction="inline" gap="small" alignItems="center">
                <s-button variant="primary" href="/app/free-shipping-bar">
                  {shippingBar
                    ? "Configure Shipping Bar ✎"
                    : "Create Shipping Bar ＋"}
                </s-button>
                <s-button variant="tertiary" href="/app/settings">
                  Theme App Embed Settings ↗
                </s-button>
              </s-stack>
            </s-stack>

            <s-box border="base" borderRadius="base" overflow="hidden">
              <s-image
                alt="Free Shipping Bar Preview"
                src="/free-shipping-bar-placeholder.png"
              />
            </s-box>
          </s-grid>
        </s-box>
      </s-section>

      {/* CONFIRMATION MODAL */}
      <ConfirmModal
        id="delete-shippingbar-modal"
        heading="Delete Free Shipping Bar?"
        description="Are you sure you want to delete this Free Shipping Bar? The progress bar widget will be removed from your storefront."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmTone="critical"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />

      {/* MANAGE BAR SECTION */}
      <s-section heading="Manage Free Shipping Campaign">
        <s-box
          background="base"
          borderRadius="base"
          borderWidth="base"
          borderColor="base"
          padding="none"
        >
          {!shippingBar ? (
            <EmptyState
              accessibilityLabel="Free Shipping Bar empty state"
              heading="No Free Shipping Bar configured yet"
              description="Create a Free Shipping Bar to boost your store conversion rate and encourage higher cart totals with tiered rewards."
              imageSrc="/empty-state.png"
              imageAlt="Free shipping bar empty state"
              primaryAction={{
                content: "Configure Free Shipping Bar",
                href: "/app/free-shipping-bar",
                accessibilityLabel: "Configure Free Shipping Bar",
              }}
            />
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Campaign Name</s-table-header>
                <s-table-header>Target Amount</s-table-header>
                <s-table-header>Milestone Tiers</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                <s-table-row>
                  <s-table-cell>
                    <s-stack direction="block" gap="none">
                      <s-link
                        onClick={() => navigate("/app/free-shipping-bar")}
                      >
                        <s-text>
                          <strong>{shippingBar.title}</strong>
                        </s-text>
                      </s-link>
                      <s-text tone="neutral">
                        Multi-threshold progress bar
                      </s-text>
                    </s-stack>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge tone="info">
                      ${shippingBar.targetAmount.toFixed(2)}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      {shippingBar.thresholds.length === 0 ? (
                        <s-text tone="neutral">None</s-text>
                      ) : (
                        shippingBar.thresholds.map((t) => (
                          <s-badge key={t.id} tone="success">
                            ${t.amount} ({t.discountPercentage}%)
                          </s-badge>
                        ))
                      )}
                    </s-stack>
                  </s-table-cell>

                  <s-table-cell>
                    <s-badge
                      tone={
                        shippingBar.status === "ACTIVE" ? "success" : "neutral"
                      }
                    >
                      {shippingBar.status}
                    </s-badge>
                  </s-table-cell>

                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        variant="tertiary"
                        onClick={() => navigate("/app/free-shipping-bar")}
                        accessibilityLabel="Edit Free Shipping Bar"
                      >
                        Edit
                      </s-button>

                      <s-button
                        variant="tertiary"
                        tone="critical"
                        commandFor="delete-shippingbar-modal"
                        command="--show"
                        onClick={() => setShowDeleteModal(true)}
                        accessibilityLabel="Delete Free Shipping Bar"
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              </s-table-body>
            </s-table>
          )}
        </s-box>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
