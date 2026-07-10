"use strict";

// ── Cache-busting ─────────────────────────────────────────────────────────────
let cacheBuster = "";

// ── State ─────────────────────────────────────────────────────────────────────
let playerData = null;
let manifest   = null;
let chart      = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const playerName   = document.getElementById("player-name");
const playerTeam   = document.getElementById("player-team");
const errorMsg     = document.getElementById("error-msg");
const content      = document.getElementById("player-content");
const selSource    = document.getElementById("sel-source");
const selMetric    = document.getElementById("sel-metric");
const selRange     = document.getElementById("sel-range");
const inpDateStart = document.getElementById("inp-date-start");
const inpDateEnd   = document.getElementById("inp-date-end");
const btnClear     = document.getElementById("btn-clear-dates");
const chartMsg     = document.getElementById("chart-msg");
const chartCanvas  = document.getElementById("chart");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  const url = cacheBuster ? `${path}?v=${cacheBuster}` : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
  content.hidden  = true;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Return the subset of [[date, value], ...] that falls within the current range.
// Custom dates take precedence over the preset when set.
function filterPoints(points) {
  if (!points || points.length === 0) return [];

  const customStart = inpDateStart.value;   // "YYYY-MM-DD" or ""
  const customEnd   = inpDateEnd.value;     // "YYYY-MM-DD" or ""
  const hasCustom   = customStart || customEnd;

  if (hasCustom) {
    return points.filter(([date]) => {
      if (customStart && date < customStart) return false;
      if (customEnd   && date > customEnd)   return false;
      return true;
    });
  }

  const preset = selRange.value;
  if (preset === "all") return points;

  // Preset: last N days from the player's most recent point.
  const lastDate = points[points.length - 1][0];
  const cutoff   = new Date(lastDate + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - parseInt(preset, 10));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return points.filter(([date]) => date >= cutoffStr);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const ver = await fetch("data/version.json", {cache: "no-store"});
    if (ver.ok) cacheBuster = (await ver.json()).v ?? "";
  } catch (_) {}

  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) { showError("No player ID specified in the URL."); return; }

  try {
    [playerData, manifest] = await Promise.all([
      fetchJSON(`data/players/${id}.json`),
      fetchJSON("data/manifest.json"),
    ]);
  } catch (e) {
    const notFound = /HTTP 4/.test(e.message);
    showError(notFound
      ? `Player not found (id: ${id}). The player may not have data yet.`
      : `Failed to load player data: ${e.message}`);
    return;
  }

  document.title = `${playerData.name} — Baseball Archive`;
  playerName.textContent = playerData.name ?? "Unknown Player";
  playerTeam.textContent = playerData.team ?? "";

  populateDropdowns();
  content.hidden = false;
  renderChart();
}

// ── Dropdowns ─────────────────────────────────────────────────────────────────
function populateDropdowns() {
  const series  = playerData.series;
  const sources = manifest.sources;

  const present = Object.keys(series)
    .filter(s => sources[s])
    .sort((a, b) => sources[a].label.localeCompare(sources[b].label));

  selSource.innerHTML = "";
  present.forEach(src => selSource.appendChild(new Option(sources[src].label, src)));

  if (series["bref_war_batting"]) selSource.value = "bref_war_batting";

  populateMetrics();
}

function populateMetrics() {
  const src             = selSource.value;
  const seriesForSrc    = playerData.series[src] ?? {};
  const manifestMetrics = manifest.sources[src]?.metrics ?? [];

  selMetric.innerHTML = "";

  const available = manifestMetrics.filter(m => seriesForSrc[m.key] !== undefined);
  if (available.length) {
    available.forEach(m => selMetric.appendChild(new Option(m.label, m.key)));
  } else {
    Object.keys(seriesForSrc).forEach(k => selMetric.appendChild(new Option(k, k)));
  }

  if (selSource.value === "bref_war_batting" &&
      playerData.series["bref_war_batting"]?.["bwar"] !== undefined) {
    selMetric.value = "bwar";
  }
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart() {
  const src    = selSource.value;
  const metric = selMetric.value;
  const all    = playerData.series[src]?.[metric] ?? [];
  const points = filterPoints(all);

  // Zero-point case
  if (points.length === 0) {
    chartMsg.textContent = all.length === 0
      ? "No data for this source / metric."
      : "No data in this range.";
    chartMsg.hidden   = false;
    chartCanvas.hidden = true;
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  chartMsg.hidden    = false; // keep space consistent; hide text below
  chartCanvas.hidden = false;
  chartMsg.hidden    = true;

  const labels = points.map(([date])  => date);
  const values = points.map(([, val]) => val);

  const metricInfo  = manifest.sources[src]?.metrics.find(m => m.key === metric);
  const metricLabel = metricInfo?.label ?? metric;

  const accent  = cssVar("--accent");
  const muted   = cssVar("--muted");
  const text    = cssVar("--text");
  const border  = cssVar("--border");
  const surface = cssVar("--surface");

  if (chart) { chart.destroy(); chart = null; }

  const isSingle = points.length === 1;

  chart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label:               metricLabel,
        data:                values,
        borderColor:         accent,
        backgroundColor:     accent + "22",
        borderWidth:         isSingle ? 0 : 2,
        pointRadius:         isSingle ? 8 : 3,
        pointHoverRadius:    8,
        pointBackgroundColor: accent,
        fill:                true,
        tension:             0.3,
        spanGaps:            false,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: surface,
          borderColor:     border,
          borderWidth:     1,
          titleColor:      text,
          bodyColor:       text,
          callbacks: {
            title: ([item]) => item.label,
            label: (item)   => `${metricLabel}: ${item.formattedValue}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: muted, maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
          grid:  { color: border },
        },
        y: {
          ticks: { color: muted },
          grid:  { color: border },
        },
      },
    },
  });
}

// ── Events ────────────────────────────────────────────────────────────────────
selSource.addEventListener("change", () => { populateMetrics(); renderChart(); });
selMetric.addEventListener("change", renderChart);
selRange.addEventListener("change", renderChart);
inpDateStart.addEventListener("change", renderChart);
inpDateEnd.addEventListener("change", renderChart);

btnClear.addEventListener("click", () => {
  inpDateStart.value = "";
  inpDateEnd.value   = "";
  renderChart();
});

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
