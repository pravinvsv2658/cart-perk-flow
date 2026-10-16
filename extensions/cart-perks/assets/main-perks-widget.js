/**
 * CartPerksFlow - Free Shipping Bar & Cart Integration
 *
 * Designed to work with all `.cartperks-shipping-bar` elements on the storefront
 * (cart page, cart drawer, etc.) using querySelectorAll.
 * Fetches data from CartPerksFlow backend database API and keeps progress bar synchronized.
 */
(function () {
  "use strict";

  // Guard: Only run if the master App Embed is active on the storefront
  if (!window.__cartPerksFlowEnabled) {
    return;
  }

  // Prevent duplicate script execution
  if (window.__cartPerksWidgetInitialized) return;
  window.__cartPerksWidgetInitialized = true;

  const BAR_SELECTOR = ".cartperks-shipping-bar";

  let cachedConfig = null;
  let configPromise = null;
  let isFetching = false;
  let pendingUpdate = false;
  let isRendering = false;
  let lastKnownTotal = 0;

  // Preserve original fetch
  const originalFetch = window.fetch;
  window.__cartPerksOriginalFetch = originalFetch;

  /*----------------------------------
    Currency Localizer
  -----------------------------------*/
  function localizeCurrency(amount) {
    const num = Number(amount) || 0;
    const currency =
      typeof window.Shopify?.currency?.active === "string"
        ? window.Shopify.currency.active
        : typeof window.Shopify?.currency === "string"
          ? window.Shopify.currency
          : "USD";

    const locale =
      window.Shopify?.locale && window.Shopify?.country
        ? `${window.Shopify.locale}-${window.Shopify.country}`
        : document.documentElement.lang || "en-US";

    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency,
      }).format(num);
    } catch {
      const symbol = window.Shopify?.currency?.symbol || "$";
      return `${symbol}${num.toFixed(2)}`;
    }
  }

  /*----------------------------------
    Fetch Config from App Proxy
  -----------------------------------*/
  function getConfigEndpoints() {
    const rootRoute =
      window.__cartPerksRootUrl || window.Shopify?.routes?.root || "/";
    const normalizedRoot = rootRoute.endsWith("/") ? rootRoute : rootRoute + "/";
    const shopDomain =
      window.__cartPerksShop ||
      window.Shopify?.shop ||
      window.Shopify?.theme?.shop ||
      window.location.hostname ||
      "";
    const shopParam = shopDomain
      ? `?shop=${encodeURIComponent(shopDomain)}`
      : "";

    return [
      `${normalizedRoot}apps/cart-perk-flow/api/free-shipping-bar${shopParam}`
    ];
  }

  async function fetchShippingBarConfig() {
    if (cachedConfig) return cachedConfig;
    if (configPromise) return configPromise;

    configPromise = (async () => {
      const endpoints = getConfigEndpoints();
      const fetchImpl = window.__cartPerksOriginalFetch || originalFetch;

      for (const endpoint of endpoints) {
        try {
          const res = await fetchImpl(endpoint, {
            method: "GET",
            headers: { Accept: "application/json" },
          });

          if (res.ok) {
            const result = await res.json();
            if (result && result.active && result.data) {
              cachedConfig = result.data;
              console.log("CartPerks: Successfully loaded shipping bar");
              return cachedConfig;
            }
          }
        } catch {
          // try next endpoint fallback
        }
      }

      console.warn("CartPerks: No active shipping bar config found.");
      return null;
    })().finally(() => {
      configPromise = null;
    });

    return configPromise;
  }

  /*----------------------------------
    Parse Milestones from Config
  -----------------------------------*/
  function extractMilestones(config) {
    if (!config) return { freeShippingTarget: 0, milestones: [], maxTarget: 0 };

    const freeShippingTarget = Number(config.targetAmount) || 0;

    const discountMilestones = (config.thresholds || [])
      .map((item) => {
        const amount = Number(item.amount);
        const discountVal = Number(
          item.discountPercentage ?? item.offerValue ?? 0,
        );
        return {
          amount,
          type: "discount",
          offerType: discountVal > 0 ? "percentage" : "free",
          offerValue: discountVal,
          label: discountVal > 0 ? `${discountVal}% OFF` : "Discount",
          badgeText: discountVal > 0 ? `${discountVal}% Off` : "Gift",
        };
      })
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0);

    const allMilestones = [
      {
        amount: freeShippingTarget,
        type: "free",
        offerType: "free",
        offerValue: 0,
        label: "Free Shipping",
        badgeText: "Free",
      },
      ...discountMilestones,
    ]
      .filter((m) => m.amount > 0)
      .sort((a, b) => a.amount - b.amount);

    const maxTarget = allMilestones.length
      ? Math.max(...allMilestones.map((m) => m.amount))
      : freeShippingTarget;

    return {
      freeShippingTarget,
      milestones: allMilestones,
      maxTarget,
    };
  }

  /*----------------------------------
    Resolve Free Shipping Icon URL
  -----------------------------------*/
  function getFreeShipIconUrl() {
    if (window.__cartPerksFreeShipIconUrl) return window.__cartPerksFreeShipIconUrl;

    const elWithUrl = document.querySelector("[data-icon-url]");
    if (elWithUrl && elWithUrl.dataset.iconUrl) return elWithUrl.dataset.iconUrl;

    const scripts = document.querySelectorAll(
      "script[src*='main-perks-widget.js'], script[src*='main-bundle-widget.js']",
    );
    for (const s of scripts) {
      if (s.src) {
        return s.src.replace(
          /main-(perks|bundle)-widget\.js(\?.*)?$/,
          "free-ship-icon.png$2",
        );
      }
    }

    return "";
  }

  /*----------------------------------
    Render or Update a Single Bar Container
  -----------------------------------*/
  function renderBar(container, config, currentTotal) {
    const { freeShippingTarget, milestones, maxTarget } =
      extractMilestones(config);

    if (!milestones.length || maxTarget <= 0) {
      container.style.display = "none";
      container.removeAttribute("data-initialized");
      return;
    }

    container.style.display = "block";
    container.setAttribute("data-initialized", "true");

    let targetAmountEl = container.querySelector(
      ".cartperks-target-amount, .ecomm-target-amount",
    );
    let progressWrapper = container.querySelector(
      ".cartperks-progress-wrapper, .ecomm-progress-wrapper",
    );
    let progressBar = container.querySelector(
      ".cartperks-progress-bar, .ecomm-progress-bar",
    );
    let milestonesContainer = container.querySelector(
      ".cartperks-milestones, .ecomm-milestones",
    );
    let head = container.querySelector(
      ".cartperks-head-free-ship, .ecomm-head-free-ship",
    );

    // Build DOM structure inside container if not already built
    if (
      !targetAmountEl ||
      !progressWrapper ||
      !progressBar ||
      !milestonesContainer ||
      !head
    ) {
      container.innerHTML = "";

      // 1. Target amount at top
      targetAmountEl = document.createElement("span");
      targetAmountEl.className = "cartperks-target-amount ecomm-target-amount";
      targetAmountEl.textContent = `Free Shipping on ${localizeCurrency(freeShippingTarget)}`;

      // 2. Progress wrapper
      progressWrapper = document.createElement("div");
      progressWrapper.className =
        "cartperks-progress-wrapper ecomm-progress-wrapper cartpage_progress_wrapper";

      // Milestones track
      milestonesContainer = document.createElement("div");
      milestonesContainer.className =
        "cartperks-milestones ecomm-milestones cartpage_milestones";

      const freeIconUrl = getFreeShipIconUrl();

      milestones.forEach((item, index) => {
        const isFirst = index === 0;
        const isLast = index === milestones.length - 1;

        const milestoneEl = document.createElement("div");
        const specialClasses = [
          item.type === "free"
            ? "cartperks-milestone-free ecomm-milestone-free free"
            : "",
          isLast ? "cartperks-milestone-last ecomm-milestone-last last" : "",
          isFirst && item.amount === 0
            ? "cartperks-milestone-first ecomm-milestone-first first"
            : "",
        ]
          .filter(Boolean)
          .join(" ");

        milestoneEl.className = `cartperks-milestone ecomm-milestone cartpage_milestone ${specialClasses}`;
        milestoneEl.dataset.target = String(item.amount);

        const percent = Math.min((item.amount / maxTarget) * 100, 100);

        if (isLast) {
          milestoneEl.style.left = "100%";
        } else if (isFirst && percent <= 0) {
          milestoneEl.style.left = "0%";
        } else {
          milestoneEl.style.left = percent + "%";
        }

        const icon = document.createElement("span");
        icon.className = "cartperks-milestone-icon ecomm-milestone-icon icon";

        if (item.type === "free") {
          if (freeIconUrl) {
            icon.innerHTML = `<img src="${freeIconUrl}" alt="Free Shipping Icon" width="20" height="20" loading="lazy">`;
          } else {
            icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`;
          }
        } else {
          icon.textContent = item.badgeText;
        }

        const label = document.createElement("span");
        label.className = "cartperks-milestone-label ecomm-milestone-label label";
        label.textContent = localizeCurrency(item.amount);

        milestoneEl.append(icon, label);
        milestonesContainer.appendChild(milestoneEl);
      });

      // Progress bar track
      const track = document.createElement("div");
      track.className =
        "cartperks-progress-track ecomm-progress-track cartpage_free_shipp_progress_bar";

      progressBar = document.createElement("div");
      progressBar.className =
        "cartperks-progress-bar ecomm-progress-bar cartpage_progress_bar";
      progressBar.innerHTML = "&nbsp;";

      track.appendChild(progressBar);
      progressWrapper.append(milestonesContainer, track);

      // 3. Message header at bottom
      head = document.createElement("span");
      head.className =
        "cartperks-head-free-ship ecomm-head-free-ship cartpage_head_free_ship";
      head.setAttribute("aria-live", "polite");

      container.append(targetAmountEl, progressWrapper, head);
    }

    // Dynamic milestone positions & target amount text
    targetAmountEl.textContent = `Free Shipping on ${localizeCurrency(freeShippingTarget)}`;

    // Update progress bar width
    const progress = Math.max(0, Math.min((currentTotal / maxTarget) * 100, 100));
    progressBar.style.width = progress + "%";

    // Activate milestones
    const milestoneEls = container.querySelectorAll(
      ".cartperks-milestone, .ecomm-milestone",
    );
    milestoneEls.forEach((item) => {
      const target = Number(item.dataset.target);
      const isReached = currentTotal >= target;

      item.classList.toggle("active", isReached);
      item.classList.toggle("cartperks-active", isReached);
      item.classList.toggle("cartperks-milestone-active", isReached);
      item.classList.toggle("ecomm-active", isReached);
      item.classList.toggle("ecomm-milestone-active", isReached);

      const icon = item.querySelector(".icon");
      if (
        icon &&
        (item.classList.contains("free") ||
          item.classList.contains("cartperks-milestone-free") ||
          item.classList.contains("ecomm-milestone-free"))
      ) {
        const freeIconUrl = getFreeShipIconUrl();
        if (freeIconUrl) {
          if (!icon.querySelector("img")) {
            icon.innerHTML = `<img src="${freeIconUrl}" alt="Free Shipping Icon" width="20" height="20" loading="lazy">`;
          }
        } else {
          if (isReached) {
            icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          } else {
            icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`;
          }
        }
      }
    });

    // Messages (matching reference format precisely)
    const discountMilestones = milestones.filter((m) => m.type !== "free");

    if (currentTotal < freeShippingTarget) {
      head.innerHTML = `You're only <strong>${localizeCurrency(
        freeShippingTarget - currentTotal,
      )}</strong> away from <strong>Free Shipping</strong>.`;
    } else if (discountMilestones.length > 0) {
      const nextMilestone = milestones.find((m) => currentTotal < m.amount);

      if (nextMilestone) {
        const nextIndex = milestones.indexOf(nextMilestone);
        const prevMilestone = milestones[nextIndex - 1];

        if (prevMilestone && prevMilestone.type === "free") {
          head.innerHTML = `✅ <strong>Free Shipping Unlocked!</strong><br>Spend <strong>${localizeCurrency(
            nextMilestone.amount - currentTotal,
          )}</strong> more to unlock <strong>${nextMilestone.label}</strong>.`;
        } else if (prevMilestone) {
          head.innerHTML = `🎉 <strong>Free Shipping + ${prevMilestone.label} Unlocked!</strong><br>Spend <strong>${localizeCurrency(
            nextMilestone.amount - currentTotal,
          )}</strong> more to unlock <strong>${nextMilestone.label}</strong>.`;
        } else {
          head.innerHTML = `✅ <strong>Free Shipping Unlocked!</strong><br>Spend <strong>${localizeCurrency(
            nextMilestone.amount - currentTotal,
          )}</strong> more to unlock <strong>${nextMilestone.label}</strong>.`;
        }
      } else {
        const lastDiscount =
          discountMilestones[discountMilestones.length - 1];
        head.innerHTML = `🎉 Congratulations! You've unlocked <strong>Free Shipping + ${lastDiscount.label}!</strong>`;
      }
    } else {
      head.innerHTML = `🎉 Congratulations! You've unlocked <strong>Free Shipping!</strong>`;
    }
  }

  /*----------------------------------
    Update All Shipping Bar Elements (querySelectorAll)
  -----------------------------------*/
  async function updateAllBars(currentTotal) {
    const bars = document.querySelectorAll(BAR_SELECTOR);
    if (!bars.length) return;

    const config = await fetchShippingBarConfig();
    if (!config) {
      bars.forEach((bar) => {
        bar.style.display = "none";
        bar.removeAttribute("data-initialized");
      });
      return;
    }

    isRendering = true;
    try {
      bars.forEach((bar) => {
        if (!bar.closest("template")) {
          renderBar(bar, config, currentTotal);
        }
      });
    } finally {
      setTimeout(() => {
        isRendering = false;
      }, 50);
    }
  }

  /*----------------------------------
    Fetch Cart & Update Progress
  -----------------------------------*/
  async function fetchCartAndUpdateProgress() {
    if (isFetching) {
      pendingUpdate = true;
      return;
    }

    isFetching = true;
    pendingUpdate = false;

    try {
      const rootRoute =
        window.__cartPerksRootUrl || window.Shopify?.routes?.root || "/";
      const normalizedRoot = rootRoute.endsWith("/")
        ? rootRoute
        : rootRoute + "/";

      const response = await (window.__cartPerksOriginalFetch || fetch)(
        `${normalizedRoot}cart.js?_t=${Date.now()}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );

      if (response.ok) {
        const cart = await response.json();

        // Calculate undiscounted total price (before discounts)
        let undiscountedSubunits = 0;

        if (Array.isArray(cart.items) && cart.items.length > 0) {
          undiscountedSubunits = cart.items.reduce((sum, item) => {
            const lineOriginal =
              typeof item.original_line_price === "number"
                ? item.original_line_price
                : typeof item.original_price === "number"
                  ? item.original_price * (item.quantity || 1)
                  : typeof item.line_price === "number"
                    ? item.line_price
                    : (item.price || 0) * (item.quantity || 1);
            return sum + lineOriginal;
          }, 0);
        }

        if (
          !undiscountedSubunits &&
          typeof cart.original_total_price === "number"
        ) {
          undiscountedSubunits = cart.original_total_price;
        }

        if (!undiscountedSubunits) {
          if (typeof cart.items_subtotal_price === "number") {
            undiscountedSubunits = cart.items_subtotal_price;
          } else if (typeof cart.total_price === "number") {
            undiscountedSubunits = cart.total_price;
          }
        }

        const totalSubunits = undiscountedSubunits;
        lastKnownTotal = totalSubunits / 100;
        await updateAllBars(lastKnownTotal);
      }
    } catch (err) {
      console.error("CartPerks cart fetch error:", err);
    } finally {
      isFetching = false;

      if (pendingUpdate) {
        pendingUpdate = false;
        fetchCartAndUpdateProgress();
      }
    }
  }

  /*----------------------------------
    Observe Cart Containers (Drawer & Page)
  -----------------------------------*/
  function observeCartContainer(selector) {
    const container = document.querySelector(selector);
    if (!container) return;

    let timeout;
    const observer = new MutationObserver(() => {
      if (isRendering) return;

      clearTimeout(timeout);
      timeout = setTimeout(() => {
        fetchCartAndUpdateProgress();
      }, 200);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function initObservers() {
    const selectors = [
      "#cart-notification",
      "#CartDrawer",
      "cart-drawer",
      ".cart-drawer",
      "#main-cart-items",
      "cart-items",
      "#cart-icon-bubble",
      ".cart-count-bubble",
      ".drawer__inner",
      "[data-cart-drawer]",
    ];

    selectors.forEach(observeCartContainer);

    // Watch document.body for newly mounted bars (e.g. dynamic section rendering in cart drawer)
    let bodyTimeout;
    const bodyObserver = new MutationObserver((mutations) => {
      if (isRendering) return;

      const hasRelevantNode = mutations.some((m) => {
        if (
          m.target &&
          (m.target.classList?.contains("cartperks-shipping-bar") ||
            m.target.closest?.(BAR_SELECTOR))
        ) {
          return false;
        }

        if (m.addedNodes && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (
                node.matches?.(BAR_SELECTOR) ||
                node.querySelector?.(BAR_SELECTOR) ||
                node.matches?.("cart-drawer, #CartDrawer, .cart-drawer")
              ) {
                return true;
              }
            }
          }
        }
        return false;
      });

      if (!hasRelevantNode) return;

      clearTimeout(bodyTimeout);
      bodyTimeout = setTimeout(() => {
        if (lastKnownTotal > 0) {
          updateAllBars(lastKnownTotal);
        } else {
          fetchCartAndUpdateProgress();
        }
      }, 100);
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /*----------------------------------
    Fetch Override
  -----------------------------------*/
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    let url = "";
    try {
      if (typeof args[0] === "string") {
        url = args[0];
      } else if (args[0] instanceof URL) {
        url = args[0].href;
      } else if (args[0] && typeof args[0].url === "string") {
        url = args[0].url;
      }
    } catch { }

    if (
      url.includes("/cart/add") ||
      url.includes("/cart/change") ||
      url.includes("/cart/update") ||
      url.includes("/cart/clear")
    ) {
      setTimeout(fetchCartAndUpdateProgress, 300);
    }
    return response;
  };

  /*----------------------------------
    XMLHttpRequest Override (for AJAX themes)
  -----------------------------------*/
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cartPerksUrl = typeof url === "string" ? url : String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      if (this.status >= 200 && this.status < 300 && this.__cartPerksUrl) {
        const u = this.__cartPerksUrl;
        if (
          u.includes("/cart/add") ||
          u.includes("/cart/change") ||
          u.includes("/cart/update") ||
          u.includes("/cart/clear")
        ) {
          setTimeout(fetchCartAndUpdateProgress, 300);
        }
      }
    });
    return originalSend.apply(this, args);
  };

  /*----------------------------------
    Theme Event Support
  -----------------------------------*/
  const themeCartEvents = [
    "cart:updated",
    "cart:refresh",
    "cart:change",
    "cart-update",
    "theme:cart:updated",
    "theme:cart:change",
    "cartDrawer:open",
    "cart-drawer:open",
    "drawer:opened",
    "drawer:open",
    "ajaxCart.afterCartLoad",
    "rebuy:cart.change",
  ];

  themeCartEvents.forEach((evt) => {
    document.addEventListener(evt, () =>
      setTimeout(fetchCartAndUpdateProgress, 100),
    );
  });

  /*----------------------------------
    Click & Input Listeners (Cart triggers, removals)
  -----------------------------------*/
  document.addEventListener("click", function (evt) {
    const target = evt.target;
    if (!target) return;

    if (
      target.closest(
        "a[href*='/cart'], #cart-icon-bubble, .header__icon--cart, [data-cart-drawer-trigger], [data-drawer-trigger], cart-remove-button, [data-cart-remove], .quantity__button, button[name='minus'], button[name='plus']",
      )
    ) {
      setTimeout(fetchCartAndUpdateProgress, 150);
    }
  });

  document.addEventListener("change", function (evt) {
    const el =
      evt.target &&
      evt.target.closest(
        "input[name='updates[]'], input[name*='quantity'], .quantity__input",
      );
    if (el) {
      setTimeout(fetchCartAndUpdateProgress, 200);
    }
  });

  /*----------------------------------
    Public API
  -----------------------------------*/
  window.CartPerksFlow = {
    refresh: fetchCartAndUpdateProgress,
    getConfig: () => cachedConfig,
    getTotal: () => lastKnownTotal,
  };

  /*----------------------------------
    Initial Load
  -----------------------------------*/
  function init() {
    fetchCartAndUpdateProgress();
    initObservers();
  }

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
