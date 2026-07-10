"use strict";

// ── Movers defaults — change these to adjust what the Movers tab opens with ──
const DEFAULT_MOVERS_SOURCE   = "bref_war_batting";
const DEFAULT_MOVERS_METRIC   = "bwar";
const DEFAULT_MOVERS_WINDOW   = "7";       // "7", "14", "30", or "season"
const DEFAULT_MOVERS_DIR      = "risers";  // "risers" or "fallers"

// ── Cache-busting ─────────────────────────────────────────────────────────────
// Populated once on boot from data/version.json (fetched no-store).
// All data fetches append ?v=<cacheBuster> so a new export busts stale files.
let cacheBuster = "";

// ── Shared state ──────────────────────────────────────────────────────────────
const state = {
  dates:      [],
  manifest:   {},     // { sources: { [src]: { label, metrics, lower_is_better } } }
  sourceData: null,   // leaderboard: parsed {date}/{source}.json
  sortAsc:    null,   // null = use default; true/false = manual override
  activeTab:  "leaderboard",
  moversDir:  DEFAULT_MOVERS_DIR,
};

// ── DOM refs — leaderboard ────────────────────────────────────────────────────
const selDate    = document.getElementById("sel-date");
const selSource  = document.getElementById("sel-source");
const selMetric  = document.getElementById("sel-metric");
const inpFilter  = document.getElementById("inp-filter");
const btnSort    = document.getElementById("btn-sort");
const statusEl   = document.getElementById("status");
const tableWrap  = document.getElementById("table-wrap");
const tbody      = document.getElementById("leaderboard-body");
const thValue    = document.getElementById("th-value");
const snapInfo   = document.getElementById("snapshot-info");
const snapLabel  = document.getElementById("snapshot-date-label");

// ── DOM refs — movers ─────────────────────────────────────────────────────────
const selMoversSource  = document.getElementById("sel-movers-source");
const selMoversMetric  = document.getElementById("sel-movers-metric");
const selMoversWindow  = document.getElementById("sel-movers-window");
const btnMoversDir     = document.getElementById("btn-movers-dir");
const moversInfo       = document.getElementById("movers-info");
const moversDateLabel  = document.getElementById("movers-date-label");
const moversStatusEl   = document.getElementById("movers-status");
const moversTableWrap  = document.getElementById("movers-table-wrap");
const moversTbody      = document.getElementById("movers-body");
const thStart          = document.getElementById("th-start");
const thEnd            = document.getElementById("th-end");
const thDelta          = document.getElementById("th-delta");

// ── DOM refs — tabs ───────────────────────────────────────────────────────────
const tabLeaderboard  = document.getElementById("tab-leaderboard");
const tabMovers       = document.getElementById("tab-movers");
const panelLeaderboard = document.getElementById("panel-leaderboard");
const panelMovers      = document.getElementById("panel-movers");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  const url = cacheBuster ? `${path}?v=${cacheBuster}` : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatValue(v) {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) ? v.toString() : parseFloat(v.toFixed(3)).toString();
}

// Subtract n days from a YYYY-MM-DD string, return YYYY-MM-DD.
function subtractDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Given a window value, return the actual start date from state.dates.
function resolveStartDate(windowVal) {
  const dates   = state.dates;
  const endDate = dates[dates.length - 1];
  if (windowVal === "season") return dates[0];
  const target = subtractDays(endDate, parseInt(windowVal, 10));
  // Earliest snapshot date >= target; fall back to oldest if all predate target.
  return dates.find(d => d >= target) ?? dates[0];
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const ver = await fetch("data/version.json", {cache: "no-store"});
    if (ver.ok) cacheBuster = (await ver.json()).v ?? "";
  } catch (_) {}

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
  populateSources();          // leaderboard
  populateMetrics();          // leaderboard
  populateMoversSource();
  populateMoversMetrics();
  applyMoversDefaults();

  await loadAndRender();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  const isLeaderboard = tab === "leaderboard";

  tabLeaderboard.classList.toggle("active", isLeaderboard);
  tabLeaderboard.setAttribute("aria-selected", String(isLeaderboard));
  tabMovers.classList.toggle("active", !isLeaderboard);
  tabMovers.setAttribute("aria-selected", String(!isLeaderboard));

  panelLeaderboard.hidden = !isLeaderboard;
  panelMovers.hidden      = isLeaderboard;

  if (!isLeaderboard && moversTableWrap.hidden && moversStatusEl.textContent === "Loading…") {
    loadAndRenderMovers();
  }
}

tabLeaderboard.addEventListener("click", () => switchTab("leaderboard"));
tabMovers.addEventListener("click", () => {
  switchTab("movers");
  loadAndRenderMovers();
});

// ── Leaderboard: populate dropdowns ──────────────────────────────────────────
function populateDates() {
  selDate.innerHTML = "";
  [...state.dates].reverse().forEach(d => selDate.appendChild(new Option(d, d)));
}

function populateSources() {
  selSource.innerHTML = "";
  Object.entries(state.manifest.sources)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .forEach(([key, info]) => selSource.appendChild(new Option(info.label, key)));
}

function populateMetrics() {
  const src  = selSource.value;
  const info = state.manifest.sources[src];
  if (!info) return;
  selMetric.innerHTML = "";
  info.metrics.forEach(m => selMetric.appendChild(new Option(m.label, m.key)));
}

// ── Leaderboard: load + render ────────────────────────────────────────────────
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
    setStatus("No data for this selection.");
    return;
  }
  render();
}

function render() {
  const metric = selMetric.value;
  const src    = selSource.value;
  const date   = selDate.value;
  const filter = inpFilter.value.trim().toLowerCase();

  if (!state.sourceData) { setStatus("No data for this selection."); return; }

  const players = state.sourceData[metric];
  if (!players || players.length === 0) { setStatus("No data for this selection."); return; }

  const lib        = state.manifest.sources[src]?.lower_is_better ?? [];
  const defaultAsc = lib.includes(metric);
  const asc        = state.sortAsc === null ? defaultAsc : state.sortAsc;

  updateSortBtn(asc);

  let rows = [...players];
  if (filter) rows = rows.filter(p => (p.name || "").toLowerCase().includes(filter));

  rows.sort((a, b) => {
    const va = a.value ?? -Infinity;
    const vb = b.value ?? -Infinity;
    return asc ? va - vb : vb - va;
  });

  snapLabel.textContent = date;
  snapInfo.hidden = false;

  const metricInfo = state.manifest.sources[src]?.metrics.find(m => m.key === metric);
  thValue.textContent = metricInfo ? metricInfo.label : metric;

  tbody.innerHTML = "";
  rows.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="col-rank">${i + 1}</td>` +
      `<td class="col-player"><a class="player-link" href="player.html?id=${esc(String(p.id ?? ""))}">${esc(p.name ?? "—")}</a></td>` +
      `<td class="col-team">${esc(p.team ?? "—")}</td>` +
      `<td class="col-value">${formatValue(p.value)}</td>`;
    tbody.appendChild(tr);
  });

  statusEl.hidden  = true;
  tableWrap.hidden = rows.length === 0;
  if (rows.length === 0) setStatus("No players match your filter.");
}

function setStatus(msg) {
  statusEl.textContent = msg;
  statusEl.hidden      = false;
  tableWrap.hidden     = true;
  snapInfo.hidden      = true;
}

function updateSortBtn(asc) {
  btnSort.textContent = asc ? "▲ Ascending" : "▼ Descending";
  btnSort.classList.toggle("asc", asc);
  btnSort.setAttribute("aria-pressed", String(asc));
}

// ── Leaderboard: events ───────────────────────────────────────────────────────
selDate.addEventListener("change", () => { state.sortAsc = null; loadAndRender(); });
selSource.addEventListener("change", () => { state.sortAsc = null; populateMetrics(); loadAndRender(); });
selMetric.addEventListener("change", () => { state.sortAsc = null; render(); });
inpFilter.addEventListener("input", render);
btnSort.addEventListener("click", () => {
  const src    = selSource.value;
  const metric = selMetric.value;
  const lib    = state.manifest.sources[src]?.lower_is_better ?? [];
  const cur    = state.sortAsc === null ? lib.includes(metric) : state.sortAsc;
  state.sortAsc = !cur;
  render();
});

// ── Movers: populate dropdowns ────────────────────────────────────────────────
function populateMoversSource() {
  selMoversSource.innerHTML = "";
  Object.entries(state.manifest.sources)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .forEach(([key, info]) => selMoversSource.appendChild(new Option(info.label, key)));
}

function populateMoversMetrics() {
  const src  = selMoversSource.value;
  const info = state.manifest.sources[src];
  if (!info) return;
  selMoversMetric.innerHTML = "";
  info.metrics.forEach(m => selMoversMetric.appendChild(new Option(m.label, m.key)));
}

function applyMoversDefaults() {
  // Source default
  const sources = state.manifest.sources;
  if (sources[DEFAULT_MOVERS_SOURCE]) {
    selMoversSource.value = DEFAULT_MOVERS_SOURCE;
  }
  // Repopulate metrics for chosen source, then set metric default
  populateMoversMetrics();
  const src = selMoversSource.value;
  const metrics = state.manifest.sources[src]?.metrics ?? [];
  const hasDefault = metrics.some(m => m.key === DEFAULT_MOVERS_METRIC);
  if (hasDefault) selMoversMetric.value = DEFAULT_MOVERS_METRIC;

  // Window
  selMoversWindow.value = DEFAULT_MOVERS_WINDOW;

  // Direction
  state.moversDir = DEFAULT_MOVERS_DIR;
  updateMoversDirBtn();
}

function updateMoversDirBtn() {
  const isRisers = state.moversDir === "risers";
  btnMoversDir.textContent = isRisers ? "▲ Risers" : "▼ Fallers";
  btnMoversDir.classList.toggle("risers-btn", isRisers);
  btnMoversDir.classList.toggle("fallers-btn", !isRisers);
}

// ── Movers: load + render ─────────────────────────────────────────────────────
async function loadAndRenderMovers() {
  const src    = selMoversSource.value;
  const metric = selMoversMetric.value;
  const win    = selMoversWindow.value;

  if (!src || !metric || state.dates.length === 0) return;

  const endDate   = state.dates[state.dates.length - 1];
  const startDate = resolveStartDate(win);

  setMoversStatus("Loading…");

  let startData, endData;
  try {
    [startData, endData] = await Promise.all([
      fetchJSON(`data/${startDate}/${src}.json`),
      fetchJSON(`data/${endDate}/${src}.json`),
    ]);
  } catch (e) {
    setMoversStatus("No data for this selection.");
    return;
  }

  const startRows = startData[metric] ?? [];
  const endRows   = endData[metric]   ?? [];

  if (startRows.length === 0 || endRows.length === 0) {
    setMoversStatus("No data for this metric in one or both snapshots.");
    return;
  }

  // Build id → row map for start snapshot
  const startMap = {};
  startRows.forEach(p => { if (p.id) startMap[p.id] = p; });

  // Join with end snapshot, compute delta
  const movers = [];
  endRows.forEach(p => {
    if (!p.id || !(p.id in startMap)) return;
    movers.push({
      id:       p.id,
      name:     p.name,
      team:     p.team,
      startVal: startMap[p.id].value,
      endVal:   p.value,
      delta:    p.value - startMap[p.id].value,
    });
  });

  if (movers.length === 0) {
    setMoversStatus("No players found in both snapshots.");
    return;
  }

  // Sort by delta
  movers.sort((a, b) =>
    state.moversDir === "risers" ? b.delta - a.delta : a.delta - b.delta
  );

  // Date range label
  const sameDate = startDate === endDate;
  moversDateLabel.textContent = sameDate
    ? `Only one snapshot available (${endDate}) — no change to show.`
    : `Change from ${startDate} → ${endDate}`;
  moversInfo.hidden = false;

  // Column headers
  const metricInfo  = state.manifest.sources[src]?.metrics.find(m => m.key === metric);
  const metricLabel = metricInfo?.label ?? metric;
  thStart.textContent = `${metricLabel} (${startDate})`;
  thEnd.textContent   = `${metricLabel} (${endDate})`;
  thDelta.textContent = `Δ`;

  // Build rows
  moversTbody.innerHTML = "";
  movers.forEach((p, i) => {
    const sign = p.delta > 0 ? "+" : "";
    const cls  = p.delta > 0 ? "delta-pos" : p.delta < 0 ? "delta-neg" : "delta-zero";
    const tr   = document.createElement("tr");
    tr.innerHTML =
      `<td class="col-rank">${i + 1}</td>` +
      `<td class="col-player"><a class="player-link" href="player.html?id=${esc(String(p.id))}">${esc(p.name ?? "—")}</a></td>` +
      `<td class="col-team">${esc(p.team ?? "—")}</td>` +
      `<td class="col-value">${formatValue(p.startVal)}</td>` +
      `<td class="col-value">${formatValue(p.endVal)}</td>` +
      `<td class="col-delta ${cls}">${sign}${formatValue(p.delta)}</td>`;
    moversTbody.appendChild(tr);
  });

  moversStatusEl.hidden  = true;
  moversTableWrap.hidden = false;
}

function setMoversStatus(msg) {
  moversStatusEl.textContent = msg;
  moversStatusEl.hidden      = false;
  moversTableWrap.hidden     = true;
  moversInfo.hidden          = true;
}

// ── Movers: events ────────────────────────────────────────────────────────────
selMoversSource.addEventListener("change", () => {
  populateMoversMetrics();
  loadAndRenderMovers();
});
selMoversMetric.addEventListener("change", loadAndRenderMovers);
selMoversWindow.addEventListener("change", loadAndRenderMovers);
btnMoversDir.addEventListener("click", () => {
  state.moversDir = state.moversDir === "risers" ? "fallers" : "risers";
  updateMoversDirBtn();
  loadAndRenderMovers();
});

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
