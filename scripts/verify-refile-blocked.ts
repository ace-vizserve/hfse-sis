// scripts/verify-refile-blocked.ts
//
// Proves the 2026-08-29 fix against REAL data: re-filing dates that are already
// on record is refused with a 409 and a sentence naming which state the filing
// is in, instead of the old 200 that told the parent it had worked.
//
// WRITES NOTHING. It deliberately files a duplicate — the one request the
// server is now supposed to refuse — so the success path of this script is a
// refusal. It counts `student_declarations` before and after and fails loudly
// if the number moved, which is the guard against the case this is testing for
// having silently regressed into a real insert.
//
// WHY IT IS NOT A UNIT TEST. The unit tests stub PostgREST. Three things only
// production can answer: that `student_declarations.status` really comes back
// on the overlap SELECT (a column the query started asking for today), that the
// route reaches the new branch behind real auth and real rate limits, and that
// the sentence a parent would actually read is the one we think it is.
//
// Run (against whatever `.env.local` points at, with the app served locally so
// it is THIS code being tested and not what is deployed):
//
//   npx next build && npx next start -p 3000     # in one terminal
//   npx tsx --env-file=.env.local scripts/verify-refile-blocked.ts
//
// Override the target with BASE_URL=... if the app is on another port.
//
// Exit code 0 when the fix is proven, 1 when it is not.
import { createClient } from '@supabase/supabase-js';

import { createServiceClient } from '../lib/supabase/service';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

type Candidate = {
  id: string;
  studentId: string;
  studentNumber: string;
  declarationType: string;
  startDate: string;
  endDate: string;
  status: string;
  filedByEmail: string;
  withMedical: boolean | null;
  destinationCountry: string | null;
};

function fail(msg: string): never {
  console.error(`\n  FAILED — ${msg}\n`);
  process.exit(1);
}

async function main() {
  const service = createServiceClient();

  console.log('\n=== Re-filing an existing declaration is refused ===\n');
  console.log(`  target: ${BASE_URL}`);

  // ── 1. A filing that is already on record ────────────────────────────────
  // `pending` and `approved` are the two states that block; prefer `approved`
  // because it exercises the branch whose wording is new.
  const { data: rows, error } = await service
    .from('student_declarations')
    .select(
      'id, student_id, declaration_type, start_date, end_date, status, filed_by_email, with_medical, destination_country'
    )
    .in('status', ['approved', 'pending'])
    .not('filed_by_email', 'is', null)
    .order('status', { ascending: true }) // 'approved' sorts before 'pending'
    .limit(25);

  if (error) fail(`could not read declarations: ${error.message}`);
  if (!rows?.length) {
    fail(
      'no pending or approved declaration exists to re-file — file and approve one first'
    );
  }

  // The route speaks studentNumber, the table stores student_id.
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const { data: students, error: sErr } = await service
    .from('students')
    .select('id, student_number')
    .in('id', studentIds);
  if (sErr) fail(`could not resolve student numbers: ${sErr.message}`);

  const numberById = new Map(
    (students ?? []).map((s) => [
      s.id as string,
      s.student_number as string | null,
    ])
  );

  const row = rows.find((r) => numberById.get(r.student_id));
  if (!row) fail('every candidate filing points at a student with no number');

  const candidate: Candidate = {
    id: row.id,
    studentId: row.student_id,
    studentNumber: numberById.get(row.student_id)!,
    declarationType: row.declaration_type,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    filedByEmail: row.filed_by_email,
    withMedical: row.with_medical,
    destinationCountry: row.destination_country,
  };

  console.log(
    `  found:  ${candidate.declarationType} for ${candidate.studentNumber}`
  );
  console.log(`          ${candidate.startDate} to ${candidate.endDate}`);
  console.log(`          status: ${candidate.status}`);
  console.log(`          filed by: ${candidate.filedByEmail}`);

  // ── 2. A real session for the parent who filed it ────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL and the anon key must be set');
  }

  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: candidate.filedByEmail,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    fail(
      `could not mint a link for ${candidate.filedByEmail}: ${linkErr?.message}`
    );
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (otpErr || !session?.session?.access_token) {
    fail(`could not exchange the link for a session: ${otpErr?.message}`);
  }
  const token = session.session.access_token;
  console.log('\n  session: minted for the filing parent');

  // ── 3. Count first, so an accidental insert cannot hide ──────────────────
  const before = await service
    .from('student_declarations')
    .select('id', { count: 'exact', head: true });
  const countBefore = before.count ?? -1;

  // ── 4. Re-file the identical thing ───────────────────────────────────────
  const body: Record<string, unknown> = {
    declarationType: candidate.declarationType,
    studentNumbers: [candidate.studentNumber],
    startDate: candidate.startDate,
    endDate: candidate.endDate,
  };
  if (candidate.declarationType === 'absence') {
    // Re-send it as "no certificate", which needs no attachment and so cannot
    // be refused by the evidence rule before it reaches the overlap check.
    body.withMedical = false;
  } else {
    body.destinationCountry = candidate.destinationCountry ?? 'Malaysia';
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/parent/v2/declarations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    fail(
      `could not reach ${BASE_URL} — is the app running? (${e instanceof Error ? e.message : String(e)})`
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  console.log(`\n  POST /api/parent/v2/declarations -> ${res.status}`);
  console.log(
    `  body: ${JSON.stringify(payload, null, 2).split('\n').join('\n  ')}`
  );

  // ── 5. Nothing may have been written ─────────────────────────────────────
  const after = await service
    .from('student_declarations')
    .select('id', { count: 'exact', head: true });
  const countAfter = after.count ?? -1;

  console.log(`\n  declarations before: ${countBefore}, after: ${countAfter}`);
  if (countAfter !== countBefore) {
    fail(
      `THE ROW COUNT MOVED (${countBefore} -> ${countAfter}). A duplicate filing was created; delete it.`
    );
  }

  // ── 6. The verdict ───────────────────────────────────────────────────────
  if (res.status === 200) {
    fail(
      'got 200 — this is the OLD behaviour. The parent is being told their re-filing worked.'
    );
  }
  if (res.status !== 409) {
    fail(`expected 409, got ${res.status}`);
  }

  const message = String(payload.error ?? '');
  const expectedFragment =
    candidate.status === 'approved'
      ? 'has already been approved as away on'
      : 'the school has not decided it yet';

  if (!message.includes(expectedFragment)) {
    fail(
      `409 came back, but the sentence does not match the "${candidate.status}" wording.\n  wanted to contain: ${expectedFragment}`
    );
  }

  const overlapping = payload.overlapping as
    | Array<{ status?: string }>
    | undefined;
  if (!overlapping?.length) {
    fail('409 carried no `overlapping` array for the portal to read');
  }
  if (!overlapping[0].status) {
    fail(
      '`overlapping[0].status` is missing — the status is not surviving the SELECT, which is the half only production can prove'
    );
  }

  console.log('\n  PASSED');
  console.log(`    - refused with 409, not answered with a success`);
  console.log(`    - wording matches the "${candidate.status}" state`);
  console.log(
    `    - overlapping[0].status = "${overlapping[0].status}" (survives the live SELECT)`
  );
  console.log(`    - nothing written\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
