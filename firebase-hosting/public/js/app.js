/** PowerProof UI: wires the solver, Gemini (via Firebase AI Logic) and real-time sync to the page. */
import { buildScenario, solveAll, savingsPct, recommendedPlanId, slotLabel, clockLabel, ORDER_NAMES, LINE_NAMES, DEFAULTS } from './solver.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';
import * as charts from './charts.js';
import { gemini, extractCrisis, explainPlans, askWhy, buildPlanPayload } from './gemini.js';
import { createSync } from './sync.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pretty = (name) => name.replace('_', ' ');
const usd = (n) => `$${n.toFixed(2)}`;
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const PLAN_EN = { A: 'Cost Saver', B: 'Deadline Protector', C: 'Balanced' };

const SAMPLE_NOTICE = `From: Regional Grid Operations <ops@grid.example>
Subject: Emergency load restriction today

Because of a fuel shortage, industrial feeders in your zone are limited to 180 kW between 14:00 and 17:00 today.

Separately, our logistics partner reports that the component shipment for Order 1 will reach your dock about 3 hours later than scheduled.

Please adjust production accordingly.`;

const ICON = {
  alert: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 2 42h44z" fill="${c}"/><path d="M22 18h4v12h-4zM22 33h4v4h-4z" fill="#fff"/></svg>`,
  doc: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="5" width="32" height="38" rx="4" fill="${c}"/><path d="M14 16h20M14 24h14M14 32h18" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`,
  chart: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="8" width="40" height="32" rx="4" fill="${c}"/><path d="m10 34 8-12 6 6 8-12 6 8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="${c}"/><path d="m14 24 7 7 13-14" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  screen: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="7" width="40" height="27" rx="4" fill="${c}"/><path d="M16 42h16M24 34v8" stroke="${c}" stroke-width="4" stroke-linecap="round"/><path d="M13 20h6v8h-6zM21 14h6v14h-6zM29 18h6v10h-6z" fill="#fff"/></svg>`,
  tap: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M20 6a4 4 0 0 1 8 0v18l5-2a4 4 0 0 1 4 6l-6 14H18L10 30a4 4 0 0 1 6-4l4 4z" fill="${c}"/></svg>`,
  bolt: (c) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z" fill="${c}"/></svg>`,
  box: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 14 24 5l18 9v22L24 45 6 36z" fill="${c}"/><path d="m6 14 18 9 18-9M24 23v22" stroke="#fff" stroke-width="3" fill="none"/></svg>`,
  gear: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="${c}"/><circle cx="24" cy="24" r="6" fill="#fff"/><path d="M24 2v7M24 39v7M2 24h7M39 24h7M8.5 8.5l5 5M34.5 34.5l5 5M39.5 8.5l-5 5M13.5 34.5l-5 5" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
  lens: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="21" cy="21" r="14" fill="none" stroke="${c}" stroke-width="5"/><path d="m31 31 12 12" stroke="${c}" stroke-width="6" stroke-linecap="round"/></svg>`,
  help: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="${c}"/><path d="M22 12h4v18h-4zM22 34h4v4h-4z" fill="#fff"/></svg>`,
  hourglass: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 5h24v7L28 24l8 12v7H12v-7l8-12-8-12z" fill="${c}"/></svg>`,
  plug: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 4v10M32 4v10M10 14h28v8a14 14 0 0 1-28 0z" fill="${c}"/><path d="M24 36v8" stroke="${c}" stroke-width="5"/></svg>`,
  swap: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 17h28l-6-7M40 31H12l6 7" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clock: (c) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="${c}"/><path d="M24 12v13l9 5" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`,
};

const HOW = {
  m: [['alert', '#e53935', 'hw_m1'], ['doc', '#8e24aa', 'hw_m2'], ['chart', '#1a73e8', 'hw_m3'], ['check', '#0b8043', 'hw_m4'], ['screen', '#c41e3a', 'hw_m5']],
  w: [['check', '#0b8043', 'hw_w1'], ['screen', '#1a73e8', 'hw_w2'], ['tap', '#8e24aa', 'hw_w3'], ['alert', '#e53935', 'hw_w4'], ['doc', '#c41e3a', 'hw_w5']],
};
const REPORTS = [
  { type: 'no_material', icon: 'box', color: '#e53935', k: 'rp_m', ks: 'rp_m_s' },
  { type: 'machine_down', icon: 'gear', color: '#1a73e8', k: 'rp_d', ks: 'rp_d_s' },
  { type: 'quality', icon: 'lens', color: '#8e24aa', k: 'rp_q', ks: 'rp_q_s' },
  { type: 'help', icon: 'help', color: '#c41e3a', k: 'rp_help', ks: 'rp_help_s' },
];

const S = {
  params: { peakCapKw: DEFAULTS.peakCapKw, peakStartClock: DEFAULTS.peakStartClock, peakEndClock: DEFAULTS.peakEndClock, delayedOrder: DEFAULTS.delayedOrder, delayHours: DEFAULTS.delayHours },
  sc: null, result: null, viewId: 'C', ex: { status: 'off' }, exToken: 0,
  live: null, events: [], sync: null, tab: 'mgr', chart: 'power', how: 'm', ackedAt: 0, askId: null, extraction: null, intake: { key: '', kind: '' },
};

/* ------------------------------------------------------------ planning */
function recompute() {
  S.sc = buildScenario(S.params);
  S.result = solveAll(S.sc);
  S.viewId = recommendedPlanId(S.result.plans) || 'A';
  renderManager();
  runExplain();
}

async function runExplain() {
  const token = ++S.exToken;
  if (gemini.status === 'off') { S.ex = { status: 'off' }; renderPlans(); return; }
  S.ex = { status: 'wait' }; renderPlans();
  try {
    const res = await explainPlans({ payload: buildPlanPayload(S.sc, S.result), lang: getLang() });
    if (token !== S.exToken) return;
    S.ex = { status: 'ok', data: res.explanations };
  } catch (err) {
    if (token !== S.exToken) return;
    S.ex = { status: 'err', code: err.code || 'error' };
  }
  renderPlans(); renderIntakeMeta(); renderChips();
}

/* ------------------------------------------------------------ rendering: manager */
function renderManager() { renderTop(); renderNumbers(); renderHow(); renderPlans(); renderLogs(); renderDashboard(); renderChips(); }

function renderTop() {
  $('topStatus').textContent = t('top_status', { cap: S.sc.peakCapKw, from: clockLabel(S.sc.peakStartClock), to: clockLabel(S.sc.peakEndClock) });
}

function renderNumbers() {
  const r = S.result; const base = r.baseline.totalCostUsd;
  const feasible = r.plans.filter((p) => p.feasible);
  const best = feasible.length ? Math.max(...feasible.map((p) => savingsPct(base, p.totalCostUsd))) : 0;
  const safe = r.plans.find((p) => p.id === 'C' && p.feasible);
  $('nv1').textContent = `${r.solveMs < 10 ? r.solveMs.toFixed(1) : Math.round(r.solveMs)} ms`;
  $('nv2').textContent = `${best}%`;
  $('nv3').textContent = String(feasible.length);
  $('nv4').textContent = safe ? `${savingsPct(base, safe.totalCostUsd)}%` : 'n/a';
}

function renderHow() {
  const items = HOW[S.how];
  const item = ([icon, color, key]) => `<div class="how-item">${ICON[icon](color)}<div class="hl">${t(key)}</div></div>`;
  $('howRing').innerHTML = `<div class="how-top">${items.slice(0, 4).map(item).join('')}</div><div class="how-bot">${item(items[4])}</div>`;
  document.querySelectorAll('#howTabs .how-tab').forEach((b) => b.classList.toggle('on', b.dataset.how === S.how));
}

function explainHtml(id) {
  const { status, data, code } = S.ex;
  if (status === 'off') return `<span class="muted">${t('pl_ai_off')}</span>`;
  if (status === 'wait') return `<span class="muted">${t('pl_ai_wait')}</span>`;
  if (status === 'err') return `<span class="warn">${t('in_err_' + code)}</span>`;
  const e = data?.[id];
  if (!e) return '';
  const badge = e.unverified.length ? `<span class="vbadge bad">${t('pl_ai_bad', { nums: e.unverified.join(', ') })}</span>` : `<span class="vbadge ok">${t('pl_ai_ok')}</span>`;
  return `${esc(e.text)} ${badge}`;
}

function planCard(p) {
  const tag = `<div class="ptag ${p.id.toLowerCase()}">${t('tag_' + p.id)}</div>`;
  if (!p.feasible) return `<article class="pc"><div class="pc-top">${tag}<h3>${t('name_' + p.id)}</h3><p>${t('pl_none')}</p></div></article>`;
  const base = S.result.baseline.totalCostUsd;
  const sv = base - p.totalCostUsd;
  const live = S.live?.planId;
  const cls = ['pc']; if (live === p.id) cls.push('sel'); else if (live) cls.push('dim');
  const rec = recommendedPlanId(S.result.plans) === p.id ? `<span class="rec">${t('pl_rec')}</span>` : '';
  const v = S.result.validations[p.id];
  const orders = ORDER_NAMES.map((o) => `<div class="or"><span>${pretty(o)}</span><span class="ob ${p.deadlineStatus[o]}">${p.deadlineStatus[o] === 'on_time' ? '&#10003; ' + t('pl_ontime') : '&#9888; ' + t('pl_risk')}</span></div>`).join('');
  const lastFinish = Math.max(...Object.values(p.finishHour).filter((x) => x !== null));
  const approved = live === p.id;
  return `<article class="${cls.join(' ')}">
    <div class="pc-top">${tag}${rec}<h3>${t('name_' + p.id)}</h3><p>${t('sum_' + p.id)}</p></div>
    <div class="pc-body">
      <div class="row"><span class="rl">${t('pl_cost')}</span><span class="rv huge">${usd(p.totalCostUsd)}</span></div>
      <div class="row"><span class="rl">${t('pl_saved')}</span><span class="sav">&darr; ${usd(sv)} (${savingsPct(base, p.totalCostUsd)}%)</span></div>
      <div class="row"><span class="rl">${t('pl_finish')}</span><span class="rv">${clockLabel(S.sc.startHour + lastFinish + 1)}</span></div>
      <div class="row"><span class="rl">${t('pl_peak')}</span><span class="rv ${p.peakCapRespected ? 'gn' : 'rd'}">${p.peakCapRespected ? '&#10003; ' + t('pl_ok') : '&#10007;'}</span></div>
      <div class="row"><span class="rl">${t('pl_valid')}</span><span class="rv ${v.valid ? 'gn' : 'rd'}">${v.valid ? '&#10003; ' + t('pl_pass') : '&#10007; ' + t('pl_fail')}</span></div>
      <div class="orders">${orders}</div>
      <div class="ai-box"><div class="ai-h">${t('pl_ai')}</div><div class="ai-t">${explainHtml(p.id)}</div></div>
    </div>
    <div class="pc-f"><button class="btn btn-out" data-act="why" data-id="${p.id}">${t('pl_why')}</button>
      <button class="btn btn-red ${approved ? 'btn-ok' : ''}" data-act="approve" data-id="${p.id}" ${live ? 'disabled' : ''}>${approved ? '&#10003; ' + t('pl_approved') : live ? t('pl_notsel') : t('pl_approve')}</button></div>
  </article>`;
}

function renderPlans() {
  const r = S.result; if (!r) return;
  $('baseCost').textContent = usd(r.baseline.totalCostUsd);
  $('baseWarn').textContent = r.baseline.respectsPeakCap ? t('pl_base_ok') : t('pl_base_warn', { n: r.baseline.overCapHours });
  $('pG').innerHTML = r.plans.map(planCard).join('');
  const bar = $('approvedBar');
  if (S.live?.planId) { bar.textContent = t('pl_appr_msg', { plan: t('name_' + S.live.planId) }); bar.classList.add('show'); } else bar.classList.remove('show');
}

function renderLogs() {
  const rows = [];
  if (S.live?.planId) rows.push({ ms: S.live.approvedAtMs, text: t('lg_approved', { plan: t('name_' + S.live.planId) }) });
  for (const e of S.events.filter((x) => x.kind === 'ack')) rows.push({ ms: e.tsMs, text: t('lg_ack') });
  rows.sort((a, b) => b.ms - a.ms);
  $('decLog').innerHTML = rows.length ? rows.slice(0, 8).map((r) => `<div class="lr"><span class="lt">${time(r.ms)}</span>${esc(r.text)}</div>`).join('') : `<div class="lr muted">${t('lg_none')}</div>`;
  const issues = S.events.filter((x) => x.kind === 'report');
  $('issLog').innerHTML = issues.length ? issues.slice(0, 8).map((e) => `<div class="lr issue"><span class="lt">${time(e.tsMs)}</span>${esc(reportLabel(e.type))} <b>${esc(pretty(e.line || ''))}</b></div>`).join('') : `<div class="lr muted">${t('is_none')}</div>`;
}

function reportLabel(type) { const r = REPORTS.find((x) => x.type === type); return r ? t(r.k) : type; }

function renderDashboard() {
  const r = S.result; if (!r) return;
  $('stCap').textContent = `${S.sc.peakCapKw} kW`;
  $('stPeak').textContent = `${clockLabel(S.sc.peakStartClock)} - ${clockLabel(S.sc.peakEndClock)}`;
  const f = r.plans.filter((p) => p.feasible).sort((a, b) => a.totalCostUsd - b.totalCostUsd)[0];
  $('stBest').textContent = f ? usd(f.totalCostUsd) : 'n/a';
  $('stSolve').textContent = `${r.solveMs < 10 ? r.solveMs.toFixed(1) : Math.round(r.solveMs)} ms`;
  document.querySelectorAll('#monTabs .mon-tab').forEach((b) => b.classList.toggle('on', b.dataset.chart === S.chart));
  drawMain();
}

function names() { return { A: t('name_A'), B: t('name_B'), C: t('name_C') }; }

function drawMain() {
  const r = S.result; if (!r) return;
  const titles = { power: 'mo_c1', cost: 'mo_c2', lines: 'mo_c3' };
  $('monTitle').textContent = t(titles[S.chart]);
  const focus = S.live?.planId || S.viewId;
  if (S.chart === 'power') charts.drawPower({ sc: S.sc, result: r, planId: focus, text: { baseline: t('ds_baseline'), selected: t('ds_selected', { plan: t('name_' + focus) }), cap: t('ds_cap') } });
  else if (S.chart === 'cost') charts.drawCost({ result: r, names: names(), baselineLabel: t('ds_baseline') });
  else {
    const p = r.plans.find((x) => x.id === focus && x.feasible) || r.plans.find((x) => x.feasible);
    if (p) charts.drawStacked({ key: 'main', canvasId: 'mainChart', labels: Array.from({ length: S.sc.hours }, (_, h) => slotLabel(S.sc, h)), series: p.lineKw, lineNames: lineNames() });
  }
}
const lineNames = () => Object.fromEntries(LINE_NAMES.map((l) => [l, pretty(l)]));

/* ------------------------------------------------------------ intake (Gemini) */
function fillSelects() {
  const opt = (v, l) => `<option value="${v}">${l}</option>`;
  $('fFrom').innerHTML = Array.from({ length: 10 }, (_, i) => opt(9 + i, clockLabel(9 + i))).join('');
  $('fTo').innerHTML = Array.from({ length: 10 }, (_, i) => opt(10 + i, clockLabel(10 + i))).join('');
  $('fOrder').innerHTML = ORDER_NAMES.map((o) => opt(o, pretty(o))).join('');
  $('rpLine').innerHTML = LINE_NAMES.map((l) => opt(l, pretty(l))).join('');
  writeFields(S.params);
}
function writeFields(p) {
  $('fCap').value = p.peakCapKw; $('fFrom').value = p.peakStartClock; $('fTo').value = p.peakEndClock; $('fOrder').value = p.delayedOrder; $('fDelay').value = p.delayHours;
}
function readFields() {
  return { peakCapKw: clamp(parseInt($('fCap').value, 10) || DEFAULTS.peakCapKw, 60, 400), peakStartClock: +$('fFrom').value, peakEndClock: +$('fTo').value, delayedOrder: $('fOrder').value, delayHours: clamp(parseInt($('fDelay').value, 10) || 0, 0, 9) };
}
function setIntake(key, kind, vars) { S.intake = { key, kind, vars }; renderIntakeStatus(); }
function renderIntakeStatus() {
  const el = $('inStatus'); const { key, kind, vars } = S.intake;
  el.className = `status ${kind || ''}`;
  el.textContent = key ? t(key, vars) : '';
}
function renderIntakeMeta() {
  const x = S.extraction; const box = $('inResult');
  if (!x) { box.hidden = true; return; }
  const warn = x.warnings.map((w) => `<li>${t('in_w_' + w)}</li>`).join('');
  box.hidden = false;
  box.innerHTML = `<div><b>${t('in_conf')}:</b> <span class="conf ${x.confidence}">${t('in_conf_' + x.confidence)}</span> <span class="muted">${t('in_ms', { ms: x.ms, cached: x.cached ? t('in_cached') : '' })}</span></div>
    ${x.evidence ? `<div><b>${t('in_evidence')}:</b> <q>${esc(x.evidence)}</q></div>` : ''}
    ${x.note ? `<div><b>${t('in_note')}:</b> ${esc(x.note)}</div>` : ''}
    ${warn ? `<ul class="warn">${warn}</ul>` : ''}`;
}

async function onRead() {
  const text = $('noticeText').value.trim();
  const file = $('noticePhoto').files[0];
  if (!text && !file) return;
  $('btnRead').disabled = true;
  setIntake('in_reading', 'busy');
  try {
    const res = await extractCrisis({ text, file });
    S.extraction = res;
    const merged = { ...readFields() };
    for (const [k, v] of Object.entries(res.values)) if (v !== null) merged[k] = v;
    writeFields(merged);
    setIntake('in_review', 'ok');
  } catch (err) {
    setIntake(err.code === 'off' ? 'in_hint_off' : `in_err_${err.code || 'error'}`, 'err');
  }
  $('btnRead').disabled = false;
  renderIntakeMeta(); renderChips();
}

async function onApply() {
  const p = readFields();
  if (p.peakStartClock >= p.peakEndClock) { setIntake('in_w_windowInvalid', 'err'); return; }
  S.params = p;
  if (S.live?.planId) await S.sync?.reset();
  recompute();
  setIntake('in_applied', 'ok');
  $('plans-area').scrollIntoView({ behavior: 'smooth' });
}

/* ------------------------------------------------------------ approve / ask */
function approve(id) {
  const p = S.result.plans.find((x) => x.id === id); const sc = S.sc;
  if (!p?.feasible || !S.sync) return;
  S.sync.approve({
    planId: id, label: PLAN_EN[id], schedule: p.schedule, hours: sc.hours, startHour: sc.startHour, peakHours: sc.peakHours,
    peakCapKw: sc.peakCapKw, peakStartClock: sc.peakStartClock, peakEndClock: sc.peakEndClock, totalCostUsd: p.totalCostUsd,
    deadlineStatus: p.deadlineStatus, linePower: Object.fromEntries(Object.entries(sc.lines).map(([l, v]) => [l, v.powerKw])),
  });
}

function openAsk(id) {
  S.askId = id; $('askInput').value = ''; $('askAnswer').hidden = true; $('askModal').hidden = false; $('askInput').focus();
}
async function doAsk() {
  const q = $('askInput').value.trim(); if (!q) return;
  const box = $('askAnswer'); box.hidden = false; box.textContent = t('as_wait');
  try {
    const payload = { ...buildPlanPayload(S.sc, S.result), questionIsAboutPlan: PLAN_EN[S.askId] };
    const res = await askWhy({ payload, question: q, lang: getLang() });
    const badge = res.unverified.length ? `<span class="vbadge bad">${t('pl_ai_bad', { nums: res.unverified.join(', ') })}</span>` : `<span class="vbadge ok">${t('pl_ai_ok')}</span>`;
    box.innerHTML = `${esc(res.text)} ${badge}`;
  } catch (err) {
    box.textContent = err.code === 'off' ? t('in_hint_off') : t('in_err_' + (err.code || 'error'));
  }
  renderChips();
}

/* ------------------------------------------------------------ line display */
function renderLine() {
  const live = S.live; const wait = !live?.planId;
  const st = $('lineStatus');
  st.className = `lstatus ${wait ? 'wait' : 'ok'}`;
  st.innerHTML = wait
    ? `<div class="ls-i">${ICON.hourglass('#c77900')}</div><div class="ls-t">${t('ln_wait_h')}</div><div class="ls-s">${t('ln_wait_s')}</div>`
    : `<div class="ls-i">${ICON.check('#0b8043')}</div><div class="ls-t">${t('ln_act_h')}</div><div class="ls-s">${t('name_' + live.planId)}</div>`;
  $('lineBoard').hidden = wait;
  if (wait) { renderLineSide(); return; }

  const times = Array.from({ length: live.hours }, (_, h) => `<div class="tm">${slotLabel(live, h)}</div>`).join('');
  const rows = Object.keys(live.schedule).map((line) => {
    const cells = Array.from({ length: live.hours }, (_, h) => {
      const run = live.schedule[line].includes(h); const peak = live.peakHours.includes(h);
      return `<div class="cell ${run ? 'run' : 'idle'} ${peak ? 'peak' : ''}">${run ? ICON.bolt('#fff') : ''}</div>`;
    }).join('');
    return `<div class="bname">${pretty(line)}</div>${cells}`;
  }).join('');
  const cols = `grid-template-columns:96px repeat(${live.hours},minmax(0,1fr))`;
  $('lineGrid').innerHTML = `<div class="brow" style="${cols}"><div></div>${times}</div><div class="brow rows" style="${cols}">${rows}</div>`;
  $('lineLegend').innerHTML = `<span><i class="sw run"></i>${t('ln_run')}</span><span><i class="sw idle"></i>${t('ln_idle')}</span><span><i class="sw peakmark"></i>${t('ln_peak', { cap: live.peakCapKw, from: clockLabel(live.peakStartClock), to: clockLabel(live.peakEndClock) })}</span>`;
  $('iconCards').innerHTML = [
    ['plug', '#e53935', 'ic_low', t('ic_low_d', { cap: live.peakCapKw })], ['swap', '#1a73e8', 'ic_shift', t('ic_shift_d')],
    ['clock', '#0b8043', 'ic_sched', t('ic_sched_d')], ['alert', '#c77900', 'ic_safe', t('ic_safe_d')],
  ].map(([i, c, k, d]) => `<div class="ic">${ICON[i](c)}<div class="il">${t(k)}</div><div class="id">${d}</div></div>`).join('');
  const acked = S.ackedAt === live.approvedAtMs;
  $('btnAck').disabled = acked; $('ackToast').classList.toggle('show', acked);
  renderLineSide();
}

function renderLineSide() {
  const live = S.live; const box = $('lnStats');
  if (!live?.planId) { box.innerHTML = `<div class="dash-stat"><div class="ds-n muted">-</div></div>`; charts.drawStacked({ key: 'line', canvasId: 'lineChart', labels: [], series: {}, lineNames: {} }); return; }
  const series = {};
  for (const [line, hrs] of Object.entries(live.schedule)) series[line] = Array.from({ length: live.hours }, (_, h) => (hrs.includes(h) ? live.linePower[line] : 0));
  const loads = Array.from({ length: live.hours }, (_, h) => Object.values(series).reduce((s, a) => s + a[h], 0));
  const peakLoad = Math.max(...live.peakHours.map((h) => loads[h]), 0);
  charts.drawStacked({ key: 'line', canvasId: 'lineChart', labels: Array.from({ length: live.hours }, (_, h) => slotLabel(live, h)), series, lineNames: lineNames() });
  box.innerHTML = `<div class="dash-stat"><div class="ds-l">${t('ln_s1')}</div><div class="ds-n green">${usd(live.totalCostUsd)}</div></div>
    <div class="dash-stat"><div class="ds-l">${t('ln_s2')}</div><div class="ds-n amber">${peakLoad} kW</div></div>
    <div class="dash-stat"><div class="ds-l">${t('ln_s3')}</div><div class="ds-n red">${live.peakCapKw} kW</div></div>`;
}

/* ------------------------------------------------------------ report panel */
function renderReport() {
  $('rpButtons').innerHTML = REPORTS.map((r) => `<button class="rb" data-rp="${r.type}">${ICON[r.icon](r.color)}<div class="rl">${t(r.k)}</div><div class="rs">${t(r.ks)}</div></button>`).join('');
  const reports = S.events.filter((e) => e.kind === 'report');
  $('rpList').innerHTML = reports.length ? reports.slice(0, 8).map((e) => `<div class="lr"><span class="lt">${time(e.tsMs)}</span>${esc(reportLabel(e.type))} <b>${esc(pretty(e.line || ''))}</b></div>`).join('') : `<div class="lr muted">${t('rp_none')}</div>`;
  const counts = REPORTS.map((r) => reports.filter((e) => e.type === r.type).length);
  const top = counts.some((c) => c > 0) ? t(REPORTS[counts.indexOf(Math.max(...counts))].k) : '-';
  $('rpStats').innerHTML = `<div class="dash-stat"><div class="ds-l">${t('rp_s1')}</div><div class="ds-n">${reports.length}</div></div>
    <div class="dash-stat"><div class="ds-l">${t('rp_s2')}</div><div class="ds-n green">${S.events.filter((e) => e.kind === 'ack').length}</div></div>
    <div class="dash-stat"><div class="ds-l">${t('rp_s3')}</div><div class="ds-n amber small">${esc(top)}</div></div>`;
  charts.drawIssues({ labels: REPORTS.map((r) => t(r.k)), counts });
}

async function sendReport(type) {
  if (!S.sync) return;
  await S.sync.event({ kind: 'report', type, label: type, line: $('rpLine').value });
  const el = $('rpToast'); el.textContent = t('rp_sent', { label: reportLabel(type), line: pretty($('rpLine').value) });
  el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500);
}

/* ------------------------------------------------------------ chrome */
function renderChips() {
  const g = $('chipGem');
  g.textContent = gemini.status === 'off' ? t('gm_off') : gemini.status === 'error' ? t('gm_err') : t('gm_ready');
  g.className = `chip ${gemini.status === 'off' ? 'off' : gemini.status === 'error' ? 'bad' : 'on'}`;
  const s = $('chipSync');
  s.textContent = S.sync ? (S.sync.mode === 'firestore' ? t('sy_fs') : t('sy_local')) : '';
  s.className = `chip ${S.sync?.mode === 'firestore' ? 'on' : 'off'}`;
}

function showTab(id) {
  S.tab = id;
  for (const k of ['mgr', 'line', 'rpt']) $(`v-${k}`).hidden = k !== id;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.t === id));
  window.scrollTo({ top: 0 });
  if (id === 'mgr') drawMain();
  if (id === 'line') renderLine();
  if (id === 'rpt') renderReport();
}

function renderAll() {
  applyI18n(document);
  if (S.result) renderManager();
  renderLine(); renderReport(); renderIntakeStatus(); renderIntakeMeta(); renderChips();
  if (S.tab === 'mgr') drawMain();
}

function playSiren() {
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
  const c = new Ctx(); const o = c.createOscillator(); const g = c.createGain();
  o.connect(g); g.connect(c.destination); o.type = 'sawtooth';
  [[400, 0], [800, 0.5], [400, 1], [800, 1.5]].forEach(([f, at]) => o.frequency.linearRampToValueAtTime(f, c.currentTime + at));
  g.gain.setValueAtTime(0.25, c.currentTime); g.gain.linearRampToValueAtTime(0, c.currentTime + 2);
  o.start(); o.stop(c.currentTime + 2);
}

/* ------------------------------------------------------------ events */
function bind() {
  document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.t); }));
  document.querySelectorAll('#langPick button').forEach((b) => b.addEventListener('click', () => {
    setLang(b.dataset.lang);
    document.querySelectorAll('#langPick button').forEach((x) => x.classList.toggle('on', x === b));
    document.documentElement.lang = b.dataset.lang;
    renderAll();
    if (gemini.status !== 'off') runExplain();
  }));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { showTab('mgr'); $(b.dataset.go).scrollIntoView({ behavior: 'smooth' }); }));
  $('howTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-how]'); if (b) { S.how = b.dataset.how; renderHow(); } });
  $('monTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-chart]'); if (b) { S.chart = b.dataset.chart; renderDashboard(); } });
  $('pG').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    if (b.dataset.act === 'approve') approve(b.dataset.id); else openAsk(b.dataset.id);
  });
  $('rpButtons').addEventListener('click', (e) => { const b = e.target.closest('[data-rp]'); if (b) sendReport(b.dataset.rp); });
  $('btnSample').addEventListener('click', () => { $('noticeText').value = SAMPLE_NOTICE; });
  $('noticePhoto').addEventListener('change', (e) => { $('photoName').textContent = e.target.files[0]?.name || ''; });
  $('btnRead').addEventListener('click', onRead);
  $('btnApply').addEventListener('click', onApply);
  $('btnReset').addEventListener('click', async () => { S.ackedAt = 0; await S.sync?.reset(); });
  $('btnAck').addEventListener('click', async () => { if (!S.live?.planId) return; S.ackedAt = S.live.approvedAtMs; await S.sync.event({ kind: 'ack', type: 'ack', label: 'ack', line: 'all' }); renderLine(); });
  $('sirenBtn').addEventListener('click', playSiren);
  $('askGo').addEventListener('click', doAsk);
  $('askCancel').addEventListener('click', () => { $('askModal').hidden = true; });
  $('askModal').addEventListener('click', (e) => { if (e.target.id === 'askModal') $('askModal').hidden = true; });
  $('askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAsk(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('askModal').hidden = true; });
}

async function init() {
  $('noticeText').value = SAMPLE_NOTICE;
  fillSelects();
  bind();
  applyI18n(document);
  recompute();
  renderLine(); renderReport();
  S.sync = await createSync({
    onState: (d) => { S.live = d; renderPlans(); renderLogs(); renderLine(); drawMain(); },
    onEvents: (e) => { S.events = e; renderLogs(); renderReport(); },
  });
  renderChips();
}

init();
