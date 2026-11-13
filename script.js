/*
 * Wraeclast Market
 * Path of Exile 2 market tracker
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

// Fetch API data.
const fetchJSON = (url) =>
  fetch(url, {
    headers: { Accept: "application/json" }
  }).then(response => {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}).`);
    }
    return response.json();
  });

// Get entries from API responses.
const getEntries = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.lines)) return data.lines;
  if (Array.isArray(data?.results)) return data.results;
  return [];
};

const getLeagueName = (league) =>
  league?.name || league?.id || league?.league || "Unknown league";

const getIcon = (item) => item?.icon || item?.image || "";

const getName = (item) =>
  item?.name || item?.currencyTypeName || item?.baseType || "Unknown";

const getValue = (item) =>
  Number(item?.primaryValue ?? item?.chaosValue ?? item?.value ?? 0);

const getVolume = (item) =>
  item?.volumePrimaryValue ?? item?.listingCount ?? item?.count ?? null;

// Display notifications.
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

// Display loading and error messages.
function showPanel(container, message, isError = false) {
  container.innerHTML = `
    <div class="${isError ? "error-panel" : "loading-panel"}">
      ${message}
    </div>
  `;
}

// Escape HTML.
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

// Build currency API URL.
function buildCurrencyURL(leagueId) {
  const params = new URLSearchParams({
    league: leagueId,
    type: "Currency"
  });

  return `${API_BASE}/poe2/api/economy/exchange/current/overview?${params}`;
}

// Build item API URL.
function buildItemURL(leagueId, itemType) {
  const params = new URLSearchParams({
    league: leagueId,
    type: itemType
  });

  return `${API_BASE}/poe2/api/economy/stash/current/item/overview?${params}`;
}

// Load currencies.
function loadCurrencies(leagueId) {
  showPanel(elements.currencyGrid, "Consulting the market records…");

  return fetchJSON(buildCurrencyURL(leagueId))
    .then(data => {
      const core = data?.core || {};
      const currencyItems = core.items || [];
      const rates = core.rates || {};

      const primary = core.primary;
      const secondary = core.secondary;

      /*
       * The API's core.items contains currency names and images.
       * The API's core.rates contains exchange-rate information.
       * The lines array contains item listings, not currency metadata.
       */

      currencyData = currencyItems.map(currency => {
        let chaosValue = null;

        if (currency.id === secondary) {
          chaosValue = 1;
        } else if (
          currency.id === primary &&
          Number(rates[secondary]) > 0
        ) {
          chaosValue = Number(rates[secondary]);
        } else if (
          Number(rates[currency.id]) > 0 &&
          Number(rates[secondary]) > 0
        ) {
          chaosValue =
            Number(rates[secondary]) /
            Number(rates[currency.id]);
        }

        return {
          ...currency,
          name: currency.name,
          icon: currency.image,
          primaryValue: chaosValue,
          volumePrimaryValue: null
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
        `Unable to load currency data: ${escapeHTML(error.message)}`,
        true
      );

      throw error;
    });
}

// Load items.
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

    return sortMode === "value-asc"
      ? (getValue(a) || 0) - (getValue(b) || 0)
      : (getValue(b) || 0) - (getValue(a) || 0);
  });

  if (!visible.length) {
    showPanel(elements.currencyGrid, "No currencies match your search.");
    return;
  }

  elements.currencyGrid.innerHTML = visible.slice(0, 32).map(item => {
    const name = getName(item);
    const icon = getIcon(item);
    const value = getValue(item);

    return `
      <article class="currency-card" data-spring-card>
        ${
          icon
            ? `<img class="currency-icon" src="${escapeHTML(icon.startsWith("/") ? "https://poe.ninja" + icon : icon)}" alt="" loading="lazy">`
            : `<span class="currency-icon currency-placeholder" aria-hidden="true">✦</span>`
        }

        <div class="currency-info">
          <div class="currency-name">${escapeHTML(name)}</div>

          <div class="currency-value">
            ${
              Number.isFinite(value) && value > 0
                ? `${formatNumber(value)} chaos value`
                : "Price unavailable"
            }
          </div>

          <div class="currency-volume">
            Market exchange rate
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

// Populate calculator dropdowns.
function populateCurrencySelects() {
  const previousFrom = elements.from.value;
  const previousTo = elements.to.value;

  const options = [...currencyData]
    .sort((a, b) => getName(a).localeCompare(getName(b)))
    .map(item => `
      <option value="${escapeHTML(getName(item))}">
        ${escapeHTML(getName(item))}
      </option>
    `)
    .join("");

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

// Calculate currency conversion.
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
    !Number.isFinite(fromValue) ||
    !Number.isFinite(toValue) ||
    fromValue <= 0 ||
    toValue <= 0
  ) {
    elements.result.textContent = "—";
    return;
  }

  const converted = amount * fromValue / toValue;

  elements.result.textContent = formatNumber(converted, 4);
}

// Refresh market data.
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

// Initialize application.
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

// Start application.
initialize();