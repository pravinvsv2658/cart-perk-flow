import {
  DiscountClass,
  OrderDiscountSelectionStrategy,
  CartInput,
  CartLinesDiscountsGenerateRunResult,
} from "../generated/api";

type Threshold = {
  id: number;
  index: number;
  amount: number;
  discountPercentage: number;
};

type ShippingBarConfig = {
  targetAmount: number;
  thresholds: Threshold[];
};

function getConfig(value: unknown): ShippingBarConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const config = value as Partial<ShippingBarConfig>;

  if (
    typeof config.targetAmount !== "number" ||
    !Array.isArray(config.thresholds)
  ) {
    return null;
  }

  return config as ShippingBarConfig;
}

export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  const hasOrderDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Order,
  );

  if (!hasOrderDiscountClass) {
    return { operations: [] };
  }

  const config = getConfig(input.discount.metafield?.jsonValue);

  if (!config) {
    return { operations: [] };
  }

  const subtotal = Number(input.cart.cost.subtotalAmount.amount);

  if (!Number.isFinite(subtotal)) {
    return { operations: [] };
  }

  const eligibleThresholds = config.thresholds
    .filter(
      (threshold) =>
        typeof threshold.amount === "number" &&
        typeof threshold.discountPercentage === "number" &&
        threshold.amount >= 0 &&
        threshold.discountPercentage > 0 &&
        threshold.discountPercentage <= 100 &&
        subtotal >= threshold.amount,
    )
    .sort((a, b) => b.amount - a.amount);

  if (eligibleThresholds.length === 0) {
    return { operations: [] };
  }

  const bestThreshold = eligibleThresholds[0];

  return {
    operations: [
      {
        orderDiscountsAdd: {
          candidates: [
            {
              message: `${bestThreshold.discountPercentage}% off | CartPerks`,
              targets: [
                {
                  orderSubtotal: {
                    excludedCartLineIds: [],
                  },
                },
              ],
              value: {
                percentage: {
                  value: String(bestThreshold.discountPercentage),
                },
              },
            },
          ],
          selectionStrategy: OrderDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}
