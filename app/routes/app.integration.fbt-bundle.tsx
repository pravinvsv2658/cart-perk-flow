import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getOrCreateStore } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  FbtBundleForm,
  type FbtBundleFormData,
  type FbtBundleFormInitialData,
  type FbtProductItem,
  type FbtTriggerItem,
  type FbtTriggerType,
} from "../components/bundle-creation";

function getCurrencySymbol(code: string): string {
  if (!code) return "$";
  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    });
    const parts = formatter.formatToParts(0);
    const symbolPart = parts.find((part) => part.type === "currency");
    return symbolPart ? symbolPart.value : code;
  } catch {
    return code || "$";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  const url = new URL(request.url);
  const bundleId = url.searchParams.get("id");

  let initialData: FbtBundleFormInitialData | null = null;
  let isEditing = false;

  if (bundleId) {
    const existing = await prisma.bundle.findFirst({
      where: {
        id: bundleId,
        storeId: store.id,
      },
      include: {
        products: true,
        triggerProducts: true,
        triggerCollections: true,
        tags: true,
      },
    });

    if (existing) {
      isEditing = true;

      let triggerType: FbtTriggerType = "ALL";
      if (
        existing.triggerType === "PRODUCT" ||
        existing.triggerType === "COLLECTION" ||
        existing.triggerType === "TAGS"
      ) {
        triggerType = existing.triggerType as FbtTriggerType;
      } else if (existing.triggerType === "TAG") {
        triggerType = "TAGS";
      } else if (existing.triggerType === "SPECIFIC") {
        if (existing.tags && existing.tags.length > 0) {
          triggerType = "TAGS";
        } else if (
          existing.triggerCollections &&
          existing.triggerCollections.length > 0
        ) {
          triggerType = "COLLECTION";
        } else {
          triggerType = "PRODUCT";
        }
      }

      // Resolve metadata (title & image) for trigger products & collections
      const triggerProductGids = existing.triggerProducts
        .map((tp) => {
          const id = tp.shopifyId.trim();
          if (id.startsWith("gid://shopify/Product/")) return id;
          const digits = id.replace(/\D/g, "");
          return digits ? `gid://shopify/Product/${digits}` : "";
        })
        .filter(Boolean);

      const triggerCollectionGids = existing.triggerCollections
        .map((tc) => {
          const id = tc.shopifyId.trim();
          if (id.startsWith("gid://shopify/Collection/")) return id;
          const digits = id.replace(/\D/g, "");
          return digits ? `gid://shopify/Collection/${digits}` : "";
        })
        .filter(Boolean);

      const titleMap = new Map<string, { title: string; image?: string }>();

      // Pre-seed from bundle's own products
      existing.products.forEach((p) => {
        if (p.shopifyId) {
          const info = {
            title: p.title || "Product",
            image: p.featuredImage || "",
          };
          titleMap.set(p.shopifyId, info);
          const digits = p.shopifyId.replace(/\D/g, "");
          if (digits) {
            titleMap.set(`gid://shopify/Product/${digits}`, info);
            titleMap.set(digits, info);
          }
        }
      });

      const idsToFetch = [
        ...triggerProductGids.filter((gid) => !titleMap.has(gid)),
        ...triggerCollectionGids.filter((gid) => !titleMap.has(gid)),
      ];

      if (idsToFetch.length > 0) {
        try {
          const nodesRes = await admin.graphql(
            `#graphql
            query getTriggerNodes($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  title
                  featuredImage {
                    url
                  }
                }
                ... on Collection {
                  id
                  title
                  image {
                    url
                  }
                }
              }
            }`,
            { variables: { ids: idsToFetch } },
          );
          const nodesJson = await nodesRes.json();
          const nodes = (nodesJson.data as any)?.nodes || [];
          for (const node of nodes) {
            if (node && node.id) {
              const nodeInfo = {
                title: node.title || "",
                image: node.featuredImage?.url || node.image?.url || "",
              };
              titleMap.set(node.id, nodeInfo);
              const digits = String(node.id).replace(/\D/g, "");
              if (digits) {
                titleMap.set(digits, nodeInfo);
              }
            }
          }
        } catch (e) {
          console.warn("Could not fetch trigger node titles:", e);
        }
      }

      initialData = {
        id: existing.id,
        bundleId: existing.id,
        title: existing.title,
        bundleName: existing.title,
        description: existing.description || "",
        status: existing.status === "DRAFT" ? "DRAFT" : "ACTIVE",
        startDate: existing.startDate,
        endDate: existing.endDate,
        triggerType,
        discountType: existing.discountType || "PERCENTAGE",
        discountValue: existing.discountValue || 10,
        badgeText: existing.badgeText || "Frequently Bought Together",
        ctaButtonText: existing.ctaButtonText || "Add Selected to Cart",
        products: existing.products.map((p) => ({
          id: p.id,
          shopifyId: p.shopifyId,
          title: p.title || "Product",
          price: p.price ?? 0,
          featuredImage: p.featuredImage || "",
          qty: p.qty ?? 1,
          role: p.role || "BUNDLE_ITEM",
        })),
        triggerProducts: existing.triggerProducts.map((tp) => {
          const digits = tp.shopifyId.replace(/\D/g, "");
          const meta =
            titleMap.get(tp.shopifyId) ||
            (digits
              ? titleMap.get(`gid://shopify/Product/${digits}`)
              : undefined) ||
            (digits ? titleMap.get(digits) : undefined);
          return {
            id: tp.id,
            shopifyId: tp.shopifyId,
            title: meta?.title || "Product",
            image: meta?.image || "",
          };
        }),
        triggerCollections: existing.triggerCollections.map((tc) => {
          const digits = tc.shopifyId.replace(/\D/g, "");
          const meta =
            titleMap.get(tc.shopifyId) ||
            (digits
              ? titleMap.get(`gid://shopify/Collection/${digits}`)
              : undefined) ||
            (digits ? titleMap.get(digits) : undefined);
          return {
            id: tc.id,
            shopifyId: tc.shopifyId,
            title: meta?.title || "Collection",
            image: meta?.image || "",
          };
        }),
        tags: existing.tags.map((t) => t.tag),
      };
    }
  }

  // Plan limits check
  const bundleLimit = store.plan?.bundleLimit ?? 1;
  const activeBundleCount = await prisma.bundle.count({
    where: {
      storeId: store.id,
      status: "ACTIVE",
    },
  });

  const isLimitReached = activeBundleCount >= bundleLimit;
  const isFreePlan = store.plan?.name?.toLowerCase().includes("free") ?? true;

  // Store product tags from Shopify catalog only
  let availableTags: string[] = [];
  try {
    const tagsResponse = await admin.graphql(
      `#graphql
      query getProductTags {
        productTags(first: 250) {
          edges {
            node
          }
        }
      }`,
    );
    const tagsJson = await tagsResponse.json();
    if (tagsJson.data?.productTags?.edges) {
      availableTags = tagsJson.data.productTags.edges
        .map((edge: { node: string }) => edge.node)
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b));
    }
  } catch (err) {
    console.warn("GraphQL productTags fetch error:", err);
  }

  // Store currency
  let currencyCode = store.currency || "USD";
  try {
    const response = await admin.graphql(
      `#graphql
      query getShopCurrency {
        shop {
          currencyCode
        }
      }`,
    );
    const json = await response.json();
    if (json.data?.shop?.currencyCode) {
      currencyCode = json.data.shop.currencyCode;
    }
  } catch (err) {
    console.warn("GraphQL shop currency fetch fallback:", err);
  }

  return {
    currencyCode,
    isEditing,
    initialData,
    availableTags,
    isLimitReached,
    activeBundleCount,
    bundleLimit,
    isFreePlan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop, admin, session);

  let payload: any;
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await request.json();
      payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    } else {
      const formData = await request.formData();
      const rawPayload = formData.get("payload");
      if (typeof rawPayload === "string") {
        payload = JSON.parse(rawPayload);
      } else {
        payload = Object.fromEntries(formData.entries());
      }
    }
  } catch (err: any) {
    console.error("Payload parsing error in fbt-bundle action:", err);
    return data({ error: "Invalid payload format" }, { status: 400 });
  }

  const url = new URL(request.url);
  const bundleId =
    (typeof payload.bundleId === "string" ? payload.bundleId : "") ||
    (typeof payload.id === "string" ? payload.id : "") ||
    url.searchParams.get("id");

  const title = (
    typeof payload.title === "string"
      ? payload.title
      : typeof payload.bundleName === "string"
        ? payload.bundleName
        : ""
  ).trim();

  if (!title) {
    return data(
      { error: "Perk title is required for Frequently Bought Together." },
      { status: 400 },
    );
  }

  const requestedStatus = payload.status === "DRAFT" ? "DRAFT" : "ACTIVE";
  const startDate = payload.startDate
    ? new Date(payload.startDate)
    : new Date();
  const endDate = payload.endDate ? new Date(payload.endDate) : null;

  if (endDate && endDate <= startDate) {
    return data(
      { error: "End Date must be after the Start Date." },
      { status: 400 },
    );
  }

  const discountType = payload.discountType || "PERCENTAGE";
  const discountValue = parseFloat(String(payload.discountValue || "0")) || 0;

  if (
    discountType === "PERCENTAGE" &&
    (discountValue < 0 || discountValue > 100)
  ) {
    return data(
      { error: "Percentage discount must be between 0% and 100%." },
      { status: 400 },
    );
  }
  if (discountType === "FIXED_AMOUNT" && discountValue < 0) {
    return data(
      { error: "Fixed amount discount cannot be negative." },
      { status: 400 },
    );
  }

  // Check active perk plan limit
  if (requestedStatus === "ACTIVE") {
    const bundleLimit = store.plan?.bundleLimit ?? 1;
    const activeBundleCount = await prisma.bundle.count({
      where: {
        storeId: store.id,
        status: "ACTIVE",
        ...(bundleId ? { NOT: { id: bundleId } } : {}),
      },
    });

    if (activeBundleCount >= bundleLimit) {
      return data(
        {
          error: `Active perk limit reached (${activeBundleCount}/${bundleLimit}). Please upgrade your plan in Settings or save this perk as Draft.`,
        },
        { status: 400 },
      );
    }
  }

  const rawTrigger = String(payload.triggerType || "ALL").toUpperCase();
  const triggerType: FbtTriggerType =
    rawTrigger === "PRODUCT" ||
    rawTrigger === "COLLECTION" ||
    rawTrigger === "TAGS"
      ? (rawTrigger as FbtTriggerType)
      : rawTrigger === "TAG"
        ? "TAGS"
        : "ALL";

  const badgeText = payload.badgeText || "Frequently Bought Together";
  const ctaButtonText = payload.ctaButtonText || "Add Selected to Cart";
  const description = payload.description || "";

  const products: FbtProductItem[] = Array.isArray(payload.products)
    ? payload.products
    : [];

  if (products.length === 0) {
    return data(
      { error: "Please select at least one product for the bundle." },
      { status: 400 },
    );
  }

  const triggerProducts: FbtTriggerItem[] = Array.isArray(
    payload.triggerProducts,
  )
    ? payload.triggerProducts
    : [];

  const triggerCollections: FbtTriggerItem[] = Array.isArray(
    payload.triggerCollections,
  )
    ? payload.triggerCollections
    : [];

  const tags: string[] = Array.isArray(payload.tags)
    ? payload.tags.map((t: any) => String(t).trim()).filter(Boolean)
    : [];

  try {
    let savedBundle: any;

    if (bundleId) {
      // Update existing bundle
      savedBundle = await prisma.bundle.update({
        where: {
          id: bundleId,
          storeId: store.id,
        },
        data: {
          title,
          description,
          bundleType: "FBT",
          discountType,
          discountValue,
          status: requestedStatus,
          startDate,
          endDate,
          triggerType,
          badgeText,
          ctaButtonText,
          updatedAt: new Date(),
        },
      });

      // Synchronize related products
      await prisma.bundleProduct.deleteMany({ where: { bundleId } });
      await prisma.bundleProduct.createMany({
        data: products.map((p) => ({
          bundleId,
          shopifyId: p.shopifyId,
          title: p.title || "Product",
          price: typeof p.price === "number" ? p.price : 0,
          featuredImage: p.featuredImage || "",
          qty: p.qty || 1,
          role: p.role || "BUNDLE_ITEM",
        })),
      });

      // Synchronize trigger products
      await prisma.bundleTriggerProduct.deleteMany({ where: { bundleId } });
      if (triggerType === "PRODUCT" && triggerProducts.length > 0) {
        await prisma.bundleTriggerProduct.createMany({
          data: triggerProducts.map((tp) => ({
            bundleId,
            shopifyId: tp.shopifyId,
          })),
        });
      }

      // Synchronize trigger collections
      await prisma.bundleTriggerCollection.deleteMany({ where: { bundleId } });
      if (triggerType === "COLLECTION" && triggerCollections.length > 0) {
        await prisma.bundleTriggerCollection.createMany({
          data: triggerCollections.map((tc) => ({
            bundleId,
            shopifyId: tc.shopifyId,
          })),
        });
      }

      // Synchronize tags
      await prisma.bundleTag.deleteMany({ where: { bundleId } });
      if (triggerType === "TAGS" && tags.length > 0) {
        await prisma.bundleTag.createMany({
          data: tags.map((tag) => ({
            bundleId,
            tag,
          })),
        });
      }

      return data({
        success: true,
        isEdit: true,
        bundle: savedBundle,
      });
    } else {
      // Create new bundle with relations
      savedBundle = await prisma.bundle.create({
        data: {
          storeId: store.id,
          title,
          description,
          bundleType: "FBT",
          discountType,
          discountValue,
          status: requestedStatus,
          startDate,
          endDate,
          triggerType,
          badgeText,
          ctaButtonText,
          products: {
            create: products.map((p) => ({
              shopifyId: p.shopifyId,
              title: p.title || "Product",
              price: typeof p.price === "number" ? p.price : 0,
              featuredImage: p.featuredImage || "",
              qty: p.qty || 1,
              role: p.role || "BUNDLE_ITEM",
            })),
          },
          ...(triggerType === "PRODUCT" && triggerProducts.length > 0
            ? {
                triggerProducts: {
                  create: triggerProducts.map((tp) => ({
                    shopifyId: tp.shopifyId,
                  })),
                },
              }
            : {}),
          ...(triggerType === "COLLECTION" && triggerCollections.length > 0
            ? {
                triggerCollections: {
                  create: triggerCollections.map((tc) => ({
                    shopifyId: tc.shopifyId,
                  })),
                },
              }
            : {}),
          ...(triggerType === "TAGS" && tags.length > 0
            ? {
                tags: {
                  create: tags.map((tag) => ({
                    tag,
                  })),
                },
              }
            : {}),
        },
      });

      return data({
        success: true,
        isEdit: false,
        bundle: savedBundle,
      });
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to save Frequently Bought Together perk in database";
    console.error("Error saving FBT perk:", err);
    return data({ error: message }, { status: 400 });
  }
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function FbtBundlePage() {
  const {
    currencyCode,
    isEditing,
    initialData,
    availableTags,
    isLimitReached,
    activeBundleCount,
    bundleLimit,
  } = useLoaderData<typeof loader>();

  const currencySymbol = getCurrencySymbol(currencyCode);
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    const res = fetcher.data as
      | { success: boolean; isEdit?: boolean; bundle: any }
      | { error: string }
      | undefined;

    if (res && "success" in res && res.success) {
      const isEdit = res.isEdit;
      shopify.toast.show(
        isEdit
          ? "Frequently Bought Together perk updated successfully!"
          : "Frequently Bought Together perk created successfully!",
      );
      // Stay on same page: if creating new, update URL to edit mode with bundle ID
      if (!isEdit && res.bundle?.id) {
        navigate(`?id=${res.bundle.id}`, { replace: true });
      }
    } else if (res && "error" in res && res.error) {
      shopify.toast.show(res.error, { isError: true });
    }
  }, [fetcher.data, navigate, shopify]);

  const handleSubmit = (formData: FbtBundleFormData) => {
    fetcher.submit({ payload: JSON.stringify(formData) }, { method: "POST" });
  };

  return (
    <s-page
      heading={
        isEditing
          ? `Edit Perk: ${initialData?.title || "Frequently Bought Together"}`
          : "Create Frequently Bought Together Perk"
      }
    >
      <s-button
        commandFor="fbt-preview-modal"
        command="--show"
        slot="primary-action"
      >
        👁️ Preview Storefront Widget
      </s-button>

      <FbtBundleForm
        key={initialData?.bundleId || initialData?.id || "new-fbt"}
        initialData={initialData || undefined}
        availableTags={availableTags}
        currencySymbol={currencySymbol}
        isSubmitting={fetcher.state !== "idle"}
        submitButtonLabel={isEditing ? "Save Changes" : "Create Perk"}
        submittingLabel={isEditing ? "Saving Changes..." : "Creating Perk..."}
        onSubmit={handleSubmit}
        onCancel={() => navigate("/app")}
        isLimitReached={isLimitReached}
        activeBundleCount={activeBundleCount}
        bundleLimit={bundleLimit}
        isEditing={isEditing}
      />
    </s-page>
  );
}
