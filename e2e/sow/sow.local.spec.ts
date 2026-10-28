import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTermWeeks, weekForDate } from '../../lib/sow/weeks';
import { LOCAL_PASSWORD, localDb } from '../parent-portal/local-db';

// Scheme of work, the whole walk (LOCAL stack only), in one serial run:
//
//   teacher starts a blank scheme -> edits Week 1 -> sends it -> the subject
//   head vets -> the OIC -> the Assistant Principal -> the AEB approves ->
//   the teacher checks the current week for both classes -> the relief teacher
//   records a note -> the subject head signs the week.
//
// Every step a person takes is done in the browser. The local database only
// arranges what an administrator would set in SIS Admin (the approval steps,
// the subject head, who teaches which class, who covers) and checks what was
// saved. Everything it arranges is removed afterwards, even after a crash —
// see STATE_FILE.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';
const RELIEF_EMAIL = 'relief@local.test';
const OIC = {
  primary: 'oic.primary@local.test',
  secondary: 'oic.secondary@local.test',
};
const ASST_P = 'asst.principal@local.test';
const AEB = 'aeb.member@local.test';
const FLOW = 'markbook.scheme_of_work';
const STEPS = ['Subject head', 'OIC', 'Assistant Principal', 'AEB'] as const;
const STATE_FILE = join(tmpdir(), 'hfse-sow-walk-state.json');

const WEEK1_TOPIC = 'E2E Walk topic 1';
const DELAYED_NOTE = 'E2E Walk the lab was moved to Thursday';
const RELIEF_NOTE = 'E2E Walk relief covered worksheet one';
const HEAD_REMARKS = 'E2E Walk noted, catch up next week';

const db = localDb();

type Person = { id: string; email: string };
type Cls = { id: string; name: string };

let today = '';
let ayId = '';
let termId = '';
let termNumber = 0;
let levelId = '';
let levelLabel = '';
let levelType: 'primary' | 'secondary' = 'primary';
let subjectId = '';
let subjectName = '';
let weekN = 0;
let A: Person; // the teacher who writes the scheme (holds S1, co-teaches S2)
let B: Person; // holds S2 (covered by the relief teacher today), co-teaches S1
let HEAD: Person;
let RELIEF: Person;
let S1: Cls;
let S2: Cls;
let reliefAssignmentId = '';
let sowId = '';
const userIds = new Map<string, string>();

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
  termId: string | null;
  subjectId: string | null;
  levelId: string | null;
  assignmentIds: string[];
  reliefAssignmentId: string | null;
  headRowId: string | null;
  addedStageIds: string[];
  pausedStageIds: string[];
  sectionIds: string[];
};

const emptyState = (): State => ({
  termId: null,
  subjectId: null,
  levelId: null,
  assignmentIds: [],
  reliefAssignmentId: null,
  headRowId: null,
  addedStageIds: [],
  pausedStageIds: [],
  sectionIds: [],
});

let state: State = emptyState();

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

/** Removes the requests (with their steps and decisions) filed on these schemes. */
async function removeRequestsOf(sowIds: string[]) {
  if (sowIds.length === 0) return;
  const { data: subs } = await db
    .from('scheme_of_work_submissions')
    .select('id')
    .in('sow_id', sowIds);
  const subIds = (subs ?? []).map((s) => s.id as string);
  if (subIds.length === 0) return;
  const { data: reqs } = await db
    .from('approval_requests')
    .select('id')
    .in('subject_id', subIds);
  const reqIds = (reqs ?? []).map((r) => r.id as string);
  if (reqIds.length === 0) return;
  const { data: stages } = await db
    .from('approval_request_stages')
    .select('id')
    .in('request_id', reqIds);
  const stageIds = (stages ?? []).map((s) => s.id as string);
  if (stageIds.length) {
    await db
      .from('approval_request_stage_decisions')
      .delete()
      .in('request_stage_id', stageIds);
  }
  await db.from('approval_request_stages').delete().in('request_id', reqIds);
  const { error } = await db
    .from('approval_requests')
    .delete()
    .in('id', reqIds);
  if (error) throw error;
}

/** Removes everything this walk arranged. Safe to run twice, and after a crash. */
async function cleanup() {
  const s: State = existsSync(STATE_FILE)
    ? { ...emptyState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
    : emptyState();

  // The scheme the walk made, found by the group it was made for.
  const sowIds = new Set<string>();
  if (sowId) sowIds.add(sowId);
  if (s.termId && s.subjectId && s.levelId) {
    const { data } = await db
      .from('schemes_of_work')
      .select('id')
      .eq('term_id', s.termId)
      .eq('subject_id', s.subjectId)
      .eq('level_id', s.levelId);
    for (const r of data ?? []) sowIds.add(r.id as string);
  }
  if (sowIds.size > 0) {
    // Relief notes keep their rows when a scheme goes (set null), so go first.
    await db
      .from('scheme_of_work_relief_notes')
      .delete()
      .in('sow_id', [...sowIds]);
    await removeRequestsOf([...sowIds]);
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
      .like('note', 'E2E Walk%');
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
  // Approvers go with their steps (cascade).
  if (s.addedStageIds.length > 0) {
    await db.from('approval_stages').delete().in('id', s.addedStageIds);
  }
  if (s.pausedStageIds.length > 0) {
    await db
      .from('approval_stages')
      .update({ is_active: true })
      .in('id', s.pausedStageIds);
  }
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  state = emptyState();
}

function idOf(email: string): string {
  const id = userIds.get(email);
  if (!id) throw new Error(`${email} is not on the local stack.`);
  return id;
}

test.beforeAll(async () => {
  await cleanup();

  today = sgDate(new Date());
  for (let p = 1; p < 20; p++) {
    const { data, error } = await db.auth.admin.listUsers({
      page: p,
      perPage: 1000,
    });
    if (error) throw error;
    for (const u of data.users) if (u.email) userIds.set(u.email, u.id);
    if (data.users.length < 1000) break;
  }
  const emailOf = new Map([...userIds].map(([e, id]) => [id, e]));
  RELIEF = { id: idOf(RELIEF_EMAIL), email: RELIEF_EMAIL };

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
          'id, teacher_user_id, role, subject_id, relief_teacher_user_id, section_id, sections!inner(id, name, level_id, academic_year_id, levels(label, level_type)), subjects(name)'
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
  const { data: reliefRows } = await db
    .from('teacher_assignments')
    .select('subject_id')
    .eq('relief_teacher_user_id', RELIEF.id);
  const reliefSubjects = new Set((reliefRows ?? []).map((r) => r.subject_id));

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
      levels: { label: string; level_type: string };
    };
    subjects: { name: string };
  };
  const all = (assigns ?? []) as unknown as Row[];
  const groups = new Map<string, Row[]>();
  for (const r of all) {
    if (!configured.has(r.subject_id)) continue;
    if (!offered.has(`${r.subject_id}|${r.sections.level_id}`)) continue;
    if (
      r.sections.levels.level_type !== 'primary' &&
      r.sections.levels.level_type !== 'secondary'
    ) {
      continue;
    }
    const key = `${r.subject_id}|${r.sections.level_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // One subject x level with exactly two classes, each held by a
  // different teacher, nothing else on either, no head yet, no cover booked.
  let picked: { rows: Row[]; headCandidate: string } | null = null;
  for (const [key, rows] of groups) {
    if (taken.has(key)) continue;
    const [sid] = key.split('|');
    if (hasHead.has(sid) || reliefSubjects.has(sid)) continue;
    if (rows.length !== 2) continue;
    const [r1, r2] = rows;
    if (r1.section_id === r2.section_id) continue;
    if (r1.teacher_user_id === r2.teacher_user_id) continue;
    if (r1.role !== 'subject_teacher' || r2.role !== 'subject_teacher') {
      continue;
    }
    if (r1.relief_teacher_user_id || r2.relief_teacher_user_id) continue;
    if (r1.sections.name === r2.sections.name) continue;
    const busy = new Set(
      all
        .filter((r) => r.subject_id === sid)
        .flatMap((r) => [r.teacher_user_id, r.relief_teacher_user_id ?? ''])
    );
    const head = [...userIds].find(
      ([e, id]) =>
        /^teacher\d+@local\.test$/.test(e) && !busy.has(id) && id !== RELIEF.id
    );
    if (!head) continue;
    picked = { rows, headCandidate: head[1] };
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
  levelType = r1.sections.levels.level_type as 'primary' | 'secondary';
  S1 = { id: r1.section_id, name: r1.sections.name };
  S2 = { id: r2.section_id, name: r2.sections.name };
  A = { id: r1.teacher_user_id, email: emailOf.get(r1.teacher_user_id)! };
  B = { id: r2.teacher_user_id, email: emailOf.get(r2.teacher_user_id)! };
  HEAD = {
    id: picked.headCandidate,
    email: emailOf.get(picked.headCandidate)!,
  };
  reliefAssignmentId = r2.id;

  // The week today falls in — the walk needs a school day.
  const { weeks } = await loadTermWeeks(db, termId, levelId);
  const numbered = weeks.filter(
    (w): w is Extract<typeof w, { kind: 'week' }> => w.kind === 'week'
  );
  const current = weekForDate(numbered, today);
  if (!current) {
    throw new Error(
      `${today} is not inside a numbered teaching week (a weekend or a break). Run this on a school day.`
    );
  }
  weekN = current.weekNumber;

  // Write down what we are about to add, BEFORE adding it.
  state = {
    ...emptyState(),
    termId,
    subjectId,
    levelId,
    sectionIds: [S1.id, S2.id],
  };
  saveState();

  // The two teachers each co-teach the other's class, so both classes are on
  // both teachers' pages.
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
  state.assignmentIds = (co ?? []).map((r) => r.id as string);
  saveState();

  // Four approval steps, as an administrator would set them. Steps the flow
  // already has are switched off for the walk and back on afterwards.
  const { data: existing } = await db
    .from('approval_stages')
    .select('id')
    .eq('flow', FLOW)
    .eq('is_active', true);
  state.pausedStageIds = (existing ?? []).map((r) => r.id as string);
  saveState();
  if (state.pausedStageIds.length) {
    const { error } = await db
      .from('approval_stages')
      .update({ is_active: false })
      .in('id', state.pausedStageIds);
    if (error) throw error;
  }
  const { data: stages, error: stageErr } = await db
    .from('approval_stages')
    .insert(
      STEPS.map((label, i) => ({
        flow: FLOW,
        stage_order: i + 1,
        label,
        resolver: i === 0 ? 'subject_head' : 'named',
      }))
    )
    .select('id, stage_order');
  if (stageErr) throw stageErr;
  state.addedStageIds = (stages ?? []).map((s) => s.id as string);
  saveState();
  const stageId = (order: number) =>
    (stages ?? []).find((s) => s.stage_order === order)!.id as string;
  const { error: apprErr } = await db.from('approval_stage_approvers').insert([
    {
      stage_id: stageId(2),
      user_id: idOf(OIC.primary),
      applies_to_level_type: 'primary',
    },
    {
      stage_id: stageId(2),
      user_id: idOf(OIC.secondary),
      applies_to_level_type: 'secondary',
    },
    {
      stage_id: stageId(3),
      user_id: idOf(ASST_P),
      applies_to_level_type: null,
    },
    { stage_id: stageId(4), user_id: idOf(AEB), applies_to_level_type: null },
  ]);
  if (apprErr) throw apprErr;

  // A third teacher heads the subject.
  const { data: headRow, error: headErr } = await db
    .from('subject_heads')
    .insert({
      subject_id: subjectId,
      user_id: HEAD.id,
      applies_to_level_type: null,
    })
    .select('id')
    .single();
  if (headErr) throw headErr;
  state.headRowId = headRow!.id as string;
  saveState();

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
  saveState();
});

test.afterAll(async () => {
  await cleanup();
});

// ── helpers ────────────────────────────────────────────────────────────────

async function signIn(page: Page, email: string) {
  // One browser page plays several people in turn.
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

const className = (c: Cls) => `${levelLabel} ${c.name}`;
const sowPage = (page: Page) => page.goto(`${SIS}/classroom/sow/${sowId}`);
const classGroup = (page: Page, c: Cls) =>
  page.locator(`[aria-label="${c.name} this week"]`);
const isPost =
  (path: string) => (r: { url(): string; request(): { method(): string } }) =>
    new URL(r.url()).pathname === path && r.request().method() === 'POST';
const isDecide = (r: { url(): string; request(): { method(): string } }) =>
  /\/api\/approvals\/[0-9a-f-]{36}\/decide$/.test(new URL(r.url()).pathname) &&
  r.request().method() === 'POST';

function queueRow(page: Page) {
  return page.getByRole('row').filter({
    has: page.getByText(subjectName, { exact: true }),
    hasText: `· ${levelLabel}`,
  });
}

async function expectNotInQueue(page: Page) {
  await page.goto(`${SIS}/classroom/sow/review`);
  await expect(
    page.getByRole('heading', { name: 'Waiting for you.' })
  ).toBeVisible();
  await expect(queueRow(page)).toHaveCount(0);
}

/** Signs in as an approver, vets or approves, and checks it left their list. */
async function decideAs(
  page: Page,
  email: string,
  buttonName: 'Looks good, send on' | 'Approve'
) {
  await signIn(page, email);
  await page.goto(`${SIS}/classroom/sow/review`);
  const row = queueRow(page);
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Open' }).click();
  await page.waitForURL(`**/classroom/sow/${sowId}`);
  const button = page.getByRole('button', { name: buttonName, exact: true });
  await expect(button).toBeVisible();
  await shot(page, `walk-approver-${email.split('@')[0]}.png`);
  const decided = page.waitForResponse(isDecide);
  await button.click();
  expect((await decided).ok()).toBe(true);
  await expectNotInQueue(page);
}

async function liveRequest() {
  const { data: sow } = await db
    .from('schemes_of_work')
    .select('state, current_submission_id, approved_snapshot')
    .eq('id', sowId)
    .single();
  const { data: req } = await db
    .from('approval_requests')
    .select('id, status')
    .eq('subject_id', sow!.current_submission_id as string)
    .single();
  const { data: stages } = await db
    .from('approval_request_stages')
    .select('stage_order, status')
    .eq('request_id', req!.id)
    .order('stage_order');
  return {
    sow,
    req,
    stages: (stages ?? []).map((s) => `${s.stage_order}:${s.status}`),
  };
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

// ── 1 ──────────────────────────────────────────────────────────────────────

test('the teacher starts a blank scheme and writes Week 1', async ({
  page,
}) => {
  await signIn(page, A.email);
  await page.goto(`${SIS}/classroom/sow?term=${termNumber}`);
  const row = page.getByRole('row').filter({
    has: page.getByText(subjectName, { exact: true }),
    hasText: `· ${levelLabel}`,
  });
  await expect(row.getByText('Not started', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Start SOW' }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('New SOW', { exact: true })).toBeVisible();
  // Both classes are the teacher's (one held, one co-taught), so both are ticked.
  for (const c of [S1, S2]) {
    await expect(
      drawer.getByRole('checkbox', { name: className(c) })
    ).toBeChecked();
  }
  await drawer.getByRole('radio', { name: /Start blank/ }).click();
  const created = page.waitForResponse((r) => isPost('/api/sow')(r) && r.ok());
  await drawer.getByRole('button', { name: 'Create draft' }).click();
  await created;
  await page.waitForURL(/\/classroom\/sow\/[0-9a-f-]{36}$/);
  sowId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  // Week 1, in the drawer.
  await page.getByRole('button', { name: 'Edit week 1', exact: true }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Topic').fill(WEEK1_TOPIC);
  await fillRich(page.locator('#week-outcomes'), 'E2E Walk compare fractions');
  await fillRich(page.locator('#week-activities'), 'E2E Walk number line');
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/weeks/1') &&
      r.request().method() === 'PATCH'
  );
  await edit.getByRole('button', { name: 'Save Week 1' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(edit).toBeHidden();
  await shot(page, 'walk-1-draft.png');

  // The scheme holds both classes and Week 1's text.
  const { data: classes } = await db
    .from('scheme_of_work_classes')
    .select('section_id')
    .eq('sow_id', sowId);
  expect((classes ?? []).map((c) => c.section_id).sort()).toEqual(
    [S1.id, S2.id].sort()
  );
  const { data: wk } = await db
    .from('scheme_of_work_weeks')
    .select('topic')
    .eq('sow_id', sowId)
    .eq('week_number', 1)
    .single();
  expect(wk?.topic).toBe(WEEK1_TOPIC);

  // A scheme can only be sent with a topic in every week. Week 1 was written
  // by hand above; the rest are filled here to save the walk 20 more drawers.
  const { data: rest } = await db
    .from('scheme_of_work_weeks')
    .select('week_number')
    .eq('sow_id', sowId)
    .neq('week_number', 1);
  for (const w of rest ?? []) {
    const { error } = await db
      .from('scheme_of_work_weeks')
      .update({ topic: `E2E Walk topic ${w.week_number}` })
      .eq('sow_id', sowId)
      .eq('week_number', w.week_number);
    if (error) throw error;
  }
});

// ── 2 ──────────────────────────────────────────────────────────────────────

test('the teacher sends it: in review at the Subject head', async ({
  page,
}) => {
  await signIn(page, A.email);
  await sowPage(page);
  const sent = page.waitForResponse(isPost(`/api/sow/${sowId}/submit`));
  await page.getByRole('button', { name: 'Send for review' }).click();
  expect((await sent).ok()).toBe(true);
  await expect(
    page.getByText('In review · Subject head', { exact: true })
  ).toBeVisible();
  await shot(page, 'walk-2-in-review.png');

  const live = await liveRequest();
  expect(live.sow?.state).toBe('in_review');
  expect(live.stages).toEqual([
    '1:pending',
    '2:waiting',
    '3:waiting',
    '4:waiting',
  ]);
});

// ── 3 ──────────────────────────────────────────────────────────────────────

test('subject head, OIC, Assistant Principal and AEB: approved', async ({
  page,
}) => {
  await decideAs(page, HEAD.email, 'Looks good, send on');
  expect((await liveRequest()).stages).toEqual([
    '1:approved',
    '2:pending',
    '3:waiting',
    '4:waiting',
  ]);
  await decideAs(page, OIC[levelType], 'Looks good, send on');
  await decideAs(page, ASST_P, 'Looks good, send on');
  await decideAs(page, AEB, 'Approve');

  await signIn(page, A.email);
  await sowPage(page);
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await shot(page, 'walk-3-approved.png');

  const live = await liveRequest();
  expect(live.req?.status).toBe('approved');
  expect(live.sow?.state).toBe('approved');
  const snapshot = live.sow?.approved_snapshot as {
    weeks: { weekNumber: number; topic: string }[];
  } | null;
  expect(snapshot?.weeks.find((w) => w.weekNumber === 1)?.topic).toBe(
    WEEK1_TOPIC
  );
});

// ── 4 ──────────────────────────────────────────────────────────────────────

test('the teacher checks the week for both classes', async ({ page }) => {
  await signIn(page, A.email);
  await sowPage(page);
  await expect(
    page.getByText(`How did Week ${weekN} go?`, { exact: true })
  ).toBeVisible();

  const answers: number[] = [];
  page.on('response', (r) => {
    if (isPost(`/api/sow/${sowId}/checks`)(r)) answers.push(r.status());
  });
  await classGroup(page, S1)
    .getByRole('radio', { name: 'As planned', exact: true })
    .click();
  await classGroup(page, S2)
    .getByRole('radio', { name: 'Delayed', exact: true })
    .click();
  await fillRich(page.locator(`#check-note-${S2.id}`), DELAYED_NOTE);
  await shot(page, 'walk-4-check-form.png');
  await page.getByRole('button', { name: `Save Week ${weekN}` }).click();
  await expect.poll(() => answers.length).toBe(2);
  expect(answers).toEqual([200, 200]);

  const rows = await checkRows();
  expect(rows).toHaveLength(2);
  const s1 = rows.find((r) => r.section_id === S1.id);
  const s2 = rows.find((r) => r.section_id === S2.id);
  expect(s1).toMatchObject({ teacher_user_id: A.id, option: 'as_planned' });
  expect(s2).toMatchObject({ teacher_user_id: A.id, option: 'delayed' });
  expect(s2?.note).toContain(DELAYED_NOTE);
});

// ── 5 ──────────────────────────────────────────────────────────────────────

test('the relief teacher records what was covered', async ({ page }) => {
  await signIn(page, RELIEF.email);
  await page.goto(`${SIS}/classroom`);
  const panel = page.locator(
    'section[aria-labelledby="upcoming-cover-heading"]'
  );
  await expect(
    panel.getByRole('heading', { name: /You.re covering/ })
  ).toBeVisible();
  const row = panel.getByRole('listitem').filter({
    hasText: new RegExp(`${esc(S2.name)} · `),
  });
  await expect(row).toHaveCount(1);
  await row.getByRole('link', { name: /See today.s lesson/ }).click();
  await page.waitForURL(`**/classroom/sow/covering/${S2.id}/${subjectId}`);
  await expect(
    page.getByRole('heading', { name: `E2E Walk topic ${weekN}` })
  ).toBeVisible();

  await fillRich(page.locator('#relief-covered'), RELIEF_NOTE);
  const saved = page.waitForResponse(isPost('/api/sow/relief-notes'));
  await page.getByRole('button', { name: 'Save what I covered' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText(`Saved to Week ${weekN}.`)).toBeVisible();
  await shot(page, 'walk-5-relief-saved.png');

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
});

// ── 6 ──────────────────────────────────────────────────────────────────────

test('the subject head reviews the week and signs it', async ({ page }) => {
  await signIn(page, HEAD.email);
  await page.goto(
    `${SIS}/classroom/sow/oversight?term=${termNumber}&view=checks&level=${levelId}`
  );
  await expect(
    page.getByRole('heading', { name: 'Needs a look' })
  ).toBeVisible();

  const needs = page.locator('li').filter({
    hasText: `${className(S2)} · ${subjectName}, Wk ${weekN}`,
  });
  await expect(needs).toHaveCount(1);
  await expect(needs).toContainText(`Delayed: “${DELAYED_NOTE}”`);
  await needs.getByRole('button', { name: 'Review and sign' }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(`Week ${weekN} ·`)).toBeVisible();
  await expect(drawer.getByText(DELAYED_NOTE)).toBeVisible();
  await expect(drawer.getByText(RELIEF_NOTE)).toBeVisible();
  await fillRich(drawer.locator('#supervisor-remarks'), HEAD_REMARKS);
  await shot(page, 'walk-6-sign-drawer.png');

  const signed = page.waitForResponse(isPost(`/api/sow/${sowId}/signoffs`));
  await drawer.getByRole('button', { name: `Sign Week ${weekN}` }).click();
  expect((await signed).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(needs).toHaveCount(0);
  await shot(page, 'walk-6-signed.png');

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

  // The signed week is closed to the teacher.
  await signIn(page, A.email);
  const refused = await page.request.post(`${SIS}/api/sow/${sowId}/checks`, {
    data: {
      weekNumber: weekN,
      sectionId: S2.id,
      option: 'as_planned',
      note: null,
    },
  });
  expect(refused.status()).toBe(423);
});
