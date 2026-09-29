// A PostgREST-shaped fake that FILTERS: `.eq` / `.in` / `.not(col,'is',null)` /
// `.gte` are applied to fixture rows, dotted embed paths included
// (`subjects.is_examinable` reads the `subject` embed, as PostgREST's alias
// does). Like the real server it returns at most ROW_CAP rows per request,
// so an unpaginated read of a big table comes back cut short — silently.

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const ROW_CAP = 1000;

const ALIAS: Record<string, string> = {
  subjects: 'subject',
  sections: 'section',
};

function read(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const obj = cur as Row;
    cur = key in obj ? obj[key] : obj[ALIAS[key] ?? key];
    if (Array.isArray(cur)) cur = cur[0];
  }
  return cur;
}

export function makeFakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const run = (): Row[] => {
        const all = (tables[table] ?? []).filter((r) =>
          filters.every((f) => f(r))
        );
        const [from, to] = range ?? [0, ROW_CAP - 1];
        return all.slice(from, Math.min(to + 1, from + ROW_CAP));
      };
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push((r) => read(r, col) === val);
          return q;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(read(r, col)));
          return q;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null)
            filters.push((r) => read(r, col) != null);
          return q;
        },
        gte: (col: string, val: string) => {
          filters.push((r) => String(read(r, col)) >= val);
          return q;
        },
        order: () => q,
        range: (from: number, to: number) => {
          range = [from, to];
          return q;
        },
        maybeSingle: () =>
          Promise.resolve({ data: run()[0] ?? null, error: null }),
        then: (
          resolve: (v: { data: Row[]; error: null }) => unknown,
          reject?: (e: unknown) => unknown
        ) =>
          Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      });
      return q;
    },
  };
}
