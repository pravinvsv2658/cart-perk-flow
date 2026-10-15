import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const defaultPlans = [
  {
    name: "Free",
    price: 0.0,
    currency: "USD",
    billingInterval: "EVERY_30_DAYS",
    trialDays: 0,
    bundleLimit: 1,
    features: "Up to 1 Active Perk, FBT, Shipping Bar, Standard Support",
  },
  {
    name: "Starter",
    price: 9.99,
    currency: "USD",
    billingInterval: "EVERY_30_DAYS",
    trialDays: 14,
    bundleLimit: 5,
    features:
      "Up to 5 Active Perks, FBT, Shipping Bar & Widgets, Priority Support",
  },
  {
    name: "Pro",
    price: 19.99,
    currency: "USD",
    billingInterval: "EVERY_30_DAYS",
    trialDays: 14,
    bundleLimit: 999,
    features:
      "Unlimited Bundles, All from Starter,Dedicated Account Manager",
  },
];

async function main() {
  console.log("🌱 Seeding plan data into database...");

  for (const plan of defaultPlans) {
    const seeded = await prisma.plan.upsert({
      where: { name: plan.name },
      update: {
        price: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        trialDays: plan.trialDays,
        bundleLimit: plan.bundleLimit,
        features: plan.features,
      },
      create: plan,
    });
    console.log(
      `✓ Plan seeded/updated: ${seeded.name} ($${seeded.price} ${seeded.currency}/${seeded.billingInterval}, trial: ${seeded.trialDays}d, limit: ${seeded.bundleLimit})`,
    );
  }

  console.log("✨ All plans successfully seeded!");

  // Synchronize existing stores without subscriptions
  const stores = await prisma.store.findMany({
    include: { plan: true, subscriptions: true },
  });

  const freePlan = await prisma.plan.findFirst({ where: { name: "Free" } });

  for (const store of stores) {
    if (store.subscriptions.length === 0) {
      const activePlan = store.plan || freePlan;
      if (activePlan) {
        await prisma.subscription.create({
          data: {
            shopId: store.id,
            planId: activePlan.id,
            name: activePlan.name,
            status: "ACTIVE",
            price: activePlan.price,
            currency: activePlan.currency || "USD",
            interval: activePlan.billingInterval || "EVERY_30_DAYS",
            trialDays: activePlan.trialDays || 0,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        console.log(
          `✓ Created initial active subscription for store: ${store.shop} (${activePlan.name})`,
        );
      }
    }
  }
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
