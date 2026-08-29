// scripts/audit/row-at-a-time-writes.ts
//
// Every `.insert(` / `.update(` / `.upsert(` / `.rpc(` that sits inside a
// `for`, `for…of`, `for await…of`, `while`, `.map(`, or `.forEach(` — the
// shape docs/context/11-performance-patterns.md §12 documents fixing once
// already: Attendance Submit wrote every roster row in a serial loop (insert
// + rollup + audit, per student — "3N sequential round-trips, about 90 for a
// class of 30"), replaced by `writeDailyBatch`'s one insert + bounded-
// concurrency waves. `app/api/relief/book/route.ts` still has one today,
// documented in its own header as a deliberate, stated cost (no multi-
// statement transaction over PostgREST) — this script's job is to make sure
// that is a decision someone made on purpose everywhere it appears, not a
// pattern nobody counted.
//
// STATIC TEXT SCAN. No DB credentials, no network. Exits 0 always. Biased
// toward OVER-reporting: a write inside a loop that only ever runs 0 or 1
// times in practice still gets flagged, because that is not something this
// scanner can know from source text — a human classifies it against the
// actual bound (Hard Rule #5's 50-student roster cap, a fixed 4-term loop,
// etc.), same discipline as `__tests__/data/no-unpaginated-high-volume-reads.test.ts`'s
// allowlist.
//
// APPROXIMATION: a loop/map/forEach's "body" is taken to be the region from
// right after its opening `{` (or, for a braceless arrow body used with
// `.map()`/`.forEach()`, right after its `=>`) through the matching `}` (or,
// braceless, through the matching `)` that closes the `.map(`/`.forEach(`
// call itself). Every write-verb call whose position falls inside at least
// one such region is reported once, naming every loop kind it is nested
// inside (innermost first) rather than being reported once per enclosing loop.
//
// Run:
//   npx tsx scripts/audit/row-at-a-time-writes.ts

import { join } from 'node:path';
import {
  REPO_ROOT,
  findMatchingBrace,
  findMatchingParen,
  lineAt,
  maskNoise,
  printFooter,
  printHeader,
  readSource,
  relative,
  walk,
} from './_shared';

type LoopWindow = {
  kind: string;
  start: number;
  end: number;
};

type WriteHit = {
  file: string;
  line: number;
  verb: string;
  enclosing: string[];
};

/** Every `for(`, `for await(`, `while(`, `.map(`, `.forEach(` region in the
 * masked source, as a [start, end) body window. */
function findLoopWindows(masked: string): LoopWindow[] {
  const windows: LoopWindow[] = [];

  for (const kind of ['for', 'while']) {
    // `for await (` or `for (` / `while (` — allow the optional `await`.
    const re = new RegExp(`\\b${kind}\\s*(?:await\\s*)?\\(`, 'g');
    for (const m of masked.matchAll(re)) {
      const headOpen = m.index! + m[0].length - 1;
      const headClose = findMatchingParen(masked, headOpen);
      // Body: `{ ... }` immediately after the header, or (rare, single
      // statement) up to the next `;` — this scanner only needs to catch the
      // common braced form; a braceless single-statement loop body would
      // itself have to contain a full `.insert(` etc. chain on one line to
      // matter, which findMatchingParen-based detection below still can spot
      // if the brace search below simply finds none and the caller skips it
      // (safe: an unbodied match here never widens the window incorrectly).
      let i = headClose + 1;
      while (i < masked.length && /\s/.test(masked[i])) i++;
      if (masked[i] === '{') {
        const bodyClose = findMatchingBrace(masked, i);
        windows.push({ kind, start: i, end: bodyClose });
      }
    }
  }

  for (const kind of ['map', 'forEach']) {
    const marker = `.${kind}(`;
    let at = masked.indexOf(marker);
    while (at !== -1) {
      const openParen = at + marker.length - 1;
      const closeParen = findMatchingParen(masked, openParen);
      // Find the arrow `=>` inside the callback header, then decide braced
      // vs. braceless body.
      const arrowAt = masked.indexOf('=>', openParen);
      if (arrowAt !== -1 && arrowAt < closeParen) {
        let i = arrowAt + 2;
        while (i < masked.length && /\s/.test(masked[i])) i++;
        if (masked[i] === '{') {
          const bodyClose = findMatchingBrace(masked, i);
          windows.push({ kind: `.${kind}()`, start: i, end: bodyClose });
        } else {
          // Braceless expression body — everything up to the call's own
          // closing paren is the body.
          windows.push({ kind: `.${kind}()`, start: i, end: closeParen });
        }
      }
      at = masked.indexOf(marker, at + marker.length);
    }
  }

  return windows;
}

function scanFile(file: string): WriteHit[] {
  const source = readSource(file);
  const masked = maskNoise(source);
  const windows = findLoopWindows(masked);
  const hits: WriteHit[] = [];

  for (const verb of ['insert', 'update', 'upsert', 'rpc']) {
    const marker = `.${verb}(`;
    let at = masked.indexOf(marker);
    while (at !== -1) {
      const enclosing = windows
        .filter((w) => at >= w.start && at < w.end)
        // Innermost first — the smallest window is the most specific.
        .sort((a, b) => a.end - a.start - (b.end - b.start))
        .map((w) => w.kind);
      if (enclosing.length > 0) {
        hits.push({
          file: relative(file),
          line: lineAt(source, at),
          verb,
          enclosing,
        });
      }
      at = masked.indexOf(marker, at + marker.length);
    }
  }

  return hits;
}

function main() {
  printHeader('ROW-AT-A-TIME WRITES — insert/update/upsert/rpc inside a loop');

  const files = [
    ...walk(join(REPO_ROOT, 'lib'), ['.ts', '.tsx']),
    ...walk(join(REPO_ROOT, 'app'), ['.ts', '.tsx']),
  ];

  const allHits = files.flatMap(scanFile);

  for (const h of allHits) {
    console.log(
      `${h.file}:${h.line} — .${h.verb}(...) inside ${h.enclosing.join(' > ')}`
    );
  }

  printFooter(allHits.length, 'write(s) inside a loop');
  console.log(
    "Classify each: a bounded loop (Hard Rule #5's 50-row roster cap, a fixed " +
      '4-term walk) may be a deliberate, acceptable cost — an unbounded one ' +
      '(a school-wide sync, an import) is the shape worth fixing.\n'
  );
}

main();
