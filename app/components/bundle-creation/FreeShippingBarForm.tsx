import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { BundleBenefitsSection } from "./BundleBenefitsSection";

export type Threshold = {
  id: number;
  amount: string;
  discountPercentage: string;
};

export interface FreeShippingBarFormData {
  bundleId?: string;
  bundleName: string;
  bundleType: "FREE_SHIPPING_BAR";
  targetAmount: number;
  status: "ACTIVE" | "DRAFT";
  startDate: string;
  endDate: string | null;
  thresholds: {
    id: number;
    index: number;
    amount: number;
    discountPercentage: number;
  }[];
}

export interface FreeShippingBarFormInitialData {
  id?: string;
  bundleId?: string;
  bundleName?: string;
  title?: string;
  targetAmount?: string | number;
  status?: string;
  startDate?: string | Date;
  endDate?: string | Date | null;
  thresholds?: {
    id?: number | string;
    amount?: string | number;
    discountPercentage?: string | number;
    discountValue?: string | number;
  }[];
  [key: string]: unknown;
}

export interface FreeShippingBarFormProps {
  initialData?: FreeShippingBarFormInitialData;
  currencySymbol?: string;
  isSubmitting?: boolean;
  submitButtonLabel?: string;
  submittingLabel?: string;
  onSubmit?: (formData: FreeShippingBarFormData) => void;
  onCancel?: () => void;
  pageTitle?: string;
  isLimitReached?: boolean;
  activeBundleCount?: number;
  bundleLimit?: number;
  isEditing?: boolean;
  hasActiveShippingBar?: boolean;
  activeShippingBarId?: string | null;
  activeShippingBarTitle?: string | null;
}

function parseAmount(
  val: string,
  currencySymbol = "$",
): { isValid: boolean; value: number | null; error?: string } {
  if (!val || !val.trim()) {
    return { isValid: false, value: null, error: "Amount is required" };
  }
  let clean = val.trim();
  if (currencySymbol && clean.startsWith(currencySymbol)) {
    clean = clean.slice(currencySymbol.length).trim();
  } else if (clean.startsWith("$")) {
    clean = clean.slice(1).trim();
  }
  clean = clean.replace(/,/g, "");

  const num = Number(clean);
  if (!/^\d+(\.\d+)?$/.test(clean) || isNaN(num) || num <= 0) {
    return {
      isValid: false,
      value: null,
      error: "Must be a valid positive number",
    };
  }

  return { isValid: true, value: num };
}

function parsePercentage(val: string): {
  isValid: boolean;
  value: number | null;
  error?: string;
} {
  if (!val || !val.trim()) {
    return {
      isValid: false,
      value: null,
      error: "Discount percentage is required",
    };
  }
  let clean = val.trim();
  if (clean.endsWith("%")) {
    clean = clean.slice(0, -1).trim();
  }
  const num = Number(clean);
  if (!/^\d+(\.\d+)?$/.test(clean) || isNaN(num) || num <= 0 || num > 100) {
    return {
      isValid: false,
      value: null,
      error: "Must be a valid percentage between 1 and 100",
    };
  }

  return { isValid: true, value: num };
}

function formatDateTimeLocal(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function FreeShippingBarForm({
  initialData,
  currencySymbol = "$",
  isSubmitting = false,
  submitButtonLabel = "Create Free Shipping Bar",
  submittingLabel = "Creating...",
  onSubmit,
  onCancel,
  pageTitle = "Multiple Threshold Shipping Bar Settings",
  isLimitReached = false,
  activeBundleCount,
  bundleLimit,
  isEditing = false,
  hasActiveShippingBar = false,
  activeShippingBarId,
  activeShippingBarTitle,
}: FreeShippingBarFormProps) {
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [bundleName, setBundleName] = useState<string>(
    String(
      initialData?.bundleName || initialData?.title || "Free Shipping Bar",
    ).trim() || "Free Shipping Bar",
  );

  const [targetAmount, setTargetAmount] = useState<string>(
    initialData?.targetAmount !== undefined &&
      initialData?.targetAmount !== null
      ? String(initialData.targetAmount)
      : "",
  );

  const [status, setStatus] = useState<"ACTIVE" | "DRAFT">(() => {
    if (hasActiveShippingBar) {
      return "DRAFT";
    }
    if (initialData?.status) {
      return initialData.status === "DRAFT" ? "DRAFT" : "ACTIVE";
    }
    return isLimitReached && !isEditing ? "DRAFT" : "ACTIVE";
  });

  const [startDate, setStartDate] = useState<string>(() => {
    return formatDateTimeLocal(initialData?.startDate || new Date());
  });

  const [hasEndDate, setHasEndDate] = useState<boolean>(() => {
    return Boolean(initialData?.endDate);
  });

  const [endDate, setEndDate] = useState<string>(() => {
    return initialData?.endDate ? formatDateTimeLocal(initialData.endDate) : "";
  });

  const [scheduleError, setScheduleError] = useState<string>("");

  const [thresholds, setThresholds] = useState<Threshold[]>(() => {
    if (
      initialData?.thresholds &&
      Array.isArray(initialData.thresholds) &&
      initialData.thresholds.length > 0
    ) {
      return initialData.thresholds.map((t, index: number) => ({
        id: Number(t.id) || Date.now() + index,
        amount: String(t.amount ?? ""),
        discountPercentage: String(
          t.discountPercentage ?? t.discountValue ?? "",
        ),
      }));
    }
    return [];
  });

  // Sync state whenever initialData changes (e.g. navigating to edit existing bar)
  useEffect(() => {
    if (initialData) {
      setBundleName(
        String(
          initialData.bundleName || initialData.title || "Free Shipping Bar",
        ).trim() || "Free Shipping Bar",
      );
      setTargetAmount(
        initialData.targetAmount !== undefined &&
          initialData.targetAmount !== null
          ? String(initialData.targetAmount)
          : "",
      );
      setStatus(
        hasActiveShippingBar
          ? "DRAFT"
          : initialData.status === "DRAFT"
            ? "DRAFT"
            : "ACTIVE",
      );
      setStartDate(formatDateTimeLocal(initialData.startDate || new Date()));
      setHasEndDate(Boolean(initialData.endDate));
      setEndDate(
        initialData.endDate ? formatDateTimeLocal(initialData.endDate) : "",
      );
      if (
        initialData.thresholds &&
        Array.isArray(initialData.thresholds) &&
        initialData.thresholds.length > 0
      ) {
        setThresholds(
          initialData.thresholds.map((t, index: number) => ({
            id: Number(t.id) || Date.now() + index,
            amount: String(t.amount ?? ""),
            discountPercentage: String(
              t.discountPercentage ?? t.discountValue ?? "",
            ),
          })),
        );
      } else {
        setThresholds([]);
      }
    }
  }, [initialData, hasActiveShippingBar]);

  const [targetAmountError, setTargetAmountError] = useState("");
  const [thresholdErrors, setThresholdErrors] = useState<
    Record<number, string>
  >({});
  const [thresholdDiscountErrors, setThresholdDiscountErrors] = useState<
    Record<number, string>
  >({});

  const validateForm = (): boolean => {
    let isValid = true;
    let targetErr = "";
    const threshErrs: Record<number, string> = {};
    const threshDiscErrs: Record<number, string> = {};

    const parsedTarget = parseAmount(targetAmount, currencySymbol);
    if (!parsedTarget.isValid) {
      targetErr =
        parsedTarget.error === "Amount is required"
          ? "Free Shipping Bar Target Amount is required"
          : "Target amount must be a valid number greater than 0";
      isValid = false;
    }

    let schedErr = "";
    if (!startDate) {
      schedErr = "Start date & time is required.";
      isValid = false;
    } else if (hasEndDate && endDate) {
      if (new Date(endDate) <= new Date(startDate)) {
        schedErr = "End date & time must be after start date & time.";
        isValid = false;
      }
    }
    setScheduleError(schedErr);

    const targetVal = parsedTarget.value;
    let prevVal = targetVal;

    thresholds.forEach((item, index) => {
      // 1. Validate Spend Amount
      const parsedItem = parseAmount(item.amount, currencySymbol);
      if (!parsedItem.isValid) {
        threshErrs[item.id] =
          parsedItem.error === "Amount is required"
            ? `Milestone ${index + 1} spend amount is required (or click Remove)`
            : `Milestone ${index + 1} spend amount must be a valid number greater than 0`;
        isValid = false;
      } else {
        const itemVal = parsedItem.value!;

        if (prevVal !== null && itemVal <= prevVal) {
          threshErrs[item.id] =
            index === 0
              ? `Milestone 1 (${currencySymbol}${itemVal}) must be greater than Free Shipping Target (${currencySymbol}${targetVal})`
              : `Milestone ${index + 1} (${currencySymbol}${itemVal}) must be greater than Milestone ${index} (${currencySymbol}${prevVal})`;
          isValid = false;
        }

        prevVal = itemVal;
      }

      // 2. Validate Discount Percentage
      const parsedDisc = parsePercentage(item.discountPercentage);
      if (!parsedDisc.isValid) {
        threshDiscErrs[item.id] =
          parsedDisc.error === "Discount percentage is required"
            ? `Milestone ${index + 1} discount percentage is required`
            : `Milestone ${index + 1} discount must be between 1% and 100%`;
        isValid = false;
      }
    });

    setTargetAmountError(targetErr);
    setThresholdErrors(threshErrs);
    setThresholdDiscountErrors(threshDiscErrs);

    return isValid;
  };

  const handleTargetAmountChange = (val: string) => {
    setTargetAmount(val);
    if (targetAmountError) {
      setTargetAmountError("");
    }
  };

  const addMilestone = () => {
    setThresholds((prev) => [
      ...prev,
      {
        id: Date.now(),
        amount: "",
        discountPercentage: "",
      },
    ]);
  };

  const updateMilestoneAmount = (id: number, amount: string) => {
    setThresholds((prev) =>
      prev.map((item) => (item.id === id ? { ...item, amount } : item)),
    );
    if (thresholdErrors[id]) {
      setThresholdErrors((prev) => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
    }
  };

  const updateMilestoneDiscount = (id: number, discountPercentage: string) => {
    setThresholds((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, discountPercentage } : item,
      ),
    );
    if (thresholdDiscountErrors[id]) {
      setThresholdDiscountErrors((prev) => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
    }
  };

  const removeMilestone = (id: number) => {
    setThresholds((prev) => prev.filter((item) => item.id !== id));
    setThresholdErrors((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
    setThresholdDiscountErrors((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!validateForm()) {
      shopify.toast.show("Please fix the validation errors before saving.", {
        isError: true,
      });
      return;
    }

    const parsedTarget = parseAmount(targetAmount, currencySymbol);
    if (!parsedTarget.isValid || parsedTarget.value === null) return;

    const finalStatus: "ACTIVE" | "DRAFT" = hasActiveShippingBar
      ? "DRAFT"
      : status;

    if (onSubmit) {
      onSubmit({
        bundleId:
          (initialData?.id as string) ||
          (initialData?.bundleId as string) ||
          undefined,
        bundleName: bundleName.trim() || "Free Shipping Bar",
        bundleType: "FREE_SHIPPING_BAR",
        targetAmount: parsedTarget.value,
        status: finalStatus,
        startDate: startDate
          ? new Date(startDate).toISOString()
          : new Date().toISOString(),
        endDate: hasEndDate && endDate ? new Date(endDate).toISOString() : null,
        thresholds: thresholds.map((t, idx) => ({
          id: t.id,
          index: idx + 1,
          amount: parseAmount(t.amount, currencySymbol).value ?? 0,
          discountPercentage: parsePercentage(t.discountPercentage).value ?? 0,
        })),
      });
    }
  };

  const parsedTargetNum = parseAmount(targetAmount, currencySymbol).value;

  return (
    <>
      <s-section>
        {/* Top Bar with Back & Modal Preview Button */}
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
              <s-heading>{pageTitle}</s-heading>
              <s-text color="subdued">
                Configure your free shipping target amount and optional
                milestone rewards.
              </s-text>
            </s-stack>
          </s-stack>
        </s-stack>

        {hasActiveShippingBar && !isEditing && (
          <s-box padding="base">
            <s-banner
              tone="warning"
              heading="Active Free Shipping Bar Already Exists"
            >
              <s-paragraph>
                An active Free Shipping Bar is already created for your store.
                Only 1 Free Shipping Bar can be created and active per store for
                better management. Please edit the existing Free Shipping Bar or
                set it to Draft before creating a new one.
              </s-paragraph>
              {activeShippingBarId && (
                <s-button
                  variant="secondary"
                  href={`/app/integration/free-shipping-bar?id=${activeShippingBarId}`}
                  onClick={(e: any) => {
                    e.preventDefault();
                    navigate(
                      `/app/integration/free-shipping-bar?id=${activeShippingBarId}`,
                    );
                  }}
                >
                  Edit Existing Free Shipping Bar ↗
                </s-button>
              )}
            </s-banner>
          </s-box>
        )}

        {isLimitReached && (
          <s-box padding="base">
            <s-banner tone="warning" heading="Plan Limit Reached">
              <s-paragraph>
                You have reached your active bundle limit ({activeBundleCount}/
                {bundleLimit}). This Free Shipping Bar will be created with
                status <strong>Draft</strong>.
              </s-paragraph>
            </s-banner>
          </s-box>
        )}

        <form onSubmit={handleFormSubmit}>
          <s-stack gap="base" padding="base">
            {/* 1. Free Shipping Bar Target Amount */}
            <s-box
              padding="base"
              background="base"
              borderRadius="base"
              border="base"
            >
              <s-stack gap="base">
                <s-heading>1. Free Shipping Bar Target</s-heading>
                <s-text color="subdued">
                  Set the bar name and minimum cart subtotal required for
                  shoppers to unlock free shipping.
                </s-text>

                <s-text-field
                  label="Bar Name"
                  name="bundleName"
                  value={bundleName}
                  onInput={(event: { currentTarget: { value: string } }) => {
                    setBundleName(event.currentTarget.value);
                  }}
                  required
                />

                <s-text-field
                  label="Free Shipping Bar Target Amount"
                  name="targetAmount"
                  placeholder="e.g. 200"
                  value={targetAmount}
                  onInput={(event: { currentTarget: { value: string } }) => {
                    handleTargetAmountChange(event.currentTarget.value);
                  }}
                  error={targetAmountError || undefined}
                  required
                />
              </s-stack>
            </s-box>

            {/* 2. Progressive Milestones */}
            <s-box
              padding="base"
              background="base"
              borderRadius="base"
              border="base"
            >
              <s-stack gap="base">
                <s-stack gap="none">
                  <s-heading>
                    2. Milestone Spend Thresholds (Optional)
                  </s-heading>
                  <s-text color="subdued">
                    Milestones are optional. If added, set a spend threshold
                    higher than free shipping and the corresponding percentage
                    discount customers unlock at that milestone.
                  </s-text>
                </s-stack>

                {thresholds.length === 0 && (
                  <s-box
                    padding="base"
                    background="subdued"
                    borderRadius="base"
                  >
                    <s-paragraph tone="neutral">
                      No milestone thresholds added. Milestones are
                      optional—click &quot;+ Add New Milestone&quot; below if
                      you would like to set up progressive rewards for higher
                      order values.
                    </s-paragraph>
                  </s-box>
                )}

                {thresholds.map((threshold, index) => {
                  const error = thresholdErrors[threshold.id];
                  const discountError = thresholdDiscountErrors[threshold.id];
                  const prevVal =
                    index === 0
                      ? parsedTargetNum
                      : parseAmount(
                          thresholds[index - 1]?.amount,
                          currencySymbol,
                        ).value;

                  return (
                    <s-box
                      key={threshold.id}
                      padding="base"
                      background="subdued"
                      borderRadius="base"
                      border="base"
                    >
                      <s-stack gap="small">
                        <s-stack
                          direction="inline"
                          alignItems="center"
                          justifyContent="space-between"
                        >
                          <s-stack
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >
                            <s-badge tone="info">Milestone {index + 1}</s-badge>
                            <s-text tone="neutral">
                              {index === 0
                                ? `Must be > Free Shipping Target (${currencySymbol}${parsedTargetNum ?? 0})`
                                : `Must be > Milestone ${index} (${currencySymbol}${prevVal ?? 0})`}
                            </s-text>
                          </s-stack>

                          <s-button
                            type="button"
                            variant="tertiary"
                            tone="critical"
                            onClick={() => removeMilestone(threshold.id)}
                          >
                            Remove
                          </s-button>
                        </s-stack>

                        <s-grid
                          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                          gap="base"
                        >
                          <s-text-field
                            label={`Milestone ${index + 1} Spend Threshold (${currencySymbol})`}
                            name={`thresholds[${index}].amount`}
                            placeholder={
                              prevVal
                                ? `e.g. ${prevVal + 50}`
                                : `e.g. ${(index + 2) * 100}`
                            }
                            value={threshold.amount}
                            onInput={(event: {
                              currentTarget: { value: string };
                            }) =>
                              updateMilestoneAmount(
                                threshold.id,
                                event.currentTarget.value,
                              )
                            }
                            error={error || undefined}
                          />

                          <s-text-field
                            label={`Discount ${index + 1} Value (In %)`}
                            name={`thresholds[${index}].discountPercentage`}
                            placeholder="e.g. 10"
                            value={threshold.discountPercentage}
                            onInput={(event: {
                              currentTarget: { value: string };
                            }) =>
                              updateMilestoneDiscount(
                                threshold.id,
                                event.currentTarget.value,
                              )
                            }
                            error={discountError || undefined}
                          />
                        </s-grid>
                      </s-stack>
                    </s-box>
                  );
                })}

                <s-button
                  type="button"
                  variant="secondary"
                  onClick={addMilestone}
                >
                  + Add New Milestone
                </s-button>
              </s-stack>
            </s-box>

            {/* 3. Schedule & Expiration */}
            <s-box
              padding="base"
              background="base"
              borderRadius="base"
              border="base"
            >
              <s-stack gap="base">
                <s-heading>3. Schedule &amp; Expiration</s-heading>
                <s-text color="subdued">
                  Optionally schedule when this perk goes live and when it
                  expires.
                </s-text>

                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                  gap="base"
                >
                  <s-box>
                    <s-stack gap="small">
                      <s-text type="strong">Start Date &amp; Time</s-text>
                      <input
                        type="datetime-local"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                        required
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: "1px solid #c9cccf",
                          fontSize: "14px",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                    </s-stack>
                  </s-box>

                  {hasEndDate ? (
                    <s-box>
                      <s-stack gap="small">
                        <s-text type="strong">End Date &amp; Time</s-text>
                        <input
                          type="datetime-local"
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "8px",
                            border: scheduleError
                              ? "1px solid #d82c0d"
                              : "1px solid #c9cccf",
                            fontSize: "14px",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                          }}
                        />
                      </s-stack>
                    </s-box>
                  ) : (
                    <s-box padding="small">
                      <s-text tone="neutral">
                        No end date set (runs indefinitely until drafted).
                      </s-text>
                    </s-box>
                  )}
                </s-grid>

                <s-checkbox
                  checked={hasEndDate}
                  onChange={() => setHasEndDate(!hasEndDate)}
                  label="Set an expiration / end date for this perk"
                />

                {scheduleError && (
                  <s-banner tone="critical">
                    <s-paragraph>{scheduleError}</s-paragraph>
                  </s-banner>
                )}

                <s-banner tone="info">
                  <s-paragraph>
                    • <strong>Draft</strong> perks remain unpublished regardless
                    of dates.
                    <br />• <strong>Active</strong> perks with a future start
                    date automatically show as <strong>Scheduled</strong>.<br />
                    • Active perks whose end date has passed automatically show
                    as <strong>Expired</strong>.
                  </s-paragraph>
                </s-banner>
              </s-stack>
            </s-box>

            {/* Action Buttons */}
            <s-stack
              direction="inline"
              gap="base"
              justifyContent="end"
              alignItems="center"
            >
              {hasActiveShippingBar && (
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-text tone="neutral">
                    <em>
                      Notice: Another Free Shipping Bar{" "}
                      {activeShippingBarTitle
                        ? `("${activeShippingBarTitle}")`
                        : ""}{" "}
                      is currently active. Only 1 can be active at a time, so
                      this perk will be saved as Draft.
                    </em>
                  </s-text>
                </s-box>
              )}

              {/* Perk Status selector inline before Cancel and Save Changes */}
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text>
                  <strong>Perk Status:</strong>
                </s-text>
                <div style={{ minWidth: "120px" }}>
                  <s-select
                    label="Perk Status"
                    labelAccessibilityVisibility="exclusive"
                    value={hasActiveShippingBar ? "DRAFT" : status}
                    disabled={hasActiveShippingBar ? true : undefined}
                    onChange={(event: any) =>
                      setStatus(event.currentTarget.value as "ACTIVE" | "DRAFT")
                    }
                  >
                    {!hasActiveShippingBar && (
                      <s-option value="ACTIVE">Active</s-option>
                    )}
                    <s-option value="DRAFT">Draft</s-option>
                  </s-select>
                </div>
                <s-badge
                  tone={
                    !hasActiveShippingBar && status === "ACTIVE"
                      ? "success"
                      : "neutral"
                  }
                >
                  {!hasActiveShippingBar && status === "ACTIVE"
                    ? "Active"
                    : "Draft"}
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
                  : hasActiveShippingBar
                    ? "Save as Draft"
                    : submitButtonLabel}
              </s-button>
            </s-stack>
          </s-stack>
        </form>
      </s-section>

      {/* POPUP MODAL: Storefront Preview */}
      <s-modal
        id="shippingbar-preview-modal"
        heading="Preview Free Shipping Bar"
      >
        <s-box padding="base">
          <s-stack gap="base">
            <s-text color="subdued">
              This is an interactive preview of how the Free Shipping Bar widget
              renders on your online storefront product pages.
            </s-text>

            {/* FREE SHIPPING BAR PREVIEW IMAGE */}
            <s-box border="base" borderRadius="base">
              <s-image
                alt="Free Shipping Bar img"
                src="/free-shipping-bar-placeholder.png"
              />
            </s-box>

            {/* Close Modal Button */}
            <s-stack direction="inline" justifyContent="end">
              <s-button commandFor="shippingbar-preview-modal" command="--hide">
                Close Preview
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-modal>

      <s-section>
        {/* Dynamic Bundle Notes & Benefits Section */}
        <BundleBenefitsSection
          bundleType="FREE_SHIPPING_BAR"
          bundleTitle={bundleName || "Free Shipping Bar"}
          discountType="NO_DISCOUNT"
          discountValue={targetAmount || "0"}
          currencySymbol={currencySymbol}
          isEditing={isEditing}
        />
      </s-section>
    </>
  );
}
