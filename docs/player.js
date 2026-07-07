"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
let playerData = null;
let manifest   = null;
let chart      = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const playerName = document.getElementById("player-name");
const playerTeam = document.getElementById("player-team");
const errorMsg   = document.getElementById("error-msg");
const content    = document.getElementById("player-content");
const selSource  = document.getElementById("sel-source");
const selMetric  = document.getElementById("sel-metric");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  const res = await fetch(path);
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

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
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
  playerName.textContent = playerData.name  ?? "Unknown Player";
  playerTeam.textContent = playerData.team  ?? "";

  populateDropdowns();
  content.hidden = false;
  renderChart();
}

// ── Dropdowns ─────────────────────────────────────────────────────────────────
function populateDropdowns() {
  const series  = playerData.series;
  const sources = manifest.sources;

  // Sources present in this player's data, sorted by label
  const present = Object.keys(series)
    .filter(s => sources[s])
    .sort((a, b) => (sources[a].label).localeCompare(sources[b].label));

  selSource.innerHTML = "";
  present.forEach(src => selSource.appendChild(new Option(sources[src].label, src)));

  // Default: bref_war_batting if available, else first
  if (series["bref_war_batting"]) selSource.value = "bref_war_batting";

  populateMetrics();
}

function populateMetrics() {
  const src            = selSource.value;
  const seriesForSrc   = playerData.series[src] ?? {};
  const manifestMetrics = manifest.sources[src]?.metrics ?? [];

  selMetric.innerHTML = "";

  // Only the metrics this player actually has for this source
  const available = manifestMetrics.filter(m => seriesForSrc[m.key] !== undefined);

  if (available.length) {
    available.forEach(m => selMetric.appendChild(new Option(m.label, m.key)));
  } else {
    // Fallback: raw keys (shouldn't normally happen)
    Object.keys(seriesForSrc).forEach(k => selMetric.appendChild(new Option(k, k)));
  }

  // Default bwar when on the bref batting source
  if (src === "bref_war_batting" && seriesForSrc["bwar"] !== undefined) {
    selMetric.value = "bwar";
  }
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart() {
  const src    = selSource.value;
  const metric = selMetric.value;
  const points = playerData.series[src]?.[metric] ?? [];

  const labels = points.map(([date])    => date);
  const values = points.map(([, val])   => val);

  const metricInfo  = manifest.sources[src]?.metrics.find(m => m.key === metric);
  const metricLabel = metricInfo?.label ?? metric;

  const accent  = cssVar("--accent");
  const muted   = cssVar("--muted");
  const text    = cssVar("--text");
  const border  = cssVar("--border");
  const surface = cssVar("--surface");

  if (chart) { chart.destroy(); chart = null; }

  const ctx = document.getElementById("chart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label:              metricLabel,
        data:               values,
        borderColor:        accent,
        backgroundColor:    accent + "22",
        borderWidth:        2,
        pointRadius:        values.length === 1 ? 6 : 3,
        pointHoverRadius:   6,
        pointBackgroundColor: accent,
        fill:               true,
        tension:            0.3,
        spanGaps:           false,
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

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
