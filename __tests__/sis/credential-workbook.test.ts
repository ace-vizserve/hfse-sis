import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

import {
  CREDENTIAL_SHEET_LAYOUT,
  buildCredentialWorkbook,
  readIssuedPasswords,
  sanitizeTabName,
  type CredentialRow,
} from '../../lib/sis/provisioning/credential-workbook';

const row = (over: Partial<CredentialRow> = {}): CredentialRow => ({
  fullName: 'Gary Cacananta',
  email: 'gary.cacananta@hfse.edu.sg',
  role: 'superadmin',
  group: 'Superadmin',
  password: 'Ab3?wKmq',
  status: 'Created',
  ...over,
});

const ROWS: CredentialRow[] = [
  row(),
  row({
    fullName: 'Ninalyn Cacananta',
    email: 'nina.cacananta@hfse.edu.sg',
    password: 'Zc7#pRvt',
  }),
  row({
    fullName: 'Chandana Dileep',
    email: 'chandana.dileep@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
    password: 'Qm4@bWxy',
  }),
  row({
    fullName: 'Apple Grace Obias',
    email: 'applegrace.obias@hfse.edu.sg',
    role: 'admissions',
    group: 'Admissions',
    password: 'Ht9!vNsp',
  }),
];

function read(rows: CredentialRow[] = ROWS, signInUrl?: string) {
  const buf = buildCredentialWorkbook(rows, { signInUrl });
  return XLSX.read(buf, { type: 'buffer' });
}

// Sheet -> array-of-arrays with blanks preserved, so row indices in the
// assertions line up with CREDENTIAL_SHEET_LAYOUT.
function aoa(wb: XLSX.WorkBook, tab: string): unknown[][] {
  const ws = wb.Sheets[tab];
  expect(ws, `missing tab "${tab}"`).toBeDefined();
  return XLSX.utils.sheet_to_json(ws!, {
    header: 1,
    blankrows: true,
    defval: '',
  });
}

describe('buildCredentialWorkbook', () => {
  it('returns a readable xlsx buffer', () => {
    const buf = buildCredentialWorkbook(ROWS);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(0);
    // PK zip magic — xlsx is a zip container.
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('creates one tab per group plus All accounts, in roster order', () => {
    const wb = read();
    expect(wb.SheetNames).toEqual([
      'Superadmin',
      'School Admin - Academics',
      'Admissions',
      CREDENTIAL_SHEET_LAYOUT.allAccountsTab,
    ]);
  });

  it('puts each row on exactly its own group tab', () => {
    const wb = read();
    const dataRows = (tab: string) =>
      aoa(wb, tab).slice(CREDENTIAL_SHEET_LAYOUT.firstDataRow);

    expect(dataRows('Superadmin')).toHaveLength(2);
    expect(dataRows('School Admin - Academics')).toHaveLength(1);
    expect(dataRows('Admissions')).toHaveLength(1);
    expect(dataRows(CREDENTIAL_SHEET_LAYOUT.allAccountsTab)).toHaveLength(4);
  });

  it('places the header row where the layout says', () => {
    const wb = read();
    const grid = aoa(wb, 'Superadmin');
    expect(grid[CREDENTIAL_SHEET_LAYOUT.headerRow]).toEqual([
      ...CREDENTIAL_SHEET_LAYOUT.headers,
    ]);
  });

  it('writes name, email, password and status into the data rows', () => {
    const wb = read();
    const first = aoa(wb, 'Superadmin')[
      CREDENTIAL_SHEET_LAYOUT.firstDataRow
    ] as unknown[];
    expect(first[0]).toBe(1);
    expect(first[1]).toBe('Gary Cacananta');
    expect(first[2]).toBe('gary.cacananta@hfse.edu.sg');
    expect(first[4]).toBe('Ab3?wKmq');
    expect(first[5]).toBe('Created');
  });

  it('renders plain-English role names, never the raw enum', () => {
    const wb = read([
      row({ role: 'p_file_officer', group: 'Officer' }),
      row({ role: 'academic_coordinator', group: 'Academics' }),
    ]);
    const cell = (tab: string) =>
      (aoa(wb, tab)[CREDENTIAL_SHEET_LAYOUT.firstDataRow] as unknown[])[3];
    expect(cell('Officer')).toBe('P-Files Officer');
    expect(cell('Academics')).toBe('Academic Coordinator');
  });

  it('falls back to the raw role for an unknown value rather than blanking', () => {
    const wb = read([row({ role: 'future_role', group: 'Future' })]);
    const grid = aoa(wb, 'Future');
    expect((grid[CREDENTIAL_SHEET_LAYOUT.firstDataRow] as unknown[])[3]).toBe(
      'future_role'
    );
  });

  it('puts the sign-in URL on its own row and keeps it out of the prose', () => {
    const wb = read(ROWS, 'https://sis.hfse.edu.sg');
    const grid = aoa(wb, 'Superadmin');
    const prose = String(
      (grid[CREDENTIAL_SHEET_LAYOUT.instructionRow] as unknown[])[0]
    );
    const link = String(
      (grid[CREDENTIAL_SHEET_LAYOUT.linkRow] as unknown[])[0]
    );
    expect(link).toBe('https://sis.hfse.edu.sg');
    expect(prose).toContain('link below');
    expect(prose).toContain('change your password');
  });

  it('never prints "undefined" when the sign-in URL is missing', () => {
    for (const url of [undefined, null, '   ']) {
      const buf = buildCredentialWorkbook(ROWS, { signInUrl: url });
      const wb = XLSX.read(buf, { type: 'buffer' });
      const grid = aoa(wb, 'Superadmin');
      const line = String(
        (grid[CREDENTIAL_SHEET_LAYOUT.instructionRow] as unknown[])[0]
      );
      expect(line).not.toMatch(/undefined|null/);
      expect(line).toContain('HFSE SIS website');
      // No URL -> no link row content and no hyperlink at all.
      expect(
        String((grid[CREDENTIAL_SHEET_LAYOUT.linkRow] as unknown[])[0])
      ).toBe('');
    }
  });

  it('merges the title, instruction and link rows across the full table width', () => {
    const wb = read();
    const merges = wb.Sheets['Superadmin']!['!merges']!;
    const lastCol = CREDENTIAL_SHEET_LAYOUT.headers.length - 1;
    expect(merges).toHaveLength(3);
    for (const m of merges) {
      expect(m.s.c).toBe(0);
      expect(m.e.c).toBe(lastCol);
      expect(m.s.r).toBe(m.e.r);
    }
  });

  it('sets a column width for every header column', () => {
    // XLSX.read only parses !cols back when cellStyles is on — the widths
    // are written to the file either way, this just makes them readable
    // here. Without the flag `!cols` is undefined on the round trip even
    // though Excel honours the widths.
    const wb = XLSX.read(buildCredentialWorkbook(ROWS), {
      type: 'buffer',
      cellStyles: true,
    });
    const cols = wb.Sheets['Superadmin']!['!cols'];
    expect(cols).toHaveLength(CREDENTIAL_SHEET_LAYOUT.headers.length);
    // Email and password columns must be wide enough not to truncate.
    expect(cols![2]!.wch).toBeGreaterThanOrEqual(30);
    expect(cols![4]!.wch).toBeGreaterThanOrEqual(12);
  });

  it('leaves the password cell blank for a skipped existing account', () => {
    const wb = read([
      row({ password: '', status: 'Existing — password unchanged' }),
    ]);
    const first = aoa(wb, 'Superadmin')[
      CREDENTIAL_SHEET_LAYOUT.firstDataRow
    ] as unknown[];
    expect(first[4]).toBe('');
    expect(first[5]).toBe('Existing — password unchanged');
  });

  it('renders an empty-group note instead of a bare header', () => {
    const wb = buildCredentialWorkbook([]);
    const parsed = XLSX.read(wb, { type: 'buffer' });
    expect(parsed.SheetNames).toEqual([CREDENTIAL_SHEET_LAYOUT.allAccountsTab]);
    const grid = aoa(parsed, CREDENTIAL_SHEET_LAYOUT.allAccountsTab);
    expect((grid[CREDENTIAL_SHEET_LAYOUT.firstDataRow] as unknown[])[1]).toBe(
      'No accounts in this group.'
    );
  });
});

describe('sign-in hyperlink', () => {
  const linkCell = (wb: XLSX.WorkBook, tab: string) =>
    wb.Sheets[tab]![
      XLSX.utils.encode_cell({ r: CREDENTIAL_SHEET_LAYOUT.linkRow, c: 0 })
    ];

  it('writes a real external hyperlink, on every tab', () => {
    const wb = read(ROWS, 'https://hfse-sis.vercel.app/');
    for (const tab of wb.SheetNames) {
      const cell = linkCell(wb, tab);
      expect(cell, `no link cell on "${tab}"`).toBeDefined();
      expect(cell!.l?.Target).toBe('https://hfse-sis.vercel.app/');
      expect(cell!.l?.Rel?.TargetMode).toBe('External');
    }
  });

  it('carries a tooltip', () => {
    const cell = linkCell(
      read(ROWS, 'https://hfse-sis.vercel.app/'),
      'Superadmin'
    );
    expect(cell!.l?.Tooltip).toMatch(/sign-in/i);
  });

  it('accepts http as well as https', () => {
    const cell = linkCell(read(ROWS, 'http://localhost:3000'), 'Superadmin');
    expect(cell!.l?.Target).toBe('http://localhost:3000');
  });

  it('does NOT hyperlink a non-URL or malformed value', () => {
    // A broken link in a staff handout is worse than plain text.
    for (const bad of [
      'the HFSE SIS website',
      'hfse-sis.vercel.app',
      'javascript:alert(1)',
      'ftp://x.y',
    ]) {
      const wb = XLSX.read(buildCredentialWorkbook(ROWS, { signInUrl: bad }), {
        type: 'buffer',
      });
      const cell = linkCell(wb, 'Superadmin');
      expect(cell?.l, `unexpectedly linked "${bad}"`).toBeUndefined();
    }
  });

  it('keeps HEADER_ROW and FIRST_DATA_ROW where they were', () => {
    // The link row reused a blank spacer precisely so these did not shift —
    // a shift would make readIssuedPasswords mis-slice older workbooks.
    expect(CREDENTIAL_SHEET_LAYOUT.linkRow).toBe(2);
    expect(CREDENTIAL_SHEET_LAYOUT.headerRow).toBe(3);
    expect(CREDENTIAL_SHEET_LAYOUT.firstDataRow).toBe(4);
  });
});

describe('readIssuedPasswords', () => {
  // This round trip is what makes carry-forward trustworthy: a temporary
  // password exists nowhere else (auth.users stores only its bcrypt hash),
  // so if the reader and writer disagree, previously-issued passwords are
  // lost and staff get a blank cell.
  it('recovers every email -> password pair it wrote', () => {
    const recovered = readIssuedPasswords(buildCredentialWorkbook(ROWS));
    expect(recovered.size).toBe(ROWS.length);
    for (const r of ROWS) {
      expect(recovered.get(r.email)).toBe(r.password);
    }
  });

  it('survives a workbook with only one group', () => {
    const one = [row()];
    const recovered = readIssuedPasswords(buildCredentialWorkbook(one));
    expect(recovered.get(one[0]!.email)).toBe(one[0]!.password);
  });

  it('omits accounts whose password cell is blank', () => {
    const mixed = [
      row({ password: 'Ab3?wKmq' }),
      row({
        email: 'skipped@hfse.edu.sg',
        password: '',
        status: 'Existing account',
      }),
    ];
    const recovered = readIssuedPasswords(buildCredentialWorkbook(mixed));
    expect(recovered.has('gary.cacananta@hfse.edu.sg')).toBe(true);
    expect(recovered.has('skipped@hfse.edu.sg')).toBe(false);
  });

  it('matches emails case-insensitively', () => {
    const recovered = readIssuedPasswords(
      buildCredentialWorkbook([
        row({ email: 'Gary.Cacananta@HFSE.edu.sg', password: 'Ab3?wKmq' }),
      ])
    );
    expect(recovered.get('gary.cacananta@hfse.edu.sg')).toBe('Ab3?wKmq');
  });

  it('never picks up the title or instruction rows as data', () => {
    const recovered = readIssuedPasswords(buildCredentialWorkbook(ROWS));
    for (const key of recovered.keys()) {
      expect(key).toContain('@');
      expect(key).not.toContain('sign in at');
    }
  });

  it('still reads workbooks written in the PRE-link-row layout', () => {
    // The archived handouts on disk were written when row 2 was a blank
    // spacer. They are the only record of those passwords, so the reader
    // must stay able to parse them — this reconstructs that exact old
    // layout by hand rather than trusting the current writer.
    const oldLayout = [
      ['HFSE SIS accounts — Superadmin', '', '', '', '', ''],
      [
        'Sign in at https://old.example with the email and temporary password below.',
        '',
        '',
        '',
        '',
        '',
      ],
      ['', '', '', '', '', ''], // blank spacer, no link row
      [...CREDENTIAL_SHEET_LAYOUT.headers],
      [
        1,
        'Gary Cacananta',
        'gary.cacananta@hfse.edu.sg',
        'Superadmin',
        'Ab3?wKmq',
        'Created',
      ],
      [
        2,
        'Ninalyn Cacananta',
        'nina.cacananta@hfse.edu.sg',
        'Superadmin',
        'Zc7#pRvt',
        'Created',
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(oldLayout);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Superadmin');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const recovered = readIssuedPasswords(buf);
    expect(recovered.size).toBe(2);
    // The FIRST data row is the one a stale slice would have eaten.
    expect(recovered.get('gary.cacananta@hfse.edu.sg')).toBe('Ab3?wKmq');
    expect(recovered.get('nina.cacananta@hfse.edu.sg')).toBe('Zc7#pRvt');
  });

  it('ignores the header and URL cells even though it scans every row', () => {
    const wb = read(ROWS, 'https://hfse-sis.vercel.app/');
    const recovered = readIssuedPasswords(
      buildCredentialWorkbook(ROWS, {
        signInUrl: 'https://hfse-sis.vercel.app/',
      })
    );
    expect(recovered.size).toBe(ROWS.length);
    expect([...recovered.keys()]).not.toContain('https://hfse-sis.vercel.app/');
    expect(wb.SheetNames.length).toBeGreaterThan(0);
  });

  it('returns an empty map for a non-xlsx buffer instead of throwing', () => {
    // A failed harvest must degrade to "blank cell + warning", never crash a
    // run that has already created real accounts.
    expect(readIssuedPasswords(Buffer.from('not a spreadsheet')).size).toBe(0);
    expect(readIssuedPasswords(Buffer.alloc(0)).size).toBe(0);
  });

  it('ignores an unrelated workbook with different headers', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Student', 'Grade'],
      ['Someone', 91],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Grades');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(readIssuedPasswords(buf).size).toBe(0);
  });

  it('is consistent across a duplicated row on the group and All tabs', () => {
    // Each person appears twice (group tab + All accounts) with the same
    // password; the reader must not report a conflict or drop them.
    const recovered = readIssuedPasswords(buildCredentialWorkbook(ROWS));
    expect(recovered.get('chandana.dileep@hfse.edu.sg')).toBe('Qm4@bWxy');
  });
});

describe('tab-name handling', () => {
  it('strips characters Excel forbids and caps at 31', () => {
    expect(sanitizeTabName('a/b\\c?d*e[f]g')).toBe('a b c d e f g');
    expect(sanitizeTabName('x'.repeat(60))).toHaveLength(31);
    expect(sanitizeTabName('   ')).toBe('Sheet');
  });

  it('disambiguates groups that sanitize to the same tab name', () => {
    // SheetJS throws on a duplicate tab name — two long group labels sharing
    // a 31-char prefix must not collide.
    const long = 'School Admin - Academics and Curriculum';
    const wb = read([
      row({ group: `${long} One` }),
      row({ group: `${long} Two` }),
    ]);
    const names = wb.SheetNames;
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(3); // 2 groups + All accounts
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
  });

  it('does not collide when a group is literally named All accounts', () => {
    const wb = read([row({ group: CREDENTIAL_SHEET_LAYOUT.allAccountsTab })]);
    expect(new Set(wb.SheetNames).size).toBe(wb.SheetNames.length);
    expect(wb.SheetNames).toHaveLength(2);
  });
});
