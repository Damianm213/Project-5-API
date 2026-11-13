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

// Fetch JSON and handle unsuccessful responses.
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

// Get entries from different API response formats.
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

const getValue = (item) => {
  const value =
    item?.primaryValue ??
    item?.chaosValue ??
    item?.value;

  return value === undefined || value === null
    ? null
    : Number(value);
};

const getVolume = (item) =>
  item?.volumePrimaryValue ??
  item?.listingCount ??
  item?.count ??
  null;

// Display a temporary notification.
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

// Display loading or error messages.
function showPanel(container, message, isError = false) {
  container.innerHTML = `
    <div class="${isError ? "error-panel" : "loading-panel"}">
      ${message}
    </div>
  `;
}

// Escape HTML to safely display API data.
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

// Format numbers.
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

// Build the item API URL through the Worker.
function buildItemURL(leagueId, itemType) {
  const params = new URLSearchParams({
    league: leagueId,
    type: itemType
  });

  return `${API_BASE}/poe2/api/economy/stash/current/item/overview?${params}`;
}

// Load currency data.
function loadCurrencies(leagueId) {
  showPanel(elements.currencyGrid, "Consulting the market records…");

  return fetchJSON(buildCurrencyURL(leagueId))
    .then(data => {

      // Currency names and images are stored in core.items.
      // data.lines contains item listings, not currency metadata.
      const currencyMetadata = data?.core?.items || [];

      currencyData = currencyMetadata.map(currency => ({
        id: currency.id,
        name: currency.name,
        image: currency.image,
        detailsId: currency.detailsId,

        // Keep prices unavailable until a confirmed price field exists.
        primaryValue: null,
        volumePrimaryValue: null
      }));

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
        `Unable to load currency data: ${escapeHTML(error.message)}`,
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
        `Unable to load item data: ${escapeHTML(error.message)}`,
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

    const valueA = getValue(a) ?? 0;
    const valueB = getValue(b) ?? 0;

    return sortMode === "value-asc"
      ? valueA - valueB
      : valueB - valueA;
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
            ${
              value !== null && Number.isFinite(value)
                ? `${formatNumber(value)} chaos value`
                : "Price unavailable"
            }
          </div>

          <div class="currency-volume">
            ${
              volume !== null
                ? `Market volume: ${formatNumber(Number(volume))}`
                : "Currency market data"
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
            ${
              price !== null && Number.isFinite(price)
                ? `${formatNumber(price)} chaos value`
                : "Price unavailable"
            }
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
    elements.from.value = getName(currencyData[0]);
    elements.to.value = getName(currencyData[1]);
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

  const fromValue = fromItem ? getValue(fromItem) : null;
  const toValue = toItem ? getValue(toItem) : null;

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    fromValue === null ||
    toValue === null ||
    !Number.isFinite(fromValue) ||
    !Number.isFinite(toValue) ||
    toValue <= 0
  ) {
    elements.result.textContent = "—";
    return;
  }

  const converted = amount * fromValue / toValue;

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