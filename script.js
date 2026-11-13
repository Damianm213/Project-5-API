/*
 * Wraeclast Market
 * Vanilla JavaScript ES6 + Fetch API.
 * Uses a Cloudflare Worker to retrieve Path of Exile 2 market data.
 */

const API_BASE = "https://wraeclast-market-api.daawesomeone1.workers.dev";
const LEAGUES_URL = `${API_BASE}/poe2/api/economy/leagues`;

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
let toastTimer;

// Fetch JSON and give a useful error if the server returns an unsuccessful status.
const fetchJSON = (url) =>
  fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  }).then(response => {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}).`);
    }
    return response.json();
  });

// Normalize API response shapes without assuming every optional property exists.
const getEntries = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.lines)) return data.lines;
  if (Array.isArray(data?.results)) return data.results;
  return [];
};

const getLeagueName = (league) =>
  league?.name || league?.id || league?.league || "Unknown league";

const getIcon = (item) =>
  item?.icon || item?.image || "";

const getName = (item) =>
  item?.name || item?.currencyTypeName || item?.baseType || "Unknown";

const getValue = (item) =>
  Number(item?.primaryValue ?? item?.chaosValue ?? item?.value ?? 0);

const getVolume = (item) =>
  item?.volumePrimaryValue ?? item?.listingCount ?? item?.count ?? null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

function showPanel(container, message, isError = false) {
  container.innerHTML = `
    <div class="${isError ? "error-panel" : "loading-panel"}">
      ${message}
    </div>
  `;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(value);
}

// Load available leagues.
function loadLeagues() {
  return fetchJSON(LEAGUES_URL)
    .then(data => {
      leagueList = getEntries(data);

      if (!leagueList.length && Array.isArray(data)) {
        leagueList = data;
      }

      if (!leagueList.length) {
        throw new Error("The API returned no league entries.");
      }

      elements.league.innerHTML = leagueList.map((league, index) => {
        const id = league.id || league.name || league.league;

        return `
          <option value="${escapeHTML(id)}" ${index === 0 ? "selected" : ""}>
            ${escapeHTML(getLeagueName(league))}
          </option>
        `;
      }).join("");

      const selected = leagueList[0];

      elements.summaryLeague.textContent = getLeagueName(selected);

      return selected;
    });
}

// Build the currency API URL through the Worker.
function buildCurrencyURL(leagueId) {
  const params = new URLSearchParams({
    league: leagueId,
    type: "Currency"
  });

  return `${API_BASE}/poe2/api/economy/exchange/current/overview?${params}`;
}

// PoE 2 uses plural category values.
const POE2_ITEM_TYPES = {
  UniqueWeapon: "UniqueWeapons",
  UniqueArmour: "UniqueArmours",
  UniqueAccessory: "UniqueAccessories",
  UniqueFlask: "UniqueFlasks",
  UniqueJewel: "UniqueJewels",
  UniqueRelic: "UniqueSanctumRelics",
  UniqueWeapons: "UniqueWeapons",
  UniqueArmours: "UniqueArmours",
  UniqueAccessories: "UniqueAccessories",
  UniqueFlasks: "UniqueFlasks",
  UniqueCharms: "UniqueCharms",
  UniqueJewels: "UniqueJewels",
  UniqueSanctumRelics: "UniqueSanctumRelics",
  UniqueTablets: "UniqueTablets",
  PrecursorTablets: "PrecursorTablets"
};

// Build the item API URL through the Worker using a valid PoE 2 category.
function buildItemURL(leagueId, itemType) {
  const poe2ItemType = POE2_ITEM_TYPES[itemType] || itemType;

  const params = new URLSearchParams({
    league: leagueId,
    type: poe2ItemType
  });

  return `${API_BASE}/poe2/api/economy/stash/current/item/overview?${params}`;
}

// Load currency data.
function loadCurrencies(leagueId) {
  showPanel(elements.currencyGrid, "Consulting the market records…");

  return fetchJSON(buildCurrencyURL(leagueId))
    .then(data => {
      // Match currency pricing information with its metadata.
      const currencyMetadata = Array.isArray(data?.core?.items)
        ? data.core.items
        : [];

      const metadataById = new Map(
        currencyMetadata.map(item => [String(item.id), item])
      );

      currencyData = getEntries(data).map(line => {
        const metadata = metadataById.get(String(line.id)) || {};

        return {
          ...metadata,
          ...line,
          name:
            line.name ||
            metadata.name ||
            metadata.currencyTypeName ||
            "Unknown",
          icon:
            line.icon ||
            metadata.icon ||
            metadata.image ||
            ""
        };
      });

      elements.summaryCurrencies.textContent = formatNumber(
        currencyData.length,
        0
      );

      renderCurrencies();
      populateCurrencySelects();
      updateCalculator();

      return currencyData;
    })
    .catch(error => {
      showPanel(
        elements.currencyGrid,
        `Unable to load currency data: ${escapeHTML(error.message)} Check the API documentation or browser console.`,
        true
      );

      throw error;
    });
}

// Load item data.
function loadItems(leagueId, itemType = elements.itemType.value) {
  showPanel(elements.itemGrid, "Gathering unique items…");

  return fetchJSON(buildItemURL(leagueId, itemType))
    .then(data => {
      itemData = getEntries(data);

      elements.summaryItems.textContent = formatNumber(
        itemData.length,
        0
      );

      renderItems();

      return itemData;
    })
    .catch(error => {
      showPanel(
        elements.itemGrid,
        `Unable to load item data: ${escapeHTML(error.message)} Check the API documentation or browser console.`,
        true
      );

      throw error;
    });
}

// Display currencies.
function renderCurrencies() {
  const query = elements.currencySearch.value.trim().toLowerCase();

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
    showPanel(elements.currencyGrid, "No currencies match your search.");
    return;
  }

  elements.currencyGrid.innerHTML = visible.slice(0, 32).map(item => {
    const name = getName(item);
    const icon = getIcon(item);
    const value = getValue(item);
    const volume = getVolume(item);

    return `
      <article class="currency-card" data-spring-card>
        ${
          icon
            ? `<img class="currency-icon" src="${escapeHTML(icon)}" alt="" loading="lazy">`
            : `<span class="currency-icon currency-placeholder" aria-hidden="true">✦</span>`
        }

        <div class="currency-info">
          <div class="currency-name">${escapeHTML(name)}</div>

          <div class="currency-value">
            ${formatNumber(value)} chaos value
          </div>

          <div class="currency-volume">
            ${
              volume !== null
                ? `Market volume: ${formatNumber(Number(volume))}`
                : "Current market listing"
            }
          </div>
        </div>
      </article>
    `;
  }).join("");

  document.dispatchEvent(new CustomEvent("currency-cards-rendered"));
}

// Display items.
function renderItems() {
  const query = elements.itemSearch.value.trim().toLowerCase();

  const visible = itemData.filter(item => {
    const name = getName(item).toLowerCase();
    const base = String(item.baseType || "").toLowerCase();

    return name.includes(query) || base.includes(query);
  });

  if (!visible.length) {
    showPanel(elements.itemGrid, "No items match your search.");
    return;
  }

  elements.itemGrid.innerHTML = visible.slice(0, 18).map(item => {
    const name = getName(item);
    const icon = getIcon(item);
    const base = item.baseType || item.itemClass || "Unique item";
    const price = getValue(item);

    return `
      <article class="item-card" data-spring-card>
        ${
          icon
            ? `<img class="item-icon" src="${escapeHTML(icon)}" alt="" loading="lazy">`
            : ""
        }

        <div>
          <div class="item-name">${escapeHTML(name)}</div>

          <div class="item-base">
            ${escapeHTML(base)}
          </div>

          <div class="item-price">
            ${formatNumber(price)} chaos value
          </div>
        </div>
      </article>
    `;
  }).join("");

  document.dispatchEvent(new CustomEvent("currency-cards-rendered"));
}

// Populate currency dropdowns for the calculator.
function populateCurrencySelects() {
  const options = [...currencyData]
    .sort((a, b) => getName(a).localeCompare(getName(b)))
    .map(item => `
      <option value="${escapeHTML(getName(item))}">
        ${escapeHTML(getName(item))}
      </option>
    `)
    .join("");

  const previousFrom = elements.from.value;
  const previousTo = elements.to.value;

  elements.from.innerHTML = `
    <option value="">Choose currency</option>
    ${options}
  `;

  elements.to.innerHTML = `
    <option value="">Choose currency</option>
    ${options}
  `;

  if (currencyData.length > 1) {
    elements.from.value = currencyData[0]
      ? getName(currencyData[0])
      : "";

    elements.to.value = currencyData[1]
      ? getName(currencyData[1])
      : "";
  }

  if ([...elements.from.options].some(option => option.value === previousFrom)) {
    elements.from.value = previousFrom;
  }

  if ([...elements.to.options].some(option => option.value === previousTo)) {
    elements.to.value = previousTo;
  }
}

// Calculate estimated currency conversion.
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

  // Values are normalized against the API's common value field.
  const converted = amount * getValue(fromItem) / getValue(toItem);

  elements.result.textContent = formatNumber(converted, 4);
}

// Refresh all market data.
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
      const leagueId = league.id || league.name || league.league;

      return Promise.allSettled([
        loadCurrencies(leagueId),
        loadItems(leagueId)
      ]);
    })
    .then(() => {
      elements.lastUpdated.textContent = new Date().toLocaleTimeString();
    })
    .catch(error => {
      elements.league.innerHTML = `
        <option value="">League data unavailable</option>
      `;

      showPanel(
        elements.currencyGrid,
        `Could not load league data: ${escapeHTML(error.message)}. Check the Cloudflare Worker connection.`,
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

// Event listeners.
elements.currencySearch.addEventListener("input", renderCurrencies);

elements.currencySort.addEventListener("change", renderCurrencies);

elements.itemSearch.addEventListener("input", renderItems);

elements.itemType.addEventListener("change", () => {
  if (elements.league.value) {
    loadItems(elements.league.value, elements.itemType.value).catch(() => {});
  }
});

elements.league.addEventListener("change", refreshMarket);

elements.refresh.addEventListener("click", refreshMarket);

[elements.amount, elements.from, elements.to].forEach(control => {
  control.addEventListener("input", updateCalculator);
  control.addEventListener("change", updateCalculator);
});

// Start the application.
initialize();