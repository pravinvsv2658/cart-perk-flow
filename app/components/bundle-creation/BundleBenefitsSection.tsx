export interface BundleBenefitsSectionProps {
  bundleType?:
    "FREE_SHIPPING_BAR" | "free_shipping_bar" | "FBT_BUNDLE" | "fbt" | string;
  bundleTitle?: string;
  discountType?: string;
  discountValue?: string | number;
  currencySymbol?: string;
  itemCount?: number;
  triggerType?: string;
  buyQuantity?: number;
  rewardQuantity?: number;
  isEditing?: boolean;
}

export function BundleBenefitsSection({
  bundleType = "FREE_SHIPPING_BAR",
  bundleTitle = "",
  discountType = "percentage",
  discountValue = 0,
  currencySymbol = "$",
  itemCount = 0,
  triggerType = "all",
  isEditing = false,
}: BundleBenefitsSectionProps) {
  const normalizedType = (bundleType || "FREE_SHIPPING_BAR").toUpperCase();
  const isFbt =
    normalizedType.includes("FBT") ||
    normalizedType.includes("FREQUENTLY_BOUGHT");
  const freeShippingBar =
    normalizedType.includes("FREE_SHIPPING_BAR") || !isFbt;

  // Format discount label
  const numDiscountVal =
    typeof discountValue === "number"
      ? discountValue
      : parseFloat(String(discountValue || "0")) || 0;

  let discountLabel = "No Discount";
  if (
    discountType === "PERCENTAGE" ||
    discountType === "percentage" ||
    discountType === "percent"
  ) {
    discountLabel =
      numDiscountVal >= 100
        ? "100% Free"
        : numDiscountVal > 0
          ? `${numDiscountVal}% OFF`
          : "No Discount";
  } else if (
    discountType === "FIXED_AMOUNT" ||
    discountType === "fixed_amount"
  ) {
    discountLabel =
      numDiscountVal > 0
        ? `${currencySymbol}${numDiscountVal.toFixed(2)} OFF`
        : "No Discount";
  }

  // Determine section heading
  let sectionHeading = "Perk Strategy & Store Benefits";
  if (bundleTitle && bundleTitle.trim()) {
    sectionHeading = `Strategy & Impact for "${bundleTitle.trim()}"`;
  } else if (isFbt) {
    sectionHeading = "Frequently Bought Together Strategy & Impact";
  } else if (freeShippingBar) {
    sectionHeading = "Free Shipping Bar Strategy & Impact";
  }

  return (
    <s-section heading={sectionHeading}>
      <s-box padding="base" background="base" borderRadius="base" border="base">
        <s-stack direction="block" gap="base">
          {/* TOP HEADER BADGES & DYNAMIC SUMMARY */}
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-stack direction="inline" gap="base" alignItems="center">
              {isFbt && (
                <>
                  <s-badge tone="success">1-Click Cross-Sell</s-badge>
                  <s-badge tone="info">Ajax Cart API</s-badge>
                </>
              )}
              {freeShippingBar && (
                <>
                  <s-badge tone="success">AOV Booster</s-badge>
                  <s-badge tone="info">Dynamic Cart Progress</s-badge>
                </>
              )}
              {isEditing && <s-badge tone="neutral">Live Edit Mode</s-badge>}
            </s-stack>

            <s-paragraph tone="neutral">
              {isEditing ? "Editing Active Offer" : "New Promotion Setup"}
            </s-paragraph>
          </s-stack>

          <s-divider direction="inline" />

          {/* DYNAMIC OVERVIEW PARAGRAPH */}
          {isFbt && (
            <s-paragraph>
              {bundleTitle
                ? `The "${bundleTitle}" widget `
                : "This Frequently Bought Together widget "}
              recommends{" "}
              {itemCount > 0
                ? `${itemCount} complementary items`
                : "curated accessories"}{" "}
              directly on high-intent product pages. Shoppers can toggle
              individual checkboxes and add all chosen items in a single click
              with <strong>{discountLabel}</strong> savings.
            </s-paragraph>
          )}

          {freeShippingBar && (
            <>
              <s-paragraph>
                The {bundleTitle ? `"${bundleTitle}"` : "Free Shipping Bar"}{" "}
                motivates shoppers to add more items to their cart by
                dynamically displaying their progress toward free shipping and
                milestone rewards. This transparent spending incentive boosts
                cart totals and lifts conversion rates without manual promo
                codes.
              </s-paragraph>
              <s-paragraph>
                Only one free shipping bar will be created per store to ensure
                better management and tracking.
              </s-paragraph>
            </>
          )}

          {/* DYNAMIC METRICS GRID */}
          {!freeShippingBar && (
            <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
              <s-box
                background="subdued"
                border="base"
                borderRadius="base"
                padding="base"
              >
                <s-heading>+18% - +32%</s-heading>
                <s-paragraph tone="neutral">Expected AOV Lift</s-paragraph>
              </s-box>

              <s-box
                background="subdued"
                border="base"
                borderRadius="base"
                padding="base"
              >
                <s-heading>1-Click Ajax</s-heading>
                <s-paragraph tone="neutral">Checkout Engine</s-paragraph>
              </s-box>

              <s-box
                background="subdued"
                border="base"
                borderRadius="base"
                padding="base"
              >
                <s-heading>{discountLabel}</s-heading>
                <s-paragraph tone="neutral">Configured Discount</s-paragraph>
              </s-box>

              <s-box
                background="subdued"
                border="base"
                borderRadius="base"
                padding="base"
              >
                <s-heading>
                  {(() => {
                    const norm = (triggerType || "").toLowerCase();
                    if (norm === "product" || norm === "specific") {
                      return "Target Products";
                    }
                    if (norm === "collection") {
                      return "Collection";
                    }
                    if (norm === "tag" || norm === "tags") {
                      return "Product Tags";
                    }
                    return "All Products";
                  })()}
                </s-heading>
                <s-paragraph tone="neutral">Display Trigger</s-paragraph>
              </s-box>
            </s-grid>
          )}

          {/* KEY BENEFITS LIST */}
          <s-heading>Key Benefits for Your Store:</s-heading>
          <s-unordered-list>
            {freeShippingBar && (
              <>
                <s-list-item>
                  <s-text type="strong">Encourage Higher Cart Values:</s-text>{" "}
                  Set free shipping thresholds that motivate customers to add
                  more items to their cart to unlock shipping rewards and
                  increase AOV.
                </s-list-item>

                <s-list-item>
                  <s-text type="strong">
                    Reward Every Spending Milestone:
                  </s-text>{" "}
                  Offer tiered discounts at different cart totals, such as 10%
                  off at $150 and 20% off at $300, encouraging customers to
                  spend more to unlock better rewards.
                </s-list-item>

                <s-list-item>
                  <s-text type="strong">
                    Create Urgency to Complete Purchases:
                  </s-text>{" "}
                  Show customers how much more they need to spend to unlock free
                  shipping or their next discount, motivating them to add more
                  products before checkout.
                </s-list-item>

                <s-list-item>
                  <s-text type="strong">
                    Increase Conversion &amp; Average Order Value:
                  </s-text>{" "}
                  Turn shipping and discount goals into purchase incentives that
                  encourage customers to discover additional products and
                  increase their cart totals.
                </s-list-item>

                <s-list-item>
                  <s-text type="strong">Automatic Rewards at Checkout:</s-text>{" "}
                  Make eligible shipping rewards and discounts easy to unlock
                  without requiring customers to enter coupon codes manually.
                </s-list-item>
              </>
            )}

            {isFbt && (
              <>
                <s-list-item>
                  <s-text type="strong">High-Intent Cross-Selling:</s-text>{" "}
                  Leverages Amazon&apos;s proven cross-sell pattern right beside
                  the primary buy button.
                </s-list-item>
                <s-list-item>
                  <s-text type="strong">
                    Dynamic Real-Time Recalculations:
                  </s-text>{" "}
                  Shoppers immediately see their total savings update as they
                  check or uncheck items.
                </s-list-item>
                <s-list-item>
                  <s-text type="strong">Zero Layout Shift (CLS):</s-text> App
                  block integrates natively with modern Shopify Online Store 2.0
                  themes without jarring page jumps.
                </s-list-item>
                <s-list-item>
                  <s-text type="strong">1-Click Multi-Item Purchase:</s-text>{" "}
                  Adds all selected variants to cart simultaneously in a single
                  transaction.
                </s-list-item>
              </>
            )}
          </s-unordered-list>

          {/* THEME APP BLOCK PLACEMENT GUIDANCE */}
          <s-box
            padding="base"
            background="subdued"
            border="base"
            borderRadius="base"
          >
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text type="strong">🎨 Theme App Block: </s-text>
              <code>
                {isFbt && "Frequently Bought Together"}
                {freeShippingBar && "Free Shipping Bar"}
              </code>

              {freeShippingBar && (
                <s-stack gap="base">
                  <s-text type="strong">
                    Add Free Shipping Bar to Your Storefront using custom code
                    instead of app block, use this snippet.
                  </s-text>

                  <s-text color="subdued">
                    Copy this code and add it to your Shopify cart page Liquid
                    template where you want the free shipping bar to appear.
                  </s-text>

                  <s-box
                    padding="base"
                    background="subdued"
                    borderRadius="base"
                    borderWidth="base"
                    borderColor="base"
                  >
                    <s-stack gap="base">
                      <code>
                        &lt;div class="cartperks-free-shipping-bar"
                        data-cart-total="" data-free-shipping-target=""
                        data-discount-thresholds=""&gt;&amp;nbsp;&lt;/div&gt;
                      </code>

                      <s-button
                        variant="primary"
                        onClick={() => {
                          const snippet = `<div class="cartperks-free-shipping-bar" data-cart-total="" data-free-shipping-target="" data-discount-thresholds="">&nbsp;</div>`;
                          navigator.clipboard.writeText(snippet);
                        }}
                      >
                        Copy HTML Code
                      </s-button>
                    </s-stack>
                  </s-box>
                </s-stack>
              )}
            </s-stack>
          </s-box>

          {/* DYNAMIC PRO-TIP BOX */}
          <s-banner
            tone={numDiscountVal >= 30 ? "warning" : "info"}
            heading={
              numDiscountVal >= 30
                ? "High Discount Pro-Tip"
                : isEditing
                  ? "Live Update Best Practice"
                  : "Conversion Optimization Pro-Tip"
            }
          >
            <s-paragraph>
              {numDiscountVal >= 30
                ? `Offering a generous ${discountLabel} discount creates immense purchase urgency. Highlight this as a limited-time flash sale in your marketing channels!`
                : isEditing
                  ? "Updates to this perk save instantly to Shopify and take effect immediately on your storefront without disrupting existing active shopping carts."
                  : freeShippingBar
                    ? "Set your primary shipping goal 15-25% higher than your current Average Order Value (AOV) to motivate customers to add another item to their cart."
                    : "Place this Frequently Bought Together block right beneath the product buy buttons or above customer reviews for maximum visibility."}
            </s-paragraph>
          </s-banner>
        </s-stack>
      </s-box>
    </s-section>
  );
}
