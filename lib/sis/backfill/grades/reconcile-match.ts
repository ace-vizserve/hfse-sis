// Quote-aware CSV parse (handles the quoted "LAST, First" name field).
function parseCSV(txt: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) {
      if (ch === '"') {
        if (txt[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\r') {
      /* skip */
    } else if (ch === '\n') {
      row.push(cur);
      out.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

// Build a map from the masterfile sheet name → its canonical enrolee + dup flag,
// read from the AY2025 reconciliation CSV. Keyed by the exact "Student Name
// (sheet)" value so it joins the parsed masterfile cells back to the roster.
export function buildNameToEnrolee(
  csvText: string
): Map<string, { enrolee: string; dup: string }> {
  const rows = parseCSV(csvText);
  const H = rows[0];
  const iName = H.indexOf('Student Name (sheet)');
  const iCanon = H.indexOf('Canonical Enrolee');
  const iDup = H.indexOf('Dup Flag');
  const m = new Map<string, { enrolee: string; dup: string }>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[iName]) continue;
    m.set(r[iName].trim(), {
      enrolee: (r[iCanon] ?? '').trim(),
      dup: (r[iDup] ?? '').trim(),
    });
  }
  return m;
}
