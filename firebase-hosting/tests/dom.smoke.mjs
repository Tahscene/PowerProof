/**
 * Browser-free smoke test: bundles the real app with esbuild and runs it inside jsdom,
 * then clicks through the manager -> floor screen -> worker report flow.
 * Chart.js is stubbed (jsdom has no canvas); Gemini is not configured, so this also
 * proves the app degrades gracefully instead of dead-ending.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const out = await build({ entryPoints: [new URL('../public/js/app.js', import.meta.url).pathname], bundle: true, format: 'iife', write: false, logLevel: 'silent' });

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
vc.on('error', (e) => errors.push(String(e)));
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
w.__charts = [];
w.Chart = class { constructor(el, cfg) { w.__charts.push(cfg.type); } destroy() {} };
w.scrollTo = () => {};
w.Element.prototype.scrollIntoView = () => {};
w.eval(out.outputFiles[0].text);
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => w.document.getElementById(id);
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

await tick(150);

test('manager view renders three solver plans with the verified numbers', () => {
  const cards = [...w.document.querySelectorAll('#pG article.pc')];
  assert.equal(cards.length, 3);
  const text = $('pG').textContent;
  for (const v of ['$165.10', '$199.30', '$235.40']) assert.ok(text.includes(v), v);
  assert.equal($('baseCost').textContent, '$376.30');
  assert.match($('topStatus').textContent, /180 kW, 2 PM to 5 PM/);
});

test('"in numbers" cards are measured, not typed', () => {
  assert.match($('nv1').textContent, /ms$/);
  assert.equal($('nv2').textContent, '56.1%');
  assert.equal($('nv3').textContent, '3');
  assert.equal($('nv4').textContent, '47%');
});

click($('btnRead')); await tick();
test('Gemini-off message shown, nothing crashed', () => assert.match($('inStatus').textContent, /not connected yet/));

$('fCap').value = '150'; click($('btnApply')); await tick();
test('applying new values re-plans with the new cap', () => {
  assert.match($('topStatus').textContent, /150 kW/);
  assert.equal(w.document.querySelectorAll('#pG article.pc').length, 3);
});

click(w.document.querySelector('[data-act="approve"][data-id="C"]')); await tick();
test('approving a plan updates the manager view and every approve button locks', () => {
  assert.ok($('approvedBar').classList.contains('show'));
  assert.ok([...w.document.querySelectorAll('[data-act="approve"]')].every((b) => b.disabled));
  assert.ok(w.document.querySelector('.pc.sel'));
});

click(w.document.querySelector('#nav a[data-t="line"]')); await tick();
test('floor screen shows the approved schedule as colour cells (no reading needed)', () => {
  assert.equal($('lineBoard').hidden, false);
  assert.equal(w.document.querySelectorAll('#lineGrid .cell.run').length, 18, 'plan C runs 4 + 7 + 7 line-hours');
  assert.ok(w.document.querySelectorAll('#lineGrid .cell.peak').length > 0);
  assert.equal(w.document.querySelectorAll('#iconCards .ic').length, 4);
});

click($('btnAck')); await tick();
test('worker confirmation is recorded and the button locks', () => {
  assert.equal($('btnAck').disabled, true);
  assert.ok($('ackToast').classList.contains('show'));
});

click(w.document.querySelector('#nav a[data-t="rpt"]')); await tick();
$('rpLine').value = 'Line_B';
click(w.document.querySelector('[data-rp="machine_down"]')); await tick();
test('speech-impaired report: one tap reaches the report list and the manager', () => {
  assert.match($('rpList').textContent, /Machine down\s*Line B/);
  click(w.document.querySelector('#nav a[data-t="mgr"]'));
  assert.match($('issLog').textContent, /Machine down\s*Line B/);
  assert.match($('decLog').textContent, /Approved: Balanced/);
  assert.match($('decLog').textContent, /confirmed the new schedule/);
});

click(w.document.querySelector('#langPick [data-lang="bn"]')); await tick();
test('language switch retranslates the interface and the plans', () => {
  assert.equal(w.document.querySelector('#nav a[data-t="mgr"]').textContent, 'ম্যানেজার');
  assert.match($('pG').textContent, /খরচ সাশ্রয়/);
  assert.equal(w.document.documentElement.lang, 'bn');
});

click($('btnReset')); await tick();
test('reset clears the approval everywhere', () => {
  assert.ok(!$('approvedBar').classList.contains('show'));
  assert.ok(![...w.document.querySelectorAll('[data-act="approve"]')].some((b) => b.disabled));
});

test('charts were drawn from solver data and nothing threw', () => {
  assert.ok(w.__charts.length >= 3);
  assert.deepEqual(errors, []);
});

console.log(`\n${passed} DOM smoke tests passed`);
