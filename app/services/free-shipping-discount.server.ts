type Threshold = {
  id: number;
  index: number;
  amount: number;
  discountPercentage: number;
};

export type ShippingBarConfig = {
  targetAmount: number;
  thresholds: Threshold[];
};

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{
    json: () => Promise<any>;
  }>;
};

type SyncShippingDiscountParams = {
  admin: AdminGraphql;
  discountId: string | null;
  title: string;
  startDate: Date;
  endDate: Date | null;
  status: "ACTIVE" | "DRAFT";
  config: ShippingBarConfig;
};

function getGraphqlErrorMessages(result: any, payload: any): string[] {
  return [
    ...(result?.errors ?? []).map((error: any) =>
      String(error.message ?? "GraphQL error"),
    ),
    ...(payload?.userErrors ?? []).map((error: any) =>
      String(error.message ?? "Shopify operation failed"),
    ),
  ];
}

function throwIfGraphqlErrors(result: any, payload: any): void {
  const messages = getGraphqlErrorMessages(result, payload);

  if (messages.length > 0) {
    throw new Error(messages.join(", "));
  }
}

/**
 * Recognize errors that indicate the stored discount ID is no longer valid.
 * Do not treat permission, validation, or unrelated GraphQL errors as missing IDs.
 */
function isMissingDiscountError(messages: string[]): boolean {
  return messages.some((message) =>
    /discount.{0,80}(not found|does not exist|could not be found|doesn't exist|invalid id)|(?:not found|does not exist|could not be found|doesn't exist).{0,80}discount/i.test(
      message,
    ),
  );
}

async function deactivateDiscount(
  admin: AdminGraphql,
  discountId: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation DeactivateShippingDiscount($id: ID!) {
      discountAutomaticDeactivate(id: $id) {
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: discountId } },
  );

  const result = await response.json();
  const payload = result.data?.discountAutomaticDeactivate;
  const messages = getGraphqlErrorMessages(result, payload);

  if (messages.length > 0) {
    if (isMissingDiscountError(messages)) {
      // The discount was already deleted from Shopify.
      return;
    }

    throw new Error(messages.join(", "));
  }
}

export async function syncShopifyShippingDiscount({
  admin,
  discountId,
  title,
  startDate,
  endDate,
  status,
  config,
}: SyncShippingDiscountParams): Promise<string | null> {
  // Draft bars should not have an active Shopify discount.
  if (status === "DRAFT") {
    if (!discountId) {
      return null;
    }

    await deactivateDiscount(admin, discountId);

    // Return null when a discount was deleted and could not be deactivated.
    // The caller should persist this result to clear the stale database ID.
    const checkResponse = await admin.graphql(
      `#graphql
      query CheckShippingDiscount($id: ID!) {
        node(id: $id) {
          id
        }
      }`,
      { variables: { id: discountId } },
    );

    const checkResult = await checkResponse.json();

    if (checkResult.errors?.length) {
      // Deactivation already succeeded or the missing discount was handled.
      // Do not fail a draft save just because this optional check failed.
      console.warn(
        "Could not verify the draft discount ID.",
        checkResult.errors,
      );
      return discountId;
    }

    if (!checkResult.data?.node) {
      return null;
    }

    return discountId;
  }

  const automaticAppDiscount = {
    title,
    functionHandle: "cart-perks-discount",
    startsAt: startDate.toISOString(),
    endsAt: endDate?.toISOString() ?? null,
    discountClasses: ["ORDER", "SHIPPING", "PRODUCT"],
    combinesWith: {
      orderDiscounts: true,
      productDiscounts: true,
      shippingDiscounts: true,
    },
    metafields: [
      {
        namespace: "$app:cart-perks-discount",
        key: "function-configuration",
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  };

  const createMutation = `#graphql
    mutation CreateShippingDiscount(
      $automaticAppDiscount: DiscountAutomaticAppInput!
    ) {
      discountAutomaticAppCreate(
        automaticAppDiscount: $automaticAppDiscount
      ) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`;

  const updateMutation = `#graphql
    mutation UpdateShippingDiscount(
      $id: ID!
      $automaticAppDiscount: DiscountAutomaticAppInput!
    ) {
      discountAutomaticAppUpdate(
        id: $id
        automaticAppDiscount: $automaticAppDiscount
      ) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`;

  let savedDiscountId: string | null = null;

  // First attempt to update the existing Shopify discount.
  if (discountId) {
    const updateResponse = await admin.graphql(updateMutation, {
      variables: {
        id: discountId,
        automaticAppDiscount,
      },
    });

    const updateResult = await updateResponse.json();
    const updatePayload = updateResult.data?.discountAutomaticAppUpdate;

    const updateErrors = getGraphqlErrorMessages(updateResult, updatePayload);

    if (updateErrors.length > 0) {
      if (isMissingDiscountError(updateErrors)) {
        console.warn(
          "Stored Shopify discount no longer exists. Creating a replacement.",
          { discountId, errors: updateErrors },
        );
      } else {
        throw new Error(updateErrors.join(", "));
      }
    } else {
      savedDiscountId = updatePayload?.automaticAppDiscount?.discountId ?? null;
    }
  }

  // Create a new discount if there is no stored ID or the old ID is missing.
  if (!savedDiscountId) {
    const createResponse = await admin.graphql(createMutation, {
      variables: { automaticAppDiscount },
    });

    const createResult = await createResponse.json();
    const createPayload = createResult.data?.discountAutomaticAppCreate;

    throwIfGraphqlErrors(createResult, createPayload);

    savedDiscountId = createPayload?.automaticAppDiscount?.discountId ?? null;
  }

  if (!savedDiscountId) {
    throw new Error("Shopify did not return an automatic discount ID.");
  }

  // Activate immediately only when the configured start date has arrived.
  if (startDate.getTime() <= Date.now()) {
    const activateResponse = await admin.graphql(
      `#graphql
      mutation ActivateShippingDiscount($id: ID!) {
        discountAutomaticActivate(id: $id) {
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: savedDiscountId } },
    );

    const activateResult = await activateResponse.json();
    const activatePayload = activateResult.data?.discountAutomaticActivate;

    throwIfGraphqlErrors(activateResult, activatePayload);
  }

  return savedDiscountId;
}
