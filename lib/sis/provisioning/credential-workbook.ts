// Builds the .xlsx credential handout for bulk-provisioned staff accounts:
// one tab per role group, plus an "All accounts" tab for the superadmin who
// ran the provisioning.
//
// Pure — takes already-generated rows, does zero DB reads and generates no
// passwords itself. Follows the SheetJS sequence established in
// lib/markbook/masterfile-export.ts (aoa_to_sheet -> !merges -> !cols ->
// book_new -> book_append_sheet -> XLSX.write).
//
// No `import 'server-only'` on purpose — see the note in ./temp-password.ts.
// Role labels are duplicated here as plain strings rather than imported from
// components/sis/staff-visuals.tsx, which is a client component: pulling it
// into a plain Node script would drag React in for two words of copy.
import * as XLSX from 'xlsx';

export type CredentialRow = {
  fullName: string;
  email: string;
  role: string;
  // Tab this row belongs on. Every group maps to exactly one role.
  group: string;
  // Empty for accounts that already existed — we never reset a working
  // password, so there is nothing to hand out.
  password: string;
  status: string;
};

export type CredentialWorkbookOptions = {
  // Shown in the instructions line. Falls back to a readable placeholder so
  // the sheet never prints the literal word "undefined".
  signInUrl?: string | null;
};

const HEADERS = [
  '#',
  'Name',
  'Email (this is your username)',
  'Role',
  'Temporary password',
  'Status',
] as const;

// Matches the header order above.
const COL_WIDTHS = [4, 26, 34, 20, 20, 30].map((wch) => ({ wch }));

const TITLE_ROW = 0;
const INSTRUCTION_ROW = 1;
// The sign-in URL, as a real clickable hyperlink. It occupies what used to
// be a blank spacer row ON PURPOSE: HEADER_ROW and FIRST_DATA_ROW must not
// shift, or readIssuedPasswords would mis-slice workbooks written by an
// earlier version of this module and silently drop the first person on every
// tab — and those files are the only record of their passwords.
const LINK_ROW = 2;
const HEADER_ROW = 3;
const FIRST_DATA_ROW = HEADER_ROW + 1;

// Only http(s) is hyperlinked. Anything else (the "the HFSE SIS website"
// placeholder, or a malformed env value) renders as plain text — a broken
// link in a staff handout is worse than no link.
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const ALL_ACCOUNTS_TAB = 'All accounts';

// Deliberately loose — this only has to distinguish a data row's email cell
// from a header/title/URL cell, not validate deliverability.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Excel tab names cap at 31 characters and forbid : \ / ? * [ ] — same
// sanitizer as lib/attendance/sheet-export.ts. SheetJS also throws on
// duplicate tab names, which that file never had to handle because it writes
// a single sheet; dedupe is applied by the caller loop below.
export function sanitizeTabName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

function uniqueTabName(desired: string, taken: Set<string>): string {
  const base = sanitizeTabName(desired);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`uniqueTabName: could not disambiguate "${desired}"`);
}

function buildSheet(
  title: string,
  rows: CredentialRow[],
  signInUrl: string
): XLSX.WorkSheet {
  const linked = isHttpUrl(signInUrl);
  const instructions = linked
    ? 'Sign in using the link below with your email and temporary password. ' +
      'After your first sign-in, change your password from the Account page. ' +
      'Please keep this sheet private.'
    : `Sign in at ${signInUrl} with the email and temporary password below. ` +
      'After your first sign-in, change your password from the Account page. ' +
      'Please keep this sheet private.';

  const aoa: (string | number)[][] = [
    [title, '', '', '', '', ''],
    [instructions, '', '', '', '', ''],
    [linked ? signInUrl : '', '', '', '', '', ''],
    [...HEADERS],
  ];

  rows.forEach((r, i) => {
    aoa.push([
      i + 1,
      r.fullName,
      r.email,
      ROLE_LABELS[r.role] ?? r.role,
      r.password,
      r.status,
    ]);
  });

  if (rows.length === 0) {
    aoa.push(['', 'No accounts in this group.', '', '', '', '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastCol = HEADERS.length - 1;
  // Title, instructions and the link each span the full table width.
  ws['!merges'] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: lastCol } },
    { s: { r: INSTRUCTION_ROW, c: 0 }, e: { r: INSTRUCTION_ROW, c: lastCol } },
    { s: { r: LINK_ROW, c: 0 }, e: { r: LINK_ROW, c: lastCol } },
  ];

  if (linked) {
    // SheetJS writes a real OOXML external hyperlink relationship from
    // `cell.l`, so the cell is clickable in Excel / LibreOffice / Sheets.
    // Set on the merge's top-left cell, which is what Excel activates for a
    // merged region. Note the community build has no cell styling, so it
    // won't be blue-underlined — it is clickable, just not styled.
    const addr = XLSX.utils.encode_cell({ r: LINK_ROW, c: 0 });
    const cell = ws[addr];
    if (cell) {
      cell.l = { Target: signInUrl, Tooltip: 'Open the HFSE SIS sign-in page' };
    }
  }

  ws['!cols'] = COL_WIDTHS;
  return ws;
}

// Plain-English role names for the handout — staff should not have to read
// `p_file_officer` off a sheet.
export const ROLE_LABELS: Record<string, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Academic Coordinator',
  school_admin: 'School Admin',
  superadmin: 'Superadmin',
  p_file_officer: 'P-Files Officer',
  admissions: 'Admissions',
};

export function buildCredentialWorkbook(
  rows: CredentialRow[],
  options: CredentialWorkbookOptions = {}
): Buffer {
  const signInUrl = options.signInUrl?.trim() || 'the HFSE SIS website';

  // Group order follows first appearance in `rows`, so the caller's roster
  // order decides tab order — no separate ordering config to keep in sync.
  const groupOrder: string[] = [];
  const byGroup = new Map<string, CredentialRow[]>();
  for (const row of rows) {
    if (!byGroup.has(row.group)) {
      byGroup.set(row.group, []);
      groupOrder.push(row.group);
    }
    byGroup.get(row.group)!.push(row);
  }

  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();

  for (const group of groupOrder) {
    const tab = uniqueTabName(group, taken);
    taken.add(tab);
    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(
        `HFSE SIS accounts — ${group}`,
        byGroup.get(group)!,
        signInUrl
      ),
      tab
    );
  }

  const allTab = uniqueTabName(ALL_ACCOUNTS_TAB, taken);
  taken.add(allTab);
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet('HFSE SIS accounts — all', rows, signInUrl),
    allTab
  );

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// Reads email -> temporary password back out of a workbook this module
// wrote.
//
// Why this exists: a temporary password is never persisted anywhere — not in
// the DB, not in auth.users (only its bcrypt hash) — so the workbook written
// at creation time is the ONLY record of it. Without this, a second
// provisioning run can only emit passwords for the accounts it just created,
// leaving the previously-issued ones blank and forcing whoever distributes
// the credentials to juggle one file per run. Reading them back lets every
// run emit one complete, current handout.
//
// Tolerant by design: reads whichever tabs exist, ignores rows with a blank
// password, and lowercases emails for matching. A malformed or unrelated
// .xlsx yields an empty map rather than throwing — a failed harvest must
// degrade to "blank password cell + a warning", never crash a run that has
// already created real accounts.
export function readIssuedPasswords(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch {
    return out;
  }

  const emailCol = HEADERS.indexOf('Email (this is your username)');
  const pwCol = HEADERS.indexOf('Temporary password');

  for (const tab of wb.SheetNames) {
    const ws = wb.Sheets[tab];
    if (!ws) continue;
    let grid: unknown[][];
    try {
      grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        blankrows: true,
        defval: '',
      });
    } catch {
      continue;
    }
    // Scans EVERY row rather than slicing at FIRST_DATA_ROW: the preamble
    // has grown once already (the link row), and if this reader's idea of
    // where data starts ever disagrees with a file written by an older
    // version, the first person on each tab is dropped — losing the only
    // copy of their password. An email-shaped value in the email column is
    // a sufficient and layout-independent test; no header, title,
    // instruction or URL cell satisfies it.
    for (const row of grid) {
      const email = String(row?.[emailCol] ?? '')
        .trim()
        .toLowerCase();
      const password = String(row?.[pwCol] ?? '').trim();
      if (!EMAIL_SHAPE.test(email) || !password) continue;
      // First tab wins within one workbook; every tab holds the same value
      // for a given person (group tab + "All accounts"), so this is a
      // dedupe, not a precedence rule.
      if (!out.has(email)) out.set(email, password);
    }
  }
  return out;
}

// Exported for tests so they assert against the real layout constants
// rather than hardcoded row indices that could drift.
export const CREDENTIAL_SHEET_LAYOUT = {
  titleRow: TITLE_ROW,
  instructionRow: INSTRUCTION_ROW,
  linkRow: LINK_ROW,
  headerRow: HEADER_ROW,
  firstDataRow: FIRST_DATA_ROW,
  headers: HEADERS,
  allAccountsTab: ALL_ACCOUNTS_TAB,
} as const;
