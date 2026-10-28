import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTermWeeks, weekForDate } from '../../lib/sow/weeks';
import { LOCAL_PASSWORD, localDb } from '../parent-portal/local-db';

// Scheme of work, phase 5 gate (LOCAL stack only): the weekly check, the
// relief teacher's note, the subject head's oversight grid and sign-off, and
// the teacher's Classroom home. "With an approved SOW: two teachers check Week
// N; the seeded relief teacher records a note; the subject head signs. The
// grid, the needs-a-look list and the teacher's Classroom home all show the
// right state."
//
// The local database arranges the setup and checks what was saved; every step
// a person takes is done in the browser.
//
// SETUP (all removed afterwards, even after a crash — see STATE_FILE):
//   - one subject x level with two classes, S1 and S2;
//   - teacher A holds S1 (their own seat) and co-teaches S2 (added); teacher B
//     holds S2 (their own seat) and co-teaches S1 (added);
//   - an APPROVED scheme for the term covering every numbered week;
//   - a third teacher as the subject's head;
//   - the seeded relief teacher covers B's seat on S2 today.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';
const RELIEF_EMAIL = 'relief@local.test';
const MODULE_TITLE = 'E2E Phase 5 Module';
const STATE_FILE = join(tmpdir(), 'hfse-sow-phase5-state.json');

const db = localDb();

type Person = { id: string; email: string };
type Cls = { id: string; name: string };

let today = '';
let ayId = '';
let termId = '';
let termNumber = 0;
let levelId = '';
let levelLabel = '';
let subjectId = '';
let subjectName = '';
let weekN = 0; // the week today falls in
let weekCount = 0; // numbered weeks in the term
let prevWeekN: number | null = null; // N - 1, when it exists
let A: Person;
let B: Person;
let HEAD: Person;
let RELIEF: Person;
let S1: Cls; // A's own class, B co-teaches it
let S2: Cls; // B's own class (covered today), A co-teaches it
let sowId = '';
let reliefAssignmentId = '';

const addedAssignmentIds: string[] = [];

const DELAYED_NOTE = 'E2E Phase 5 lab was cancelled on Tuesday';
const RELIEF_NOTE = 'E2E Phase 5 relief covered worksheet one';
const HEAD_REMARKS = 'E2E Phase 5 noted, catch up next week';
const ASK_REMARKS = 'E2E Phase 5 please say which practical moved';

test.describe.configure({ mode: 'serial' });

const sgDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(d);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── set-up and clean-up ────────────────────────────────────────────────────

type State = {
  sowIds: string[];
  assignmentIds: string[];
  reliefAssignmentId: string | null;
  headRowId: string | null;
  sectionIds: string[];
};

function saveState(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s));
}

/** Removes everything this suite arranged. Safe to run twice, and after a crash. */
async function cleanup() {
  const s: State = existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    : {
        sowIds: [],
        assignmentIds: [],
        reliefAssignmentId: null,
        headRowId: null,
        sectionIds: [],
      };
  // Leftovers of any run carry this module title.
  const { data: leftovers } = await db
    .from('schemes_of_work')
    .select('id, module');
  const sowIds = new Set(s.sowIds);
  for (const r of leftovers ?? []) {
    if ((r.module as { title?: string })?.title === MODULE_TITLE) {
      sowIds.add(r.id as string);
    }
  }
  if (sowIds.size > 0) {
    // Relief notes keep their rows when a scheme goes (set null), so go first.
    await db
      .from('scheme_of_work_relief_notes')
      .delete()
      .in('sow_id', [...sowIds]);
    const { error } = await db
      .from('schemes_of_work')
      .delete()
      .in('id', [...sowIds]);
    if (error) throw error;
  }
  if (s.sectionIds.length > 0) {
    await db
      .from('scheme_of_work_relief_notes')
      .delete()
      .in('section_id', s.sectionIds)
      .like('note', 'E2E Phase 5%');
  }
  if (s.reliefAssignmentId) {
    await db
      .from('teacher_assignments')
      .update({
        relief_teacher_user_id: null,
        relief_started_on: null,
        relief_ended_on: null,
      })
      .eq('id', s.reliefAssignmentId);
  }
  if (s.assignmentIds.length > 0) {
    await db.from('teacher_assignments').delete().in('id', s.assignmentIds);
  }
  if (s.headRowId) {
    await db.from('subject_heads').delete().eq('id', s.headRowId);
  }
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

test.beforeAll(async () => {
  await cleanup();

  today = sgDate(new Date());
  const { data: users, error: usersErr } = await db.auth.admin.listUsers({
    perPage: 1000,
  });
  if (usersErr) throw usersErr;
  const byEmail = new Map(
    users.users.map((u) => [u.email ?? '', u as { id: string; email: string }])
  );
  const byId = new Map(users.users.map((u) => [u.id, u]));
  const relief = byEmail.get(RELIEF_EMAIL);
  if (!relief) throw new Error(`${RELIEF_EMAIL} is not on the local stack.`);
  RELIEF = { id: relief.id, email: RELIEF_EMAIL };

  const { data: ay } = await db
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .single();
  if (!ay) throw new Error('No current academic year.');
  ayId = ay.id as string;

  const { data: terms } = await db
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', ayId);
  const term = (terms ?? []).find(
    (t) => t.start_date <= today && today <= t.end_date
  );
  if (!term) throw new Error(`No term of ${ay.ay_code} holds ${today}.`);
  termId = term.id as string;
  termNumber = term.term_number as number;

  const [{ data: configs }, { data: offerings }, { data: assigns }] =
    await Promise.all([
      db
        .from('subject_configs')
        .select('subject_id')
        .eq('academic_year_id', ayId),
      db
        .from('subject_level_offerings')
        .select('subject_id, level_id')
        .eq('academic_year_id', ayId),
      db
        .from('teacher_assignments')
        .select(
          'id, teacher_user_id, role, subject_id, relief_teacher_user_id, section_id, sections!inner(id, name, level_id, academic_year_id, levels(label)), subjects(name)'
        )
        .in('role', ['subject_teacher', 'co_teacher'])
        .not('subject_id', 'is', null)
        .eq('sections.academic_year_id', ayId),
    ]);
  const configured = new Set((configs ?? []).map((c) => c.subject_id));
  const offered = new Set(
    (offerings ?? []).map((o) => `${o.subject_id}|${o.level_id}`)
  );
  const { data: existingSows } = await db
    .from('schemes_of_work')
    .select('subject_id, level_id')
    .eq('term_id', termId);
  const taken = new Set(
    (existingSows ?? []).map((s) => `${s.subject_id}|${s.level_id}`)
  );
  const { data: heads } = await db.from('subject_heads').select('subject_id');
  const hasHead = new Set((heads ?? []).map((h) => h.subject_id));

  type Row = {
    id: string;
    teacher_user_id: string;
    role: string;
    subject_id: string;
    relief_teacher_user_id: string | null;
    section_id: string;
    sections: {
      id: string;
      name: string;
      level_id: string;
      levels: { label: string };
    };
    subjects: { name: string };
  };
  const groups = new Map<string, Row[]>();
  for (const r of (assigns ?? []) as unknown as Row[]) {
    if (!configured.has(r.subject_id)) continue;
    const key = `${r.subject_id}|${r.sections.level_id}`;
    if (!offered.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // Everyone who already teaches a subject, to keep the head and the relief
  // teacher clear of it.
  const teachersOfSubject = (sid: string) =>
    new Set(
      ((assigns ?? []) as unknown as Row[])
        .filter((r) => r.subject_id === sid)
        .flatMap((r) => [r.teacher_user_id, r.relief_teacher_user_id ?? ''])
    );
  const { data: allReliefRows } = await db
    .from('teacher_assignments')
    .select('subject_id')
    .eq('relief_teacher_user_id', RELIEF.id);
  const reliefSubjects = new Set(
    (allReliefRows ?? []).map((r) => r.subject_id)
  );

  let picked: {
    rows: Row[];
    key: string;
    headCandidate: string;
  } | null = null;
  for (const [key, rows] of groups) {
    if (taken.has(key)) continue;
    const [sid] = key.split('|');
    if (hasHead.has(sid) || reliefSubjects.has(sid)) continue;
    // Exactly two classes, each held by a different teacher, nothing else on
    // either (no co-teacher, no cover already booked).
    if (rows.length !== 2) continue;
    const [r1, r2] = rows;
    if (r1.section_id === r2.section_id) continue;
    if (r1.teacher_user_id === r2.teacher_user_id) continue;
    if (r1.role !== 'subject_teacher' || r2.role !== 'subject_teacher') {
      continue;
    }
    if (r1.relief_teacher_user_id || r2.relief_teacher_user_id) continue;
    if (r1.sections.name === r2.sections.name) continue;
    const busy = teachersOfSubject(sid);
    const head = users.users.find(
      (u) =>
        /^teacher\d+@local\.test$/.test(u.email ?? '') &&
        !busy.has(u.id) &&
        u.id !== RELIEF.id &&
        !u.banned_until
    );
    if (!head) continue;
    picked = { rows, key, headCandidate: head.id };
    break;
  }
  if (!picked) {
    throw new Error(
      'No subject x level with two classes and two different teachers is free of a scheme this term.'
    );
  }

  const [r1, r2] = picked.rows;
  subjectId = r1.subject_id;
  subjectName = r1.subjects.name;
  levelId = r1.sections.level_id;
  levelLabel = r1.sections.levels.label;
  S1 = { id: r1.section_id, name: r1.sections.name };
  S2 = { id: r2.section_id, name: r2.sections.name };
  A = { id: r1.teacher_user_id, email: byId.get(r1.teacher_user_id)!.email! };
  B = { id: r2.teacher_user_id, email: byId.get(r2.teacher_user_id)!.email! };
  HEAD = {
    id: picked.headCandidate,
    email: byId.get(picked.headCandidate)!.email!,
  };
  reliefAssignmentId = r2.id;

  // The term's numbered weeks for this level and the week today falls in.
  const { weeks } = await loadTermWeeks(db, termId, levelId);
  const numbered = weeks.filter(
    (w): w is Extract<typeof w, { kind: 'week' }> => w.kind === 'week'
  );
  weekCount = numbered.length;
  const current = weekForDate(numbered, today);
  if (!current) {
    throw new Error(
      `${today} is not inside a numbered teaching week (a weekend or a break). Run this on a school day.`
    );
  }
  weekN = current.weekNumber;
  prevWeekN = numbered.some((w) => w.weekNumber === weekN - 1)
    ? weekN - 1
    : null;

  // Write down what we are about to add, BEFORE adding it.
  const state: State = {
    sowIds: [],
    assignmentIds: [],
    reliefAssignmentId: null,
    headRowId: null,
    sectionIds: [S1.id, S2.id],
  };
  saveState(state);

  // Cross co-teachers: A co-teaches S2, B co-teaches S1.
  const { data: co, error: coErr } = await db
    .from('teacher_assignments')
    .insert([
      {
        teacher_user_id: A.id,
        section_id: S2.id,
        subject_id: subjectId,
        role: 'co_teacher',
      },
      {
        teacher_user_id: B.id,
        section_id: S1.id,
        subject_id: subjectId,
        role: 'co_teacher',
      },
    ])
    .select('id');
  if (coErr) throw coErr;
  addedAssignmentIds.push(...(co ?? []).map((r) => r.id as string));
  state.assignmentIds = [...addedAssignmentIds];
  saveState(state);

  // The approved scheme: every numbered week has a topic.
  const snapshot = {
    module: { title: MODULE_TITLE, hoursPerWeek: '4' },
    weeks: numbered.map((w) => ({
      weekNumber: w.weekNumber,
      topic: `E2E P5 topic ${w.weekNumber}`,
      learningOutcomes: null,
      textbookPages: null,
      activities: `<p>E2E P5 activities ${w.weekNumber}</p>`,
      assessment: null,
      remarks: null,
    })),
  };
  const { data: sow, error: sowErr } = await db
    .from('schemes_of_work')
    .insert({
      academic_year_id: ayId,
      term_id: termId,
      subject_id: subjectId,
      level_id: levelId,
      state: 'approved',
      module: snapshot.module,
      approved_snapshot: snapshot,
      approved_at: new Date().toISOString(),
      started_from: 'blank',
      created_by: A.id,
    })
    .select('id')
    .single();
  if (sowErr) throw sowErr;
  sowId = sow!.id as string;
  state.sowIds = [sowId];
  saveState(state);

  const { error: clsErr } = await db.from('scheme_of_work_classes').insert([
    { sow_id: sowId, section_id: S1.id },
    { sow_id: sowId, section_id: S2.id },
  ]);
  if (clsErr) throw clsErr;
  const { error: wkErr } = await db.from('scheme_of_work_weeks').insert(
    numbered.map((w) => ({
      sow_id: sowId,
      week_number: w.weekNumber,
      starts_on: w.startsOn,
      ends_on: w.endsOn,
      topic: `E2E P5 topic ${w.weekNumber}`,
    }))
  );
  if (wkErr) throw wkErr;

  // A third teacher heads the subject.
  const { data: headRow, error: headErr } = await db
    .from('subject_heads')
    .insert({ subject_id: subjectId, user_id: HEAD.id })
    .select('id')
    .single();
  if (headErr) throw headErr;
  state.headRowId = headRow!.id as string;
  saveState(state);

  // Last week already checked "as planned" by everyone who takes each class
  // (direct rows, so the relief page has a "last week" to show).
  if (prevWeekN !== null) {
    const when = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { error: pastErr } = await db.from('scheme_of_work_checks').insert(
      [A, B].flatMap((t) =>
        [S1, S2].map((s) => ({
          sow_id: sowId,
          week_number: prevWeekN,
          section_id: s.id,
          teacher_user_id: t.id,
          option: 'as_planned',
          note: null,
          recorded_at: when,
        }))
      )
    );
    if (pastErr) throw pastErr;
  }

  // The relief teacher covers B's seat on S2 around today.
  const { error: reliefErr } = await db
    .from('teacher_assignments')
    .update({
      relief_teacher_user_id: RELIEF.id,
      relief_started_on: addDays(today, -1),
      relief_ended_on: addDays(today, 1),
    })
    .eq('id', reliefAssignmentId);
  if (reliefErr) throw reliefErr;
  state.reliefAssignmentId = reliefAssignmentId;
  saveState(state);
});

test.afterAll(async () => {
  await cleanup();
});

// ── helpers ────────────────────────────────────────────────────────────────

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill(email);
  await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}

async function fillRich(box: Locator, text: string) {
  const editable = box.locator('[contenteditable="true"]');
  await editable.click();
  await editable.fill(text);
}

async function checkRows() {
  const { data, error } = await db
    .from('scheme_of_work_checks')
    .select('section_id, teacher_user_id, option, note')
    .eq('sow_id', sowId)
    .eq('week_number', weekN);
  if (error) throw error;
  return data ?? [];
}

/** Counts the answers to the checks route while a step runs. */
function watchChecks(page: Page) {
  const seen: number[] = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (
      u.pathname === `/api/sow/${sowId}/checks` &&
      r.request().method() === 'POST'
    ) {
      seen.push(r.status());
    }
  });
  return seen;
}

const sowPage = (page: Page) => page.goto(`${SIS}/classroom/sow/${sowId}`);
const classGroup = (page: Page, c: Cls) =>
  page.locator(`[aria-label="${c.name} this week"]`);
const className = (c: Cls) => `${levelLabel} ${c.name}`;
const isSignoff = (r: { url(): string; request(): { method(): string } }) =>
  new URL(r.url()).pathname === `/api/sow/${sowId}/signoffs` &&
  r.request().method() === 'POST';

async function oversightGrid(page: Page) {
  await page.goto(
    `${SIS}/classroom/sow/oversight?term=${termNumber}&view=checks&level=${levelId}`
  );
  await expect(
    page.getByRole('heading', { name: 'Needs a look' })
  ).toBeVisible();
}

function gridCell(page: Page, c: Cls) {
  return page.getByRole('button', {
    name: new RegExp(
      `^${esc(className(c))} · .*, Week ${weekN}: .*Review and sign$`
    ),
  });
}

// ── 1 ──────────────────────────────────────────────────────────────────────

test("classroom home shows this week's lessons and what is due", async ({
  page,
}) => {
  await signIn(page, A.email);
  await page.goto(`${SIS}/classroom`);

  await expect(
    page.getByRole('heading', { name: /This week.s lessons/ })
  ).toBeVisible();
  const lessons = page.locator('section[aria-labelledby="this-week-heading"]');
  await expect(lessons).toContainText(`Week ${weekN}`);
  for (const c of [S1, S2]) {
    // The class and the subject: a teacher may teach the class another
    // subject too, which is its own lesson row.
    const row = lessons.getByRole('listitem').filter({
      hasText: `${className(c)} · ${subjectName}`,
    });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`E2E P5 topic ${weekN}`);
    await expect(row).toContainText(/Check due [A-Z][a-z]{2}/);
  }

  const todo = page.locator('section[aria-labelledby="sow-todo-heading"]');
  await expect(todo).toContainText(
    new RegExp(`Check Week ${weekN} for .* \\(2 classes\\)`)
  );
  await shot(page, 'sow5-home-before.png');
});

// ── 2 ──────────────────────────────────────────────────────────────────────

test('two teachers check the week and the home follows', async ({ page }) => {
  // Teacher A: S1 as planned, S2 delayed with a note.
  await signIn(page, A.email);
  const answers = watchChecks(page);
  await sowPage(page);
  await expect(
    page.getByText(`How did Week ${weekN} go?`, { exact: true })
  ).toBeVisible();

  await classGroup(page, S1)
    .getByRole('radio', { name: 'As planned', exact: true })
    .click();
  await classGroup(page, S2)
    .getByRole('radio', { name: 'Delayed', exact: true })
    .click();
  await fillRich(page.locator(`#check-note-${S2.id}`), DELAYED_NOTE);
  await shot(page, 'sow5-a-check-form.png');
  await page.getByRole('button', { name: `Save Week ${weekN}` }).click();
  await expect.poll(() => answers.length).toBe(2);
  expect(answers).toEqual([200, 200]);

  // Teacher B (co-teacher of S1): S1 as planned.
  await signIn(page, B.email);
  const answersB = watchChecks(page);
  await sowPage(page);
  await classGroup(page, S1)
    .getByRole('radio', { name: 'As planned', exact: true })
    .click();
  await page.getByRole('button', { name: `Save Week ${weekN}` }).click();
  await expect.poll(() => answersB.length).toBe(1);
  expect(answersB).toEqual([200]);

  const rows = await checkRows();
  expect(rows).toHaveLength(3);
  const find = (t: Person, c: Cls) =>
    rows.find((r) => r.teacher_user_id === t.id && r.section_id === c.id);
  expect(find(A, S1)?.option).toBe('as_planned');
  expect(find(A, S1)?.note).toBeNull();
  expect(find(A, S2)?.option).toBe('delayed');
  expect(find(A, S2)?.note).toContain(DELAYED_NOTE);
  expect(find(B, S1)?.option).toBe('as_planned');

  // A's Classroom home: both classes checked, nothing left to check.
  await signIn(page, A.email);
  await page.goto(`${SIS}/classroom`);
  const lessons = page.locator('section[aria-labelledby="this-week-heading"]');
  for (const c of [S1, S2]) {
    const row = lessons.getByRole('listitem').filter({
      hasText: `${className(c)} · ${subjectName}`,
    });
    await expect(row).toContainText('Checked');
    await expect(row).not.toContainText('Check due');
  }
  await expect(
    page.getByText(new RegExp(`Check Week ${weekN} for`))
  ).toHaveCount(0);
  await shot(page, 'sow5-home-after.png');
});

// ── 3 ──────────────────────────────────────────────────────────────────────

test('a note is required for anything but as planned', async ({ page }) => {
  await signIn(page, B.email);
  const answers = watchChecks(page);
  const before = await checkRows();
  await sowPage(page);

  await classGroup(page, S1)
    .getByRole('radio', { name: 'Adjusted', exact: true })
    .click();
  await expect(page.getByText('What did you adjust?')).toBeVisible();
  await expect(page.getByText(/Add a note for each class/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Save Week ${weekN}` })
  ).toBeDisabled();
  await shot(page, 'sow5-note-required.png');

  // The server says the same, in plain words, if asked anyway.
  const res = await page.request.post(`${SIS}/api/sow/${sowId}/checks`, {
    data: { weekNumber: weekN, sectionId: S1.id, option: 'adjusted', note: '' },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toBe(
    "Add a note saying how the week didn't go as planned."
  );

  expect(answers).toEqual([]);
  expect(await checkRows()).toHaveLength(before.length);
});

// ── 4 ──────────────────────────────────────────────────────────────────────

test('the relief teacher records what was covered', async ({ page }) => {
  await signIn(page, RELIEF.email);
  await page.goto(`${SIS}/classroom`);
  const panel = page.locator(
    'section[aria-labelledby="upcoming-cover-heading"]'
  );
  await expect(
    panel.getByRole('heading', { name: /You.re covering/ })
  ).toBeVisible();
  // The panel names the class by its short label ("P3 Courageous").
  const row = panel.getByRole('listitem').filter({
    hasText: new RegExp(`${esc(S2.name)} · `),
  });
  await expect(row).toHaveCount(1);
  await row.getByRole('link', { name: /See today.s lesson/ }).click();
  await page.waitForURL(`**/classroom/sow/covering/${S2.id}/${subjectId}`);

  // Week N's topic from the approved plan, and last week's line.
  await expect(
    page.getByRole('heading', { name: `E2E P5 topic ${weekN}` })
  ).toBeVisible();
  await expect(page.getByText(`Week ${weekN} of ${weekCount}`)).toBeVisible();
  if (prevWeekN !== null) {
    await expect(
      page.getByText(`Week ${prevWeekN} went as planned.`)
    ).toBeVisible();
  }

  await fillRich(page.locator('#relief-covered'), RELIEF_NOTE);
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/sow/relief-notes' &&
      r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Save what I covered' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText(`Saved to Week ${weekN}.`)).toBeVisible();
  await shot(page, 'sow5-relief-saved.png');

  const { data: notes } = await db
    .from('scheme_of_work_relief_notes')
    .select('sow_id, week_number, section_id, taught_on, note')
    .eq('relief_teacher_user_id', RELIEF.id)
    .eq('section_id', S2.id)
    .eq('subject_id', subjectId);
  expect(notes).toHaveLength(1);
  expect(notes![0]).toMatchObject({
    sow_id: sowId,
    week_number: weekN,
    taught_on: today,
  });
  expect(notes![0].note).toContain(RELIEF_NOTE);

  // Teacher A reads it on the week, against the right class.
  await signIn(page, A.email);
  await sowPage(page);
  const line = page.getByText(/^Relief, .*\(.+\):$/);
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(S2.name);
  await expect(page.getByText(RELIEF_NOTE)).toBeVisible();
  await shot(page, 'sow5-a-sees-relief.png');
});

// ── 5 ──────────────────────────────────────────────────────────────────────

test('oversight shows the state and the subject head signs the week', async ({
  page,
}) => {
  await signIn(page, HEAD.email);
  await oversightGrid(page);

  // S1 both teachers as planned; S2 has a note. (Marks are in the labels.)
  await expect(gridCell(page, S1)).toHaveAttribute(
    'aria-label',
    /Week \d+: As planned\./
  );
  await expect(gridCell(page, S2)).toHaveAttribute(
    'aria-label',
    /Week \d+: Adjusted, delayed or extra \(has a note\)\./
  );
  await expect(gridCell(page, S2)).not.toHaveAttribute(
    'aria-label',
    /, signed/
  );

  // Needs a look lists S2 with the note, and nothing for S1.
  const needs = page.locator('li').filter({
    hasText: `${className(S2)} · ${subjectName}, Wk ${weekN}`,
  });
  await expect(needs).toHaveCount(1);
  await expect(needs).toContainText(`Delayed: “${DELAYED_NOTE}”`);
  await expect(
    page.locator('li').filter({
      hasText: `${className(S1)} · ${subjectName}, Wk ${weekN}`,
    })
  ).toHaveCount(0);
  await shot(page, 'sow5-grid-before-sign.png');

  // S1's drawer first: both teachers answered as planned.
  await gridCell(page, S1).click();
  let drawer = page.getByRole('dialog');
  await expect(drawer.getByText(`Week ${weekN} ·`)).toBeVisible();
  await expect(drawer.getByText('As planned', { exact: true })).toHaveCount(2);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // S2 from the list: Review and sign.
  await needs.getByRole('button', { name: 'Review and sign' }).click();
  drawer = page.getByRole('dialog');
  await expect(drawer.getByText(`Week ${weekN} ·`)).toBeVisible();
  await expect(drawer.getByText(`E2E P5 topic ${weekN}`)).toBeVisible();
  await expect(drawer.getByText('Delayed', { exact: true })).toBeVisible();
  await expect(drawer.getByText(DELAYED_NOTE)).toBeVisible();
  // The holder who has not answered shows as such, and the relief note is there.
  await expect(drawer.getByText('Not checked', { exact: true })).toBeVisible();
  await expect(drawer.getByText(RELIEF_NOTE)).toBeVisible();
  await expect(drawer.getByText(/^Relief, /)).toBeVisible();
  await fillRich(drawer.locator('#supervisor-remarks'), HEAD_REMARKS);
  await shot(page, 'sow5-sign-drawer.png');

  const signed = page.waitForResponse(isSignoff);
  await drawer.getByRole('button', { name: `Sign Week ${weekN}` }).click();
  expect((await signed).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The cell is signed (underlined) and the item left the list.
  await expect(gridCell(page, S2)).toHaveAttribute('aria-label', /, signed\./);
  await expect(gridCell(page, S2).locator('span.underline')).toHaveCount(1);
  await expect(needs).toHaveCount(0);
  await shot(page, 'sow5-grid-after-sign.png');

  const { data: so } = await db
    .from('scheme_of_work_signoffs')
    .select('week_number, section_id, signed_by, kind, remarks')
    .eq('sow_id', sowId);
  expect(so).toHaveLength(1);
  expect(so![0]).toMatchObject({
    week_number: weekN,
    section_id: S2.id,
    signed_by: HEAD.id,
    kind: 'signed',
  });
  expect(so![0].remarks).toContain(HEAD_REMARKS);

  // Teacher A can no longer change S2's week.
  await signIn(page, A.email);
  const before = await checkRows();
  const refused = await page.request.post(`${SIS}/api/sow/${sowId}/checks`, {
    data: {
      weekNumber: weekN,
      sectionId: S2.id,
      option: 'as_planned',
      note: null,
    },
  });
  expect(refused.status()).toBe(423);
  expect((await refused.json()).error).toBe(
    "This week is signed for that class, so its check can't be changed."
  );
  expect(await checkRows()).toHaveLength(before.length);

  await sowPage(page);
  await expect(page.getByText('Signed by subject head')).toBeVisible();
  await expect(classGroup(page, S2)).toHaveCount(0);
  await expect(classGroup(page, S1)).toHaveCount(1);
  await shot(page, 'sow5-a-signed-week.png');
});

// ── 6 ──────────────────────────────────────────────────────────────────────

test('only the subject head signs', async ({ page }) => {
  await signIn(page, A.email);
  const res = await page.request.post(`${SIS}/api/sow/${sowId}/signoffs`, {
    data: { weekNumber: weekN, sectionId: S1.id, kind: 'signed', remarks: '' },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe(
    'Only the subject head signs off weeks.'
  );

  const { data: so } = await db
    .from('scheme_of_work_signoffs')
    .select('section_id')
    .eq('sow_id', sowId)
    .eq('section_id', S1.id);
  expect(so).toHaveLength(0);
});

// ── 7 ──────────────────────────────────────────────────────────────────────

test('the subject head asks a teacher and it reaches their pages', async ({
  page,
}) => {
  await signIn(page, HEAD.email);
  await oversightGrid(page);
  await gridCell(page, S1).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(`Week ${weekN} ·`)).toBeVisible();
  // Asking needs remarks.
  await expect(
    drawer.getByRole('button', { name: 'Ask the teacher' })
  ).toBeDisabled();
  await fillRich(drawer.locator('#supervisor-remarks'), ASK_REMARKS);
  const asked = page.waitForResponse(isSignoff);
  await drawer.getByRole('button', { name: 'Ask the teacher' }).click();
  expect((await asked).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const { data: so } = await db
    .from('scheme_of_work_signoffs')
    .select('kind, remarks')
    .eq('sow_id', sowId)
    .eq('section_id', S1.id);
  expect(so).toHaveLength(1);
  expect(so![0].kind).toBe('asked');
  expect(so![0].remarks).toContain(ASK_REMARKS);

  // A's SOW page and Classroom home.
  await signIn(page, A.email);
  await sowPage(page);
  await expect(
    page.getByText(`Your subject head asked about ${S1.name}:`)
  ).toBeVisible();
  await expect(page.getByText(ASK_REMARKS)).toBeVisible();
  await shot(page, 'sow5-a-asked.png');

  await page.goto(`${SIS}/classroom`);
  const todo = page.locator('section[aria-labelledby="sow-todo-heading"]');
  await expect(todo).toContainText(
    `Your subject head asked about Week ${weekN} for ${className(S1)}`
  );
  await shot(page, 'sow5-home-asked.png');
});
