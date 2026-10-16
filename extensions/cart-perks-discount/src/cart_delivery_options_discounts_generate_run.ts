import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
  DeliveryInput,
  CartDeliveryOptionsDiscountsGenerateRunResult,
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

export function cartDeliveryOptionsDiscountsGenerateRun(
  input: DeliveryInput,
): CartDeliveryOptionsDiscountsGenerateRunResult {
  const hasShippingDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Shipping,
  );

  if (!hasShippingDiscountClass) {
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

  const hasFreeShipping =
    Number.isFinite(config.targetAmount) &&
    config.targetAmount > 0 &&
    subtotal >= config.targetAmount;

  if (!hasFreeShipping) {
    return { operations: [] };
  }

  const deliveryGroups = input.cart.deliveryGroups;

  if (deliveryGroups.length === 0) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: [
            {
              message: "FREE SHIPPING | CartPerks",
              targets: deliveryGroups.map((group) => ({
                deliveryGroup: {
                  id: group.id,
                },
              })),
              value: {
                percentage: {
                  value: "100",
                },
              },
            },
          ],
          selectionStrategy: DeliveryDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
