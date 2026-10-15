import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  return {
    admin,
    session,
  };
};

export default function IntegrationPage() {
  return (
    <s-page heading="List of Ecommerce Flows">
      <s-section>
        <s-grid
          gridTemplateColumns="repeat(3, 1fr)"
          gap="base"
          alignItems="start"
        >
          {/* Free Shipping Bar */}
          <s-box
            border="base"
            borderRadius="base"
            overflow="hidden"
            maxInlineSize="300px"
          >
            <s-clickable href={"/app/integration/free-shipping-bar"}>
              <s-image
                alt="Free Shipping Bar"
                src="/free-shipping-bar-placeholder.png"
              />
            </s-clickable>

            <s-box padding="small">
              <s-stack direction="block" gap="small">
                <s-paragraph>Free shipping bar</s-paragraph>
              </s-stack>
            </s-box>
            <s-divider />

            <s-grid
              gridTemplateColumns="1fr auto"
              background="base"
              padding="small"
              gap="small"
              alignItems="center"
            >
              <s-stack direction="block" gap="small">
                <s-heading>Free Shipping Bar</s-heading>
              </s-stack>
              <s-button
                href="/app/integration/free-shipping-bar"
                accessibilityLabel="Create Free Shipping Bar"
              >
                Create
              </s-button>
            </s-grid>
          </s-box>

          {/* Frequently Bought Together */}
          <s-box
            border="base"
            borderRadius="base"
            overflow="hidden"
            maxInlineSize="300px"
          >
            <s-clickable href="/app/integration/fbt-bundle">
              <s-image
                alt="Frequently Bought Together"
                src="/fbt-bundle-placeholder.png"
              />
            </s-clickable>

            <s-box padding="small">
              <s-stack direction="block" gap="small">
                <s-paragraph>
                  Frequently bought with current product
                </s-paragraph>
              </s-stack>
            </s-box>
            <s-divider />

            <s-grid
              gridTemplateColumns="1fr auto"
              background="base"
              padding="small"
              gap="small"
              alignItems="center"
            >
              <s-stack direction="block" gap="small">
                <s-heading>Frequently Bought Together</s-heading>
              </s-stack>
              <s-button
                href="/app/integration/fbt-bundle"
                accessibilityLabel="Create Frequently Bought Together"
              >
                Create
              </s-button>
            </s-grid>
          </s-box>
        </s-grid>
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
