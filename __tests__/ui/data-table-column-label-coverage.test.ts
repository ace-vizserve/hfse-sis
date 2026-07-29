/**
 * Guards the invariant behind components/ui/data-table/column-label.ts:
 *
 *   if a column's `header` is not a plain non-empty string literal,
 *   the column must carry `meta: { label }`.
 *
 * Without this, a new column added with a `<SortableHeader>` silently
 * regresses to the humanized-id fallback — which is readable but frequently
 * WRONG (id `owner` humanizes to "Owner" while its header reads "Level"), and
 * for generated ids is meaningless (`writeups_<uuid>`). That is exactly the
 * bug this whole change fixed, and nothing else would catch its return.
 *
 * These are `.tsx` client components whose column arrays are built inside
 * functions that need props and context, so they can't be imported and
 * inspected at runtime — same constraint as
 * __tests__/audit/allowlist-coverage.test.ts, which reads its sources as
 * text. This uses the TypeScript compiler API rather than regex because a
 * regex scan crosses object-literal boundaries in the larger files (notably
 * cohort-table.tsx, which holds five separate column builders).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const SEARCH_ROOTS = ['components', 'app'];
const SKIP_DIRS = new Set(['.claude', 'node_modules', '.next', '.git']);

/** Mirrors NON_DATA_COLUMN_IDS in components/ui/data-table/export-sheet.tsx. */
const NON_DATA_COLUMN_IDS = new Set(['select', 'actions', 'action', 'open']);

/**
 * Columns whose menu label deliberately differs from the on-screen header.
 * Keep this small and always give a reason — every entry is a place the two
 * can drift apart unnoticed.
 */
const INTENTIONAL_LABEL_DIVERGENCE: Record<string, string> = {
  // Header is a per-term short code ("T2") and the id carries a term UUID;
  // the menu has room for the full "Term 2".
  writeups: 'dynamic per-term column — full term label in the menu',
  // Header is abbreviated to fit a ~60px column; menu takes the full name.
  slot: 'document slot column — header is abbreviated to fit the grid',
};

/**
 * A header that is a bare glyph carries no meaning outside the grid, where
 * the surrounding columns supply the context. "#" and "%" must always expand
 * in the menu and the CSV header, so a divergence here is the rule, not an
 * exception — and it is expected everywhere rather than per-column.
 */
const GLYPH_HEADERS = new Set(['#', '%']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function consumerFiles(): string[] {
  const files: string[] = [];
  for (const root of SEARCH_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const src = readFileSync(file, 'utf8');
      // Any importer of the shared shell — auto-includes future consumers.
      if (/from '@\/components\/ui\/data-table/.test(src)) files.push(file);
    }
  }
  return files;
}

type Finding = {
  file: string;
  line: number;
  id: string;
  headerText: string | null;
  /** The literal label text, when it is a string literal. */
  label: string | null;
  /** Whether a `label:` key is present at all (may be an expression). */
  hasLabel: boolean;
  hasMeta: boolean;
};

/** The visible string inside `<SortableHeader ...>Text</SortableHeader>`, if literal. */
function sortableHeaderText(node: ts.Node): string | null {
  let text: string | null = null;
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n)) {
      const tag = n.openingElement.tagName.getText();
      if (tag === 'SortableHeader') {
        const kids = n.children.filter(
          (c) => !ts.isJsxText(c) || c.getText().trim() !== ''
        );
        if (kids.length === 1 && ts.isJsxText(kids[0])) {
          text = kids[0].getText().trim();
        }
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return text;
}

function propOf(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.PropertyAssignment | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p;
  }
  return undefined;
}

function scan(file: string): { columns: Finding[]; blankActions: Finding[] } {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const columns: Finding[] = [];
  const blankActions: Finding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const header = propOf(node, 'header');
      if (header) {
        const idProp = propOf(node, 'id') ?? propOf(node, 'accessorKey');
        const id = idProp
          ? idProp.initializer.getText().replace(/['"`]/g, '')
          : '';
        const metaProp = propOf(node, 'meta');
        const metaText = metaProp?.initializer.getText() ?? '';
        // A label may be an expression rather than a literal — the shared
        // document-completeness table and the per-term/per-slot columns build
        // theirs from the same variable the header renders. Presence is what
        // R2 requires; only a literal can be text-compared by R3.
        const hasLabel = /(^|[{,\s])label:/.test(metaText);
        const labelMatch = metaText.match(/label:\s*(['"`])(.*?)\1/);
        const hidingProp = propOf(node, 'enableHiding');
        const hidable = hidingProp?.initializer.getText() !== 'false';
        const line =
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const init = header.initializer;
        const isStringHeader = ts.isStringLiteral(init);
        // Only a FUNCTION header is guaranteed not to be a string at runtime.
        // A non-literal expression (e.g. `header: STAGE_LABELS[stageKey]`)
        // still evaluates to a string, which the resolver's string branch
        // handles — requiring a label there would be noise.
        const isFunctionHeader =
          ts.isArrowFunction(init) || ts.isFunctionExpression(init);

        if (isStringHeader && init.text.trim() === '' && hidable) {
          blankActions.push({
            file,
            line,
            id,
            headerText: '',
            label: null,
            hasLabel,
            hasMeta: Boolean(metaProp),
          });
        }

        // A render-function header needs a declared label if the column is
        // reachable by either surface: the Columns menu (hidable) OR the CSV
        // export picker. Export membership is NOT gated on enableHiding — see
        // isExportableColumn in export-sheet.tsx, which excludes only the
        // non-data ids and meta.excludeFromExport. A non-hidable identifier
        // column still ships its label as a CSV header.
        const exportable =
          !NON_DATA_COLUMN_IDS.has(id) &&
          !/excludeFromExport:\s*true/.test(metaText);
        if (isFunctionHeader && (hidable || exportable) && id) {
          columns.push({
            file,
            line,
            id,
            headerText: sortableHeaderText(init),
            label: labelMatch ? labelMatch[2] : null,
            hasLabel,
            hasMeta: Boolean(metaProp),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { columns, blankActions };
}

const scanned = consumerFiles().map((f) => ({ file: f, ...scan(f) }));
const allColumns = scanned.flatMap((s) => s.columns);
const allBlankActions = scanned.flatMap((s) => s.blankActions);

function rel(f: string) {
  return relative(REPO_ROOT, f).split(sep).join('/');
}

function divergenceReason(id: string): string | undefined {
  // Dynamic ids are template literals — match on the static prefix.
  for (const [key, reason] of Object.entries(INTENTIONAL_LABEL_DIVERGENCE)) {
    if (id === key || id.startsWith(`${key}_`) || id.startsWith(`${key}:`))
      return reason;
  }
  return undefined;
}

describe('DataTable column labels — coverage', () => {
  it('finds the DataTable consumers to check', () => {
    // Sanity floor: if the discovery walk silently breaks, every other
    // assertion here passes vacuously.
    expect(scanned.length).toBeGreaterThan(25);
    expect(allColumns.length).toBeGreaterThan(80);
  });

  it('every render-function-header column reachable by the menu or the export declares meta.label', () => {
    const missing = allColumns
      .filter((c) => !c.hasLabel)
      .map(
        (c) =>
          `${rel(c.file)}:${c.line} — column '${c.id}'` +
          (c.headerText ? ` (header reads "${c.headerText}")` : '') +
          ` → add meta: { label: '${c.headerText ?? '…'}' }`
      );
    expect(missing).toEqual([]);
  });

  it('meta.label matches the on-screen header text', () => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const drifted = allColumns
      .filter((c) => c.label && c.headerText)
      .filter((c) => norm(c.label!) !== norm(c.headerText!))
      .filter((c) => !GLYPH_HEADERS.has(c.headerText!.trim()))
      .filter((c) => !divergenceReason(c.id))
      .map(
        (c) =>
          `${rel(c.file)}:${c.line} — column '${c.id}': header reads ` +
          `"${c.headerText}" but meta.label is "${c.label}". Update the label, ` +
          `or add '${c.id}' to INTENTIONAL_LABEL_DIVERGENCE with a reason.`
      );
    expect(drifted).toEqual([]);
  });

  it('no hidable column renders a blank checkbox row', () => {
    const blank = allBlankActions.map(
      (c) =>
        `${rel(c.file)}:${c.line} — column '${c.id}' has header: '' and is ` +
        `hidable, so the Columns menu shows an unlabelled row. Add ` +
        `enableHiding: false.`
    );
    expect(blank).toEqual([]);
  });
});
