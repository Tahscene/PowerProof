import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DICTIONARY } from '../public/js/i18n.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../public/index.html');
const app = read('../public/js/app.js');

// every key the page or the code asks for
const used = new Set();
for (const m of html.matchAll(/data-i(?:-ph|-title)?="([a-z0-9_]+)"/g)) used.add(m[1]);
for (const m of app.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/['"`]((?:hw_[mw]\d|rp_[a-z_]+|ic_[a-z_]+|lg_[a-z_]+|mo_c\d|in_(?:reading|review|applied|hint_off)))['"`]/g)) used.add(m[1]);
for (const m of app.matchAll(/\[\s*'(?:\w+)',\s*'#[0-9a-f]+',\s*'(\w+)'/g)) used.add(m[1]);
for (const id of ['A', 'B', 'C']) for (const p of ['name_', 'sum_', 'tag_']) used.add(p + id);
for (const c of ['appcheck', 'quota', 'timeout', 'error']) used.add('in_err_' + c);
for (const c of ['high', 'medium', 'low']) used.add('in_conf_' + c);
for (const w of ['capMissing', 'capOutOfRange', 'windowInvalid', 'orderUnknown', 'delayOutOfRange']) used.add('in_w_' + w);
for (const r of ['rp_m', 'rp_d', 'rp_q', 'rp_help']) { used.add(r); used.add(r + '_s'); }
used.delete('in_conf_'); used.delete('in_err_'); used.delete('in_w_'); used.delete('name_'); used.delete('sum_'); used.delete('tag_');

let n = 0;
for (const lang of Object.keys(DICTIONARY)) {
  for (const key of used) { assert.ok(DICTIONARY[lang][key], `${lang} is missing "${key}"`); n++; }
}
assert.deepEqual(Object.keys(DICTIONARY.hi).sort(), Object.keys(DICTIONARY.en).sort(), 'hi has different keys than en');
assert.deepEqual(Object.keys(DICTIONARY.bn).sort(), Object.keys(DICTIONARY.en).sort(), 'bn has different keys than en');

// {placeholders} must match across languages
for (const key of Object.keys(DICTIONARY.en)) {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const lang of ['hi', 'bn']) assert.equal(ph(DICTIONARY[lang][key]), ph(DICTIONARY.en[key]), `${lang}.${key} placeholders differ`);
}
// no long dashes anywhere in user-facing text
for (const lang of Object.keys(DICTIONARY)) for (const [k, v] of Object.entries(DICTIONARY[lang])) assert.ok(!/[\u2014\u2013]/.test(v), `${lang}.${k} has a long dash`);

console.log(`  ok  ${used.size} keys used by the UI, present in en/hi/bn (${n} lookups), placeholders consistent, no long dashes`);
console.log('\n1 i18n test passed');
