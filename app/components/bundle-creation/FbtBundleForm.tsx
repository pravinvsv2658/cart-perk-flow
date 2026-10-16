import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { BundleBenefitsSection } from "./BundleBenefitsSection";

export interface FbtProductItem {
  id?: string;
  shopifyId: string;
  title: string;
  price: number;
  featuredImage?: string;
  qty: number;
  role?: string;
}

export interface FbtTriggerItem {
  id?: string;
  shopifyId: string;
  title?: string;
  image?: string;
}

export type FbtTriggerType = "ALL" | "PRODUCT" | "COLLECTION" | "TAGS";

export interface FbtBundleFormData {
  bundleId?: string;
  title: string;
  bundleName?: string;
  description?: string;
  badgeText?: string;
  ctaButtonText?: string;
  triggerType: FbtTriggerType;
  discountType: "NO_DISCOUNT" | "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  status: "ACTIVE" | "DRAFT";
  startDate: string;
  endDate: string | null;
  products: FbtProductItem[];
  triggerProducts: FbtTriggerItem[];
  triggerCollections: FbtTriggerItem[];
  tags: string[];
}

export interface FbtBundleFormInitialData {
  id?: string;
  bundleId?: string;
  title?: string;
  bundleName?: string;
  description?: string;
  badgeText?: string;
  ctaButtonText?: string;
  triggerType?: string;
  discountType?: string;
  discountValue?: number | string;
  status?: string;
  startDate?: string | Date;
  endDate?: string | Date | null;
  products?: FbtProductItem[];
  triggerProducts?: FbtTriggerItem[];
  triggerCollections?: FbtTriggerItem[];
  tags?: string[] | { tag: string }[];
  [key: string]: unknown;
}

export interface FbtBundleFormProps {
  initialData?: FbtBundleFormInitialData;
  availableTags?: string[];
  currencySymbol?: string;
  isSubmitting?: boolean;
  submitButtonLabel?: string;
  submittingLabel?: string;
  onSubmit?: (formData: FbtBundleFormData) => void;
  onCancel?: () => void;
  pageTitle?: string;
  isLimitReached?: boolean;
  activeBundleCount?: number;
  bundleLimit?: number;
  isEditing?: boolean;
}

function formatDateTimeLocal(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = date.getDate();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function FbtBundleForm({
  initialData,
  availableTags = [],
  currencySymbol = "$",
  isSubmitting = false,
  submitButtonLabel = "Create Perk",
  submittingLabel = "Saving...",
  onSubmit,
  onCancel,
  isLimitReached = false,
  activeBundleCount,
  bundleLimit,
  isEditing = false,
}: FbtBundleFormProps) {
  const shopify = useAppBridge();

  const [bundleId, setBundleId] = useState<string | undefined>(
    initialData?.id || initialData?.bundleId,
  );

  useEffect(() => {
    if (initialData?.id || initialData?.bundleId) {
      setBundleId(initialData.id || initialData.bundleId);
    }
  }, [initialData?.id, initialData?.bundleId]);

  // Form State
  const [bundleTitle, setBundleTitle] = useState<string>(
    String(
      initialData?.title ||
        initialData?.bundleName ||
        "Frequently Bought Together Set",
    ).trim() || "Frequently Bought Together Set",
  );

  const [badgeText, setBadgeText] = useState<string>(
    initialData?.badgeText || "Frequently Bought Together",
  );

  const [ctaButtonText, setCtaButtonText] = useState<string>(
    initialData?.ctaButtonText || "Add Selected to Cart",
  );

  const [description, setDescription] = useState<string>(
    initialData?.description || "",
  );

  // Trigger Type
  const [triggerType, setTriggerType] = useState<FbtTriggerType>(() => {
    const raw = initialData?.triggerType;
    if (raw === "PRODUCT" || raw === "COLLECTION" || raw === "TAGS") {
      return raw;
    }
    if (raw === "TAG") return "TAGS";
    if (raw === "SPECIFIC") {
      if (initialData?.tags && (initialData.tags as unknown[]).length > 0) {
        return "TAGS";
      }
      if (
        initialData?.triggerCollections &&
        initialData.triggerCollections.length > 0
      ) {
        return "COLLECTION";
      }
      return "PRODUCT";
    }
    return "ALL";
  });

  // Trigger collections & products & tags
  const [triggerProducts, setTriggerProducts] = useState<FbtTriggerItem[]>(
    initialData?.triggerProducts || [],
  );

  const [triggerCollections, setTriggerCollections] = useState<
    FbtTriggerItem[]
  >(initialData?.triggerCollections || []);

  const [tags, setTags] = useState<string[]>(() => {
    if (!initialData?.tags) return [];
    if (Array.isArray(initialData.tags)) {
      return initialData.tags.map((t) =>
        typeof t === "string" ? t : (t as { tag: string }).tag,
      );
    }
    return [];
  });

  const [tagFilter, setTagFilter] = useState<string>("");

  // Preview Modal Checkbox States
  const [previewChecked, setPreviewChecked] = useState<Record<string, boolean>>(
    {},
  );
  const isPreviewChecked = (key: string) => previewChecked[key] !== false;
  const togglePreviewCheck = (key: string) => {
    setPreviewChecked((prev) => ({
      ...prev,
      [key]: !isPreviewChecked(key),
    }));
  };

  // Products
  const [products, setProducts] = useState<FbtProductItem[]>(
    initialData?.products || [],
  );

  // Discount
  const [discountType, setDiscountType] = useState<
    "NO_DISCOUNT" | "PERCENTAGE" | "FIXED_AMOUNT"
  >(
    (initialData?.discountType as
      "NO_DISCOUNT" | "PERCENTAGE" | "FIXED_AMOUNT") || "PERCENTAGE",
  );

  const [discountValue, setDiscountValue] = useState<string>(
    initialData?.discountValue !== undefined &&
      initialData?.discountValue !== null
      ? String(initialData.discountValue)
      : "10",
  );

  // Status & Schedule
  const [status, setStatus] = useState<"ACTIVE" | "DRAFT">(() => {
    if (initialData?.status) {
      return initialData.status === "DRAFT" ? "DRAFT" : "ACTIVE";
    }
    return isLimitReached && !isEditing ? "DRAFT" : "ACTIVE";
  });

  const [startDate, setStartDate] = useState<string>(() => {
    return formatDateTimeLocal(initialData?.startDate || new Date());
  });

  const [endDate, setEndDate] = useState<string>(() => {
    return initialData?.endDate ? formatDateTimeLocal(initialData.endDate) : "";
  });

  // Validation errors
  const [titleError, setTitleError] = useState("");
  const [productError, setProductError] = useState("");
  const [triggerError, setTriggerError] = useState("");
  const [discountError, setDiscountError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  // Helper to ensure Shopify GID format for resourcePicker selectionIds
  const formatGid = (
    id?: string,
    type: "Product" | "Collection" = "Product",
  ) => {
    if (!id) return "";
    const trimmed = String(id).trim();
    if (trimmed.startsWith(`gid://shopify/${type}/`)) return trimmed;
    const digits = trimmed.replace(/\D/g, "");
    return digits ? `gid://shopify/${type}/${digits}` : "";
  };

  // Product Selector using App Bridge Resource Picker
  const handleSelectProducts = async () => {
    try {
      const picker =
        (shopify as any)?.resourcePicker ||
        (window as any)?.shopify?.resourcePicker;

      if (typeof picker === "function") {
        const selectionIds = products
          .map((p) => formatGid(p.shopifyId, "Product"))
          .filter(Boolean)
          .map((id) => ({ id }));

        const selection = await picker({
          type: "product",
          multiple: true,
          selectionIds,
        });

        if (Array.isArray(selection)) {
          const existingMap = new Map<string, FbtProductItem>();
          products.forEach((p) => {
            if (p.shopifyId) {
              existingMap.set(p.shopifyId, p);
              const digits = p.shopifyId.replace(/\D/g, "");
              if (digits) existingMap.set(digits, p);
            }
          });

          const updatedItems: FbtProductItem[] = selection.map((p: any) => {
            const digits = String(p.id || "").replace(/\D/g, "");
            const existing =
              existingMap.get(p.id) ||
              (digits ? existingMap.get(digits) : undefined);

            const rawPrice =
              p.variants?.[0]?.price ??
              p.priceRange?.minVariantPrice?.amount ??
              existing?.price;
            const price =
              parseFloat(String(rawPrice || "0")) || (existing?.price ?? 0);
            const featuredImage =
              p.images?.[0]?.originalSrc ||
              p.images?.[0]?.src ||
              p.featuredImage?.url ||
              existing?.featuredImage ||
              "";

            return {
              ...(existing || {}),
              shopifyId: p.id,
              title: p.title || existing?.title || "Selected Product",
              price,
              featuredImage,
              qty: 1,
              role: "BUNDLE_ITEM",
            };
          });

          setProducts(updatedItems);
          setProductError("");
        }
      } else {
        shopify.toast.show("Opening product picker...");
      }
    } catch (err) {
      console.warn("ResourcePicker product error:", err);
    }
  };

  // Trigger Products Selector
  const handleSelectTriggerProducts = async () => {
    try {
      const picker =
        (shopify as any)?.resourcePicker ||
        (window as any)?.shopify?.resourcePicker;

      if (typeof picker === "function") {
        const selectionIds = triggerProducts
          .map((p) => formatGid(p.shopifyId, "Product"))
          .filter(Boolean)
          .map((id) => ({ id }));

        const selection = await picker({
          type: "product",
          multiple: true,
          selectionIds,
        });

        if (Array.isArray(selection)) {
          const existingMap = new Map<string, FbtTriggerItem>();
          triggerProducts.forEach((tp) => {
            if (tp.shopifyId) {
              existingMap.set(tp.shopifyId, tp);
              const digits = tp.shopifyId.replace(/\D/g, "");
              if (digits) existingMap.set(digits, tp);
            }
          });

          const newTriggers: FbtTriggerItem[] = selection.map((p: any) => {
            const digits = String(p.id || "").replace(/\D/g, "");
            const existing =
              existingMap.get(p.id) ||
              (digits ? existingMap.get(digits) : undefined);

            return {
              ...(existing || {}),
              shopifyId: p.id,
              title: p.title || existing?.title || "Target Product",
              image:
                p.images?.[0]?.originalSrc ||
                p.images?.[0]?.src ||
                p.featuredImage?.url ||
                existing?.image ||
                "",
            };
          });

          setTriggerProducts(newTriggers);
          setTriggerError("");
        }
      }
    } catch (err) {
      console.warn("ResourcePicker trigger product error:", err);
    }
  };

  // Trigger Collections Selector
  const handleSelectTriggerCollections = async () => {
    try {
      const picker =
        (shopify as any)?.resourcePicker ||
        (window as any)?.shopify?.resourcePicker;

      if (typeof picker === "function") {
        const selectionIds = triggerCollections
          .map((c) => formatGid(c.shopifyId, "Collection"))
          .filter(Boolean)
          .map((id) => ({ id }));

        const selection = await picker({
          type: "collection",
          multiple: true,
          selectionIds,
        });

        if (Array.isArray(selection)) {
          const existingMap = new Map<string, FbtTriggerItem>();
          triggerCollections.forEach((tc) => {
            if (tc.shopifyId) {
              existingMap.set(tc.shopifyId, tc);
              const digits = tc.shopifyId.replace(/\D/g, "");
              if (digits) existingMap.set(digits, tc);
            }
          });

          const newCols: FbtTriggerItem[] = selection.map((c: any) => {
            const digits = String(c.id || "").replace(/\D/g, "");
            const existing =
              existingMap.get(c.id) ||
              (digits ? existingMap.get(digits) : undefined);

            return {
              ...(existing || {}),
              shopifyId: c.id,
              title: c.title || existing?.title || "Collection",
              image: c.image?.src || c.image?.url || existing?.image || "",
            };
          });

          setTriggerCollections(newCols);
          setTriggerError("");
        }
      }
    } catch (err) {
      console.warn("ResourcePicker trigger collection error:", err);
    }
  };

  const toggleTag = (tagName: string) => {
    const clean = tagName.trim();
    if (!clean) return;
    setTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === clean.toLowerCase());
      if (exists) {
        return prev.filter((t) => t.toLowerCase() !== clean.toLowerCase());
      } else {
        return [...prev, clean];
      }
    });
    setTriggerError("");
  };

  const handleRemoveTag = (index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveProduct = (index: number) => {
    setProducts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveTriggerProduct = (index: number) => {
    setTriggerProducts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveTriggerCollection = (index: number) => {
    setTriggerCollections((prev) => prev.filter((_, i) => i !== index));
  };

  // Filtered available store tags for popup
  const filteredAvailableTags = availableTags.filter((t) =>
    t.toLowerCase().includes(tagFilter.toLowerCase()),
  );

  // Calculations
  const totalPrice = products.reduce(
    (acc, p) => acc + (p.price || 0) * (p.qty || 1),
    0,
  );

  const numDiscount = parseFloat(discountValue) || 0;
  let calculatedDiscount = 0;
  if (discountType === "PERCENTAGE") {
    calculatedDiscount =
      (totalPrice * Math.min(100, Math.max(0, numDiscount))) / 100;
  } else if (discountType === "FIXED_AMOUNT") {
    calculatedDiscount = Math.min(totalPrice, Math.max(0, numDiscount));
  }
  const discountedBundlePrice = Math.max(0, totalPrice - calculatedDiscount);

  // Form Submission Validation
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let hasError = false;

    // Title validation
    if (!bundleTitle.trim()) {
      setTitleError(
        "Please enter a title for this Frequently Bought Together perk.",
      );
      hasError = true;
    } else {
      setTitleError("");
    }

    // Products validation
    if (products.length === 0) {
      setProductError(
        "Please select at least one complementary product to bundle together.",
      );
      hasError = true;
    } else {
      setProductError("");
    }

    // Trigger validation
    if (triggerType === "PRODUCT" && triggerProducts.length === 0) {
      setTriggerError(
        "Please select at least one target product where this bundle will be displayed.",
      );
      hasError = true;
    } else if (
      triggerType === "COLLECTION" &&
      triggerCollections.length === 0
    ) {
      setTriggerError(
        "Please select at least one target collection where this bundle will be displayed.",
      );
      hasError = true;
    } else if (triggerType === "TAGS" && tags.length === 0) {
      setTriggerError(
        "Please select or add at least one product tag to match target products.",
      );
      hasError = true;
    } else {
      setTriggerError("");
    }

    // Discount validation
    if (discountType === "PERCENTAGE") {
      if (isNaN(numDiscount) || numDiscount < 0 || numDiscount > 100) {
        setDiscountError("Percentage discount must be between 0% and 100%.");
        hasError = true;
      } else {
        setDiscountError("");
      }
    } else if (discountType === "FIXED_AMOUNT") {
      if (isNaN(numDiscount) || numDiscount < 0) {
        setDiscountError("Fixed amount discount cannot be negative.");
        hasError = true;
      } else {
        setDiscountError("");
      }
    } else {
      setDiscountError("");
    }

    // Date validation
    if (endDate && startDate) {
      const s = new Date(startDate);
      const en = new Date(endDate);
      if (en <= s) {
        setScheduleError("End Date must be after the Start Date.");
        hasError = true;
      } else {
        setScheduleError("");
      }
    } else {
      setScheduleError("");
    }

    if (hasError) return;

    if (onSubmit) {
      onSubmit({
        bundleId: bundleId || initialData?.id || initialData?.bundleId,
        title: bundleTitle.trim(),
        bundleName: bundleTitle.trim(),
        description: description.trim(),
        badgeText: badgeText.trim(),
        ctaButtonText: ctaButtonText.trim(),
        triggerType,
        discountType,
        discountValue: numDiscount,
        status,
        startDate: startDate
          ? new Date(startDate).toISOString()
          : new Date().toISOString(),
        endDate: endDate ? new Date(endDate).toISOString() : null,
        products,
        triggerProducts: triggerType === "PRODUCT" ? triggerProducts : [],
        triggerCollections:
          triggerType === "COLLECTION" ? triggerCollections : [],
        tags: triggerType === "TAGS" ? tags : [],
      });
    }
  };

  return (
    <>
      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
        padding="base"
      >
        <s-stack direction="inline" alignItems="center" gap="small">
          <s-button icon="arrow-left" onClick={onCancel}>
            Back
          </s-button>
          <s-stack gap="none">
            <s-heading>Frequently Bought Together – Perk Settings:</s-heading>
            <s-text color="subdued">
              Configure complementary products, discounts, and bundle offers to
              encourage customers to purchase multiple items.
            </s-text>
          </s-stack>
        </s-stack>
      </s-stack>

      <form onSubmit={handleFormSubmit}>
        <s-stack direction="block" gap="base" padding="base">
          {/* Plan limit warning banner */}
          {isLimitReached && !isEditing && (
            <s-banner tone="warning" heading="Plan Limit Reached">
              <s-paragraph>
                You have reached your active perk limit ({activeBundleCount}/
                {bundleLimit}). This perk will be saved as{" "}
                <strong>Draft</strong>. Upgrade your plan in Settings to
                activate more perks.
              </s-paragraph>
            </s-banner>
          )}

          {/* 1. Perk Name & Widget Labels */}
          <s-box
            padding="base"
            background="base"
            borderRadius="base"
            border="base"
          >
            <s-stack direction="block" gap="base">
              <s-heading>1. Perk Name &amp; Widget Labels</s-heading>
              <s-text color="subdued">
                Define the promotion name and customer-facing headings displayed
                on product pages.
              </s-text>

              <s-text-field
                label="Perk Name (Internal &amp; Admin)"
                name="bundleTitle"
                value={bundleTitle}
                error={titleError || undefined}
                onInput={(event: any) => {
                  setBundleTitle(event.currentTarget.value);
                  if (titleError) setTitleError("");
                }}
              />

              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                gap="base"
              >
                <s-text-field
                  label="Badge / Header Text"
                  value={badgeText}
                  onInput={(event: any) =>
                    setBadgeText(event.currentTarget.value)
                  }
                />

                <s-text-field
                  label="Call to Action (CTA) Button"
                  value={ctaButtonText}
                  onInput={(event: any) =>
                    setCtaButtonText(event.currentTarget.value)
                  }
                />
              </s-grid>

              <s-text-field
                label="Optional Subtitle / Promotional Note"
                value={description}
                onInput={(event: any) =>
                  setDescription(event.currentTarget.value)
                }
              />
            </s-stack>
          </s-box>

          {/* 2. Display Location & Triggers */}
          <s-box
            padding="base"
            background="base"
            borderRadius="base"
            border="base"
          >
            <s-stack direction="block" gap="base">
              <s-heading>2. Where to Display this Perk</s-heading>
              <s-text color="subdued">
                Choose whether this Frequently Bought Together recommendation
                appears across all product catalog pages, specific products,
                specific collections, or matching product tags.
              </s-text>

              <s-select
                label="Display Target"
                value={triggerType}
                onChange={(event: any) => {
                  setTriggerType(event.currentTarget.value as FbtTriggerType);
                  setTriggerError("");
                }}
              >
                <s-option value="ALL">
                  All Product Pages (Storewide Recommended Set)
                </s-option>
                <s-option value="PRODUCT">Specific Products</s-option>
                <s-option value="COLLECTION">Specific Collections</s-option>
                <s-option value="TAGS">Specific Product Tags</s-option>
              </s-select>

              {triggerError && (
                <s-banner tone="critical">
                  <s-paragraph>{triggerError}</s-paragraph>
                </s-banner>
              )}

              {/* SEPARATED TRIGGER OPTIONS */}

              {/* A. ALL PRODUCTS */}
              {triggerType === "ALL" && (
                <s-box
                  padding="base"
                  background="subdued"
                  borderRadius="base"
                  border="base"
                >
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <span style={{ fontSize: "20px" }}>🌐</span>
                    <s-stack direction="block" gap="small">
                      <s-text>
                        <strong>Storewide Display Enabled</strong>
                      </s-text>
                      <s-text color="subdued">
                        This bundle will appear on all product pages across your
                        store as a general cross-sell recommendation set.
                      </s-text>
                    </s-stack>
                  </s-stack>
                </s-box>
              )}

              {/* B. SPECIFIC PRODUCTS */}
              {triggerType === "PRODUCT" && (
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-text color="subdued">
                      Display this perk only when visitors view any of the
                      selected target products.
                    </s-text>
                    <s-button onClick={handleSelectTriggerProducts}>
                      ＋ Select Target Products ({triggerProducts.length}{" "}
                      selected)
                    </s-button>
                  </s-stack>

                  {triggerProducts.length > 0 ? (
                    <s-stack gap="small">
                      <s-text color="subdued">
                        Widget will display on ({triggerProducts.length})
                        product page(s):
                      </s-text>
                      {triggerProducts.map((p, idx) => {
                        const gid = formatGid(p.shopifyId, "Product");
                        const matchedProduct = products.find(
                          (prod) =>
                            prod.shopifyId === p.shopifyId ||
                            prod.shopifyId === gid ||
                            (prod.shopifyId &&
                              p.shopifyId &&
                              prod.shopifyId.replace(/\D/g, "") ===
                                p.shopifyId.replace(/\D/g, "")),
                        );
                        const productTitle =
                          p.title ||
                          matchedProduct?.title ||
                          `Product #${idx + 1}`;
                        const productImage =
                          p.image || matchedProduct?.featuredImage;

                        return (
                          <s-grid
                            key={p.shopifyId || idx}
                            gridTemplateColumns="36px 1fr auto"
                            gap="small"
                            alignItems="center"
                          >
                            {productImage ? (
                              <s-image alt={productTitle} src={productImage} />
                            ) : (
                              <s-box background="subdued" borderRadius="base" />
                            )}
                            <s-button
                              onClick={() => {
                                (shopify as any)?.intents?.invoke?.(
                                  "edit:shopify/Product",
                                  {
                                    value: gid,
                                  },
                                );
                              }}
                              target="_blank"
                              variant="tertiary"
                            >
                              <strong>{productTitle}</strong>
                            </s-button>
                            <s-button
                              variant="tertiary"
                              onClick={() => handleRemoveTriggerProduct(idx)}
                            >
                              ✕
                            </s-button>
                          </s-grid>
                        );
                      })}
                    </s-stack>
                  ) : (
                    <s-text color="subdued">
                      No target products selected yet. Click "Select Target
                      Products".
                    </s-text>
                  )}
                </s-stack>
              )}

              {/* C. SPECIFIC COLLECTIONS */}
              {triggerType === "COLLECTION" && (
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-text color="subdued">
                      Display this perk on all products belonging to the
                      selected collections.
                    </s-text>
                    <s-button onClick={handleSelectTriggerCollections}>
                      ＋ Select Target Collections ({triggerCollections.length}{" "}
                      selected)
                    </s-button>
                  </s-stack>

                  {triggerCollections.length > 0 ? (
                    <s-stack gap="small">
                      <s-text color="subdued">
                        Widget will display on all products in (
                        {triggerCollections.length}) collection(s):
                      </s-text>
                      {triggerCollections.map((col, idx) => {
                        const gid = formatGid(col.shopifyId, "Collection");
                        return (
                          <s-grid
                            key={col.shopifyId || idx}
                            gridTemplateColumns="36px 1fr auto"
                            gap="small"
                            alignItems="center"
                          >
                            {col.image ? (
                              <s-image
                                alt={col.title || "Collection"}
                                src={col.image}
                              />
                            ) : (
                              <s-box background="subdued" borderRadius="base" />
                            )}
                            <s-button
                              onClick={() => {
                                (shopify as any)?.intents?.invoke?.(
                                  "edit:shopify/Collection",
                                  {
                                    value: gid,
                                  },
                                );
                              }}
                              target="_blank"
                              variant="tertiary"
                            >
                              <strong>
                                {col.title || `Collection #${idx + 1}`}
                              </strong>
                            </s-button>
                            <s-button
                              variant="tertiary"
                              onClick={() => handleRemoveTriggerCollection(idx)}
                            >
                              ✕
                            </s-button>
                          </s-grid>
                        );
                      })}
                    </s-stack>
                  ) : (
                    <s-text color="subdued">
                      No target collections selected yet. Click "Select Target
                      Collections".
                    </s-text>
                  )}
                </s-stack>
              )}

              {/* D. SPECIFIC PRODUCT TAGS */}
              {triggerType === "TAGS" && (
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-text color="subdued">
                      Display this perk on any product page whose product has
                      one of the selected product tags from your store catalog.
                    </s-text>
                    <s-button
                      commandFor="available-tags-modal"
                      command="--show"
                      variant="primary"
                    >
                      🏷️ Select from Available Product Tags (
                      {availableTags.length})
                    </s-button>
                  </s-stack>

                  {tags.length === 0 ? (
                    <s-box
                      padding="large"
                      border="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-stack
                        direction="block"
                        gap="small"
                        alignItems="center"
                      >
                        <s-text tone="neutral">
                          No product tags selected yet.
                        </s-text>
                        <s-text color="subdued">
                          Choose from your store's {availableTags.length}{" "}
                          available product tags to trigger this bundle.
                        </s-text>
                        <s-button
                          commandFor="available-tags-modal"
                          command="--show"
                          variant="primary"
                        >
                          🏷️ Select Product Tags
                        </s-button>
                      </s-stack>
                    </s-box>
                  ) : (
                    <s-box
                      padding="small"
                      background="subdued"
                      borderRadius="base"
                      border="base"
                    >
                      <s-stack direction="block" gap="small">
                        <s-stack
                          direction="inline"
                          justifyContent="space-between"
                          alignItems="center"
                        >
                          <s-text tone="neutral">
                            <strong>Active Target Tags ({tags.length}):</strong>
                          </s-text>
                          <s-stack direction="inline" gap="small">
                            <s-button
                              commandFor="available-tags-modal"
                              command="--show"
                            >
                              Edit Tags Selection
                            </s-button>
                            <s-button
                              variant="tertiary"
                              onClick={() => setTags([])}
                            >
                              Clear all
                            </s-button>
                          </s-stack>
                        </s-stack>
                        <s-stack direction="inline" gap="small">
                          {tags.map((tag, idx) => (
                            <s-badge key={`${tag}-${idx}`} tone="info">
                              🏷️ {tag}
                              <s-button
                                variant="tertiary"
                                onClick={() => handleRemoveTag(idx)}
                              >
                                ✕
                              </s-button>
                            </s-badge>
                          ))}
                        </s-stack>
                      </s-stack>
                    </s-box>
                  )}
                </s-stack>
              )}
            </s-stack>
          </s-box>

          {/* 3. Frequently Bought Together Products */}
          <s-box
            padding="base"
            background="base"
            borderRadius="base"
            border="base"
          >
            <s-stack direction="block" gap="base">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <div>
                  <s-heading>3. Frequently Bought Together Products</s-heading>
                  <s-text color="subdued">
                    Complementary products bundled and cross-sold together with
                    1-click Add to Cart.
                  </s-text>
                </div>
                <s-button variant="primary" onClick={handleSelectProducts}>
                  🛒 Select Products from Catalog
                </s-button>
              </s-stack>

              {productError && (
                <s-banner tone="critical">
                  <s-paragraph>{productError}</s-paragraph>
                </s-banner>
              )}

              {/* Products List */}
              {products.length === 0 ? (
                <s-box
                  padding="large"
                  border="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="base" alignItems="center">
                    <div style={{ fontSize: "36px" }}>🛍️</div>
                    <s-heading>
                      No complementary products selected yet
                    </s-heading>
                    <s-paragraph tone="neutral">
                      Choose 1 or more products from your Shopify catalog that
                      will be recommended together in this bundle.
                    </s-paragraph>
                    <s-button variant="primary" onClick={handleSelectProducts}>
                      🛒 Select Products from Catalog
                    </s-button>
                  </s-stack>
                </s-box>
              ) : (
                <s-stack direction="block" gap="small">
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Item</s-table-header>
                      <s-table-header>Title</s-table-header>
                      <s-table-header>Price</s-table-header>
                      <s-table-header>Action</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {products.map((item, index) => {
                        const gid = formatGid(item.shopifyId, "Product");
                        return (
                          <s-table-row key={item.shopifyId || index}>
                            <s-table-cell>
                              <div
                                onClick={() => {
                                  (shopify as any)?.intents?.invoke?.(
                                    "edit:shopify/Product",
                                    {
                                      value: gid,
                                    },
                                  );
                                }}
                                style={{
                                  width: "44px",
                                  height: "44px",
                                  borderRadius: "6px",
                                  overflow: "hidden",
                                  background: "#f1f2f3",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                }}
                              >
                                {item.featuredImage ? (
                                  <s-image
                                    alt={item.title}
                                    src={item.featuredImage}
                                  />
                                ) : (
                                  <span>📦</span>
                                )}
                              </div>
                            </s-table-cell>
                            <s-table-cell>
                              <s-button
                                onClick={() => {
                                  (shopify as any)?.intents?.invoke?.(
                                    "edit:shopify/Product",
                                    {
                                      value: gid,
                                    },
                                  );
                                }}
                                target="_blank"
                                variant="tertiary"
                              >
                                <strong>{item.title}</strong>
                              </s-button>
                            </s-table-cell>
                            <s-table-cell>
                              {currencySymbol}
                              {(item.price || 0).toFixed(2)}
                            </s-table-cell>
                            <s-table-cell>
                              <s-badge tone="info">
                                <s-button
                                  variant="tertiary"
                                  onClick={() => handleRemoveProduct(index)}
                                >
                                  ✕
                                </s-button>
                              </s-badge>
                            </s-table-cell>
                          </s-table-row>
                        );
                      })}
                    </s-table-body>
                  </s-table>

                  <s-stack direction="inline" justifyContent="end">
                    <s-button onClick={handleSelectProducts}>
                      ＋ Add More Products
                    </s-button>
                  </s-stack>
                </s-stack>
              )}
            </s-stack>
          </s-box>

          {/* 4. Discount & Pricing Configuration */}
          <s-box
            padding="base"
            background="base"
            borderRadius="base"
            border="base"
          >
            <s-stack direction="block" gap="base">
              <s-heading>4. Bundle Discount &amp; Pricing</s-heading>
              <s-text color="subdued">
                Give customers an incentive to purchase all items together with
                a bundle discount.
              </s-text>

              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                gap="base"
              >
                <s-select
                  label="Discount Type"
                  value={discountType}
                  onChange={(event: any) =>
                    setDiscountType(
                      event.currentTarget.value as
                        "NO_DISCOUNT" | "PERCENTAGE" | "FIXED_AMOUNT",
                    )
                  }
                >
                  <s-option value="PERCENTAGE">
                    Percentage Discount (%)
                  </s-option>
                  <s-option value="FIXED_AMOUNT">
                    Fixed Amount Discount ({currencySymbol})
                  </s-option>
                  <s-option value="NO_DISCOUNT">
                    No Discount (Regular Price)
                  </s-option>
                </s-select>

                {discountType !== "NO_DISCOUNT" && (
                  <s-text-field
                    label={
                      discountType === "PERCENTAGE"
                        ? "Discount Percentage (%)"
                        : `Discount Amount (${currencySymbol})`
                    }
                    value={discountValue}
                    error={discountError || undefined}
                    onInput={(event: any) => {
                      setDiscountValue(event.currentTarget.value);
                      if (discountError) setDiscountError("");
                    }}
                  />
                )}
              </s-grid>

              {/* Live Price Calculation Summary */}
              {products.length > 0 && (
                <s-box
                  padding="base"
                  background="subdued"
                  borderRadius="base"
                  border="base"
                >
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-stack direction="block" gap="small">
                      <s-text tone="neutral">Combined Regular Price:</s-text>
                      <s-heading>
                        {currencySymbol}
                        {totalPrice.toFixed(2)}
                      </s-heading>
                    </s-stack>

                    <s-stack direction="block" gap="small">
                      <s-text tone="neutral">Bundle Discount:</s-text>
                      <s-heading>
                        - {currencySymbol}
                        {calculatedDiscount.toFixed(2)}{" "}
                        {discountType === "PERCENTAGE" && `(${numDiscount}%)`}
                      </s-heading>
                    </s-stack>

                    <s-stack direction="block" gap="small">
                      <s-text tone="neutral">Shopper Bundle Price:</s-text>
                      <s-heading>
                        <span style={{ color: "#008060" }}>
                          {currencySymbol}
                          {discountedBundlePrice.toFixed(2)}
                        </span>
                      </s-heading>
                    </s-stack>
                  </s-stack>
                </s-box>
              )}
            </s-stack>
          </s-box>

          {/* 5. Schedule & Expiration */}
          <s-box
            padding="base"
            background="base"
            borderRadius="base"
            border="base"
          >
            <s-stack direction="block" gap="base">
              <s-heading>5. Schedule &amp; Expiration</s-heading>
              <s-text color="subdued">
                Optionally schedule when this perk goes live and when it
                expires. Perks with future start dates show as Scheduled, and
                past end dates show as Expired.
              </s-text>

              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                gap="base"
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                  >
                    Start Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    name="startDate"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                  >
                    End Date &amp; Time (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    name="endDate"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </s-grid>

              {scheduleError && (
                <s-banner tone="critical">
                  <s-paragraph>{scheduleError}</s-paragraph>
                </s-banner>
              )}

              <s-banner tone="info">
                <s-paragraph>
                  • <strong>Draft</strong> perks remain unpublished regardless
                  of dates.
                  <br />• <strong>Active</strong> perks with a future start date
                  automatically show as <strong>Scheduled</strong>.<br />•
                  Active perks whose end date has passed automatically show as{" "}
                  <strong>Expired</strong>.
                </s-paragraph>
              </s-banner>
            </s-stack>
          </s-box>

          {/* 6. Action Row with Perk Status inline before Cancel and Save */}
          <s-stack
            direction="inline"
            gap="base"
            justifyContent="end"
            alignItems="center"
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text>
                <strong>Perk Status:</strong>
              </s-text>
              <div style={{ minWidth: "120px" }}>
                <s-select
                  label="Perk Status"
                  labelAccessibilityVisibility="exclusive"
                  value={status}
                  onChange={(event: any) =>
                    setStatus(event.currentTarget.value as "ACTIVE" | "DRAFT")
                  }
                >
                  <s-option value="ACTIVE">Active</s-option>
                  <s-option value="DRAFT">Draft</s-option>
                </s-select>
              </div>
              <s-badge tone={status === "ACTIVE" ? "success" : "neutral"}>
                {status === "ACTIVE" ? "Active" : "Draft"}
              </s-badge>
            </s-stack>

            {onCancel && (
              <s-button variant="secondary" onClick={onCancel}>
                Cancel
              </s-button>
            )}

            <s-button
              variant="primary"
              type="submit"
              {...(isSubmitting ? { loading: true } : {})}
            >
              {isSubmitting
                ? submittingLabel
                : isEditing
                  ? "Save Changes"
                  : submitButtonLabel}
            </s-button>
          </s-stack>
        </s-stack>
      </form>

      {/* POPUP MODAL: Store Available Tags Picker */}
      <s-modal id="available-tags-modal" heading="Select Store Product Tags">
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Click any store tag to select or deselect it. Products matching
              any of these selected tags will display this bundle.
            </s-text>

            <s-stack direction="inline" gap="small" alignItems="end">
              <div style={{ flex: 1 }}>
                <s-text-field
                  label="Search Tags"
                  placeholder="Filter store tags..."
                  value={tagFilter}
                  onInput={(e: any) => setTagFilter(e.currentTarget.value)}
                />
              </div>
              {tagFilter && (
                <s-button onClick={() => setTagFilter("")}>
                  Clear Filter
                </s-button>
              )}
            </s-stack>

            {/* Quick Actions */}
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text tone="neutral">
                <strong>
                  {tags.length} tag{tags.length === 1 ? "" : "s"} selected
                </strong>
              </s-text>
              <s-stack direction="inline" gap="small">
                {filteredAvailableTags.length > 0 && (
                  <s-button
                    variant="tertiary"
                    onClick={() => {
                      const toAdd = filteredAvailableTags.filter(
                        (t) =>
                          !tags.some(
                            (st) => st.toLowerCase() === t.toLowerCase(),
                          ),
                      );
                      setTags((prev) => [...prev, ...toAdd]);
                      setTriggerError("");
                    }}
                  >
                    Select All Shown
                  </s-button>
                )}
                {tags.length > 0 && (
                  <s-button variant="tertiary" onClick={() => setTags([])}>
                    Deselect All
                  </s-button>
                )}
              </s-stack>
            </s-stack>

            {/* Tag List */}
            <div
              style={{
                maxHeight: "260px",
                overflowY: "auto",
                padding: "12px",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                background: "#fafbfb",
              }}
            >
              {filteredAvailableTags.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px",
                    color: "#6d7175",
                  }}
                >
                  {tagFilter
                    ? `No store tags matching "${tagFilter}".`
                    : "No tags found in your product catalog."}
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {filteredAvailableTags.map((t) => {
                    const isSelected = tags.some(
                      (st) => st.toLowerCase() === t.toLowerCase(),
                    );
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        style={{
                          border: isSelected
                            ? "1.5px solid #008060"
                            : "1px solid #c9cccf",
                          background: isSelected ? "#f1f8f5" : "#ffffff",
                          color: isSelected ? "#008060" : "#202223",
                          fontWeight: isSelected ? 600 : 400,
                          borderRadius: "16px",
                          padding: "6px 12px",
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span>{isSelected ? "✓" : "＋"}</span>
                        <span>{t}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Close button */}
            <s-stack direction="inline" justifyContent="end">
              <s-button
                commandFor="available-tags-modal"
                command="--hide"
                variant="primary"
              >
                Done ({tags.length} Selected)
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-modal>

      {/* POPUP MODAL: Storefront Preview */}
      <s-modal
        id="fbt-preview-modal"
        heading="Frequently Bought Together Preview"
      >
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              This is an interactive preview of how the Frequently Bought
              Together widget appears to customers below product descriptions.
            </s-text>

            <s-box
              border="base"
              borderRadius="base"
              padding="base"
              background="base"
            >
              <s-stack direction="block" gap="base">
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-heading>
                    {badgeText || "Frequently Bought Together"}
                  </s-heading>
                  {numDiscount > 0 && (
                    <s-badge tone="success">
                      Save{" "}
                      {discountType === "PERCENTAGE"
                        ? `${numDiscount}%`
                        : `${currencySymbol}${numDiscount}`}{" "}
                      as a Bundle!
                    </s-badge>
                  )}
                </s-stack>

                {description && (
                  <s-paragraph tone="neutral">{description}</s-paragraph>
                )}

                {/* Products rows with checkbox */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {/* Current Product Row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "8px 12px",
                      background: "#fafbfb",
                      border: "1px solid #e1e3e5",
                      borderRadius: "8px",
                    }}
                  >
                    <s-checkbox
                      checked={isPreviewChecked("current")}
                      onChange={() => togglePreviewCheck("current")}
                      label="Current Product"
                      labelAccessibilityVisibility="exclusive"
                    />
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "6px",
                        background: "#f1f2f3",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "22px",
                        flexShrink: 0,
                      }}
                    >
                      📱
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ color: "#6d7175", fontWeight: 500 }}>
                          This item:{" "}
                        </span>
                        Current Product
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {currencySymbol}49.99
                    </div>
                  </div>

                  {/* Bundled products rows */}
                  {products.length > 0 ? (
                    products.map((p, idx) => {
                      const itemKey = p.shopifyId || String(idx);
                      const itemTotal = (p.price || 0) * (p.qty || 1);
                      return (
                        <div
                          key={itemKey}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "8px 12px",
                            background: "#ffffff",
                            border: "1px solid #e1e3e5",
                            borderRadius: "8px",
                          }}
                        >
                          <s-checkbox
                            checked={isPreviewChecked(itemKey)}
                            onChange={() => togglePreviewCheck(itemKey)}
                            label={p.title}
                            labelAccessibilityVisibility="exclusive"
                          />
                          <div
                            style={{
                              width: "40px",
                              height: "40px",
                              borderRadius: "6px",
                              overflow: "hidden",
                              background: "#f1f2f3",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "20px",
                              flexShrink: 0,
                            }}
                          >
                            {p.featuredImage ? (
                              <img
                                src={p.featuredImage}
                                alt={p.title}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              "🎁"
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: "14px",
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {p.title}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: 600,
                              flexShrink: 0,
                            }}
                          >
                            {currencySymbol}
                            {itemTotal.toFixed(2)}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        padding: "16px",
                        textAlign: "center",
                        border: "1px dashed #c9cccf",
                        borderRadius: "8px",
                        color: "#6d7175",
                      }}
                    >
                      No complementary products added to bundle yet.
                    </div>
                  )}
                </div>

                {/* Total and CTA */}
                <s-divider />
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack direction="block" gap="small">
                    <s-text tone="neutral">Bundle Total Price:</s-text>
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="baseline"
                    >
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: "bold",
                          color: "#008060",
                        }}
                      >
                        {currencySymbol}
                        {discountedBundlePrice > 0
                          ? discountedBundlePrice.toFixed(2)
                          : "44.99"}
                      </span>
                      {calculatedDiscount > 0 && (
                        <span
                          style={{
                            textDecoration: "line-through",
                            color: "#8c9196",
                            fontSize: "14px",
                          }}
                        >
                          {currencySymbol}
                          {totalPrice.toFixed(2)}
                        </span>
                      )}
                    </s-stack>
                  </s-stack>

                  <s-button variant="primary">
                    {ctaButtonText || "Add Selected to Cart"}
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>

            <s-stack direction="inline" justifyContent="end">
              <s-button commandFor="fbt-preview-modal" command="--hide">
                Close Preview
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-modal>

      {/* Benefits Strategy Section */}
      <s-section>
        <BundleBenefitsSection
          bundleType="FBT"
          bundleTitle={bundleTitle}
          discountType={discountType}
          discountValue={discountValue}
          currencySymbol={currencySymbol}
          itemCount={products.length}
          triggerType={triggerType}
          isEditing={isEditing}
        />
      </s-section>
    </>
  );
}
