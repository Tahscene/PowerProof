/**
 * Deterministic guards around Gemini. Pure functions, unit-tested in Node.
 * Rule of the system: Gemini may read text and write text, but nothing it says
 * reaches the solver or the UI as a "fact" without passing through here first.
 */
import { ORDER_NAMES } from './solver.js';

/** Bengali and Devanagari digits -> ASCII, so numbers in any UI language can be checked. */
export function normalizeDigits(s) {
  return String(s)
    .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[\u09E6-\u09EF]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

export function numbersIn(text) {
  const clean = normalizeDigits(text).replace(/(\d),(?=\d{3}\b)/g, '$1');
  return (clean.match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

/**
 * Numbers that appear in `answer` but not in the data the solver produced.
 * A whole number is accepted if it is a rounding of an allowed decimal (56.1 -> 56).
 */
export function findUnverifiedNumbers(answer, allowedSource) {
  const allowed = numbersIn(typeof allowedSource === 'string' ? allowedSource : JSON.stringify(allowedSource));
  const bad = new Set();
  for (const n of numbersIn(answer)) {
    const ok = allowed.some((a) => Math.abs(a - n) < 0.0051 || (Number.isInteger(n) && Math.round(a) === n));
    if (!ok) bad.add(n);
  }
  return [...bad];
}

export function parseJsonLoose(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(t);
}

const int = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));

/**
 * Validate what Gemini extracted before it is allowed to change the schedule.
 * Anything out of range becomes null and produces a warning for the manager.
 */
export function sanitizeExtraction(raw) {
  const warnings = [];
  const out = { peakCapKw: null, peakStartClock: null, peakEndClock: null, delayedOrder: null, delayHours: null };

  const cap = int(raw?.powerCapKw);
  if (cap !== null && cap >= 60 && cap <= 400) out.peakCapKw = cap;
  else if (cap !== null) warnings.push('capOutOfRange');

  const s = int(raw?.restrictionStartHour24);
  const e = int(raw?.restrictionEndHour24);
  if (s !== null && e !== null && s >= 0 && s <= 23 && e >= 1 && e <= 24 && s < e) { out.peakStartClock = s; out.peakEndClock = e; }
  else if (s !== null || e !== null) warnings.push('windowInvalid');

  if (raw?.delayedOrder != null) {
    const m = String(raw.delayedOrder).match(/(\d+)/);
    const name = m ? `Order_${m[1]}` : null;
    if (name && ORDER_NAMES.includes(name)) out.delayedOrder = name; else warnings.push('orderUnknown');
  }
  const d = int(raw?.delayHours);
  if (d !== null && d >= 0 && d <= 9) out.delayHours = d;
  else if (d !== null) warnings.push('delayOutOfRange');

  if (out.peakCapKw === null) warnings.push('capMissing');
  const conf = ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'low';
  return {
    values: out,
    warnings,
    confidence: warnings.length && conf === 'high' ? 'medium' : conf,
    note: typeof raw?.uncertaintyNote === 'string' ? raw.uncertaintyNote.slice(0, 400) : '',
    evidence: typeof raw?.evidence === 'string' ? raw.evidence.slice(0, 500) : '',
  };
}
