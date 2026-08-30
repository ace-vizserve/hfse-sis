// scripts/audit/cache-tags.ts
//
// Every `unstable_cache(...)` call site in the app, with three questions
// answered per site:
//
//   1. What tags does it emit?
//   2. Does any tag interpolate something that LOOKS like a raw id/uuid,
//      rather than a stable code? `lib/markbook/overview-data.ts` did exactly
//      this — it tagged `markbook:${academicYearId}` (a uuid) while every
//      invalidator in lib/cache/invalidate-drill-tags.ts calls
//      `invalidateDrillTags('markbook', ayCode)`, which busts `markbook:AY2026`.
//      The two strings never matched, so that cache entry was NEVER busted by
//      a write — only by its own TTL. One character of naming drift, invisible
//      in review, silently wrong for as long as the TTL allowed.
//      __tests__/cache/write-route-invalidation.test.ts now pins this specific
//      case; this script is the exhaustive version — every call site, not the
//      one that already bit.
//   3. For a tag with a `prefix:` shape, is that prefix one
//      `invalidateDrillTags` can actually produce? A tag whose prefix appears
//      nowhere in lib/cache/invalidate-drill-tags.ts is either busted some
//      OTHER way (a direct `revalidateTag` call, a `revalidatePath`) or is
//      never busted at all except by TTL — either is worth a human's eyes,
//      neither is provably wrong from source text alone.
//
// STATIC TEXT SCAN. No DB credentials, no network, safe offline / in CI.
// Exits 0 always — this enumerates, a human classifies.
//
// Run:
//   npx tsx scripts/audit/cache-tags.ts

import {
  REPO_ROOT,
  findMatchingParen,
  lineAt,
  maskNoise,
  printFooter,
  printHeader,
  readSource,
  relative,
  walk,
} from './_shared';
import { join } from 'node:path';

type TagFinding = {
  raw: string;
  /** The literal prefix before the first `${...}`, if any (e.g. `markbook:`). */
  prefix: string | null;
  /** Every `${...}` expression found inside this tag, if it's a template literal. */
  interpolations: string[];
  looksLikeId: boolean;
};

type Hit = {
  file: string;
  line: number;
  tags: TagFinding[];
  /** Set when `tags:` calls a helper this script could not resolve. */
  unresolvedHelper: string | null;
};

/**
 * Extracts the set of tag PREFIXES `invalidateDrillTags` / `invalidateAllOperationalDrills`
 * can produce, straight from their own source — so this script tracks that file
 * automatically instead of hand-maintaining a second copy of the same list.
 * A prefix is the literal text before the first `${...}` in a backtick tag
 * template, e.g. `` `markbook-drill:${ay}` `` -> `markbook-drill:`.
 */
function extractInvalidatableTagPrefixes(): Set<string> {
  const file = join(REPO_ROOT, 'lib', 'cache', 'invalidate-drill-tags.ts');
  let source: string;
  try {
    source = readSource(file);
  } catch {
    return new Set();
  }
  const prefixes = new Set<string>();
  for (const m of source.matchAll(/`([^`$]*)\$\{[^}]+\}([^`]*)`/g)) {
    const before = m[1];
    if (before) prefixes.add(before);
  }
  return prefixes;
}

/** True if an interpolated expression reads like a raw database id rather
 * than a stable code — the exact shape write-route-invalidation.test.ts
 * checks for (`...Id` / `..._id`), reused here for full coverage of every
 * unstable_cache site rather than only tag TEMPLATES built for invalidation. */
function looksLikeId(expr: string): boolean {
  const trimmed = expr.trim();
  return /(^|\.)\w*(Id|_id)$/.test(trimmed) || /\buuid\b/i.test(trimmed);
}

/** Parse one `tags: [...]` array's raw text into individual tag findings. */
function parseTags(tagsArrayText: string): TagFinding[] {
  const out: TagFinding[] = [];
  // Each tag is a single-quoted, double-quoted, or backtick-quoted literal.
  // A bare identifier (a tag built elsewhere and referenced by variable) is
  // deliberately NOT matched — this script can only read what the string
  // literally says, so a variable-built tag is invisible to it and must be
  // checked by a human. Noted, not silently pretended away.
  for (const m of tagsArrayText.matchAll(/(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    const raw = m[1];
    const isTemplate = raw.startsWith('`');
    if (!isTemplate) {
      out.push({ raw, prefix: null, interpolations: [], looksLikeId: false });
      continue;
    }
    const body = raw.slice(1, -1);
    const interpolations = [...body.matchAll(/\$\{([^}]+)\}/g)].map(
      (im) => im[1]
    );
    const firstInterpAt = body.indexOf('${');
    const prefix = firstInterpAt >= 0 ? body.slice(0, firstInterpAt) : null;
    out.push({
      raw,
      prefix,
      interpolations,
      looksLikeId: interpolations.some(looksLikeId),
    });
  }
  return out;
}

/**
 * Some call sites don't write `tags: [...]` literally — they call a small
 * same-file helper that returns the array, e.g.
 * `lib/admissions/dashboard.ts`'s `tag(ayCode)` returning
 * `['admissions-dashboard', \`admissions-dashboard:${ayCode}\`]`. Resolve one
 * level of that indirection: find the same-file `function <name>(...)` / `const
 * <name> = (...) => ...` declaration, skip PAST its parameter list and any
 * return-type annotation (a naive "first `[` after the name" would stop at
 * the `[]` inside a `: string[]` return type, never reaching the real array),
 * then take the first array literal in its body as the return value. Good
 * enough for the pattern actually used in this repo (a small pure formatter,
 * not a branching helper); anything deeper is reported unresolved rather than
 * guessed at.
 */
function resolveTagsHelper(
  source: string,
  masked: string,
  callName: string
): string | null {
  const funcMatch = new RegExp(`function\\s+${callName}\\s*\\(`).exec(masked);
  const arrowMatch = new RegExp(
    `const\\s+${callName}\\s*=\\s*(?:async\\s*)?\\(`
  ).exec(masked);

  let bodyStart = -1;
  if (funcMatch) {
    const parenOpen = funcMatch.index + funcMatch[0].length - 1;
    const parenClose = findMatchingParen(masked, parenOpen);
    const braceIdx = masked.indexOf('{', parenClose + 1);
    if (braceIdx !== -1) bodyStart = braceIdx + 1;
  } else if (arrowMatch) {
    const parenOpen = arrowMatch.index + arrowMatch[0].length - 1;
    const parenClose = findMatchingParen(masked, parenOpen);
    const arrowIdx = masked.indexOf('=>', parenClose + 1);
    if (arrowIdx !== -1) {
      let i = arrowIdx + 2;
      while (i < masked.length && /\s/.test(masked[i])) i++;
      bodyStart = masked[i] === '{' ? i + 1 : i;
    }
  }
  if (bodyStart === -1) return null;

  const arrayMatch = /\[([\s\S]*?)\]/.exec(
    source.slice(bodyStart, bodyStart + 500)
  );
  return arrayMatch ? arrayMatch[1] : null;
}

function scanFile(file: string): Hit[] {
  const source = readSource(file);
  const masked = maskNoise(source);
  const hits: Hit[] = [];

  const marker = 'unstable_cache(';
  let at = masked.indexOf(marker);
  while (at !== -1) {
    const openParen = at + 'unstable_cache'.length;
    const closeParen = findMatchingParen(masked, openParen);
    // Read the REAL text (not the comment/string-masked copy) — this script's
    // whole job is what's actually inside the tag strings, per _shared.ts's
    // documented caveat on maskNoise().
    const callText = source.slice(openParen, closeParen + 1);

    const directMatch = /tags\s*:\s*\[([\s\S]*?)\]/.exec(callText);
    let tags: TagFinding[];
    let unresolvedHelper: string | null = null;
    if (directMatch) {
      tags = parseTags(directMatch[1]);
    } else {
      const helperCallMatch = /tags\s*:\s*(\w+)\s*\(/.exec(callText);
      const resolved = helperCallMatch
        ? resolveTagsHelper(source, masked, helperCallMatch[1])
        : null;
      tags = resolved != null ? parseTags(resolved) : [];
      if (helperCallMatch && resolved == null)
        unresolvedHelper = helperCallMatch[1];
    }

    hits.push({
      file: relative(file),
      line: lineAt(source, at),
      tags,
      unresolvedHelper,
    });

    at = masked.indexOf(marker, at + marker.length);
  }
  return hits;
}

function main() {
  printHeader('CACHE TAGS — every unstable_cache() call site');

  const invalidatablePrefixes = extractInvalidatableTagPrefixes();
  console.log(
    `\ninvalidateDrillTags() can produce ${invalidatablePrefixes.size} tag prefix(es): ` +
      [...invalidatablePrefixes].sort().join(', ')
  );

  const files = [
    ...walk(join(REPO_ROOT, 'lib'), ['.ts', '.tsx']),
    ...walk(join(REPO_ROOT, 'app'), ['.ts', '.tsx']),
  ].filter((f) => readSource(f).includes('unstable_cache'));

  const libFiles = files.filter((f) => relative(f).startsWith('lib/'));
  const appFiles = files.filter((f) => relative(f).startsWith('app/'));
  console.log(
    `${files.length} file(s) mention unstable_cache (${libFiles.length} in lib/, ${appFiles.length} in app/).\n`
  );

  const hits = files.flatMap(scanFile);

  let flagged = 0;
  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line} — unstable_cache(...)`);
    if (hit.tags.length === 0) {
      console.log(
        hit.unresolvedHelper
          ? `  ⚠ tags built via ${hit.unresolvedHelper}(...) — could not resolve its return value statically.`
          : `  ⚠ no \`tags: [...]\` found in this call's options — either untagged ` +
              `(never revalidateTag-able) or built from a variable this scanner can't read.`
      );
      flagged += 1;
      continue;
    }
    for (const tag of hit.tags) {
      const notes: string[] = [];
      if (tag.looksLikeId) {
        notes.push(
          'SUSPECT: interpolates something that looks like a raw id/uuid, not a stable code'
        );
      }
      if (tag.prefix && tag.prefix.includes(':')) {
        const known = [...invalidatablePrefixes].some((p) =>
          tag.prefix!.startsWith(p)
        );
        if (!known) {
          notes.push(
            `prefix "${tag.prefix}" not produced by invalidateDrillTags() — confirm it is busted another way (revalidateTag/revalidatePath) or is deliberately TTL-only`
          );
        }
      }
      const classification = notes.length > 0 ? notes.join('; ') : 'OK';
      if (notes.length > 0) flagged += 1;
      console.log(`    ${tag.raw}  ->  ${classification}`);
    }
  }

  printFooter(hits.length, 'call site(s)');
  console.log(`${flagged} tag/call flagged for a human look.\n`);
}

main();
