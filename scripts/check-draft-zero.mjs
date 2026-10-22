#!/usr/bin/env node
// check-draft-zero.mjs — the srmw-site check (bead es-9qj).
// Fails (exit 1) when Draft Zero's data or pages would break the live site:
//   1. draft-zero/entries.json must parse and match the schema the page reads
//      (a malformed file blanks the counters, strip, chart and entries).
//   2. every inline <script> in the checked pages must parse.
//   3. every page must carry the same-origin feedback chip (SOMA standard §8),
//      through soma-chip-loader.js or the direct script, with the vendored fallback present.
// Usage: node scripts/check-draft-zero.mjs [entries.json]   (the argument is for the self-test)
import { existsSync, readFileSync } from 'node:fs';

const problems = [];
const fail = (m) => problems.push(m);

const entriesPath = process.argv[2] || 'draft-zero/entries.json';
let data;
try { data = JSON.parse(readFileSync(entriesPath, 'utf8')); }
catch (e) { fail(`${entriesPath}: not valid JSON (${e.message})`); }

if (data) {
  if (!Array.isArray(data.entries)) fail(`${entriesPath}: "entries" must be an array`);
  const seen = new Set();
  for (const [i, e] of (data.entries || []).entries()) {
    const at = `${entriesPath} entries[${i}]`;
    if (!Number.isInteger(e.day) || e.day < 1 || e.day > 31) fail(`${at}: day must be an integer 1-31`);
    if (seen.has(e.day)) fail(`${at}: day ${e.day} appears twice`);
    seen.add(e.day);
    const want = `2026-10-${String(e.day).padStart(2, '0')}`;
    if (e.date !== want) fail(`${at}: date must be ${want} for day ${e.day} (got ${e.date})`);
    if (!/^2026-1[01]-\d{2}$/.test(e.foretells || '')) fail(`${at}: foretells must be a date like 2026-11-01`);
    if (typeof e.title !== 'string' || !e.title.trim()) fail(`${at}: title is empty`);
    if (!Array.isArray(e.paragraphs) || !e.paragraphs.length) fail(`${at}: paragraphs must be a non-empty array`);
    for (const [j, p] of (e.paragraphs || []).entries()) {
      const pa = `${at}.paragraphs[${j}]`;
      if (p.kind !== 'human' && p.kind !== 'ai') fail(`${pa}: kind must be "human" or "ai"`);
      if (typeof p.writer !== 'string' || !p.writer.trim()) fail(`${pa}: writer is empty`);
      if (p.kind === 'ai' && (typeof p.model !== 'string' || !p.model.trim())) fail(`${pa}: an ai paragraph must name its model`);
      if (typeof p.text !== 'string' || !p.text.trim()) fail(`${pa}: text is empty`);
    }
  }
}

for (const page of ['index.html', 'draft-zero/index.html', 'ai/index.html']) {
  const html = readFileSync(page, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((js, k) => {
    try { new Function(js); } catch (e) { fail(`${page}: inline script ${k + 1} does not parse (${e.message})`); }
  });
  // Since 2026-10-21 (pm-8e8a) the chip loads through soma-chip-loader.js, which
  // pulls the chip from the central host and falls back to the vendored copy.
  // Either the loader or the older direct script/stylesheet pair passes.
  const loader = /src="\/vendor\/soma-feedback\/soma-chip-loader\.js"[\s\S]*?data-endpoint="\/\.netlify\/functions\/soma-feedback"/.test(html);
  const direct = html.includes('href="/vendor/soma-feedback/soma-feedback.css"')
    && /src="\/vendor\/soma-feedback\/soma-feedback\.js"[\s\S]*?data-endpoint="\/\.netlify\/functions\/soma-feedback"/.test(html);
  if (!loader && !direct) fail(`${page}: feedback chip (loader or script) or its same-origin endpoint is missing`);
}

// The loader's fallback is the vendored chip, so its files must stay in the repo.
for (const f of ['soma-chip-loader.js', 'soma-feedback.js', 'soma-feedback.css']) {
  if (!existsSync(`vendor/soma-feedback/${f}`)) fail(`vendor/soma-feedback/${f} missing (the chip's fallback)`);
}

if (problems.length) {
  console.error(`check-draft-zero: FAIL (${problems.length})\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`check-draft-zero: PASS (${data.entries.length} entries)`);
