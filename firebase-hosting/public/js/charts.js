/** Chart.js wrappers. All data passed in comes from the solver, never typed by hand. */
import { slotLabel } from './solver.js';

const COLORS = { red: '#ff6b6b', green: '#51cf66', blue: '#4dabf7', amber: '#ffd43b', grey: '#adb5bd' };
export const LINE_COLORS = { Line_A: COLORS.green, Line_B: COLORS.blue, Line_C: COLORS.amber };
const GRID = 'rgba(255,255,255,.07)';
const TICK = 'rgba(255,255,255,.55)';
const instances = {};

const baseOptions = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 800 },
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: 'rgba(255,255,255,.8)', font: { size: 11 } } } },
  scales: { x: { grid: { color: GRID }, ticks: { color: TICK } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK } } },
  ...extra,
});

function mount(key, canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!window.Chart || !el) return;
  instances[key]?.destroy();
  instances[key] = new window.Chart(el, config);
}

const gradient = (rgb) => (ctx) => {
  const { chart } = ctx;
  if (!chart.chartArea) return `rgba(${rgb},.2)`;
  const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
  g.addColorStop(0, `rgba(${rgb},.35)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  return g;
};
const dots = (color) => ({ pointBackgroundColor: '#fff', pointBorderColor: color, pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7 });
const hourLabels = (hours, start, startHour) => Array.from({ length: hours }, (_, h) => slotLabel({ startHour }, h));

export function drawPower({ sc, result, planId, text }) {
  const labels = hourLabels(sc.hours, 0, sc.startHour);
  const plan = result.plans.find((p) => p.id === planId && p.feasible);
  const datasets = [{ label: text.baseline, data: result.baseline.hourlyKw, borderColor: COLORS.red, backgroundColor: gradient('255,107,107'), fill: true, tension: 0.35, ...dots(COLORS.red) }];
  if (plan) datasets.push({ label: text.selected, data: plan.hourlyKw, borderColor: COLORS.green, backgroundColor: gradient('81,207,102'), fill: true, tension: 0.35, ...dots(COLORS.green) });
  datasets.push({ label: text.cap, data: labels.map((_, h) => (sc.peakHours.includes(h) ? sc.peakCapKw : null)), borderColor: '#fff', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false });
  mount('main', 'mainChart', { type: 'line', data: { labels, datasets }, options: baseOptions() });
}

export function drawCost({ result, names, baselineLabel }) {
  const rows = [{ label: baselineLabel, v: result.baseline.totalCostUsd, c: COLORS.grey }];
  const palette = { A: COLORS.blue, B: COLORS.green, C: COLORS.amber };
  for (const p of result.plans) if (p.feasible) rows.push({ label: names[p.id], v: p.totalCostUsd, c: palette[p.id] });
  mount('main', 'mainChart', {
    type: 'bar',
    data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.v), backgroundColor: rows.map((r) => r.c), borderRadius: 8 }] },
    options: baseOptions({ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: TICK } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK, callback: (v) => `$${v}` } } } }),
  });
}

/** Stacked bars: kW per hour, one series per line. `series` = { Line_A: [kW per hour], ... } */
export function drawStacked({ key, canvasId, labels, series, lineNames }) {
  mount(key, canvasId, {
    type: 'bar',
    data: { labels, datasets: Object.entries(series).map(([line, data]) => ({ label: lineNames[line] || line, data, backgroundColor: LINE_COLORS[line] || COLORS.grey, borderRadius: 4 })) },
    options: baseOptions({ scales: { x: { stacked: true, grid: { display: false }, ticks: { color: TICK } }, y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK } } } }),
  });
}

export function drawIssues({ labels, counts }) {
  mount('issue', 'issueChart', {
    type: 'bar',
    data: { labels, datasets: [{ data: counts, backgroundColor: [COLORS.red, COLORS.blue, '#b197fc', COLORS.amber], borderRadius: 8 }] },
    options: baseOptions({ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: TICK } }, y: { beginAtZero: true, ticks: { color: TICK, precision: 0 }, grid: { color: GRID } } } }),
  });
}
