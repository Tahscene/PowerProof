import assert from 'node:assert/strict';
import { normalizeDigits, numbersIn, findUnverifiedNumbers, sanitizeExtraction, parseJsonLoose } from '../public/js/guards.js';
import { buildScenario, solveAll } from '../public/js/solver.js';
import { buildPlanPayload } from '../public/js/gemini.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

test('digits in Bangla and Hindi are normalised before checking', () => {
  assert.equal(normalizeDigits('১৬৫.১০ ও ₹१९९'), '165.10 ও ₹199');
  assert.deepEqual(numbersIn('খরচ ১৬৫.১০ ডলার'), [165.1]);
});

test('an invented number is caught, a real one passes', () => {
  const data = { totalCostUsd: 199.3, savingsPercent: 47, restrictionWindow: '2 PM to 5 PM' };
  assert.deepEqual(findUnverifiedNumbers('Plan C costs $199.30, saving 47% in the 2 PM to 5 PM window.', data), []);
  assert.deepEqual(findUnverifiedNumbers('Plan C costs $187.50.', data), [187.5]);
  assert.deepEqual(findUnverifiedNumbers('It saves about 47 percent.', { savingsPercent: 47.0 }), []);
  assert.deepEqual(findUnverifiedNumbers('saves 56%', { savingsPercent: 56.1 }), [], 'rounding of an allowed value is accepted');
});

test('explanations built from the real payload verify cleanly', () => {
  const sc = buildScenario();
  const payload = buildPlanPayload(sc, solveAll(sc));
  const good = `Plan C costs ${payload.plans[2].totalCostUsd} dollars and keeps all three orders on time during the ${payload.restrictionWindow} restriction (${payload.restrictionHours} hours).`;
  assert.deepEqual(findUnverifiedNumbers(good, payload), []);
  assert.ok(findUnverifiedNumbers(good.replace('199.3', '172.4'), payload).includes(172.4));
});

test('extraction: valid values pass through', () => {
  const r = sanitizeExtraction({ powerCapKw: 180, restrictionStartHour24: 14, restrictionEndHour24: 17, delayedOrder: 'Order 1', delayHours: 3, confidence: 'high', uncertaintyNote: '', evidence: '180 kW between 14:00 and 17:00' });
  assert.deepEqual(r.values, { peakCapKw: 180, peakStartClock: 14, peakEndClock: 17, delayedOrder: 'Order_1', delayHours: 3 });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.confidence, 'high');
});

test('extraction: out-of-range or malformed values are rejected, never applied', () => {
  const r = sanitizeExtraction({ powerCapKw: 5000, restrictionStartHour24: 17, restrictionEndHour24: 14, delayedOrder: 'Order 9', delayHours: 40, confidence: 'high' });
  assert.deepEqual(r.values, { peakCapKw: null, peakStartClock: null, peakEndClock: null, delayedOrder: null, delayHours: null });
  for (const w of ['capOutOfRange', 'windowInvalid', 'orderUnknown', 'delayOutOfRange']) assert.ok(r.warnings.includes(w), w);
  assert.notEqual(r.confidence, 'high', 'confidence is downgraded when validation fails');
});

test('extraction: nulls from the model stay null (no guessing)', () => {
  const r = sanitizeExtraction({ powerCapKw: null, restrictionStartHour24: null, restrictionEndHour24: null, delayedOrder: null, delayHours: null, confidence: 'low', uncertaintyNote: 'delay given in days' });
  assert.ok(r.warnings.includes('capMissing'));
  assert.equal(r.note, 'delay given in days');
});

test('JSON in markdown fences is parsed', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
});

console.log(`\n${passed} guard tests passed`);
