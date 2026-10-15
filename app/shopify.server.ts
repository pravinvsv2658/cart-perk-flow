import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    afterAuth: async ({ session, admin }) => {
      console.log(`[afterAuth] App installed/authorized for ${session.shop}`);
      await getOrCreateStore(session.shop, admin, session);
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

// In-flight store sync deduplication to prevent parallel route loaders from triggering race conditions
const inFlightStoreSyncs = new Map<string, Promise<any>>();

/**
 * Register / synchronize installed Store details and accessToken into the database.
 * Triggered automatically on app installation (afterAuth hook) and whenever the app loads.
 */
export async function getOrCreateStore(
  param1: any,
  param2?: any,
  param3?: any,
) {
  let shop: string = "";
  let admin: any = undefined;
  let accessToken: string | undefined = undefined;

  if (typeof param1 === "string") {
    shop = param1;
    if (param2 && typeof param2.graphql === "function") {
      admin = param2;
    } else if (param2 && param2.accessToken) {
      accessToken = param2.accessToken;
    }
    if (param3 && param3.accessToken) {
      accessToken = param3.accessToken;
    }
  } else if (param1 && typeof param1 === "object") {
    shop = param1.shop || "";
    accessToken = param1.accessToken;
    admin = param2;
  }

  if (!shop) {
    return {
      id: "store_default",
      shop: "myshop.myshopify.com",
      name: "myshop",
      currency: "USD",
      accessToken: null,
      plan: {
        name: "Free",
        price: 0,
        currency: "USD",
        billingInterval: "EVERY_30_DAYS",
        trialDays: 0,
        bundleLimit: 1,
      },
      bundles: [],
    };
  }

  // If another request is currently synchronizing this shop, reuse its in-flight promise
  if (inFlightStoreSyncs.has(shop)) {
    return inFlightStoreSyncs.get(shop);
  }

  const syncPromise = (async () => {
    const fallbackStore = {
      id: "store_default",
      shop,
      name: shop.split(".")[0],
      currency: "USD",
      accessToken: accessToken || null,
      plan: {
        name: "Free",
        price: 0,
        currency: "USD",
        billingInterval: "EVERY_30_DAYS",
        trialDays: 0,
        bundleLimit: 1,
      },
      bundles: [],
    };

    let shopName = shop.split(".")[0];
    let shopEmail = "";
    let shopCurrency = "USD";

    // If admin GraphQL client is provided, query real shop details from Shopify
    if (admin && typeof admin.graphql === "function") {
      try {
        const response = await admin.graphql(
          `#graphql
          query getShopDetails {
            shop {
              name
              email
              myshopifyDomain
              currencyCode
            }
          }`,
        );
        const resJson = await response.json();
        const shopData = resJson.data?.shop;

        if (shopData) {
          shopName = shopData.name || shopName;
          shopEmail = shopData.email || shopEmail;
          shopCurrency = shopData.currencyCode || shopCurrency;
        }
      } catch (graphqlErr) {
        console.warn(
          "Could not fetch shop GraphQL details, using fallback:",
          graphqlErr,
        );
      }
    }

    try {
      const freePlan = await prisma.plan.findFirst({ where: { name: "Free" } });

      const includeConfig = {
        plan: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" as const },
          take: 1,
          include: { plan: true },
        },
        bundles: true,
      };

      let store: any;
      try {
        store = await prisma.store.upsert({
          where: { shop },
          update: {
            name: shopName,
            email: shopEmail || undefined,
            currency: shopCurrency,
            accessToken: accessToken || undefined,
            isInstalled: true,
            uninstalledAt: null,
          },
          create: {
            shop,
            name: shopName,
            email: shopEmail || undefined,
            currency: shopCurrency,
            accessToken: accessToken || undefined,
            planId: freePlan?.id || null,
            isInstalled: true,
          },
          include: includeConfig,
        });
      } catch (upsertErr: any) {
        // Recover gracefully from concurrent insertion collision (P2002)
        if (
          upsertErr?.code === "P2002" ||
          String(upsertErr?.message || "").includes("Unique constraint")
        ) {
          store = await prisma.store.update({
            where: { shop },
            data: {
              name: shopName,
              email: shopEmail || undefined,
              currency: shopCurrency,
              accessToken: accessToken || undefined,
              isInstalled: true,
              uninstalledAt: null,
            },
            include: includeConfig,
          });
        } else {
          throw upsertErr;
        }
      }

      // Synchronize initial subscription record if store has none
      if (store && (!store.subscriptions || store.subscriptions.length === 0)) {
        const activePlan = store.plan || freePlan;
        if (activePlan) {
          try {
            const existingSub = await prisma.subscription.findFirst({
              where: { shopId: store.id, status: "ACTIVE" },
              include: { plan: true },
            });

            if (existingSub) {
              store.subscriptions = [existingSub];
            } else {
              const initialSubscription = await prisma.subscription.create({
                data: {
                  shopId: store.id,
                  planId: activePlan.id,
                  name: activePlan.name,
                  status: "ACTIVE",
                  price: activePlan.price,
                  currency: activePlan.currency || "USD",
                  interval: activePlan.billingInterval || "EVERY_30_DAYS",
                  trialDays: activePlan.trialDays || 0,
                  currentPeriodEnd: new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000,
                  ),
                },
                include: { plan: true },
              });
              store.subscriptions = [initialSubscription];
            }
          } catch (subErr) {
            console.warn(
              "Could not create initial subscription record:",
              subErr,
            );
          }
        }
      }

      if (store) return store;
    } catch (dbErr) {
      console.warn("Notice: Store database operation fallback active:", dbErr);
    }

    return fallbackStore;
  })();

  inFlightStoreSyncs.set(shop, syncPromise);

  try {
    return await syncPromise;
  } finally {
    inFlightStoreSyncs.delete(shop);
  }
}
