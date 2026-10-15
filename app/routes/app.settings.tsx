import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getOrCreateStore } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  // Fetch shop details and themes from Shopify Admin GraphQL API
  let shopData = {
    name: session.shop,
    email: "",
    myshopifyDomain: session.shop,
    currencyCode: "USD",
  };
  let themes: Array<{
    gid: string;
    id: string;
    name: string;
    role: string;
    isLive: boolean;
  }> = [];

  let sampleProductHandle = "gift-card";

  try {
    const response = await admin.graphql(
      `#graphql
      query getShopAndThemes {
        shop {
          name
          email
          myshopifyDomain
          currencyCode
        }
        themes(first: 20) {
          nodes {
            id
            name
            role
            processing
          }
        }
        products(first: 1) {
          nodes {
            handle
          }
        }
      }`,
    );
    const responseJson = await response.json();
    if (responseJson.data?.products?.nodes?.[0]?.handle) {
      sampleProductHandle = responseJson.data.products.nodes[0].handle;
    }
    if (responseJson.data?.shop) {
      shopData = {
        name: responseJson.data.shop.name || session.shop,
        email: responseJson.data.shop.email || "",
        myshopifyDomain: responseJson.data.shop.myshopifyDomain || session.shop,
        currencyCode: responseJson.data.shop.currencyCode || "USD",
      };
    }

    const rawThemes = responseJson.data?.themes?.nodes || [];
    themes = rawThemes.map((t: any) => {
      const numericId = t.id ? t.id.split("/").pop() || "" : "";
      return {
        gid: t.id,
        id: numericId,
        name: t.name,
        role: t.role || "UNPUBLISHED",
        isLive: String(t.role || "").toUpperCase() === "MAIN",
      };
    });
  } catch (error) {
    console.warn("Could not query Shopify themes/shop data:", error);
  }

  // Fallback theme if none returned
  if (themes.length === 0) {
    themes = [
      {
        gid: "gid://shopify/OnlineStoreTheme/current",
        id: "current",
        name: "Live Store Theme (Default)",
        role: "MAIN",
        isLive: true,
      },
    ];
  }

  // Query real plans from DB or seed defaults
  let plans = await prisma.plan.findMany({
    orderBy: { price: "asc" },
  });

  if (plans.length === 0) {
    const freePlan = await prisma.plan.create({
      data: {
        name: "Free",
        price: 0,
        currency: "USD",
        billingInterval: "EVERY_30_DAYS",
        trialDays: 0,
        bundleLimit: 1,
        features: "1 Active Bundle, Community Support",
      },
    });

    const starterPlan = await prisma.plan.create({
      data: {
        name: "Starter",
        price: 9.99,
        currency: "USD",
        billingInterval: "EVERY_30_DAYS",
        trialDays: 14,
        bundleLimit: 5,
        features: "5 Active Bundles, Priority Support, Analytics",
      },
    });

    const proPlan = await prisma.plan.create({
      data: {
        name: "Pro",
        price: 19.99,
        currency: "USD",
        billingInterval: "EVERY_30_DAYS",
        trialDays: 14,
        bundleLimit: 999,
        features:
          "Unlimited Active Bundles, 24/7 Priority Support, Full Analytics, Custom Styling",
      },
    });

    plans = [freePlan, starterPlan, proPlan];
  }

  // Fetch real subscription history for this store
  const subscriptions = await prisma.subscription.findMany({
    where: { shopId: store.id },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });

  const activeBundlesCount = await prisma.bundle.count({
    where: { storeId: store.id, status: "ACTIVE" },
  });

  const storeWithCount = {
    ...store,
    _count: { bundles: activeBundlesCount },
  };

  return {
    shop: session.shop,
    shopData,
    themes,
    store: storeWithCount,
    plans,
    subscriptions,
    sampleProductHandle,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const planId = formData.get("planId");

  if (intent === "selectPlan" || intent === "changePlan" || planId) {
    const targetPlanQuery = String(planId || formData.get("planName") || "");
    let targetPlan = await prisma.plan.findUnique({
      where: { id: targetPlanQuery },
    });
    if (!targetPlan) {
      targetPlan = await prisma.plan.findFirst({
        where: { name: targetPlanQuery },
      });
    }

    if (!targetPlan) {
      return Response.json(
        { success: false, error: "Plan not found in database" },
        { status: 404 },
      );
    }

    await prisma.store.update({
      where: { id: store.id },
      data: { planId: targetPlan.id },
    });

    await prisma.subscription.updateMany({
      where: { shopId: store.id, status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });

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
      include: { plan: true },
    });

    return Response.json({
      success: true,
      message: `Plan changed to "${targetPlan.name}" successfully!`,
      plan: targetPlan,
      subscription,
    });
  }

  return Response.json({
    success: true,
    message: "Settings saved successfully.",
  });
};

export default function SettingsPage() {
  const {
    shop,
    shopData,
    themes,
    store,
    plans,
    subscriptions,
    sampleProductHandle,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const billingFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    error?: string;
    confirmationUrl?: string | null;
    plan?: any;
    subscription?: any;
  }>();
  const shopify = useAppBridge();

  const isBillingSubmitting = billingFetcher.state !== "idle";
  const submittingPlanId = billingFetcher.formData?.get("planId") as
    string | undefined;

  useEffect(() => {
    if (billingFetcher.state === "idle" && billingFetcher.data) {
      if (billingFetcher.data.error) {
        shopify.toast.show(billingFetcher.data.error, { isError: true });
      } else if (billingFetcher.data.confirmationUrl) {
        shopify.toast.show(
          billingFetcher.data.message || "Redirecting to Shopify Billing...",
        );
        window.open(billingFetcher.data.confirmationUrl, "_top");
      } else if (billingFetcher.data.success) {
        shopify.toast.show(
          billingFetcher.data.message || "Plan updated successfully!",
        );
      }
    }
  }, [billingFetcher.state, billingFetcher.data, shopify]);

  const handleSubscribePlan = (targetPlanId: string) => {
    billingFetcher.submit(
      { planId: targetPlanId },
      { action: "/api/billing/create", method: "POST" },
    );
  };

  // Active top-level settings tab
  const [activeTab, setActiveTab] = useState<"themes" | "plans" | "storeInfo">(
    "themes",
  );

  // Selected theme ID for Theme Customizer redirect
  const defaultTheme = themes.find((t) => t.isLive) || themes[0];
  const [selectedThemeId, setSelectedThemeId] = useState<string>(
    defaultTheme?.id || "current",
  );

  // Current active plan
  const currentPlanId = store?.planId || plans[0]?.id || "";
  const currentPlan = plans.find((p) => p.id === currentPlanId) ||
    plans[0] || {
      id: "free",
      name: "Free",
      price: 0.0,
      currency: "USD",
      billingInterval: "EVERY_30_DAYS",
      trialDays: 0,
      bundleLimit: 1,
      features: "Up to 1 Active Bundle, Cart Transform, Standard Support",
    };

  const freePlan =
    plans.find((p) => p.name.toLowerCase().includes("free")) || plans[0];
  const starterPlan =
    plans.find((p) => p.name.toLowerCase().includes("starter")) ||
    plans[1] ||
    plans[0];
  const proPlan =
    plans.find(
      (p) =>
        p.name.toLowerCase().includes("pro") ||
        p.name.toLowerCase().includes("enterprise"),
    ) ||
    plans[2] ||
    plans[0];

  // Find currently selected theme object
  const currentThemeObj =
    themes.find((t) => t.id === selectedThemeId) || themes[0];

  // Construct Theme Editor URLs
  const shopHandle = (shopData?.myshopifyDomain || shop)
    .replace(/^https?:\/\//, "")
    .replace(/\.myshopify\.com\/?$/, "");

  const themeEditorBaseUrl =
    selectedThemeId === "current"
      ? `https://admin.shopify.com/store/${shopHandle}/themes/current/editor`
      : `https://admin.shopify.com/store/${shopHandle}/themes/${selectedThemeId}/editor`;

  const previewPath = encodeURIComponent(
    `/products/${sampleProductHandle || "gift-card"}`,
  );
  const themeEditorProductUrl = `${themeEditorBaseUrl}?previewPath=${previewPath}`;
  const themeEditorAppEmbedUrl = `${themeEditorBaseUrl}?context=apps`;

  // Direct product page URLs for perk blocks (opens the product page preview directly in theme customizer)
  const fbtBundleBlockUrl = `${themeEditorBaseUrl}?previewPath=${previewPath}`;

  const isSubmitting = fetcher.state === "submitting";
  const actionData = fetcher.data as
    { success?: boolean; message?: string; intent?: string } | undefined;

  return (
    <s-page heading="App Settings & Configuration">
      {/* PRIMARY ACTION */}
      <s-button slot="primary-action" variant="primary" href="/app/integration">
        Configure Perks ＋
      </s-button>

      {/* SUCCESS / FEEDBACK BANNER */}
      {actionData?.message && (
        <s-section>
          <s-banner
            tone={actionData.success ? "success" : "critical"}
            heading={actionData.success ? "Settings Saved" : "Action Notice"}
          >
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* BILLING API FEEDBACK BANNER */}
      {billingFetcher.data?.message && (
        <s-section>
          <s-banner
            tone={billingFetcher.data.success ? "success" : "critical"}
            heading={
              billingFetcher.data.success ? "Plan Updated" : "Billing Notice"
            }
          >
            <s-paragraph>{billingFetcher.data.message}</s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* TOP SETTINGS NAVIGATION TABS */}
      <s-section>
        <s-box
          padding="base"
          background="base"
          border="base"
          borderRadius="base"
        >
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button
              variant={activeTab === "themes" ? "primary" : "secondary"}
              onClick={() => setActiveTab("themes")}
            >
              🎨 Theme Blocks Setup
            </s-button>
            <s-button
              variant={activeTab === "plans" ? "primary" : "secondary"}
              onClick={() => setActiveTab("plans")}
            >
              💎 Plans &amp; Subscription
            </s-button>
            <s-button
              variant={activeTab === "storeInfo" ? "primary" : "secondary"}
              onClick={() => setActiveTab("storeInfo")}
            >
              ⚙️ Store Info
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* ========================================================================= */}
      {/* TAB 1: THEME BLOCKS SETUP & THEME CUSTOMIZER REDIRECT */}
      {/* ========================================================================= */}
      {activeTab === "themes" && (
        <>
          <s-section heading="Theme Blocks Setup &amp; Customizer">
            <s-box
              padding="base"
              background="base"
              border="base"
              borderRadius="base"
            >
              <s-stack direction="block" gap="base">
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>Select Target Theme</s-heading>
                    <s-paragraph tone="neutral">
                      Choose any published or unpublished theme on your store to
                      launch the Shopify Theme Customizer and position your
                      Bundle App Blocks.
                    </s-paragraph>
                  </s-stack>
                  <s-badge tone="success">Online Store 2.0 Ready</s-badge>
                </s-stack>

                <s-divider direction="inline" />

                {/* THEME SELECTION DROPDOWN */}
                <s-box
                  background="subdued"
                  padding="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <s-text type="strong">Choose Store Theme:</s-text>
                      {currentThemeObj?.isLive ? (
                        <s-badge tone="success">🟢 Live / Published</s-badge>
                      ) : (
                        <s-badge tone="neutral">Draft / Unpublished</s-badge>
                      )}
                    </s-stack>

                    <s-stack direction="inline" gap="base" alignItems="end">
                      <s-select
                        label="Select Theme"
                        value={selectedThemeId}
                        onChange={(e: any) =>
                          setSelectedThemeId(e.target.value)
                        }
                      >
                        {themes.map((t) => (
                          <s-option key={t.id} value={t.id}>
                            {t.name}{" "}
                            {t.isLive
                              ? "★ (Live Main Theme)"
                              : `(${t.role.toLowerCase()})`}
                          </s-option>
                        ))}
                      </s-select>

                      <s-button
                        variant="primary"
                        href={themeEditorProductUrl}
                        target="_blank"
                      >
                        Open Theme Editor ↗
                      </s-button>
                    </s-stack>

                    <s-paragraph tone="neutral">
                      Selected Theme: <strong>{currentThemeObj?.name}</strong>{" "}
                      {currentThemeObj?.isLive
                        ? "★ (Live Main Theme)"
                        : `(${currentThemeObj?.role.toLowerCase()})`}
                    </s-paragraph>
                  </s-stack>
                </s-box>

                {/* QUICK APP BLOCK DEEP-LINKS */}
                <s-heading>Product Page Customization Links</s-heading>
                <s-paragraph tone="neutral">
                  Click any block below to open the Theme Customizer directly on
                  the Product Page where you can position and configure your
                  bundle widgets:
                </s-paragraph>

                <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
                  {/* FBT Perk Widget */}
                  <s-box
                    background="subdued"
                    border="base"
                    borderRadius="base"
                    padding="base"
                  >
                    <s-stack direction="block" gap="base">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <s-heading>🤝 Frequently Bought</s-heading>
                        <s-badge tone="success">1-Click Multi-Add</s-badge>
                      </s-stack>
                      <s-paragraph>
                        Amazon-style cross-sell widget with interactive
                        checkboxes and real-time total calculation.
                      </s-paragraph>
                      <s-button
                        variant="secondary"
                        href={fbtBundleBlockUrl}
                        target="_blank"
                      >
                        Add FBT Widget ↗
                      </s-button>
                    </s-stack>
                  </s-box>

                  {/* Free Shipping Bar Perk */}
                  <s-box
                    background="subdued"
                    border="base"
                    borderRadius="base"
                    padding="base"
                  >
                    <s-stack direction="block" gap="base">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <s-heading>🚚 Free Shipping Bar</s-heading>
                        <s-badge tone="info">AOV Booster</s-badge>
                      </s-stack>
                      <s-paragraph>
                        Dynamic cart goal and milestone discounts bar that
                        motivates customers to increase order totals.
                      </s-paragraph>
                      <s-button
                        variant="secondary"
                        href="/app/integration/free-shipping-bar"
                      >
                        Configure Shipping Bar ↗
                      </s-button>
                    </s-stack>
                  </s-box>
                </s-grid>

                {/* APP EMBED & ZERO CODE GUIDE */}
                <s-divider direction="inline" />

                <s-stack background="base" direction="block" gap="base">
                  <s-stack direction="block" gap="small">
                    <s-heading>Global App Embed Script</s-heading>
                    <s-paragraph tone="neutral">
                      Ensure the global bundle engine app embed is toggled ON in
                      your theme for optimized styling and fastest load speeds.
                      Click this button and enable{" "}
                      <strong>Ecommerce Flows</strong> app embed.
                    </s-paragraph>
                  </s-stack>
                  <s-button
                    variant="primary"
                    href={themeEditorAppEmbedUrl}
                    target="_blank"
                  >
                    Open App Embeds Settings ↗
                  </s-button>
                </s-stack>

                <s-banner tone="info" heading="Zero-Shift Theme App Extension">
                  <s-paragraph>
                    All bundle blocks are injected natively using Shopify Online
                    Store 2.0 architecture. When no bundle is active on a
                    product page, the app block automatically remains completely
                    hidden with 0px layout shift.
                  </s-paragraph>
                </s-banner>
              </s-stack>
            </s-box>
          </s-section>
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PLANS & SUBSCRIPTION SETTINGS */}
      {/* ========================================================================= */}
      {activeTab === "plans" && (
        <s-section heading="Plans &amp; Subscription Settings">
          <s-box
            padding="base"
            background="base"
            border="base"
            borderRadius="base"
          >
            <s-stack direction="block" gap="base">
              {/* CURRENT ACTIVE PLAN BANNER */}
              <s-box
                background="subdued"
                padding="base"
                border="base"
                borderRadius="base"
              >
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-heading>Current Plan: {currentPlan.name}</s-heading>
                    <s-badge tone="success">Active</s-badge>
                    <s-badge tone="info">
                      ${currentPlan.price.toFixed(2)} / month
                    </s-badge>
                  </s-stack>

                  <s-paragraph tone="neutral">
                    Active Bundles:{" "}
                    <strong>{store?._count?.bundles || 0}</strong> /{" "}
                    <strong>
                      {currentPlan.bundleLimit >= 100
                        ? "Unlimited"
                        : currentPlan.bundleLimit}
                    </strong>
                  </s-paragraph>
                </s-stack>
              </s-box>

              {/* TIERED PLANS COMPARISON */}
              <s-heading>Choose the Right Plan for Your Growth</s-heading>
              <s-paragraph tone="neutral">
                Scale your bundle campaigns with zero checkout friction. Upgrade
                or downgrade at any time with automated Shopify Billing.
              </s-paragraph>

              <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
                {/* 1. FREE PLAN */}
                <s-box
                  border="base"
                  borderRadius="base"
                  padding="base"
                  background={
                    currentPlan.name.toLowerCase().includes("free")
                      ? "base"
                      : "subdued"
                  }
                >
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <s-heading>Free Plan</s-heading>
                      <s-badge tone="neutral">Free Forever</s-badge>
                    </s-stack>

                    <s-stack direction="block" gap="small">
                      <s-heading>
                        ${Number(freePlan?.price ?? 0).toFixed(2)} / mo
                      </s-heading>
                      <s-text tone="neutral">No credit card required</s-text>
                    </s-stack>

                    <s-paragraph tone="neutral">
                      Ideal for new stores launching their first bundle
                      promotions.
                    </s-paragraph>

                    <s-divider direction="inline" />

                    <s-unordered-list>
                      <s-list-item>
                        {freePlan?.bundleLimit && freePlan.bundleLimit >= 100
                          ? "Unlimited Active Bundles"
                          : `Up to ${freePlan?.bundleLimit ?? 1} Active Bundle${(freePlan?.bundleLimit ?? 1) === 1 ? "" : "s"}`}
                      </s-list-item>
                      <s-list-item>
                        Frequently Bought Together &amp; Free Shipping Bar
                      </s-list-item>
                      <s-list-item>Automatic Discounts</s-list-item>
                      <s-list-item>Standard Community Support</s-list-item>
                    </s-unordered-list>

                    <s-button
                      variant={
                        currentPlan.name.toLowerCase().includes("free")
                          ? "secondary"
                          : "primary"
                      }
                      disabled={
                        currentPlan.name.toLowerCase().includes("free") ||
                        isBillingSubmitting
                      }
                      onClick={() => {
                        const targetPlan =
                          plans.find((p) =>
                            p.name.toLowerCase().includes("free"),
                          ) || plans[0];
                        if (targetPlan) {
                          handleSubscribePlan(targetPlan.id);
                        }
                      }}
                    >
                      {currentPlan.name.toLowerCase().includes("free")
                        ? "Current Plan ✓"
                        : isBillingSubmitting &&
                            submittingPlanId === freePlan?.id
                          ? "Switching Plan..."
                          : "Downgrade to Free"}
                    </s-button>
                  </s-stack>
                </s-box>

                {/* 2. STARTER PLAN */}
                <s-box
                  border="base"
                  borderRadius="base"
                  padding="base"
                  background={
                    currentPlan.name.toLowerCase().includes("starter")
                      ? "base"
                      : "subdued"
                  }
                >
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <s-heading>Starter Plan</s-heading>
                      <s-badge tone="info">Popular ⭐</s-badge>
                    </s-stack>

                    <s-stack direction="block" gap="small">
                      <s-heading>
                        ${Number(starterPlan?.price ?? 9.99).toFixed(2)} / mo
                      </s-heading>
                      <s-badge tone="success">14-Day Free Trial</s-badge>
                    </s-stack>

                    <s-paragraph tone="neutral">
                      For growing stores maximizing Average Order Value (AOV).
                      14 days free, then billed monthly.
                    </s-paragraph>

                    <s-divider direction="inline" />

                    <s-unordered-list>
                      <s-list-item>14-Day Free Trial included</s-list-item>
                      <s-list-item>All from Free plan</s-list-item>
                      <s-list-item>
                        {starterPlan?.bundleLimit &&
                        starterPlan.bundleLimit >= 100
                          ? "Unlimited Active Bundles"
                          : `Up to ${starterPlan?.bundleLimit ?? 5} Active Bundles`}
                      </s-list-item>
                      <s-list-item>
                        Frequently Bought Together &amp; Shipping Bar Widgets
                      </s-list-item>
                      <s-list-item>
                        Free Shipping Bar (Multiple threshold Discounts)
                      </s-list-item>
                      <s-list-item>Real-Time Inventory Sync</s-list-item>
                      <s-list-item>Custom CSS &amp; Theme Styling</s-list-item>
                      <s-list-item>Priority 24/7 Support</s-list-item>
                    </s-unordered-list>

                    <s-button
                      variant={
                        currentPlan.name.toLowerCase().includes("starter")
                          ? "secondary"
                          : "primary"
                      }
                      disabled={
                        currentPlan.name.toLowerCase().includes("starter") ||
                        isBillingSubmitting
                      }
                      onClick={() => {
                        const targetPlan =
                          plans.find((p) =>
                            p.name.toLowerCase().includes("starter"),
                          ) ||
                          plans[1] ||
                          plans[0];
                        if (targetPlan) {
                          handleSubscribePlan(targetPlan.id);
                        }
                      }}
                    >
                      {currentPlan.name.toLowerCase().includes("starter")
                        ? "Current Plan ✓"
                        : isBillingSubmitting &&
                            submittingPlanId === starterPlan?.id
                          ? "Processing..."
                          : currentPlan.price > (starterPlan?.price ?? 9.99)
                            ? "Downgrade to Starter"
                            : "Start 14-Day Free Trial"}
                    </s-button>
                  </s-stack>
                </s-box>

                {/* 3. PRO PLAN */}
                <s-box
                  border="base"
                  borderRadius="base"
                  padding="base"
                  background={
                    currentPlan.name.toLowerCase().includes("pro") ||
                    currentPlan.name.toLowerCase().includes("enterprise")
                      ? "base"
                      : "subdued"
                  }
                >
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <s-heading>Pro Plan</s-heading>
                      <s-badge tone="success">
                        {proPlan?.bundleLimit && proPlan.bundleLimit >= 100
                          ? "Unlimited Bundles"
                          : `${proPlan?.bundleLimit} Bundles`}
                      </s-badge>
                    </s-stack>

                    <s-stack direction="block" gap="small">
                      <s-heading>
                        ${Number(proPlan?.price ?? 19.99).toFixed(2)} / mo
                      </s-heading>
                      <s-badge tone="success">14-Day Free Trial</s-badge>
                    </s-stack>

                    <s-paragraph tone="neutral">
                      For high-volume merchants demanding dedicated support and
                      scale. 14 days free, then billed monthly.
                    </s-paragraph>

                    <s-divider direction="inline" />

                    <s-unordered-list>
                      <s-list-item>14-Day Free Trial included</s-list-item>
                      <s-list-item>All from Starter plan</s-list-item>
                      <s-list-item>
                        {proPlan?.bundleLimit && proPlan.bundleLimit >= 100
                          ? "Unlimited Active Bundles"
                          : `Up to ${proPlan?.bundleLimit ?? 999} Active Bundles`}
                      </s-list-item>
                      <s-list-item>24/7 Dedicated Support</s-list-item>
                    </s-unordered-list>

                    <s-button
                      variant={
                        currentPlan.name.toLowerCase().includes("pro") ||
                        currentPlan.name.toLowerCase().includes("enterprise")
                          ? "secondary"
                          : "primary"
                      }
                      disabled={
                        currentPlan.name.toLowerCase().includes("pro") ||
                        currentPlan.name.toLowerCase().includes("enterprise") ||
                        isBillingSubmitting
                      }
                      onClick={() => {
                        const targetPlan =
                          plans.find(
                            (p) =>
                              p.name.toLowerCase().includes("pro") ||
                              p.name.toLowerCase().includes("enterprise"),
                          ) ||
                          plans[2] ||
                          plans[0];
                        if (targetPlan) {
                          handleSubscribePlan(targetPlan.id);
                        }
                      }}
                    >
                      {currentPlan.name.toLowerCase().includes("pro") ||
                      currentPlan.name.toLowerCase().includes("enterprise")
                        ? "Current Plan ✓"
                        : isBillingSubmitting &&
                            submittingPlanId === proPlan?.id
                          ? "Processing..."
                          : "Start 14-Day Free Trial"}
                    </s-button>
                  </s-stack>
                </s-box>
              </s-grid>

              <s-banner tone="info" heading="Shopify Billing Guarantee">
                <s-paragraph>
                  All charges are processed securely through Shopify's official
                  recurring billing API. You will only be billed after your
                  first 14-day trial period, and you can cancel anytime with a
                  single click.
                </s-paragraph>
              </s-banner>

              {/* SUBSCRIPTION AUDIT HISTORY */}
              <s-box
                border="base"
                borderRadius="base"
                padding="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-heading>Subscription &amp; Billing History</s-heading>
                    <s-badge tone="neutral">
                      {subscriptions.length} Record
                      {subscriptions.length === 1 ? "" : "s"}
                    </s-badge>
                  </s-stack>

                  <s-paragraph tone="neutral">
                    Complete audit trail of your store's plan subscriptions,
                    tier upgrades, and billing status.
                  </s-paragraph>

                  {subscriptions.length === 0 ? (
                    <s-box
                      border="base"
                      borderRadius="base"
                      padding="base"
                      background="base"
                    >
                      <s-paragraph tone="neutral">
                        No subscription history records found yet. Changing your
                        plan will create an immutable audit record.
                      </s-paragraph>
                    </s-box>
                  ) : (
                    <s-stack direction="block" gap="small">
                      {subscriptions.map((sub) => (
                        <s-box
                          key={sub.id}
                          border="base"
                          borderRadius="base"
                          padding="base"
                          background="base"
                        >
                          <s-stack
                            direction="inline"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <s-stack
                              direction="inline"
                              gap="small"
                              alignItems="center"
                            >
                              <s-text type="strong">{sub.name} Plan</s-text>
                              <s-badge
                                tone={
                                  sub.status === "ACTIVE"
                                    ? "success"
                                    : "neutral"
                                }
                              >
                                {sub.status}
                              </s-badge>
                              {sub.trialDays > 0 && (
                                <s-badge tone="info">
                                  {sub.trialDays}d Trial
                                </s-badge>
                              )}
                            </s-stack>

                            <s-stack
                              direction="inline"
                              gap="base"
                              alignItems="center"
                            >
                              <s-text>
                                ${sub.price.toFixed(2)} {sub.currency} /{" "}
                                {sub.interval.replace(/_/g, " ").toLowerCase()}
                              </s-text>
                              <s-text tone="neutral">
                                Started:{" "}
                                {new Date(sub.createdAt).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )}
                              </s-text>
                            </s-stack>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: STORE & SYSTEM INFO */}
      {/* ========================================================================= */}
      {activeTab === "storeInfo" && (
        <s-section heading="Store Information &amp; Architecture Status">
          <s-box
            padding="base"
            background="base"
            border="base"
            borderRadius="base"
          >
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
                <s-box
                  background="subdued"
                  border="base"
                  borderRadius="base"
                  padding="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Connected Store Domain:</s-text>
                    <code>{shopData.myshopifyDomain || shop}</code>
                    <s-paragraph tone="neutral">
                      Store Name: {shopData.name} | Currency:{" "}
                      {shopData.currencyCode}
                    </s-paragraph>
                  </s-stack>
                </s-box>

                <s-box
                  background="subdued"
                  border="base"
                  borderRadius="base"
                  padding="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Theme App Extension:</s-text>
                    <s-badge tone="info">OS 2.0 App Blocks</s-badge>
                  </s-stack>
                </s-box>
              </s-grid>
            </s-stack>
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
