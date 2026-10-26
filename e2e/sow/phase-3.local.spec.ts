import { expect, test, type Page } from '@playwright/test';
import { loadTermWeeks } from '../../lib/sow/weeks';
import { LOCAL_PASSWORD, localDb } from '../parent-portal/local-db';

// Scheme of work, phase 3 gate (LOCAL stack only): the approval ladder. One
// scheme of work goes teacher -> subject head -> OIC -> Assistant Principal ->
// AEB -> approved; a second is returned by the OIC, edited and sent again, and
// starts over at step 1; a third step with nobody on it says it is waiting.
// Everything a person would do is driven through the real screens. The local
// database is used to arrange the setup an administrator would make at
// /sis/admin/approvers (the approval tables are closed to the browser) and to
// check what was saved.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';
const TEACHER = 'teacher18@local.test';
const SUBJECT_HEAD = 'teacher01@local.test';
const OIC = {
  primary: 'oic.primary@local.test',
  secondary: 'oic.secondary@local.test',
};
const ASST_P = 'asst.principal@local.test';
const AEB = 'aeb.member@local.test';
const FLOW = 'markbook.scheme_of_work';
const STEPS = ['Subject head', 'OIC', 'Assistant Principal', 'AEB'] as const;

const db = localDb();

type Group = {
  subjectId: string;
  subjectName: string;
  levelId: string;
  levelLabel: string;
  levelType: 'primary' | 'secondary';
  track: 'Standard' | 'Global';
  mine: { id: string; name: string }[];
};

let teacherId = '';
let termId = '';
let termNumber = 0;
let ayId = '';
const userIds = new Map<string, string>();
/** A walks the whole ladder (and later stalls); B is returned and resent. */
let groupA: Group;
let groupB: Group;
let sowA = '';
let sowB = '';

/** Rows this suite added, so the afterAll removes exactly them. */
const createdSowIds = new Set<string>();
const addedStageIds: string[] = [];
const addedHeadIds: string[] = [];
/** Steps of this flow that were already active, switched off for the run. */
let pausedStageIds: string[] = [];

test.describe.configure({ mode: 'serial' });

const keyOf = (g: Group) => ({
  subject_id: g.subjectId,
  level_id: g.levelId,
  track: g.track,
});

async function sowIdsFor(g: Group): Promise<string[]> {
  const { data, error } = await db
    .from('schemes_of_work')
    .select('id')
    .eq('term_id', termId)
    .match(keyOf(g));
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
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

/** Puts the database back as it was. Safe to run twice, and after a crash. */
async function cleanup() {
  const ids = new Set(createdSowIds);
  for (const g of [groupA, groupB]) {
    if (!g || !termId) continue;
    for (const id of await sowIdsFor(g)) ids.add(id);
  }
  await removeRequestsOf([...ids]);
  if (ids.size > 0) {
    const { error } = await db
      .from('schemes_of_work')
      .delete()
      .in('id', [...ids]);
    if (error) throw error;
  }
  if (addedHeadIds.length) {
    await db.from('subject_heads').delete().in('id', addedHeadIds);
    addedHeadIds.length = 0;
  }
  // Approvers go with their steps (cascade).
  if (addedStageIds.length) {
    await db.from('approval_stages').delete().in('id', addedStageIds);
    addedStageIds.length = 0;
  }
  if (pausedStageIds.length) {
    await db
      .from('approval_stages')
      .update({ is_active: true })
      .in('id', pausedStageIds);
    pausedStageIds = [];
  }
}

async function idOf(email: string): Promise<string> {
  const id = userIds.get(email);
  if (!id) throw new Error(`${email} is not on the local stack.`);
  return id;
}

async function addSubjectHead(subjectId: string) {
  const { data, error } = await db
    .from('subject_heads')
    .insert({
      subject_id: subjectId,
      user_id: await idOf(SUBJECT_HEAD),
      applies_to_level_type: null,
    })
    .select('id')
    .single();
  if (error) throw error;
  addedHeadIds.push(data.id as string);
}

async function removeSubjectHeads() {
  if (addedHeadIds.length === 0) return;
  const { error } = await db
    .from('subject_heads')
    .delete()
    .in('id', addedHeadIds);
  if (error) throw error;
  addedHeadIds.length = 0;
}

/** A complete draft: every numbered term week has a topic. */
async function createDraftSow(g: Group, label: string): Promise<string> {
  const { data: sow, error } = await db
    .from('schemes_of_work')
    .insert({
      academic_year_id: ayId,
      term_id: termId,
      subject_id: g.subjectId,
      level_id: g.levelId,
      track: g.track,
      state: 'draft',
      module: { title: `E2E ${label} module`, hoursPerWeek: '4' },
      started_from: 'blank',
      created_by: teacherId,
    })
    .select('id')
    .single();
  if (error) throw error;
  const id = sow.id as string;
  createdSowIds.add(id);
  const { error: clsErr } = await db
    .from('scheme_of_work_classes')
    .insert(g.mine.map((m) => ({ sow_id: id, section_id: m.id })));
  if (clsErr) throw clsErr;
  const { weeks } = await loadTermWeeks(db, termId, g.levelId);
  const rows = weeks.flatMap((w) =>
    w.kind === 'week'
      ? [
          {
            sow_id: id,
            week_number: w.weekNumber,
            starts_on: w.startsOn,
            ends_on: w.endsOn,
            topic: `E2E ${label} topic ${w.weekNumber}`,
          },
        ]
      : []
  );
  expect(rows.length).toBeGreaterThan(1);
  const { error: wkErr } = await db.from('scheme_of_work_weeks').insert(rows);
  if (wkErr) throw wkErr;
  return id;
}

test.beforeAll(async () => {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    for (const u of data.users) if (u.email) userIds.set(u.email, u.id);
    if (data.users.length < 1000) break;
  }
  teacherId = await idOf(TEACHER);
  for (const email of [SUBJECT_HEAD, OIC.primary, OIC.secondary, ASST_P, AEB]) {
    await idOf(email);
    expect(userIds.get(email)).not.toBe(teacherId);
  }

  const { data: ay } = await db
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .single();
  if (!ay) throw new Error('No current academic year.');
  ayId = ay.id as string;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
  }).format(new Date());
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

  // The teacher's substantive subject classes, grouped like the page does.
  const { data: assigns, error: assignErr } = await db
    .from('teacher_assignments')
    .select(
      'subject_id, section_id, sections!inner(id, name, level_id, class_type, academic_year_id, levels(label, level_type)), subjects(name)'
    )
    .eq('teacher_user_id', teacherId)
    .in('role', ['subject_teacher', 'co_teacher'])
    .not('subject_id', 'is', null);
  if (assignErr) throw assignErr;

  const [{ data: configs }, { data: offerings }] = await Promise.all([
    db
      .from('subject_configs')
      .select('subject_id')
      .eq('academic_year_id', ayId),
    db
      .from('subject_level_offerings')
      .select('subject_id, level_id')
      .eq('academic_year_id', ayId),
  ]);
  const configured = new Set((configs ?? []).map((c) => c.subject_id));
  const offered = new Set(
    (offerings ?? []).map((o) => `${o.subject_id}|${o.level_id}`)
  );

  const groups = new Map<string, Group>();
  for (const a of assigns ?? []) {
    const s = a.sections as unknown as {
      id: string;
      name: string;
      level_id: string;
      class_type: string | null;
      academic_year_id: string;
      levels: { label: string; level_type: string };
    };
    if (s.academic_year_id !== ayId) continue;
    if (!configured.has(a.subject_id)) continue;
    if (!offered.has(`${a.subject_id}|${s.level_id}`)) continue;
    if (
      s.levels.level_type !== 'primary' &&
      s.levels.level_type !== 'secondary'
    )
      continue;
    const track = s.class_type === 'Global' ? 'Global' : 'Standard';
    const key = `${a.subject_id}|${s.level_id}|${track}`;
    const g = groups.get(key) ?? {
      subjectId: a.subject_id as string,
      subjectName: (a.subjects as unknown as { name: string }).name,
      levelId: s.level_id,
      levelLabel: s.levels.label,
      levelType: s.levels.level_type as 'primary' | 'secondary',
      track: track as 'Standard' | 'Global',
      mine: [],
    };
    g.mine.push({ id: s.id, name: s.name });
    groups.set(key, g);
  }

  // Start from nothing: no leftovers of this suite from a crashed run.
  groupA = undefined as unknown as Group;
  const free: Group[] = [];
  for (const g of groups.values()) {
    if ((await sowIdsFor(g)).length === 0) free.push(g);
  }
  if (free.length < 2) {
    throw new Error(
      `${TEACHER} needs two subject x level x track groups with no scheme of work in Term ${termNumber}; found ${free.length}.`
    );
  }
  [groupA, groupB] = free;

  // Four steps, as an administrator would set them. Any steps the flow already
  // has are switched off for the run and switched back on afterwards.
  const { data: existing } = await db
    .from('approval_stages')
    .select('id')
    .eq('flow', FLOW)
    .eq('is_active', true);
  pausedStageIds = (existing ?? []).map((r) => r.id as string);
  if (pausedStageIds.length) {
    const { error } = await db
      .from('approval_stages')
      .update({ is_active: false })
      .in('id', pausedStageIds);
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
  for (const s of stages ?? []) addedStageIds.push(s.id as string);
  const stageId = (order: number) =>
    (stages ?? []).find((s) => s.stage_order === order)!.id as string;
  const { error: apprErr } = await db.from('approval_stage_approvers').insert([
    {
      stage_id: stageId(2),
      user_id: await idOf(OIC.primary),
      applies_to_level_type: 'primary',
    },
    {
      stage_id: stageId(2),
      user_id: await idOf(OIC.secondary),
      applies_to_level_type: 'secondary',
    },
    {
      stage_id: stageId(3),
      user_id: await idOf(ASST_P),
      applies_to_level_type: null,
    },
    {
      stage_id: stageId(4),
      user_id: await idOf(AEB),
      applies_to_level_type: null,
    },
  ]);
  if (apprErr) throw apprErr;

  await addSubjectHead(groupA.subjectId);
  if (groupB.subjectId !== groupA.subjectId) {
    await addSubjectHead(groupB.subjectId);
  }

  sowA = await createDraftSow(groupA, 'ladder');
  sowB = await createDraftSow(groupB, 'return');
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

function queueRow(page: Page, g: Group) {
  return page.getByRole('row').filter({
    has: page.getByText(g.subjectName, { exact: true }),
    hasText: `${g.levelLabel} · ${g.track}`,
  });
}

function weekRowOf(page: Page, n: number) {
  return page
    .locator('ul.divide-y > li')
    .filter({ has: page.getByText(`WK ${n}`, { exact: true }) });
}

function oicOf(g: Group): string {
  return OIC[g.levelType];
}

function isDecide(r: { url(): string; request(): { method(): string } }) {
  return (
    /\/api\/approvals\/[0-9a-f-]{36}\/decide$/.test(
      new URL(r.url()).pathname
    ) && r.request().method() === 'POST'
  );
}

/** From the person's "Waiting for you" list into the scheme's page. */
async function openFromQueue(page: Page, g: Group, sowId: string) {
  await page.goto(`${SIS}/classroom/sow/review`);
  const row = queueRow(page, g);
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Open' }).click();
  await page.waitForURL(`**/classroom/sow/${sowId}`);
}

async function expectNotInQueue(page: Page, g: Group) {
  await page.goto(`${SIS}/classroom/sow/review`);
  await expect(
    page.getByRole('heading', { name: 'Waiting for you.' })
  ).toBeVisible();
  await expect(queueRow(page, g)).toHaveCount(0);
}

/** Signs in as an approver, vets or approves, and checks it left their list. */
async function decideAs(
  page: Page,
  email: string,
  g: Group,
  sowId: string,
  buttonName: 'Vet' | 'Approve'
) {
  await signIn(page, email);
  await openFromQueue(page, g, sowId);
  const button = page.getByRole('button', { name: buttonName, exact: true });
  await expect(button).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Return to teacher' })
  ).toBeVisible();
  await shot(page, `sow-approver-${email.split('@')[0]}.png`);
  const decided = page.waitForResponse(isDecide);
  await button.click();
  expect((await decided).ok()).toBe(true);
  await expectNotInQueue(page, g);
}

async function liveRequest(sowId: string) {
  const { data: sow } = await db
    .from('schemes_of_work')
    .select('state, current_submission_id, approved_snapshot')
    .eq('id', sowId)
    .single();
  const subId = sow?.current_submission_id as string;
  const { data: req } = await db
    .from('approval_requests')
    .select('id, status')
    .eq('subject_id', subId)
    .single();
  const { data: stages } = await db
    .from('approval_request_stages')
    .select('stage_order, label, status, approver_pool')
    .eq('request_id', req!.id)
    .order('stage_order');
  return { sow, subId, req, stages: stages ?? [] };
}

function statusOf(stages: { stage_order: number; status: string }[]) {
  return stages.map((s) => `${s.stage_order}:${s.status}`);
}

// ── 1 ──────────────────────────────────────────────────────────────────────

test('the teacher sends it: In review, at the Subject head, with the step rail', async ({
  page,
}) => {
  await signIn(page, TEACHER);
  await page.goto(`${SIS}/classroom/sow/${sowA}`);
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await shot(page, 'sow-a-draft.png');

  const sent = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/sow/${sowA}/submit` &&
      r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Send for review' }).click();
  expect((await sent).ok()).toBe(true);

  await expect(
    page.getByText('In review · Subject head', { exact: true })
  ).toBeVisible();
  const rail = page.locator('ol').filter({ hasText: 'Assistant Principal' });
  for (const label of STEPS) {
    await expect(rail.getByText(label, { exact: true })).toBeVisible();
  }
  // The sender is told it is waiting, and has no controls to decide it.
  await expect(page.getByText(/Waiting on the Subject head/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vet', exact: true })
  ).toHaveCount(0);
  await shot(page, 'sow-a-in-review.png');

  const { data: subs } = await db
    .from('scheme_of_work_submissions')
    .select('id, outcome, submitted_by')
    .eq('sow_id', sowA);
  expect(subs).toHaveLength(1);
  expect(subs![0].outcome).toBe('pending');
  expect(subs![0].submitted_by).toBe(teacherId);

  const live = await liveRequest(sowA);
  expect(live.sow?.state).toBe('in_review');
  expect(live.req?.status).toBe('pending');
  expect(live.stages.map((s) => s.label)).toEqual([...STEPS]);
  expect(statusOf(live.stages)).toEqual([
    '1:pending',
    '2:waiting',
    '3:waiting',
    '4:waiting',
  ]);
  expect(live.stages[0].approver_pool).toEqual([await idOf(SUBJECT_HEAD)]);
});

// ── 2 ──────────────────────────────────────────────────────────────────────

test('the subject head vets it and it moves to the OIC', async ({ page }) => {
  await decideAs(page, SUBJECT_HEAD, groupA, sowA, 'Vet');

  const live = await liveRequest(sowA);
  expect(statusOf(live.stages)).toEqual([
    '1:approved',
    '2:pending',
    '3:waiting',
    '4:waiting',
  ]);
  // The OIC step froze only the OIC of this half of the school.
  expect(live.stages[1].approver_pool).toEqual([await idOf(oicOf(groupA))]);

  // The teacher sees where it is now.
  await signIn(page, TEACHER);
  await page.goto(`${SIS}/classroom/sow/${sowA}`);
  await expect(
    page.getByText('In review · OIC', { exact: true })
  ).toBeVisible();
});

// ── 3 ──────────────────────────────────────────────────────────────────────

test('nobody off the step sees decide controls', async ({ page }) => {
  for (const email of [TEACHER, ASST_P, SUBJECT_HEAD]) {
    await signIn(page, email);
    await page.goto(`${SIS}/classroom/sow/${sowA}`);
    await expect(
      page.getByRole('heading', {
        name: `${groupA.levelLabel} ${groupA.subjectName}`,
      })
    ).toBeVisible();
    await expect(
      page.getByText('In review · OIC', { exact: true })
    ).toBeVisible();
    for (const name of ['Vet', 'Approve']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
        0
      );
    }
    await expect(
      page.getByRole('button', { name: 'Return to teacher' })
    ).toHaveCount(0);
    if (email === ASST_P) await shot(page, 'sow-a-asst-p-off-step.png');
  }
  // Nor is it on their list.
  await signIn(page, ASST_P);
  await expectNotInQueue(page, groupA);
});

// ── 4 ──────────────────────────────────────────────────────────────────────

test('OIC, Assistant Principal and AEB in turn: it is approved', async ({
  page,
}) => {
  await decideAs(page, oicOf(groupA), groupA, sowA, 'Vet');
  await decideAs(page, ASST_P, groupA, sowA, 'Vet');
  // The last step is the one that says Approve.
  await decideAs(page, AEB, groupA, sowA, 'Approve');

  await signIn(page, TEACHER);
  await page.goto(`${SIS}/classroom/sow/${sowA}`);
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await shot(page, 'sow-a-approved.png');

  const live = await liveRequest(sowA);
  expect(live.req?.status).toBe('approved');
  expect(statusOf(live.stages)).toEqual([
    '1:approved',
    '2:approved',
    '3:approved',
    '4:approved',
  ]);
  expect(live.sow?.state).toBe('approved');
  const snapshot = live.sow?.approved_snapshot as {
    weeks: { weekNumber: number; topic: string }[];
  } | null;
  expect(snapshot).not.toBeNull();
  const { data: weeks } = await db
    .from('scheme_of_work_weeks')
    .select('week_number, topic')
    .eq('sow_id', sowA)
    .order('week_number');
  expect(snapshot!.weeks.map((w) => [w.weekNumber, w.topic])).toEqual(
    (weeks ?? []).map((w) => [w.week_number, w.topic])
  );
  const { data: sub } = await db
    .from('scheme_of_work_submissions')
    .select('outcome')
    .eq('id', live.subId)
    .single();
  expect(sub?.outcome).toBe('approved');
});

// ── 5 ──────────────────────────────────────────────────────────────────────

test('a return, an edit and a resend: the new send starts at step 1', async ({
  page,
}) => {
  await signIn(page, TEACHER);
  await page.goto(`${SIS}/classroom/sow/${sowB}`);
  const sent = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/sow/${sowB}/submit` &&
      r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Send for review' }).click();
  expect((await sent).ok()).toBe(true);
  await expect(
    page.getByText('In review · Subject head', { exact: true })
  ).toBeVisible();
  const first = await liveRequest(sowB);

  await decideAs(page, SUBJECT_HEAD, groupB, sowB, 'Vet');

  // The OIC returns it, naming Week 2.
  await signIn(page, oicOf(groupB));
  await openFromQueue(page, groupB, sowB);
  await page.getByRole('button', { name: 'Return to teacher' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Return to teacher').first()).toBeVisible();
  // Nothing to send until the note is written.
  await expect(
    dialog.getByRole('button', { name: 'Return SOW' })
  ).toBeDisabled();
  const note = 'E2E Week 2 needs a clearer topic';
  const box = dialog.locator('#sow-return-note [contenteditable="true"]');
  await box.click();
  await box.fill(note);
  await dialog.locator('#sow-return-week').click();
  await page.getByRole('option', { name: /^Week 2 ·/ }).click();
  await shot(page, 'sow-b-return-dialog.png');
  const returned = page.waitForResponse(isDecide);
  await dialog.getByRole('button', { name: 'Return SOW' }).click();
  const res = await returned;
  expect(res.ok()).toBe(true);
  await expectNotInQueue(page, groupB);

  const afterReturn = await liveRequest(sowB);
  expect(afterReturn.sow?.state).toBe('returned');
  const { data: sub1 } = await db
    .from('scheme_of_work_submissions')
    .select('outcome, return_note, return_week_number')
    .eq('id', first.subId)
    .single();
  expect(sub1?.outcome).toBe('returned');
  expect(sub1?.return_week_number).toBe(2);
  expect(sub1?.return_note).toContain(note);

  // The teacher sees Returned, the note, and Week 2 flagged.
  await signIn(page, TEACHER);
  await page.goto(`${SIS}/classroom/sow/${sowB}`);
  await expect(
    page.getByText('Returned', { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText('Returned with a note')).toBeVisible();
  // The note in the banner (and quoted on the OIC's step), Week 2 flagged.
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(
    weekRowOf(page, 2).getByText('The return note is about this week')
  ).toBeVisible();
  await expect(
    page.getByText('The return note is about this week')
  ).toHaveCount(1);
  await expect(
    page.getByText(/starts over from the Subject head/)
  ).toBeVisible();
  await shot(page, 'sow-b-returned.png');

  // Edit Week 2, then send again.
  await page.getByRole('button', { name: 'Edit week 2', exact: true }).click();
  const drawer = page.getByRole('dialog');
  const topic = 'E2E Week 2 a clearer topic';
  await drawer.getByLabel('Topic').fill(topic);
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/weeks/2') &&
      r.request().method() === 'PATCH'
  );
  await drawer.getByRole('button', { name: 'Save Week 2' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(drawer).toBeHidden();

  const resent = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/sow/${sowB}/submit` &&
      r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Send for review again' }).click();
  expect((await resent).ok()).toBe(true);
  await expect(
    page.getByText('In review · Subject head', { exact: true })
  ).toBeVisible();
  await shot(page, 'sow-b-resent.png');

  // A new submission and a new request, live at step 1.
  const { data: subs } = await db
    .from('scheme_of_work_submissions')
    .select('id, outcome')
    .eq('sow_id', sowB)
    .order('submitted_at');
  expect(subs).toHaveLength(2);
  expect(subs![0].outcome).toBe('returned');
  expect(subs![1].outcome).toBe('pending');
  expect(subs![1].id).not.toBe(first.subId);
  const again = await liveRequest(sowB);
  expect(again.req?.id).not.toBe(first.req?.id);
  expect(statusOf(again.stages)).toEqual([
    '1:pending',
    '2:waiting',
    '3:waiting',
    '4:waiting',
  ]);

  // And the subject head has it in their list again.
  await signIn(page, SUBJECT_HEAD);
  await page.goto(`${SIS}/classroom/sow/review`);
  await expect(queueRow(page, groupB)).toBeVisible();
});

// ── 6 ──────────────────────────────────────────────────────────────────────

test('a step with nobody on it says it is waiting', async ({ page }) => {
  // Reopen the approved scheme the way the office would, then take the subject
  // head off the subject before it is sent again.
  await db
    .from('schemes_of_work')
    .update({ state: 'draft' })
    .eq('id', sowA)
    .eq('state', 'approved');
  await removeSubjectHeads();
  try {
    await signIn(page, TEACHER);
    await page.goto(`${SIS}/classroom/sow/${sowA}`);
    const sent = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/sow/${sowA}/submit` &&
        r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Send for review' }).click();
    const res = await sent;
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({
      stalled: true,
      stalledStep: 'Subject head',
    });

    await expect(
      page
        .getByRole('main')
        .getByText('Waiting — nobody is set for Subject head yet.')
    ).toBeVisible();
    await expect(
      page.getByText('Nobody has been added to this step yet')
    ).toBeVisible();
    await shot(page, 'sow-a-stalled.png');

    const live = await liveRequest(sowA);
    expect(live.stages[0].approver_pool).toEqual([]);
    expect(live.stages[0].status).toBe('pending');
  } finally {
    await addSubjectHead(groupA.subjectId);
  }
});
