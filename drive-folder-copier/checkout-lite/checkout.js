// checkout.js — Hosted on extensionlabs.online (regular web page, so
// Paddle.js loads without any extension CSP restrictions).
//
// Reads install_id / pack from the URL fragment, opens Paddle Checkout with
// the matching Price ID for that credit pack (a ONE-TIME purchase, not a
// subscription — Lite has no recurring billing), and messages the extension
// back when the purchase completes. Same externally_connectable pattern
// used by the Pro checkout and by picker-lite/picker.js.

const EXTENSION_ID = "lbebgmgpdafocohkmhpjifkadnagliip";

// ⚠️ FILL IN: paste your real Paddle LIVE client-side token here (same
// Paddle account as the Pro product — find it in Paddle → Developer Tools
// → Authentication → "Client-side tokens", starts with "live_").
const PADDLE_CLIENT_TOKEN = "live_REPLACE_ME";

// ⚠️ FILL IN: paste the 3 real Price IDs from Paddle → Catalog → Products,
// one per credit pack (each a ONE-TIME price, not recurring). Each looks
// like "pri_01xxxxxxxxxxxxxxxxxxxxxxx".
const PRICE_IDS = {
  pack_10gb: "pri_REPLACE_ME_10GB",
  pack_50gb: "pri_REPLACE_ME_50GB",
  pack_200gb: "pri_REPLACE_ME_200GB"
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
    pack: params.get("pack")
  };
}

const { installId, pack } = getParamsFromHash();

if (!installId || !pack) {
  setStatus("Missing checkout details. Close this tab and try again from the extension.", true);
} else {
  const priceId = PRICE_IDS[pack];
  if (!priceId || priceId.includes("REPLACE_ME")) {
    setStatus("This credit pack isn't configured yet. Please contact support@extensionlabs.online.", true);
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
      product: "lite",
      pack: pack
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
    notifyExtension({ type: "CREDITS_PURCHASE_COMPLETED", installId });
  } else if (event.name === "checkout.closed") {
    window.close();
  }
}

function notifyExtension(message) {
  if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
    return;
  }
  chrome.runtime.sendMessage(EXTENSION_ID, message, () => {
    setTimeout(() => window.close(), 1500);
  });
}
