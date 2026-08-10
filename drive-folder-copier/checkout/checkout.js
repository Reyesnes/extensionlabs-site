// checkout.js — Hosted on extensionlabs.online (regular web page, so
// Paddle.js loads without any extension CSP restrictions).
//
// Reads install_id / plan / billing_period from the URL fragment, opens
// Paddle Checkout with the matching Price ID, and messages the extension
// back when the purchase completes — same externally_connectable pattern
// used by the Picker.

const EXTENSION_ID = "adocjegeagfnjhdkjiagkabbnopmochk";

// ⚠️ FILL IN: paste your real Paddle LIVE client-side token here.
// Find it in Paddle → Developer Tools → Authentication → "Client-side tokens".
// It starts with "live_".
const PADDLE_CLIENT_TOKEN = "live_d0dd112b18d92a6fcc4fe9d1c48";

// ⚠️ FILL IN: paste your 9 real Price IDs from Paddle → Catalog → Products
// (click into each product, copy the Price ID for each of its 3 prices).
// Each looks like "pri_01xxxxxxxxxxxxxxxxxxxxxxx".
const PRICE_IDS = {
  essential: {
    monthly: "pri_01kzpf4jpk0vj27236g7v7nsm1",
    annual: "pri_01kzpf6k0nye8d60k099csbzpw",
    perpetual: "pri_01kzpf88w4xm8mggm4esn5sddw"
  },
  advanced: {
    monthly: "pri_01kzpfbj2t884jrn9hn4zcyvh3",
    annual: "pri_01kzpfctq53g63kx0kg4bzy3mf",
    perpetual: "pri_01kzpfdy1cjynksp0e8sfyka8a"
  },
  business: {
    monthly: "pri_01kzpfm6knqk26fv2qnqw9xdfw",
    annual: "pri_01kzpfn297j7cms78f0pxcrcjq",
    perpetual: "pri_01kzpfp0q1en0fvv252v078yjv"
  }
};

const statusEl = document.getElementById("status");
const spinnerEl = document.getElementById("spinner");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  if (isError) spinnerEl.style.display = "none";
}

function getParamsFromHash() {
  const params = new URLSearchParams(location.hash.substring(1));
  return {
    installId: params.get("install_id"),
    plan: params.get("plan"),
    billingPeriod: params.get("billing_period")
  };
}

const { installId, plan, billingPeriod } = getParamsFromHash();

if (!installId || !plan || !billingPeriod) {
  setStatus("Missing checkout details. Close this tab and try again from the extension.", true);
} else {
  const priceId = PRICE_IDS[plan]?.[billingPeriod];
  if (!priceId || priceId.includes("REPLACE_ME")) {
    setStatus("This plan isn't configured yet. Please contact support@extensionlabs.online.", true);
  } else {
    openCheckout(priceId);
  }
}

function openCheckout(priceId) {
  Paddle.Environment.set("production"); // remove this line entirely to test against sandbox
  Paddle.Initialize({
    token: PADDLE_CLIENT_TOKEN,
    eventCallback: onPaddleEvent
  });

  Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: {
      install_id: installId,
      plan: plan,
      billing_period: billingPeriod
    },
    settings: {
      displayMode: "overlay",
      theme: "light"
    }
  });

  spinnerEl.style.display = "none";
  statusEl.style.display = "none";
}

function onPaddleEvent(event) {
  if (event.name === "checkout.completed") {
    notifyExtension({ type: "CHECKOUT_COMPLETED", installId });
  } else if (event.name === "checkout.closed") {
    // User closed the checkout without paying — just let them close the tab.
    window.close();
  }
}

function notifyExtension(message) {
  if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
    // Not running in a context where the extension can hear us — the
    // webhook + get-license endpoint will still pick this up next time the
    // extension checks, so this isn't fatal, just less instant.
    return;
  }
  chrome.runtime.sendMessage(EXTENSION_ID, message, () => {
    setTimeout(() => window.close(), 1500);
  });
}
