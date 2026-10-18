import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScenario, solveAll, generatePlans, computeBaseline, validatePlan, recommendedPlanId } from '../public/js/solver.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const byId = (r, id) => r.plans.find((p) => p.id === id);

test('default scenario reproduces the documented numbers', () => {
  const r = solveAll(buildScenario());
  assert.equal(r.baseline.totalCostUsd, 376.3);
  assert.equal(byId(r, 'A').totalCostUsd, 165.1);
  assert.equal(byId(r, 'A').deadlineStatus.Order_1, 'at_risk');
  assert.equal(byId(r, 'C').totalCostUsd, 199.3);
  assert.ok(Object.values(byId(r, 'C').deadlineStatus).every((s) => s === 'on_time'));
  assert.ok(byId(r, 'B').totalCostUsd > byId(r, 'C').totalCostUsd, 'Plan B should cost more than Plan C');
  assert.ok(Object.values(byId(r, 'B').deadlineStatus).every((s) => s === 'on_time'));
  assert.ok(Object.values(r.validations).every((v) => v.valid));
  assert.equal(recommendedPlanId(r.plans), 'C');
});

test('costs match the real OR-Tools CP-SAT model on 35 scenarios', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/ortools_cases.json', import.meta.url)));
  for (const c of cases) {
    const r = solveAll(buildScenario({ peakCapKw: c.cap, delayHours: c.delay }));
    assert.equal(byId(r, 'A').totalCostUsd, c.A.cost, `Plan A cap=${c.cap} delay=${c.delay}`);
    assert.equal(byId(r, 'C').totalCostUsd, c.C.cost, `Plan C cap=${c.cap} delay=${c.delay}`);
    assert.ok(Object.values(byId(r, 'C').deadlineStatus).every((s) => s === 'on_time'));
  }
});

test('property: every feasible plan validates, and A <= C <= B in cost (400 random scenarios)', () => {
  let seed = 12345;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < 400; i++) {
    const sc = buildScenario({
      peakCapKw: 60 + Math.floor(rnd() * 25) * 10,
      delayHours: Math.floor(rnd() * 7),
      delayedOrder: ['Order_1', 'Order_2', 'Order_3'][Math.floor(rnd() * 3)],
      peakStartClock: 11 + Math.floor(rnd() * 5),
      peakEndClock: 16 + Math.floor(rnd() * 4),
    });
    const r = solveAll(sc);
    for (const p of r.plans) if (p.feasible) assert.ok(r.validations[p.id].valid, `invalid plan ${p.id}: ${r.validations[p.id].issues}`);
    const [A, B, C] = ['A', 'B', 'C'].map((id) => byId(r, id));
    if (C.feasible) { assert.ok(B.feasible); assert.ok(A.feasible); assert.ok(A.totalCostUsd <= C.totalCostUsd + 1e-9); assert.ok(C.totalCostUsd <= B.totalCostUsd + 1e-9); }
  }
});

test('an impossible cap yields an honest "no feasible plan", not a crash', () => {
  const r = solveAll(buildScenario({ peakCapKw: 50 }));
  assert.equal(byId(r, 'C').feasible, false);
  assert.equal(r.validations.C.valid, false);
});

test('validator catches a tampered plan (cap violation and wrong cost)', () => {
  const sc = buildScenario();
  const plan = JSON.parse(JSON.stringify(generatePlans(sc).find((p) => p.id === 'C')));
  plan.schedule.Line_B = [0, 1, 2, 3, 4, 5, 6];            // all three lines now run in slots 5 and 6
  plan.schedule.Line_C = [0, 1, 2, 3, 4, 5, 6];            // 90 + 70 + 60 = 220 kW > 180 kW cap
  const v = validatePlan(sc, plan);
  assert.equal(v.valid, false);
  assert.ok(v.issues.some((s) => s.includes('peak cap')));
  assert.ok(v.issues.some((s) => s.includes('cost mismatch')));
});

test('baseline exceeds the peak cap in the default crisis (why a plan is needed)', () => {
  const b = computeBaseline(buildScenario());
  assert.equal(b.respectsPeakCap, false);
  assert.equal(b.overCapHours, 3);
});

test('solving takes well under a second', () => {
  const r = solveAll(buildScenario());
  assert.ok(r.solveMs < 1000, `took ${r.solveMs} ms`);
});

console.log(`\n${passed} solver tests passed`);
