/**
 * PowerProof scheduling engine.
 *
 * Pure, deterministic functions: no DOM, no network, no randomness. Gemini never
 * touches this file. It only reads this module's OUTPUT and explains it.
 *
 * This is a JavaScript port of backend/solver.py (the OR-Tools CP-SAT model).
 * The search is exact: every line picks the set of hours it runs, the peak-hour
 * power cap couples the lines, and a branch-and-bound search finds the optimum
 * for each plan objective. tests/solver.test.mjs cross-checks costs against the
 * Python CP-SAT model.
 *
 * All factory data below is SIMULATED demo data (see README).
 */

export const DEFAULTS = Object.freeze({
  hours: 10,          // 10 one-hour slots
  startHour: 9,       // slot 0 = 09:00-10:00
  offPeakRate: 0.13,  // USD per kWh (illustrative)
  peakRate: 0.32,     // USD per kWh (illustrative)
  peakStartClock: 14,
  peakEndClock: 17,
  peakCapKw: 180,
  normalCapKw: 300,
  delayedOrder: 'Order_1',
  delayHours: 3,
});

const LINES = {
  Line_A: { powerKw: 90, unitsPerHour: 120 },
  Line_B: { powerKw: 70, unitsPerHour: 95 },
  Line_C: { powerKw: 60, unitsPerHour: 80 },
};

const ORDERS = {
  Order_1: { line: 'Line_A', units: 480, deadlineHour: 7 },
  Order_2: { line: 'Line_B', units: 650, deadlineHour: 9 },
  Order_3: { line: 'Line_C', units: 500, deadlineHour: 9 },
};

export const ORDER_NAMES = Object.keys(ORDERS);
export const LINE_NAMES = Object.keys(LINES);

/** "14" -> "2 PM" */
export function clockLabel(hour24) {
  const h = ((hour24 % 24) + 24) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Slot index -> clock label of the slot start. */
export function slotLabel(sc, slot) {
  return clockLabel(sc.startHour + slot);
}

export function buildScenario(input = {}) {
  const p = { ...DEFAULTS, ...input };
  const peakHours = [];
  for (let h = 0; h < p.hours; h++) {
    const clock = p.startHour + h;
    if (clock >= p.peakStartClock && clock < p.peakEndClock) peakHours.push(h);
  }
  const tariff = Array.from({ length: p.hours }, (_, h) => (peakHours.includes(h) ? p.peakRate : p.offPeakRate));
  const orders = {};
  for (const [name, o] of Object.entries(ORDERS)) {
    const ready = name === p.delayedOrder ? Math.max(0, Math.min(p.hours - 1, Math.round(p.delayHours))) : 0;
    orders[name] = { ...o, materialReadyHour: ready };
  }
  return {
    hours: p.hours,
    startHour: p.startHour,
    peakHours,
    peakStartClock: p.peakStartClock,
    peakEndClock: p.peakEndClock,
    peakCapKw: p.peakCapKw,
    normalCapKw: p.normalCapKw,
    lines: JSON.parse(JSON.stringify(LINES)),
    orders,
    tariff,
  };
}

const cents = (sc, line, h) => Math.round(sc.lines[line].powerKw * sc.tariff[h] * 100);
const round2 = (x) => Math.round(x * 100) / 100;
const hoursNeeded = (sc, order) => Math.ceil(order.units / sc.lines[order.line].unitsPerHour);

/** What happens with no optimization: every line starts as soon as material is ready. */
export function computeBaseline(sc) {
  let costCents = 0;
  let kwh = 0;
  const hourlyKw = Array(sc.hours).fill(0);
  for (const o of Object.values(sc.orders)) {
    const power = sc.lines[o.line].powerKw;
    for (let h = o.materialReadyHour; h < sc.hours; h++) {
      hourlyKw[h] += power;
      kwh += power;
      costCents += cents(sc, o.line, h);
    }
  }
  const overCapHours = sc.peakHours.filter((h) => hourlyKw[h] > sc.peakCapKw).length;
  return {
    totalCostUsd: round2(costCents / 100),
    totalKwh: kwh,
    hourlyKw,
    overCapHours,
    respectsPeakCap: overCapHours === 0,
  };
}

function* combinations(items, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

/**
 * Exact search for one objective.
 *  - 'cost'     : minimise energy cost (ties -> earliest hours)
 *  - 'earliest' : minimise when lines finish (ties -> cheapest)
 * enforceDeadlines=false lets a line finish any time before end of day
 * (Plan A trades deadline risk for cost; the risk is reported, never hidden).
 */
function solve(sc, objective, enforceDeadlines) {
  const names = Object.keys(sc.lines);
  const specs = [];
  for (const line of names) {
    const order = Object.values(sc.orders).find((o) => o.line === line);
    if (!order) { specs.push({ line, candidates: [{ hours: [], local: 0, peak: [] }] }); continue; }
    const need = hoursNeeded(sc, order);
    const end = enforceDeadlines ? order.deadlineHour : sc.hours - 1;
    const window = [];
    for (let h = order.materialReadyHour; h <= end; h++) window.push(h);
    if (window.length < need) return null;
    const candidates = [];
    for (const hrs of combinations(window, need)) {
      let c = 0; let sum = 0;
      for (const h of hrs) { c += cents(sc, line, h); sum += h; }
      const finish = hrs[hrs.length - 1];
      const local = objective === 'cost' ? c * 1000 + sum : finish * 1e6 + c;
      candidates.push({ hours: hrs, local, peak: hrs.filter((h) => sc.peakHours.includes(h)) });
    }
    candidates.sort((a, b) => a.local - b.local);
    specs.push({ line, candidates });
  }
  const suffixMin = Array(specs.length + 1).fill(0);
  for (let i = specs.length - 1; i >= 0; i--) suffixMin[i] = suffixMin[i + 1] + specs[i].candidates[0].local;

  const load = {};
  for (const h of sc.peakHours) load[h] = 0;
  let best = null; let bestScore = Infinity;
  const chosen = [];
  (function dfs(i, score) {
    if (score + suffixMin[i] >= bestScore) return;
    if (i === specs.length) { bestScore = score; best = chosen.slice(); return; }
    const power = sc.lines[specs[i].line].powerKw;
    for (const cand of specs[i].candidates) {
      if (score + cand.local + suffixMin[i + 1] >= bestScore) break; // sorted: nothing better follows
      if (cand.peak.some((h) => load[h] + power > sc.peakCapKw)) continue;
      for (const h of cand.peak) load[h] += power;
      chosen.push(cand);
      dfs(i + 1, score + cand.local);
      chosen.pop();
      for (const h of cand.peak) load[h] -= power;
    }
  })(0, 0);
  if (!best) return null;
  const schedule = {};
  names.forEach((line, i) => { schedule[line] = best[i].hours.slice(); });
  return buildPlan(sc, schedule, enforceDeadlines);
}

function buildPlan(sc, schedule, deadlinesEnforced) {
  let costCents = 0; let kwh = 0;
  const hourlyKw = Array(sc.hours).fill(0);
  const lineKw = {};
  for (const [line, hrs] of Object.entries(schedule)) {
    lineKw[line] = Array(sc.hours).fill(0);
    for (const h of hrs) {
      const p = sc.lines[line].powerKw;
      lineKw[line][h] = p; hourlyKw[h] += p; kwh += p; costCents += cents(sc, line, h);
    }
  }
  const deadlineStatus = {};
  for (const [name, o] of Object.entries(sc.orders)) {
    const done = schedule[o.line].filter((h) => h <= o.deadlineHour).length * sc.lines[o.line].unitsPerHour;
    deadlineStatus[name] = done >= o.units ? 'on_time' : 'at_risk';
  }
  const finishHour = {};
  for (const [line, hrs] of Object.entries(schedule)) finishHour[line] = hrs.length ? hrs[hrs.length - 1] : null;
  return {
    feasible: true, schedule, hourlyKw, lineKw, deadlineStatus, finishHour,
    totalCostUsd: round2(costCents / 100), totalKwh: kwh,
    peakCapRespected: sc.peakHours.every((h) => hourlyKw[h] <= sc.peakCapKw),
    deadlinesEnforced,
  };
}

/** Plan A = Cost Saver, Plan B = Deadline Protector, Plan C = Balanced (cheapest plan meeting every deadline). */
export function generatePlans(sc) {
  const defs = [
    { id: 'A', objective: 'cost', enforce: false },
    { id: 'B', objective: 'earliest', enforce: true },
    { id: 'C', objective: 'cost', enforce: true },
  ];
  return defs.map((d) => {
    const plan = solve(sc, d.objective, d.enforce);
    return plan ? { id: d.id, ...plan } : { id: d.id, feasible: false };
  });
}

/**
 * Independent feasibility check. It re-derives everything from the schedule and
 * shares no code path with solve(), so a bug in one cannot silently pass the other.
 */
export function validatePlan(sc, plan) {
  const issues = [];
  if (!plan.feasible) return { valid: false, issues: ['no feasible schedule'] };
  for (const h of sc.peakHours) {
    let kw = 0;
    for (const [line, hrs] of Object.entries(plan.schedule)) if (hrs.includes(h)) kw += sc.lines[line].powerKw;
    if (kw > sc.peakCapKw) issues.push(`peak cap exceeded in slot ${h}: ${kw} kW > ${sc.peakCapKw} kW`);
  }
  let cost = 0;
  for (const [line, hrs] of Object.entries(plan.schedule)) {
    const order = Object.values(sc.orders).find((o) => o.line === line);
    if (new Set(hrs).size !== hrs.length) issues.push(`${line}: an hour is booked twice`);
    for (const h of hrs) {
      if (h < 0 || h >= sc.hours) issues.push(`${line}: slot ${h} is outside the day`);
      if (order && h < order.materialReadyHour) issues.push(`${line}: runs in slot ${h} before material is ready`);
      cost += sc.lines[line].powerKw * sc.tariff[h];
    }
    if (order) {
      const end = plan.deadlinesEnforced ? order.deadlineHour : sc.hours - 1;
      const produced = hrs.filter((h) => h <= end).length * sc.lines[line].unitsPerHour;
      if (produced < order.units) issues.push(`${line}: produces ${produced} of ${order.units} units`);
    }
  }
  if (Math.abs(cost - plan.totalCostUsd) > 0.005) issues.push(`cost mismatch: recomputed ${cost.toFixed(2)} vs reported ${plan.totalCostUsd}`);
  for (const [name, o] of Object.entries(sc.orders)) {
    const produced = (plan.schedule[o.line] || []).filter((h) => h <= o.deadlineHour).length * sc.lines[o.line].unitsPerHour;
    const status = produced >= o.units ? 'on_time' : 'at_risk';
    if (status !== plan.deadlineStatus[name]) issues.push(`${name}: deadline status mismatch`);
  }
  return { valid: issues.length === 0, issues };
}

/** Run everything and measure the real wall-clock time. */
export function solveAll(sc) {
  const t0 = performance.now();
  const baseline = computeBaseline(sc);
  const plans = generatePlans(sc);
  const validations = Object.fromEntries(plans.map((p) => [p.id, validatePlan(sc, p)]));
  return { baseline, plans, validations, solveMs: performance.now() - t0 };
}

export const savingsPct = (baselineCost, planCost) => Math.round(((baselineCost - planCost) / baselineCost) * 1000) / 10;
export const recommendedPlanId = (plans) => (plans.find((p) => p.id === 'C' && p.feasible) ? 'C' : (plans.filter((p) => p.feasible).sort((a, b) => a.totalCostUsd - b.totalCostUsd)[0] || {}).id || null);
