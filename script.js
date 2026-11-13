/*
 * Wraeclast Market
 * Path of Exile 2 Economy Tracker
 * API: poe.ninja through Cloudflare Worker
 * JavaScript: ES6 + Fetch API
 */

const API_BASE = "https://wraeclast-market-api.daawesomeone1.workers.dev";
const API_ROOT = `${API_BASE}/poe2/api/economy`;

const elements = {
  league: document.querySelector("#league-select"),
  summaryLeague: document.querySelector("#summary-league"),
  summaryCurrencies: document.querySelector("#summary-currencies"),
  summaryItems: document.querySelector("#summary-items"),
  lastUpdated: document.querySelector("#last-updated"),
  currencyGrid: document.querySelector("#currency-grid"),
  itemGrid: document.querySelector("#item-grid"),
  currencySearch: document.querySelector("#currency-search"),
  currencySort: document.querySelector("#currency-sort"),
  itemSearch: document.querySelector("#item-search"),
  itemType: document.querySelector("#item-type"),
  refresh: document.querySelector("#refresh-button"),
  amount: document.querySelector("#amount-input"),
  from: document.querySelector("#from-currency"),
  to: document.querySelector("#to-currency"),
  result: document.querySelector("#conversion-result"),
  toast: document.querySelector("#toast")
};

let leagueList = [];
let currencyData = [];
let itemData = [];
let currencyUnit = "primary currency";
let toastTimer;

// Fetch JSON from the API and handle unsuccessful responses.
function fetchJSON(url) {
  return fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  }).then(response => {
    if (!response.ok) {
      throw new Error(`API request failed (${response.status}).`);
    }

    return response.json();
  });
}

// Display a temporary notification.
function showToast(message) {
  if (!elements.toast) return;

  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

// Display loading and error messages.
function showPanel(container, message, isError = false) {
  if (!container) return;

  const className = isError ? "error-panel" : "loading-panel";

  container.innerHTML =
    `<div class="${className}">${escapeHTML(message)}</div>`;
}

// Escape text before inserting API values into HTML.
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

// Format numbers for the market cards.
function formatNumber(value, maximumFractionDigits = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(number);
}

// Handle different possible API response formats.
function getEntries(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.lines)) return data.lines;
  if (Array.isArray(data?.results)) return data.results;

  return [];
}

function getLeagueName(league) {
  return league?.name || league?.id || "Unknown league";
}

function getName(item) {
  return item?.name ||
    item?.currencyTypeName ||
    item?.baseType ||
    "Unknown";
}

function getValue(item) {
  return Number(
    item?.primaryValue ??
    item?.chaosValue ??
    item?.value ??
    0
  );
}

function getVolume(item) {
  return item?.volumePrimaryValue ??
    item?.listingCount ??
    item?.count ??
    null;
}

/*
 * Currency prices and currency names are stored separately
 * in the poe.ninja API response.
 *
 * This function matches them using their IDs.
 */
function normalizeCurrencies(data) {
  const lines = getEntries(data);
  const rawItems = data?.core?.items ?? [];

  const metadata = new Map();

  if (Array.isArray(rawItems)) {
    rawItems.forEach(item => {
      if (item?.id !== undefined) {
        metadata.set(String(item.id), item);
      }
    });
  } else if (rawItems && typeof rawItems === "object") {
    Object.entries(rawItems).forEach(([id, item]) => {
      metadata.set(String(id), item);
    });
  }

  const primary = data?.core?.primary;

  currencyUnit = typeof primary === "string"
    ? primary
    : primary?.name || primary?.currencyTypeName || "primary currency";

  return lines.map(line => {
    const details = metadata.get(String(line.id)) || {};

    return {
      ...details,
      ...line,

      name:
        details.name ||
        details.currencyTypeName ||
        line.name ||
        line.currencyTypeName ||
        String(line.id),

      icon:
        details.icon ||
        details.image ||
        line.icon ||
        line.image ||
        "",

      primaryValue: Number(line.primaryValue ?? 0),

      volumePrimaryValue: line.volumePrimaryValue ?? null
    };
  });
}

// Load available leagues.
function loadLeagues() {
  return fetchJSON(`${API_ROOT}/leagues`).then(data => {
    leagueList = getEntries(data);

    if (!leagueList.length) {
      throw new Error("No active leagues were returned.");
    }

    elements.league.innerHTML = leagueList.map((league, index) => {
      const id = league.id || league.name;

      return `
        <option value="${escapeHTML(id)}"
          ${index === 0 ? "selected" : ""}>
          ${escapeHTML(getLeagueName(league))}
        </option>
      `;
    }).join("");

    const selectedLeague = leagueList[0];

    elements.summaryLeague.textContent =
      getLeagueName(selectedLeague);

    return selectedLeague;
  });
}

// Build the currency API URL.
function buildCurrencyURL(leagueId) {
  const params = new URLSearchParams({
    league: leagueId,
    type: "Currency"
  });

  return `${API_ROOT}/exchange/current/overview?${params}`;
}

// Convert older/simpler dropdown values to valid PoE 2 categories.
function getItemCategory(value) {
  const aliases = {
    "UniqueWeapon": "UniqueWeapons",
    "UniqueArmour": "UniqueArmours",
    "UniqueAccessory": "UniqueAccessories",
    "UniqueFlask": "UniqueFlasks",
    "UniqueJewel": "UniqueJewels",
    "UniqueSanctumRelic": "UniqueSanctumRelics",
    "UniqueTablet": "UniqueTablets"
  };

  return aliases[value] || value;
}

// Build the unique item API URL.
function buildItemURL(leagueId, itemType) {
  const params = new URLSearchParams({
    league: leagueId,
    type: getItemCategory(itemType)
  });

  return `${API_ROOT}/stash/current/item/overview?${params}`;
}

// Load currency market data.
function loadCurrencies(leagueId) {
  showPanel(
    elements.currencyGrid,
    "Consulting the market records…"
  );

  return fetchJSON(buildCurrencyURL(leagueId))
    .then(data => {
      currencyData = normalizeCurrencies(data);

      elements.summaryCurrencies.textContent =
        formatNumber(currencyData.length, 0);

      renderCurrencies();
      populateCurrencySelects();
      updateCalculator();

      return currencyData;
    })
    .catch(error => {
      showPanel(
        elements.currencyGrid,
        `Unable to load currency data: ${error.message}`,
        true
      );

      throw error;
    });
}

// Load unique item market data.
function loadItems(leagueId, itemType = elements.itemType.value) {
  showPanel(
    elements.itemGrid,
    "Gathering unique item prices…"
  );

  return fetchJSON(buildItemURL(leagueId, itemType))
    .then(data => {
      itemData = getEntries(data);

      elements.summaryItems.textContent =
        formatNumber(itemData.length, 0);

      renderItems();

      return itemData;
    })
    .catch(error => {
      showPanel(
        elements.itemGrid,
        `Unable to load item data: ${error.message}`,
        true
      );

      throw error;
    });
}

// Display currency cards.
function renderCurrencies() {
  const query = elements.currencySearch.value
    .trim()
    .toLowerCase();

  let visible = currencyData.filter(item =>
    getName(item).toLowerCase().includes(query)
  );

  const sortMode = elements.currencySort.value;

  visible = [...visible].sort((a, b) => {
    if (sortMode === "name-asc") {
      return getName(a).localeCompare(getName(b));
    }

    return sortMode === "value-asc"
      ? getValue(a) - getValue(b)
      : getValue(b) - getValue(a);
  });

  if (!visible.length) {
    showPanel(
      elements.currencyGrid,
      "No currencies match your search."
    );

    return;
  }

  elements.currencyGrid.innerHTML = visible
    .slice(0, 32)
    .map(item => {
      const name = getName(item);
      const icon = item.icon || "";
      const value = getValue(item);
      const volume = getVolume(item);

      return `
        <article class="currency-card" data-spring-card>

          ${
            icon
              ? `<img class="currency-icon"
                  src="${escapeHTML(icon)}"
                  alt=""
                  loading="lazy">`
              : `<span class="currency-icon currency-placeholder"
                  aria-hidden="true">✦</span>`
          }

          <div class="currency-info">

            <div class="currency-name">
              ${escapeHTML(name)}
            </div>

            <div class="currency-value">
              ${formatNumber(value)} ${escapeHTML(currencyUnit)}
            </div>

            <div class="currency-volume">
              ${
                volume !== null
                  ? `Market volume: ${formatNumber(volume)} ${escapeHTML(currencyUnit)}`
                  : "Current market listing"
              }
            </div>

          </div>
        </article>
      `;
    })
    .join("");

  document.dispatchEvent(
    new CustomEvent("currency-cards-rendered")
  );
}

// Display unique item cards.
function renderItems() {
  const query = elements.itemSearch.value
    .trim()
    .toLowerCase();

  const visible = itemData.filter(item => {
    const name = getName(item).toLowerCase();

    const base = String(item.baseType || "")
      .toLowerCase();

    return name.includes(query) || base.includes(query);
  });

  if (!visible.length) {
    showPanel(
      elements.itemGrid,
      "No items match your search."
    );

    return;
  }

  elements.itemGrid.innerHTML = visible
    .slice(0, 18)
    .map(item => {
      const name = getName(item);
      const icon = item.icon || "";
      const base = item.baseType || item.category || "Unique item";
      const price = getValue(item);

      return `
        <article class="item-card" data-spring-card>

          ${
            icon
              ? `<img class="item-icon"
                  src="${escapeHTML(icon)}"
                  alt=""
                  loading="lazy">`
              : ""
          }

          <div>

            <div class="item-name">
              ${escapeHTML(name)}
            </div>

            <div class="item-base">
              ${escapeHTML(base)}
            </div>

            <div class="item-price">
              ${formatNumber(price)} ${escapeHTML(currencyUnit)}
            </div>

            ${
              item.listingCount !== undefined
                ? `<div class="item-base">
                    ${formatNumber(item.listingCount, 0)} listings
                  </div>`
                : ""
            }

          </div>
        </article>
      `;
    })
    .join("");

  document.dispatchEvent(
    new CustomEvent("currency-cards-rendered")
  );
}

// Populate the currency calculator dropdowns.
function populateCurrencySelects() {
  const previousFrom = elements.from.value;
  const previousTo = elements.to.value;

  const options = [...currencyData]
    .sort((a, b) =>
      getName(a).localeCompare(getName(b))
    )
    .map(item => `
      <option value="${escapeHTML(getName(item))}">
        ${escapeHTML(getName(item))}
      </option>
    `)
    .join("");

  elements.from.innerHTML =
    `<option value="">Choose currency</option>${options}`;

  elements.to.innerHTML =
    `<option value="">Choose currency</option>${options}`;

  if (currencyData.length > 1) {
    elements.from.value = getName(currencyData[0]);
    elements.to.value = getName(currencyData[1]);
  }

  if ([...elements.from.options].some(option =>
    option.value === previousFrom
  )) {
    elements.from.value = previousFrom;
  }

  if ([...elements.to.options].some(option =>
    option.value === previousTo
  )) {
    elements.to.value = previousTo;
  }
}

// Calculate the exchange rate between two currencies.
function updateCalculator() {
  const amount = Number(elements.amount.value);

  const fromItem = currencyData.find(item =>
    getName(item) === elements.from.value
  );

  const toItem = currencyData.find(item =>
    getName(item) === elements.to.value
  );

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !fromItem ||
    !toItem ||
    getValue(toItem) <= 0
  ) {
    elements.result.textContent = "—";
    return;
  }

  const converted =
    amount * getValue(fromItem) / getValue(toItem);

  elements.result.textContent =
    formatNumber(converted, 4);
}

// Refresh both market sections.
function refreshMarket() {
  const leagueId = elements.league.value;

  if (!leagueId) return;

  elements.lastUpdated.textContent = "Updating…";

  Promise.allSettled([
    loadCurrencies(leagueId),
    loadItems(leagueId)
  ]).then(results => {
    const successful = results.some(
      result => result.status === "fulfilled"
    );

    elements.lastUpdated.textContent = successful
      ? new Date().toLocaleTimeString()
      : "Unavailable";

    if (!successful) {
      showToast("Market data could not be refreshed.");
    }
  });
}

// Initialize the application.
function initialize() {
  loadLeagues()
    .then(league => {
      const leagueId = league.id || league.name;

      return Promise.allSettled([
        loadCurrencies(leagueId),
        loadItems(leagueId)
      ]);
    })
    .then(() => {
      elements.lastUpdated.textContent =
        new Date().toLocaleTimeString();
    })
    .catch(error => {
      elements.league.innerHTML =
        `<option value="">League data unavailable</option>`;

      showPanel(
        elements.currencyGrid,
        `Could not load league data: ${error.message}`,
        true
      );

      showPanel(
        elements.itemGrid,
        "Waiting for a valid league selection.",
        true
      );

      elements.lastUpdated.textContent = "Unavailable";
    });
}

// Search and sorting events.
elements.currencySearch.addEventListener(
  "input",
  renderCurrencies
);

elements.currencySort.addEventListener(
  "change",
  renderCurrencies
);

elements.itemSearch.addEventListener(
  "input",
  renderItems
);

// Item category selection.
elements.itemType.addEventListener("change", () => {
  if (elements.league.value) {
    loadItems(
      elements.league.value,
      elements.itemType.value
    ).catch(() => {});
  }
});

// League and refresh events.
elements.league.addEventListener(
  "change",
  refreshMarket
);

elements.refresh.addEventListener(
  "click",
  refreshMarket
);

// Calculator events.
[elements.amount, elements.from, elements.to].forEach(control => {
  control.addEventListener("input", updateCalculator);
  control.addEventListener("change", updateCalculator);
});

// Start the application.
initialize();