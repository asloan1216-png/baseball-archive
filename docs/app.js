"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  dates: [],
  manifest: {},          // { sources: { [src]: { label, metrics, lower_is_better } } }
  sourceData: null,      // parsed {date}/{source}.json content (metric -> players[])
  sortAsc: null,         // null = use default; true/false = manual override
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const selDate    = document.getElementById("sel-date");
const selSource  = document.getElementById("sel-source");
const selMetric  = document.getElementById("sel-metric");
const inpFilter  = document.getElementById("inp-filter");
const btnSort    = document.getElementById("btn-sort");
const status     = document.getElementById("status");
const tableWrap  = document.getElementById("table-wrap");
const tbody      = document.getElementById("leaderboard-body");
const thValue    = document.getElementById("th-value");
const snapInfo   = document.getElementById("snapshot-info");
const snapLabel  = document.getElementById("snapshot-date-label");

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setStatus("Loading…");
  try {
    [state.dates, state.manifest] = await Promise.all([
      fetchJSON("data/dates.json"),
      fetchJSON("data/manifest.json"),
    ]);
  } catch (e) {
    setStatus("Failed to load index data. " + e.message);
    return;
  }

  populateDates();
  populateSources();
  populateMetrics();
  await loadAndRender();
}

// ── Populate dropdowns ────────────────────────────────────────────────────────
function populateDates() {
  selDate.innerHTML = "";
  // newest first in the dropdown
  [...state.dates].reverse().forEach(d => {
    const opt = new Option(d, d);
    selDate.appendChild(opt);
  });
}

function populateSources() {
  selSource.innerHTML = "";
  const sources = state.manifest.sources;
  Object.entries(sources)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .forEach(([key, info]) => {
      selSource.appendChild(new Option(info.label, key));
    });
}

function populateMetrics() {
  const src = selSource.value;
  const info = state.manifest.sources[src];
  if (!info) return;
  selMetric.innerHTML = "";
  info.metrics.forEach(m => {
    selMetric.appendChild(new Option(m.label, m.key));
  });
}

// ── Load data file and render ─────────────────────────────────────────────────
async function loadAndRender() {
  const date   = selDate.value;
  const src    = selSource.value;
  const metric = selMetric.value;
  if (!date || !src || !metric) return;

  setStatus("Loading…");
  try {
    state.sourceData = await fetchJSON(`data/${date}/${src}.json`);
  } catch (e) {
    state.sourceData = null;
    showNoData();
    return;
  }
  render();
}

// ── Render table ──────────────────────────────────────────────────────────────
function render() {
  const metric = selMetric.value;
  const src    = selSource.value;
  const date   = selDate.value;
  const filter = inpFilter.value.trim().toLowerCase();

  if (!state.sourceData) { showNoData(); return; }

  const players = state.sourceData[metric];
  if (!players || players.length === 0) { showNoData(); return; }

  // Determine sort direction
  const lib = state.manifest.sources[src]?.lower_is_better ?? [];
  const defaultAsc = lib.includes(metric);
  const asc = state.sortAsc === null ? defaultAsc : state.sortAsc;

  // Update sort button label
  updateSortBtn(asc);

  // Filter by name
  let rows = filter
    ? players.filter(p => (p.name || "").toLowerCase().includes(filter))
    : [...players];

  // Sort
  rows.sort((a, b) => {
    const va = a.value ?? -Infinity;
    const vb = b.value ?? -Infinity;
    return asc ? va - vb : vb - va;
  });

  // Snapshot info
  snapLabel.textContent = date;
  snapInfo.hidden = false;

  // Metric column header
  const metricInfo = state.manifest.sources[src]?.metrics.find(m => m.key === metric);
  thValue.textContent = metricInfo ? metricInfo.label : metric;

  // Build rows
  tbody.innerHTML = "";
  rows.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="col-rank">${i + 1}</td>` +
      `<td class="col-player">${esc(p.name ?? "—")}</td>` +
      `<td class="col-team">${esc(p.team ?? "—")}</td>` +
      `<td class="col-value">${formatValue(p.value)}</td>`;
    tbody.appendChild(tr);
  });

  status.hidden = true;
  tableWrap.hidden = rows.length === 0;
  if (rows.length === 0) setStatus("No players match your filter.");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(msg) {
  status.textContent = msg;
  status.hidden = false;
  tableWrap.hidden = true;
  snapInfo.hidden = true;
}

function showNoData() {
  setStatus("No data for this selection.");
}

function updateSortBtn(asc) {
  btnSort.textContent = asc ? "▲ Ascending" : "▼ Descending";
  btnSort.classList.toggle("asc", asc);
  btnSort.setAttribute("aria-pressed", String(asc));
}

function formatValue(v) {
  if (v === null || v === undefined) return "—";
  // Show up to 3 decimal places, strip trailing zeros
  return Number.isInteger(v) ? v.toString() : parseFloat(v.toFixed(3)).toString();
}

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Event listeners ───────────────────────────────────────────────────────────
selDate.addEventListener("change", () => {
  state.sortAsc = null;
  loadAndRender();
});

selSource.addEventListener("change", () => {
  state.sortAsc = null;
  populateMetrics();
  loadAndRender();
});

selMetric.addEventListener("change", () => {
  state.sortAsc = null;
  render();
});

inpFilter.addEventListener("input", () => render());

btnSort.addEventListener("click", () => {
  // Read current effective direction and flip it
  const src    = selSource.value;
  const metric = selMetric.value;
  const lib    = state.manifest.sources[src]?.lower_is_better ?? [];
  const currentAsc = state.sortAsc === null ? lib.includes(metric) : state.sortAsc;
  state.sortAsc = !currentAsc;
  render();
});

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
