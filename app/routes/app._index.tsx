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
import { authenticate, getOrCreateStore } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { ConfirmModal } from "../components/ConfirmModal";
import { DEFAULT_PAGE_SIZE } from "../constants";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status") || "ALL";

  const pageParam = Number(url.searchParams.get("page") || "1");
  const page = Math.max(Number.isFinite(pageParam) ? pageParam : 1, 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  // Plan and limit metrics
  const currentPlan = store.plan || {
    id: "free",
    name: "Free",
    price: 0.0,
    currency: "USD",
    billingInterval: "EVERY_30_DAYS",
    trialDays: 0,
    bundleLimit: 1,
  };

  const now = new Date();

  const [
    totalBundlesAll,
    activeBundleCount,
    draftBundleCount,
    scheduledBundleCount,
    expiredBundleCount,
    fbtBundleCount,
    shippingBarCount,
    availablePlans,
  ] = await Promise.all([
    prisma.bundle.count({ where: { storeId: store.id } }),
    prisma.bundle.count({
      where: {
        storeId: store.id,
        status: "ACTIVE",
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
    }),
    prisma.bundle.count({ where: { storeId: store.id, status: "DRAFT" } }),
    prisma.bundle.count({
      where: {
        storeId: store.id,
        status: "ACTIVE",
        startDate: { gt: now },
      },
    }),
    prisma.bundle.count({
      where: {
        storeId: store.id,
        endDate: { lt: now },
      },
    }),
    prisma.bundle.count({ where: { storeId: store.id, bundleType: "FBT" } }),
    prisma.bundle.count({
      where: { storeId: store.id, bundleType: "FREE_SHIPPING_BAR" },
    }),
    prisma.plan.findMany({ orderBy: { price: "asc" } }),
  ]);

  const isFreePlan = currentPlan.name.toLowerCase().includes("free");
  const isLimitReached = activeBundleCount >= currentPlan.bundleLimit;

  const where: any = {
    storeId: store.id,
  };

  // Search filter
  if (search) {
    where.OR = [
      {
        title: {
          contains: search,
        },
      },
      {
        description: {
          contains: search,
        },
      },
    ];
  }

  // Status filter based on date and status
  if (status === "ACTIVE") {
    where.status = "ACTIVE";
    where.startDate = { lte: now };
    where.AND = [
      {
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
    ];
  } else if (status === "DRAFT") {
    where.status = "DRAFT";
  } else if (status === "SCHEDULED") {
    where.status = "ACTIVE";
    where.startDate = { gt: now };
  } else if (status === "EXPIRED") {
    where.endDate = { lt: now };
  }

  const totalBundles = await prisma.bundle.count({
    where,
  });

  const totalPages = Math.max(Math.ceil(totalBundles / pageSize), 1);
  const currentPage = Math.min(page, totalPages);

  const bundles = await prisma.bundle.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
    include: {
      products: true,
      triggerProducts: true,
      triggerCollections: true,
      tags: true,
    },
  });

  return {
    shop: session.shop,
    bundles,
    pagination: {
      page: currentPage,
      pageSize,
      totalItems: totalBundles,
      totalBundles,
      totalPages,
    },
    filters: {
      search,
      status,
    },
    metrics: {
      totalBundlesAll,
      activeBundleCount,
      draftBundleCount,
      scheduledBundleCount,
      expiredBundleCount,
      fbtBundleCount,
      shippingBarCount,
    },
    planInfo: {
      currentPlan,
      isFreePlan,
      isLimitReached,
    },
    availablePlans,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  const formData = await request.formData();
  const actionType = formData.get("action");

  try {
    // 1. DELETE SINGLE PERK
    if (actionType === "delete") {
      const bundleId = String(formData.get("bundleId"));

      await prisma.bundle.delete({
        where: {
          id: bundleId,
          storeId: store.id,
        },
      });

      return Response.json({
        success: true,
        action: "delete",
      });
    }

    // 2. UPDATE STATUS (SINGLE)
    if (actionType === "updateStatus") {
      const bundleId = String(formData.get("bundleId"));
      const status = String(formData.get("status"));

      const bundleToUpdate = await prisma.bundle.findUnique({
        where: { id: bundleId, storeId: store.id },
        select: { status: true, bundleType: true },
      });

      if (!bundleToUpdate) {
        return Response.json(
          { success: false, error: "Perk not found" },
          { status: 404 },
        );
      }

      if (status === "ACTIVE" && bundleToUpdate.status !== "ACTIVE") {
        // Enforce max 1 active Free Shipping Bar
        if (bundleToUpdate.bundleType === "FREE_SHIPPING_BAR") {
          const activeShippingBarCount = await prisma.bundle.count({
            where: {
              storeId: store.id,
              status: "ACTIVE",
              bundleType: "FREE_SHIPPING_BAR",
              NOT: { id: bundleId },
            },
          });
          if (activeShippingBarCount > 0) {
            return Response.json(
              {
                success: false,
                error:
                  "Only 1 Free Shipping Bar can be active at a time for your store. Please set the existing Free Shipping Bar to Draft first.",
              },
              { status: 400 },
            );
          }
        }

        // Enforce active perks plan limit
        const currentActiveCount = await prisma.bundle.count({
          where: { storeId: store.id, status: "ACTIVE" },
        });
        const bundleLimit = store.plan?.bundleLimit ?? 1;

        if (currentActiveCount >= bundleLimit) {
          return Response.json(
            {
              success: false,
              error: `Active limit reached (${currentActiveCount}/${bundleLimit}). Please upgrade your plan in Settings to activate more perks.`,
            },
            { status: 400 },
          );
        }
      }

      await prisma.bundle.update({
        where: {
          id: bundleId,
          storeId: store.id,
        },
        data: {
          status,
        },
      });

      return Response.json({
        success: true,
        action: "updateStatus",
      });
    }

    // 3. BULK UPDATE STATUS
    if (actionType === "bulkUpdateStatus") {
      const bundleIds = JSON.parse(String(formData.get("bundleIds") || "[]"));
      const status = String(formData.get("status"));

      if (!bundleIds.length) {
        return Response.json(
          {
            success: false,
            error: "No perks selected",
          },
          { status: 400 },
        );
      }

      if (status === "ACTIVE") {
        const shippingBarsToActivate = await prisma.bundle.findMany({
          where: {
            id: { in: bundleIds },
            storeId: store.id,
            bundleType: "FREE_SHIPPING_BAR",
            status: { not: "ACTIVE" },
          },
        });

        if (shippingBarsToActivate.length > 0) {
          const activeShippingBarCount = await prisma.bundle.count({
            where: {
              storeId: store.id,
              status: "ACTIVE",
              bundleType: "FREE_SHIPPING_BAR",
              NOT: { id: { in: bundleIds } },
            },
          });
          if (activeShippingBarCount + shippingBarsToActivate.length > 1) {
            return Response.json(
              {
                success: false,
                error:
                  "Only 1 Free Shipping Bar can be active at a time. Please deselect extra Free Shipping Bars.",
              },
              { status: 400 },
            );
          }
        }

        const inactiveSelectedCount = await prisma.bundle.count({
          where: {
            id: { in: bundleIds },
            storeId: store.id,
            status: { not: "ACTIVE" },
          },
        });
        const currentActiveCount = await prisma.bundle.count({
          where: { storeId: store.id, status: "ACTIVE" },
        });
        const bundleLimit = store.plan?.bundleLimit ?? 1;

        if (currentActiveCount + inactiveSelectedCount > bundleLimit) {
          return Response.json(
            {
              success: false,
              error: `Activating ${inactiveSelectedCount} perk(s) exceeds your plan limit (${bundleLimit} allowed, ${currentActiveCount} currently active). Please upgrade your plan in Settings.`,
            },
            { status: 400 },
          );
        }
      }

      await prisma.bundle.updateMany({
        where: {
          id: {
            in: bundleIds,
          },
          storeId: store.id,
        },
        data: {
          status,
        },
      });

      return Response.json({
        success: true,
        action: "bulkUpdateStatus",
      });
    }

    // 4. BULK DELETE
    if (actionType === "bulkDelete") {
      const bundleIds = JSON.parse(String(formData.get("bundleIds") || "[]"));

      if (!bundleIds.length) {
        return Response.json(
          {
            success: false,
            error: "No perks selected",
          },
          { status: 400 },
        );
      }

      await prisma.bundle.deleteMany({
        where: {
          id: {
            in: bundleIds,
          },
          storeId: store.id,
        },
      });

      return Response.json({
        success: true,
        action: "bulkDelete",
      });
    }

    // 5. CHANGE PLAN (UPDATE STORE AND SUBSCRIPTION IN DATABASE)
    if (actionType === "changePlan") {
      const planId = String(formData.get("planId") || "").trim();
      if (!planId) {
        return Response.json(
          { success: false, error: "Plan ID is required." },
          { status: 400 },
        );
      }

      let targetPlan = await prisma.plan.findUnique({
        where: { id: planId },
      });
      if (!targetPlan) {
        targetPlan = await prisma.plan.findFirst({
          where: { name: planId },
        });
      }

      if (!targetPlan) {
        return Response.json(
          { success: false, error: "Target plan not found in database." },
          { status: 404 },
        );
      }

      // Update store plan in DB
      await prisma.store.update({
        where: { id: store.id },
        data: { planId: targetPlan.id },
      });

      // Supersede active subscriptions
      await prisma.subscription.updateMany({
        where: { shopId: store.id, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });

      // Create new active subscription in DB
      const newSubscription = await prisma.subscription.create({
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
        include: { plan: true },
      });

      return Response.json({
        success: true,
        action: "changePlan",
        message: `Plan changed to "${targetPlan.name}" successfully!`,
        plan: targetPlan,
        subscription: newSubscription,
      });
    }

    return Response.json(
      {
        success: false,
        error: "Invalid action",
      },
      { status: 400 },
    );
  } catch (error: any) {
    console.error("Perk action error:", error);
    return Response.json(
      {
        success: false,
        error: error.message || "Something went wrong",
      },
      { status: 500 },
    );
  }
}

function formatBundleType(typeId: string | null) {
  switch (typeId) {
    case "FBT":
    case "FBT_BUNDLE":
      return "Frequently Bought Together";
    case "FREE_SHIPPING_BAR":
      return "Free Shipping Bar";
    default:
      return typeId || "Perk";
  }
}

function formatDiscount(
  type: string,
  value: number,
  bundleType?: string | null,
) {
  if (bundleType === "FREE_SHIPPING_BAR") {
    return "Free Shipping";
  }
  switch (type) {
    case "PERCENTAGE":
      return `${value}% OFF`;
    case "FIXED_AMOUNT":
      return `$${value} OFF`;
    case "NO_DISCOUNT":
    default:
      return "No Discount";
  }
}

export function getEffectiveStatus(bundle: {
  status: string;
  startDate: Date | string;
  endDate?: Date | string | null;
}): "ACTIVE" | "DRAFT" | "SCHEDULED" | "EXPIRED" {
  if (bundle.status === "DRAFT") return "DRAFT";
  const now = new Date();
  const start = new Date(bundle.startDate);
  const end = bundle.endDate ? new Date(bundle.endDate) : null;

  if (end && end < now) {
    return "EXPIRED";
  }
  if (start > now) {
    return "SCHEDULED";
  }
  return "ACTIVE";
}

function getStatusTone(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "DRAFT":
      return "neutral";
    case "SCHEDULED":
      return "info";
    case "EXPIRED":
      return "warning";
    default:
      return "neutral";
  }
}

export default function CartPerksDashboard() {
  const { bundles, pagination, filters, metrics, planInfo, availablePlans } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const { currentPlan, isLimitReached } = planInfo;

  const [searchQuery, setSearchQuery] = useState(filters.search);
  const [selectedBundles, setSelectedBundles] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "single" | "bulk";
    bundleId?: string;
    bundleTitle?: string;
    count?: number;
  } | null>(null);

  const [isChangingPlan, setIsChangingPlan] = useState(false);

  useEffect(() => {
    setSearchQuery(filters.search);
  }, [filters.search]);

  // Debounced search effect (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== filters.search) {
        updateFilters({ search: searchQuery, page: 1 });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, filters.search]);

  // Toast feedback on fetcher actions
  useEffect(() => {
    const data = fetcher.data as
      | { success: boolean; action?: string; error?: string; message?: string }
      | undefined;

    if (data?.success) {
      if (data.action === "delete") {
        shopify.toast.show("Perk has been deleted");
      } else if (data.action === "bulkDelete") {
        shopify.toast.show("Selected perks have been deleted");
      } else if (
        data.action === "updateStatus" ||
        data.action === "bulkUpdateStatus"
      ) {
        shopify.toast.show("Perk status updated successfully");
      } else if (data.action === "changePlan") {
        shopify.toast.show(data.message || "Plan changed successfully!");
        setIsChangingPlan(false);
      }
    } else if (data?.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const allSelected =
    bundles.length > 0 && selectedBundles.length === bundles.length;

  function toggleBundle(bundleId: string) {
    setSelectedBundles((current) => {
      if (current.includes(bundleId)) {
        return current.filter((id) => id !== bundleId);
      }
      return [...current, bundleId];
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedBundles([]);
    } else {
      setSelectedBundles(bundles.map((bundle) => bundle.id));
    }
  }

  function updateStatus(bundleId: string, status: string) {
    fetcher.submit(
      {
        action: "updateStatus",
        bundleId,
        status,
      },
      { method: "post" },
    );
  }

  function bulkUpdateStatus(status: string) {
    if (!selectedBundles.length) return;

    fetcher.submit(
      {
        action: "bulkUpdateStatus",
        bundleIds: JSON.stringify(selectedBundles),
        status,
      },
      { method: "post" },
    );

    setSelectedBundles([]);
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;

    if (deleteTarget.type === "single" && deleteTarget.bundleId) {
      fetcher.submit(
        {
          action: "delete",
          bundleId: deleteTarget.bundleId,
        },
        { method: "post" },
      );
    } else if (deleteTarget.type === "bulk") {
      fetcher.submit(
        {
          action: "bulkDelete",
          bundleIds: JSON.stringify(selectedBundles),
        },
        { method: "post" },
      );
      setSelectedBundles([]);
    }

    setDeleteTarget(null);
  }

  function updateFilters(
    newParams: Partial<{ search: string; status: string; page: number }>,
  ) {
    const params = new URLSearchParams();

    const searchVal =
      newParams.search !== undefined ? newParams.search : filters.search;
    const statusVal =
      newParams.status !== undefined ? newParams.status : filters.status;
    const pageVal = newParams.page !== undefined ? newParams.page : 1;

    if (searchVal) params.set("search", searchVal);
    if (statusVal && statusVal !== "ALL") params.set("status", statusVal);
    if (pageVal > 1) params.set("page", String(pageVal));

    navigate(`?${params.toString()}`);
  }

  function clearFilters() {
    setSearchQuery("");
    navigate("/app");
  }

  const modalHeading = deleteTarget
    ? deleteTarget.type === "single"
      ? `Delete "${deleteTarget.bundleTitle}"?`
      : `Delete ${deleteTarget.count} perk${(deleteTarget.count || 0) > 1 ? "s" : ""}?`
    : "Delete perk?";

  const modalDescription = deleteTarget
    ? deleteTarget.type === "single"
      ? `Are you sure you want to delete "${deleteTarget.bundleTitle}"? This will remove the perk from your storefront.`
      : `Are you sure you want to delete ${deleteTarget.count} selected perk${(deleteTarget.count || 0) > 1 ? "s" : ""}? This action cannot be undone.`
    : "Are you sure you want to delete this perk? This action cannot be undone.";

  return (
    <s-page heading="Cart Perks Dashboard">
      {/* HEADER ACTION */}
      <s-button slot="primary-action" href="/app/integration" variant="primary">
        Configure Perks ＋
      </s-button>

      {/* PLAN LIMIT WARNING BANNER */}
      {isLimitReached && (
        <s-section>
          <s-banner
            tone="warning"
            heading={`Active Perk Limit Reached (${metrics.activeBundleCount}/${currentPlan.bundleLimit})`}
          >
            <s-paragraph>
              You are currently using all{" "}
              <strong>{metrics.activeBundleCount}</strong> active perk slot(s)
              available on your <strong>{currentPlan.name} Plan</strong>.
              Upgrade your plan in Settings to unlock additional active perks.
            </s-paragraph>
            <s-button variant="secondary" href="/app/settings">
              Upgrade Plan ↗
            </s-button>
          </s-banner>
        </s-section>
      )}

      {/* METRICS SECTION */}
      <s-section heading="Overview & Performance Metrics">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          {/* 1. ACTIVE PERKS */}
          <s-box
            background={filters.status === "ACTIVE" ? "base" : "subdued"}
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
                <s-text tone="neutral">Active Perks</s-text>
                <s-badge tone="success">
                  {metrics.activeBundleCount} /{" "}
                  {currentPlan.bundleLimit >= 100
                    ? "∞"
                    : currentPlan.bundleLimit}
                </s-badge>
              </s-stack>

              <s-heading>
                {metrics.activeBundleCount} <s-text tone="neutral">Live</s-text>
              </s-heading>

              <s-button
                variant="tertiary"
                onClick={() => updateFilters({ status: "ACTIVE", page: 1 })}
              >
                {filters.status === "ACTIVE"
                  ? "✓ Filtering Active"
                  : "Filter Active →"}
              </s-button>
            </s-stack>
          </s-box>

          {/* 2. TOTAL CREATED */}
          <s-box
            background={
              filters.status === "ALL" && !filters.search ? "base" : "subdued"
            }
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
                <s-text tone="neutral">Total Created</s-text>
                <s-badge tone="info">All Perks</s-badge>
              </s-stack>

              <s-heading>{metrics.totalBundlesAll} Total</s-heading>

              <s-button
                variant="tertiary"
                onClick={() => updateFilters({ status: "ALL", page: 1 })}
              >
                View All Perks →
              </s-button>
            </s-stack>
          </s-box>

          {/* 3. DRAFT PERKS */}
          <s-box
            background={filters.status === "DRAFT" ? "base" : "subdued"}
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
                <s-text tone="neutral">Draft Perks</s-text>
                <s-badge tone="neutral">{metrics.draftBundleCount}</s-badge>
              </s-stack>

              <s-heading>
                {metrics.draftBundleCount}{" "}
                <s-text tone="neutral">Drafts</s-text>
              </s-heading>

              <s-button
                variant="tertiary"
                onClick={() => updateFilters({ status: "DRAFT", page: 1 })}
              >
                {filters.status === "DRAFT"
                  ? "✓ Filtering Drafts"
                  : "Filter Drafts →"}
              </s-button>
            </s-stack>
          </s-box>

          {/* 4. CURRENT PLAN */}
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
                <s-text tone="neutral">Current Plan</s-text>
                <s-badge tone={isLimitReached ? "warning" : "info"}>
                  ${currentPlan.price.toFixed(2)}/mo
                </s-badge>
              </s-stack>

              <s-heading>{currentPlan.name} Tier</s-heading>

              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  commandFor="change-plan-modal"
                  command="--show"
                >
                  Change Plan
                </s-button>
                <s-button variant="tertiary" href="/app/settings">
                  Settings ↗
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {/* QUICK PERK LAUNCHPAD */}
      <s-section heading="Quick Perk Launchpad">
        <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
          {/* Free Shipping Bar Tile */}
          <s-box
            border="base"
            borderRadius="base"
            padding="base"
            background="base"
          >
            <s-stack direction="block" gap="small">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-heading>🚚 Free Shipping Bar</s-heading>
                <s-badge tone="success">AOV Booster</s-badge>
              </s-stack>

              <s-paragraph tone="neutral">
                Dynamic cart goal and milestone discounts bar that motivates
                customers to increase order totals.
              </s-paragraph>

              <s-stack direction="inline" gap="small" alignItems="center">
                <s-button
                  variant="primary"
                  href="/app/integration/free-shipping-bar"
                >
                  Configure Shipping Bar ＋
                </s-button>
                <s-button variant="tertiary" href="/app/settings">
                  Theme Embed ↗
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>

          {/* Frequently Bought Together Tile */}
          <s-box
            border="base"
            borderRadius="base"
            padding="base"
            background="base"
          >
            <s-stack direction="block" gap="small">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-heading>🤝 Frequently Bought Together</s-heading>
                <s-badge tone="info">1-Click Cross-Sell</s-badge>
              </s-stack>

              <s-paragraph tone="neutral">
                Display 1-click add-to-cart cross-sell widgets with multi-item
                bundles on product pages.
              </s-paragraph>

              <s-stack direction="inline" gap="small" alignItems="center">
                <s-button variant="primary" href="/app/integration/fbt-bundle">
                  Configure FBT ＋
                </s-button>
                <s-button variant="tertiary" href="/app/settings">
                  Theme Customizer ↗
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {/* MANAGE PERKS TABLE */}
      <s-section heading="Manage Store Perks">
        <s-box
          background="base"
          borderRadius="base"
          borderWidth="base"
          borderColor="base"
          padding="none"
        >
          {/* SEARCH & FILTERS OR BULK ACTIONS BAR */}
          <s-box padding="base" border="base">
            {selectedBundles.length > 0 ? (
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-checkbox
                    checked={allSelected}
                    onChange={toggleAll}
                    accessibilityLabel="Select all perks"
                  />
                  <s-text>
                    <strong>{selectedBundles.length}</strong> selected
                  </s-text>
                </s-stack>

                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-button
                    variant="secondary"
                    disabled={isLimitReached}
                    onClick={() => {
                      if (isLimitReached) {
                        shopify.toast.show(
                          `${currentPlan.name} plan limit reached (${metrics.activeBundleCount}/${currentPlan.bundleLimit})`,
                          { isError: true },
                        );
                        return;
                      }
                      bulkUpdateStatus("ACTIVE");
                    }}
                  >
                    Set Active
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => bulkUpdateStatus("DRAFT")}
                  >
                    Set Draft
                  </s-button>
                  {isLimitReached && (
                    <s-badge tone="warning">
                      {currentPlan.name} plan limit reached
                    </s-badge>
                  )}
                  <s-button
                    variant="secondary"
                    tone="critical"
                    commandFor="delete-confirmation-modal"
                    command="--show"
                    onClick={(e: any) => {
                      e.stopPropagation();
                      setDeleteTarget({
                        type: "bulk",
                        count: selectedBundles.length,
                      });
                    }}
                  >
                    Delete
                  </s-button>
                </s-stack>
              </s-stack>
            ) : (
              <s-grid
                gap="base"
                gridTemplateColumns="1fr auto"
                alignItems="center"
              >
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-search-field
                    label="Search perks"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Search perks by title or description..."
                    value={searchQuery}
                    onInput={(event: any) =>
                      setSearchQuery(event.currentTarget.value)
                    }
                  />
                </s-stack>

                <s-select
                  label="Status"
                  labelAccessibilityVisibility="exclusive"
                  value={filters.status}
                  onChange={(event: any) => {
                    updateFilters({
                      status: event.currentTarget.value,
                      page: 1,
                    });
                  }}
                >
                  <s-option value="ALL">
                    All ({metrics.totalBundlesAll})
                  </s-option>
                  <s-option value="ACTIVE">
                    Active ({metrics.activeBundleCount})
                  </s-option>
                  <s-option value="DRAFT">
                    Draft ({metrics.draftBundleCount})
                  </s-option>
                  <s-option value="SCHEDULED">
                    Scheduled ({metrics.scheduledBundleCount})
                  </s-option>
                  <s-option value="EXPIRED">
                    Expired ({metrics.expiredBundleCount})
                  </s-option>
                </s-select>
              </s-grid>
            )}
          </s-box>

          {/* TABLE CONTENT OR EMPTY STATE */}
          {bundles.length === 0 ? (
            <EmptyState
              accessibilityLabel="No perks found"
              heading={
                filters.search || filters.status !== "ALL"
                  ? "No matching perks found"
                  : "No perks created yet"
              }
              description={
                filters.search || filters.status !== "ALL"
                  ? "No perks matched your search or status filter criteria. Try clearing or adjusting your filters."
                  : "Create your first Free Shipping Bar or Frequently Bought Together perk to start boosting conversion rates!"
              }
              primaryAction={{
                content:
                  filters.search || filters.status !== "ALL"
                    ? "Clear filters"
                    : "Configure Free Shipping Bar",
                href:
                  filters.search || filters.status !== "ALL"
                    ? undefined
                    : "/app/integration/free-shipping-bar",
                onClick:
                  filters.search || filters.status !== "ALL"
                    ? clearFilters
                    : undefined,
                accessibilityLabel: "Perks action",
              }}
            />
          ) : (
            <>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">
                    <s-checkbox
                      checked={allSelected}
                      onChange={toggleAll}
                      accessibilityLabel="Select all perks"
                    />
                  </s-table-header>
                  <s-table-header>Perk Name</s-table-header>
                  <s-table-header>Type</s-table-header>
                  <s-table-header format="numeric">Products</s-table-header>
                  <s-table-header>Discount</s-table-header>
                  <s-table-header>Created</s-table-header>
                  <s-table-header listSlot="secondary">Status</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {bundles.map((bundle) => {
                    const isSelected = selectedBundles.includes(bundle.id);
                    const formattedDate = new Date(
                      bundle.createdAt,
                    ).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    });

                    const effectiveStatus = getEffectiveStatus(bundle);

                    const isShippingBar =
                      bundle.bundleType === "FREE_SHIPPING_BAR";
                    const editUrl = isShippingBar
                      ? `/app/integration/free-shipping-bar?id=${bundle.id}`
                      : `/app/integration/fbt-bundle?id=${bundle.id}`;

                    return (
                      <s-table-row
                        key={bundle.id}
                        clickDelegate={`bundle-checkbox-${bundle.id}`}
                      >
                        <s-table-cell>
                          <s-checkbox
                            id={`bundle-checkbox-${bundle.id}`}
                            checked={isSelected}
                            onChange={() => toggleBundle(bundle.id)}
                          />
                        </s-table-cell>

                        <s-table-cell>
                          <s-stack direction="block" gap="none">
                            <s-link
                              onClick={(e: any) => {
                                e.stopPropagation();
                                navigate(editUrl);
                              }}
                            >
                              <s-text>
                                <strong>{bundle.title}</strong>
                              </s-text>
                            </s-link>
                            {bundle.bundleType != "FREE_SHIPPING_BAR" &&
                              bundle.description && (
                                <s-text tone="neutral">
                                  {bundle.description.slice(0, 50)}
                                  {bundle.description.length > 50 ? "..." : ""}
                                </s-text>
                              )}
                          </s-stack>
                        </s-table-cell>

                        <s-table-cell>
                          <s-badge tone="info">
                            {bundle.bundleType == "FREE_SHIPPING_BAR"
                              ? "Shipping Bar"
                              : "FBT"}
                          </s-badge>
                        </s-table-cell>

                        <s-table-cell>
                          {bundle.products?.length || 0}
                        </s-table-cell>

                        <s-table-cell>
                          <s-badge tone="success">
                            {formatDiscount(
                              bundle.discountType,
                              bundle.discountValue,
                              bundle.bundleType,
                            )}
                          </s-badge>
                        </s-table-cell>

                        <s-table-cell>{formattedDate}</s-table-cell>

                        <s-table-cell>
                          <s-badge tone={getStatusTone(effectiveStatus)}>
                            {effectiveStatus}
                          </s-badge>
                        </s-table-cell>

                        <s-table-cell>
                          <s-stack direction="inline" gap="small">
                            <s-button
                              variant="tertiary"
                              onClick={(e: any) => {
                                e.stopPropagation();
                                navigate(editUrl);
                              }}
                              accessibilityLabel={`Edit ${bundle.title}`}
                            >
                              Edit
                            </s-button>

                            <s-button
                              variant="tertiary"
                              tone="critical"
                              commandFor="delete-confirmation-modal"
                              command="--show"
                              onClick={(e: any) => {
                                e.stopPropagation();
                                setDeleteTarget({
                                  type: "single",
                                  bundleId: bundle.id,
                                  bundleTitle: bundle.title,
                                });
                              }}
                              accessibilityLabel={`Delete ${bundle.title}`}
                            >
                              Delete
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>

              {/* PAGINATION */}
              <Pagination
                pagination={pagination}
                onPageChange={(newPage) => updateFilters({ page: newPage })}
                itemLabel="perks"
              />
            </>
          )}
        </s-box>
      </s-section>

      {/* CONFIRMATION MODAL */}
      <ConfirmModal
        id="delete-confirmation-modal"
        heading={modalHeading}
        description={modalDescription}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmTone="critical"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* CHANGE PLAN MODAL */}
      <s-modal id="change-plan-modal" heading="Change Store Subscription Plan">
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-paragraph tone="neutral">
              Select a plan below to upgrade or switch your store's tier. Active
              limits and features update immediately in the database.
            </s-paragraph>

            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
              gap="base"
            >
              {availablePlans.map((plan) => {
                const isSelected = currentPlan.id === plan.id;
                return (
                  <s-box
                    key={plan.id}
                    border="base"
                    borderRadius="base"
                    padding="base"
                    background={isSelected ? "base" : "subdued"}
                  >
                    <s-stack direction="block" gap="small">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <s-heading>{plan.name}</s-heading>
                        {isSelected && (
                          <s-badge tone="success">Current</s-badge>
                        )}
                      </s-stack>

                      <s-heading>${plan.price.toFixed(2)}/mo</s-heading>

                      <s-text tone="neutral">
                        {plan.bundleLimit >= 100
                          ? "Unlimited Active Perks"
                          : `Up to ${plan.bundleLimit} Active Perk${plan.bundleLimit === 1 ? "" : "s"}`}
                      </s-text>

                      {plan.trialDays > 0 && (
                        <s-badge tone="info">
                          {plan.trialDays}-Day Free Trial
                        </s-badge>
                      )}

                      <s-button
                        variant={isSelected ? "secondary" : "primary"}
                        disabled={isSelected || fetcher.state !== "idle"}
                        commandFor="change-plan-modal"
                        command="--hide"
                        onClick={() => {
                          fetcher.submit(
                            {
                              action: "changePlan",
                              planId: plan.id,
                            },
                            { method: "post" },
                          );
                        }}
                      >
                        {isSelected
                          ? "Current Plan ✓"
                          : `Switch to ${plan.name}`}
                      </s-button>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-grid>

            <s-stack direction="inline" justifyContent="end" gap="small">
              <s-button commandFor="change-plan-modal" command="--hide">
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
