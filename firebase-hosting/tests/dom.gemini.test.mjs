/**
 * Exercises the whole Gemini path with a FAKE Firebase AI Logic model (no network, no key):
 * notice -> extraction -> validated form -> solver -> explanation -> number verification.
 * The fake model deliberately invents one number for Plan B to prove the guard catches it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const FAKE = `
export const isConfigured = () => true;
export const isLocalhost = () => false;
export const getFirebase = async () => ({ app: {} });
const resp = (text) => ({ response: { text: () => text } });
const fakeAi = {
  GoogleAIBackend: class {},
  getAI: () => ({}),
  getGenerativeModel: (_ai, cfg) => ({
    generateContent: async (parts) => {
      const sys = cfg.systemInstruction;
      window.__calls = (window.__calls || []).concat(sys.slice(0, 24));
      if (sys.includes('extract structured parameters')) {
        return resp(JSON.stringify({ powerCapKw: 150, restrictionStartHour24: 13, restrictionEndHour24: 16, delayedOrder: 'Order 2', delayHours: 2,
          confidence: 'high', uncertaintyNote: '', evidence: '150 kW between 13:00 and 16:00' }));
      }
      const data = JSON.parse(String(parts[0]).replace(/^Data:\\n/, '').split('\\n\\nQuestion:')[0]);
      if (sys.includes('Return JSON only')) {
        const [a, b, c] = data.plans;
        return resp(JSON.stringify({
          A: a.feasible ? 'Plan A is the cheapest at $' + a.totalCostUsd + ' but ' + a.ordersAtRisk.length + ' order(s) may be late.' : 'No plan.',
          B: 'Plan B finishes early and costs only $1.23.',
          C: c.feasible ? 'Plan C costs $' + c.totalCostUsd + ' and keeps every order on time.' : 'No plan.',
        }));
      }
      return resp('Plan A saves energy by running Line_A off-peak, which is why Order_1 is at risk.');
    },
  }),
};
export const loadModule = async (file) => { if (file === 'firebase-ai.js') return fakeAi; throw new Error('no firestore in this test'); };
`;
const fakePlugin = { name: 'fake-firebase', setup(b) {
  b.onResolve({ filter: /\/firebase\.js$/ }, () => ({ path: 'fake-firebase', namespace: 'fake' }));
  b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: FAKE, loader: 'js' }));
} };

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const out = await build({ entryPoints: [new URL('../public/js/app.js', import.meta.url).pathname], bundle: true, format: 'iife', write: false, logLevel: 'silent', plugins: [fakePlugin] });
const errors = [];
const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(e.message));
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
w.Chart = class { constructor() {} destroy() {} };
w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
w.eval(out.outputFiles[0].text);
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => w.document.getElementById(id);
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

await tick(250);

test('Gemini explanations appear on the plan cards; a verified one is marked verified', () => {
  const a = w.document.querySelector('#pG article:nth-child(1) .ai-t');
  assert.match(a.textContent, /Plan A is the cheapest at \$165.1/);
  assert.ok(a.querySelector('.vbadge.ok'), 'verified badge');
  assert.ok(w.document.querySelector('#pG article:nth-child(3) .ai-t .vbadge.ok'));
});

test('an invented number ($1.23) is caught and flagged on Plan B', () => {
  const b = w.document.querySelector('#pG article:nth-child(2) .ai-t');
  const bad = b.querySelector('.vbadge.bad');
  assert.ok(bad, 'unverified badge present');
  assert.match(bad.textContent, /1\.23/);
});

click($('btnRead')); await tick(150);
test('extraction fills the form from the notice, with confidence and the quoted evidence', () => {
  assert.equal($('fCap').value, '150');
  assert.equal($('fFrom').value, '13');
  assert.equal($('fTo').value, '16');
  assert.equal($('fOrder').value, 'Order_2');
  assert.equal($('fDelay').value, '2');
  assert.match($('inResult').textContent, /High/);
  assert.match($('inResult').textContent, /150 kW between 13:00 and 16:00/);
  assert.match($('inStatus').textContent, /Review the values/);
});

test('nothing is applied until the manager confirms (human in the loop)', () => {
  assert.match($('topStatus').textContent, /180 kW, 2 PM to 5 PM/);
});

click($('btnApply')); await tick(250);
test('after confirmation the solver re-plans with the extracted values', () => {
  assert.match($('topStatus').textContent, /150 kW, 1 PM to 4 PM/);
  assert.ok($('pG').textContent.includes('$'));
  assert.match(w.document.querySelector('#pG article:nth-child(1) .ai-t').textContent, /Plan A is the cheapest at/);
});

click(w.document.querySelector('[data-act="why"][data-id="A"]'));
$('askInput').value = 'Why is Order 1 at risk in Plan A?';
click($('askGo')); await tick(150);
test('ask-why returns a checked answer in the modal', () => {
  assert.equal($('askModal').hidden, false);
  assert.match($('askAnswer').textContent, /Order_1 is at risk/);
});

test('the fake Gemini was called for extraction, explanation and question', () => {
  const calls = w.__calls.join('|');
  assert.ok(calls.includes('You extract structured'));
  assert.ok(calls.includes('You are the explanation'));
  assert.equal(errors.length, 0, errors.join('; '));
});

console.log(`\n${passed} Gemini-path tests passed`);
