/**
 * Gemini through Firebase AI Logic (no API key in this code base).
 *
 * Gemini does three language jobs here and nothing else:
 *   1. extractCrisis : read a messy notice (text or photo) -> structured parameters
 *   2. explainPlans  : explain numbers the solver already computed
 *   3. askWhy        : answer a manager's question using only those numbers
 * Every output is checked by guards.js before the UI trusts it.
 */
import { getFirebase, loadModule, isConfigured } from './firebase.js';
import { GEMINI_MODEL } from '../firebase-config.js';
import { parseJsonLoose, sanitizeExtraction, findUnverifiedNumbers } from './guards.js';
import { clockLabel, slotLabel, savingsPct } from './solver.js';

const LANGUAGE_NAME = { en: 'English', hi: 'Hindi', bn: 'Bangla (Bengali)' };
const TIMEOUT_MS = 25000;
const CACHE_PREFIX = 'pp_gemini_';

export const gemini = { status: isConfigured() ? 'idle' : 'off', lastMs: null, lastCached: false, lastError: null };

let aiPromise = null;
async function getAiModule() {
  if (!aiPromise) {
    aiPromise = (async () => {
      const fb = await getFirebase();
      if (!fb) return null;
      const mod = await loadModule('firebase-ai.js');
      return { mod, ai: mod.getAI(fb.app, { backend: new mod.GoogleAIBackend() }) };
    })().catch((e) => { aiPromise = null; throw e; });
  }
  return aiPromise;
}

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

function classify(err) {
  const m = String(err?.message || err);
  if (/app.?check|permission_denied|403/i.test(m)) return 'appcheck';
  if (/429|quota|resource_exhausted/i.test(m)) return 'quota';
  if (/timeout/i.test(m)) return 'timeout';
  return 'error';
}

async function call({ system, parts, json, cacheKey }) {
  const key = CACHE_PREFIX + hash(GEMINI_MODEL + system + cacheKey);
  const hit = localStorage.getItem(key);
  if (hit) { gemini.lastMs = 0; gemini.lastCached = true; gemini.status = 'ready'; return { text: hit, cached: true, ms: 0 }; }
  const g = await getAiModule();
  if (!g) { gemini.status = 'off'; throw Object.assign(new Error('not configured'), { code: 'off' }); }
  const model = g.mod.getGenerativeModel(g.ai, {
    model: GEMINI_MODEL,
    systemInstruction: system,
    generationConfig: { temperature: 0, ...(json ? { responseMimeType: 'application/json' } : {}) },
  });
  const t0 = performance.now();
  try {
    const result = await Promise.race([
      model.generateContent(parts),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
    const text = result.response.text();
    const ms = Math.round(performance.now() - t0);
    try { localStorage.setItem(key, text); } catch { /* storage full: ignore */ }
    Object.assign(gemini, { status: 'ready', lastMs: ms, lastCached: false, lastError: null });
    return { text, cached: false, ms };
  } catch (err) {
    const code = classify(err);
    Object.assign(gemini, { status: 'error', lastError: code });
    throw Object.assign(new Error(String(err?.message || err)), { code });
  }
}

const fileToPart = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error('read failed'));
  r.onloadend = () => resolve({ inlineData: { data: String(r.result).split(',')[1], mimeType: file.type || 'image/jpeg' } });
  r.readAsDataURL(file);
});

/* ---------- 1. crisis notice -> parameters ---------- */
const EXTRACT_SYSTEM = `You extract structured parameters from a factory crisis notice (email text and/or a photo of a notice).
Return JSON only, with exactly these keys:
{"powerCapKw": number|null, "restrictionStartHour24": integer 0-23|null, "restrictionEndHour24": integer 1-24|null,
 "delayedOrder": "Order_1"|"Order_2"|"Order_3"|null, "delayHours": number|null,
 "confidence": "high"|"medium"|"low", "uncertaintyNote": string, "evidence": string}
Rules: never guess. If a value is not stated, use null. Convert 12-hour times to 24-hour. "Order 1" means "Order_1".
If a delay is given in days or is vague, set delayHours to null and explain in uncertaintyNote.
"evidence" must quote the exact words of the notice that support the numbers.`;

export async function extractCrisis({ text, file }) {
  const parts = [`Crisis notice:\n${text || '(see attached image)'}`];
  if (file) {
    if (file.size > 4 * 1024 * 1024) throw Object.assign(new Error('image too large'), { code: 'error' });
    parts.push(await fileToPart(file));
  }
  const res = await call({ system: EXTRACT_SYSTEM, parts, json: true, cacheKey: `${text}|${file ? file.name + file.size : ''}` });
  return { ...sanitizeExtraction(parseJsonLoose(res.text)), ms: res.ms, cached: res.cached };
}

/* ---------- data handed to Gemini: solver output only ---------- */
const PLAN_NAME = { A: 'Cost Saver', B: 'Deadline Protector', C: 'Balanced' };

export function buildPlanPayload(sc, result) {
  const base = result.baseline.totalCostUsd;
  const peakLen = sc.peakHours.length;
  return {
    restrictionWindow: `${clockLabel(sc.peakStartClock)} to ${clockLabel(sc.peakEndClock)}`,
    restrictionHours: peakLen,
    powerCapKw: sc.peakCapKw,
    baselineCostUsd: base,
    baselineHoursOverCap: result.baseline.overCapHours,
    plans: result.plans.map((p) => (!p.feasible ? { id: p.id, name: PLAN_NAME[p.id], feasible: false } : {
      id: p.id,
      name: PLAN_NAME[p.id],
      feasible: true,
      totalCostUsd: p.totalCostUsd,
      savingsVsBaselineUsd: Math.round((base - p.totalCostUsd) * 100) / 100,
      savingsPercent: savingsPct(base, p.totalCostUsd),
      ordersOnTime: Object.entries(p.deadlineStatus).filter(([, s]) => s === 'on_time').map(([o]) => o),
      ordersAtRisk: Object.entries(p.deadlineStatus).filter(([, s]) => s === 'at_risk').map(([o]) => o),
      linesFinishBy: Object.fromEntries(Object.entries(p.finishHour).map(([l, h]) => [l, clockLabel(sc.startHour + h + 1)])),
      hoursRunInsideRestriction: sc.peakHours.filter((h) => p.hourlyKw[h] > 0).length,
    })),
  };
}

const EXPLAIN_RULES = `You are the explanation layer of PowerProof, a factory crisis planning tool.
A deterministic solver already computed every number in the data. Use ONLY numbers that appear in the data.
Never calculate, round, estimate or invent a figure. If a plan has orders at risk, say so plainly.`;

/* ---------- 2. explain the plans ---------- */
export async function explainPlans({ payload, lang }) {
  const system = `${EXPLAIN_RULES}
Explain each plan to a factory manager in at most 2 short sentences. Write in ${LANGUAGE_NAME[lang] || 'English'}.
Return JSON only: {"A": "...", "B": "...", "C": "..."}`;
  const data = JSON.stringify(payload);
  const res = await call({ system, parts: [`Data:\n${data}`], json: true, cacheKey: data + lang });
  const obj = parseJsonLoose(res.text);
  const out = {};
  for (const id of ['A', 'B', 'C']) {
    const text = String(obj[id] ?? '');
    out[id] = { text, unverified: findUnverifiedNumbers(text, data) };
  }
  return { explanations: out, ms: res.ms, cached: res.cached };
}

/* ---------- 3. answer a manager's question ---------- */
export async function askWhy({ payload, question, lang }) {
  const system = `${EXPLAIN_RULES}
Answer the manager's question in at most 3 sentences, in ${LANGUAGE_NAME[lang] || 'English'}, using only the data.
If the data cannot answer the question, say that clearly. Return plain text.`;
  const data = JSON.stringify(payload);
  const res = await call({ system, parts: [`Data:\n${data}\n\nQuestion: ${question}`], json: false, cacheKey: data + question + lang });
  return { text: res.text.trim(), unverified: findUnverifiedNumbers(res.text, data), ms: res.ms, cached: res.cached };
}
