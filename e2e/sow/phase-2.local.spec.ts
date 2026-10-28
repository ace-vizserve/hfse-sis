import { expect, test, type Page } from '@playwright/test';
import { formatRange } from '../../components/sow/format';
import { loadTermWeeks } from '../../lib/sow/weeks';
import { LOCAL_PASSWORD, localDb } from '../parent-portal/local-db';

// Scheme of work, phase 2 gate (LOCAL stack only): a teacher starts a scheme of
// work, writes a week, loses a race to someone else, copies last year's, and an
// office user sees it without edit controls. Everything a person would do is
// driven through the real screens; the local database is only read to arrange
// the data and to check what was saved.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';
const TEACHER = 'teacher18@local.test';
const ADMIN = 'admin@local.test';

const db = localDb();

type Group = {
  subjectId: string;
  subjectName: string;
  levelId: string;
  levelLabel: string;
  /** The teacher's own classes in the group (ticked by default). */
  mine: { id: string; name: string }[];
};

let teacherId = '';
let termId = '';
let termNumber = 0;
let ayId = '';
let prevAyId = '';
let prevTermId = '';
/** Group for tests 1–4 and 6, and the group for test 5. */
let blank: Group;
let copy: Group;
/** Every scheme this suite caused to exist, so the afterAll can remove them. */
const createdSowIds = new Set<string>();
let seededLastYearId = '';

test.describe.configure({ mode: 'serial' });

const keyOf = (g: Group) => ({
  subject_id: g.subjectId,
  level_id: g.levelId,
});

async function sowIdsFor(g: Group, forTermId: string): Promise<string[]> {
  const { data, error } = await db
    .from('schemes_of_work')
    .select('id')
    .eq('term_id', forTermId)
    .match(keyOf(g));
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

/** Removes every scheme this suite owns (weeks and classes cascade). Safe to run twice. */
async function cleanup() {
  const ids = new Set(createdSowIds);
  if (seededLastYearId) ids.add(seededLastYearId);
  for (const g of [blank, copy]) {
    if (!g || !termId) continue;
    for (const id of await sowIdsFor(g, termId)) ids.add(id);
  }
  if (ids.size === 0) return;
  const { error } = await db
    .from('schemes_of_work')
    .delete()
    .in('id', [...ids]);
  if (error) throw error;
}

test.beforeAll(async () => {
  const { data: users, error: usersErr } = await db.auth.admin.listUsers({
    perPage: 1000,
  });
  if (usersErr) throw usersErr;
  const teacher = users.users.find((u) => u.email === TEACHER);
  if (!teacher) throw new Error(`${TEACHER} is not on the local stack.`);
  teacherId = teacher.id;

  const { data: ay } = await db
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .single();
  if (!ay) throw new Error('No current academic year.');
  ayId = ay.id as string;

  // The term that holds today, as the page picks it.
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

  // Last year: the next-lower ay_code, and its term with the same number.
  const { data: years } = await db.from('academic_years').select('id, ay_code');
  const prev = (years ?? [])
    .filter((y) => y.ay_code < ay.ay_code)
    .sort((a, b) => b.ay_code.localeCompare(a.ay_code))[0];
  if (!prev) throw new Error('There is no earlier academic year.');
  prevAyId = prev.id as string;
  const { data: prevTerm } = await db
    .from('terms')
    .select('id')
    .eq('academic_year_id', prevAyId)
    .eq('term_number', termNumber)
    .maybeSingle();
  if (!prevTerm)
    throw new Error(`${prev.ay_code} has no Term ${termNumber} to copy from.`);
  prevTermId = prevTerm.id as string;

  // The teacher's substantive subject classes, grouped like the page does.
  const { data: assigns, error: assignErr } = await db
    .from('teacher_assignments')
    .select(
      'subject_id, role, relief_teacher_user_id, section_id, sections!inner(id, name, level_id, academic_year_id, levels(label)), subjects(name)'
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
      academic_year_id: string;
      levels: { label: string };
    };
    if (s.academic_year_id !== ayId) continue;
    if (!configured.has(a.subject_id)) continue;
    const key = `${a.subject_id}|${s.level_id}`;
    if (!offered.has(key)) continue;
    const g = groups.get(key) ?? {
      subjectId: a.subject_id as string,
      subjectName: (a.subjects as unknown as { name: string }).name,
      levelId: s.level_id,
      levelLabel: s.levels.label,
      mine: [],
    };
    g.mine.push({ id: s.id, name: s.name });
    groups.set(key, g);
  }

  // Only groups with no scheme this term and no approved scheme last year
  // (so "Start blank" is the default), plus one the suite will seed for.
  const free: Group[] = [];
  for (const g of groups.values()) {
    if ((await sowIdsFor(g, termId)).length === 0) free.push(g);
  }
  if (free.length < 2) {
    throw new Error(
      `${TEACHER} needs two subject x level groups with no scheme of work in Term ${termNumber}; found ${free.length}.`
    );
  }
  [blank, copy] = free;

  // Start from nothing: no leftovers of this suite from a crashed run.
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
});

// ── helpers ────────────────────────────────────────────────────────────────

async function signIn(page: Page, email: string) {
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill(email);
  await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}

function listRow(page: Page, g: Group) {
  return page.getByRole('row').filter({
    has: page.getByText(g.subjectName, { exact: true }),
    hasText: `· ${g.levelLabel}`,
  });
}

function weekRow(page: Page, n: number) {
  return page
    .locator('ul.divide-y > li')
    .filter({ has: page.getByText(`WK ${n}`, { exact: true }) });
}

function sowIdFromUrl(page: Page): string {
  return new URL(page.url()).pathname.split('/').pop()!;
}

async function openStartDrawer(page: Page, g: Group) {
  await page.goto(`${SIS}/classroom/sow?term=${termNumber}`);
  await listRow(page, g).getByRole('button', { name: 'Start SOW' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('New SOW', { exact: true })).toBeVisible();
  return drawer;
}

/** Creates the draft from the open drawer and waits for the new page. */
async function createDraft(page: Page) {
  const created = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/sow' &&
      r.request().method() === 'POST' &&
      r.ok()
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create draft' })
    .click();
  await created;
  await page.waitForURL(/\/classroom\/sow\/[0-9a-f-]{36}$/);
  const id = sowIdFromUrl(page);
  createdSowIds.add(id);
  return id;
}

function waitForWeekSave(page: Page, n: number) {
  return page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(`/weeks/${n}`) &&
      r.request().method() === 'PATCH'
  );
}

async function fillRich(page: Page, id: string, text: string) {
  const box = page.locator(`#${id} [contenteditable="true"]`);
  await box.click();
  await box.fill(text);
}

// ── 1 ──────────────────────────────────────────────────────────────────────

test('my schemes of work lists the group, not started', async ({ page }) => {
  await signIn(page, TEACHER);
  await page.goto(`${SIS}/classroom/sow`);
  await expect(
    page.getByRole('heading', { name: 'My schemes of work.' })
  ).toBeVisible();

  // The current term's tab is the selected one.
  await expect(
    page.getByRole('tab', { name: `Term ${termNumber}`, selected: true })
  ).toBeVisible();

  const row = listRow(page, blank);
  await expect(row).toBeVisible();
  await expect(row.getByText('Not started', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Start SOW' })).toBeVisible();
  await shot(page, 'sow-list-not-started.png');
});

// ── 2 ──────────────────────────────────────────────────────────────────────

test('start blank: the draft has a row for every week of the term', async ({
  page,
}) => {
  await signIn(page, TEACHER);
  const drawer = await openStartDrawer(page, blank);

  // The group, shown and not picked.
  for (const [label, value] of [
    ['Subject', blank.subjectName],
    ['Level', blank.levelLabel],
    ['Term', `Term ${termNumber}`],
  ]) {
    await expect(
      drawer
        .locator('dt', { hasText: label })
        .locator('xpath=following-sibling::dd')
    ).toHaveText(value);
  }

  // The classes: every class of the level, whatever its class type; the
  // teacher's own are ticked, the rest are not.
  const { data: sections } = await db
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId)
    .eq('level_id', blank.levelId);
  const inGroup = sections ?? [];
  const mineIds = new Set(blank.mine.map((m) => m.id));
  expect(inGroup.length).toBeGreaterThan(0);
  for (const s of inGroup) {
    const box = drawer.getByRole('checkbox', {
      name: `${blank.levelLabel} ${s.name}`,
    });
    if (mineIds.has(s.id)) await expect(box).toBeChecked();
    else await expect(box).not.toBeChecked();
  }

  // No earlier scheme to copy, so blank is the only (and chosen) start.
  await expect(drawer.getByText('Copy from last year')).toHaveCount(0);
  await drawer.getByRole('radio', { name: /Start blank/ }).click();
  await shot(page, 'sow-new-blank-drawer.png');

  const sowId = await createDraft(page);

  // The SOW page: title, Draft, and one row per numbered week with its dates.
  await expect(
    page.getByRole('heading', {
      name: `${blank.levelLabel} ${blank.subjectName}`,
    })
  ).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  const { weeks } = await loadTermWeeks(db, termId, blank.levelId);
  const numbered = weeks.filter((w) => w.kind === 'week');
  const breaks = weeks.filter((w) => w.kind === 'break');
  expect(numbered.length).toBeGreaterThan(0);

  const rows = page.locator('ul.divide-y > li');
  await expect(rows).toHaveCount(numbered.length + breaks.length);
  for (const w of numbered) {
    const row = weekRow(page, w.weekNumber);
    await expect(row).toBeVisible();
    await expect(row).toContainText(formatRange(w.startsOn, w.endsOn));
    await expect(row).toContainText('No topic yet');
  }
  // A break week carries no number.
  for (const b of breaks) {
    const row = rows.filter({ hasNotText: /WK \d/ }).filter({
      hasText: formatRange(b.startsOn, b.endsOn),
    });
    await expect(row.first()).toBeVisible();
  }
  await shot(page, 'sow-draft-page.png');

  // Saved: one draft scheme started blank, its classes, its weeks.
  const { data: sows } = await db
    .from('schemes_of_work')
    .select('id, state, started_from, copied_from_sow_id, created_by')
    .eq('term_id', termId)
    .match(keyOf(blank));
  expect(sows).toEqual([
    {
      id: sowId,
      state: 'draft',
      started_from: 'blank',
      copied_from_sow_id: null,
      created_by: teacherId,
    },
  ]);
  const { data: classes } = await db
    .from('scheme_of_work_classes')
    .select('section_id')
    .eq('sow_id', sowId);
  expect((classes ?? []).map((c) => c.section_id).sort()).toEqual(
    [...mineIds].sort()
  );
  const { data: dbWeeks } = await db
    .from('scheme_of_work_weeks')
    .select('week_number, starts_on, ends_on')
    .eq('sow_id', sowId)
    .order('week_number');
  expect(dbWeeks).toEqual(
    numbered.map((w) => ({
      week_number: w.weekNumber,
      starts_on: w.startsOn,
      ends_on: w.endsOn,
    }))
  );
});

// ── 3 ──────────────────────────────────────────────────────────────────────

test('edit a week: it shows on the row and survives a reload', async ({
  page,
}) => {
  await signIn(page, TEACHER);
  const [sowId] = await sowIdsFor(blank, termId);
  await page.goto(`${SIS}/classroom/sow/${sowId}`);

  const { eventsByWeek } = await loadTermWeeks(db, termId, blank.levelId);
  const week1Events = eventsByWeek.get(1) ?? [];

  await page.getByRole('button', { name: 'Edit week 1', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(/^Week 1 ·/)).toBeVisible();
  if (week1Events.length > 0) {
    await expect(drawer).toContainText(
      `From the school calendar: ${week1Events.join(' · ')}`
    );
  } else {
    await expect(drawer).toContainText('No school events this week.');
  }

  const topic = 'E2E fractions and decimals';
  const outcomes = 'E2E compare and order fractions';
  const activities = 'E2E number line card sort';
  await drawer.getByLabel('Topic').fill(topic);
  await fillRich(page, 'week-outcomes', outcomes);
  await fillRich(page, 'week-activities', activities);
  await shot(page, 'sow-edit-week-drawer.png');

  const saved = waitForWeekSave(page, 1);
  await drawer.getByRole('button', { name: 'Save Week 1' }).click();
  expect((await saved).ok()).toBe(true);

  await expect(weekRow(page, 1)).toContainText(topic);
  await expect(weekRow(page, 1)).toContainText(activities);

  await page.reload();
  await expect(weekRow(page, 1)).toContainText(topic);

  const { data: wk } = await db
    .from('scheme_of_work_weeks')
    .select('topic, learning_outcomes, activities')
    .eq('sow_id', sowId)
    .eq('week_number', 1)
    .single();
  expect(wk?.topic).toBe(topic);
  expect(wk?.learning_outcomes).toContain(outcomes);
  expect(wk?.activities).toContain(activities);
});

// ── 4 ──────────────────────────────────────────────────────────────────────

test('a stale save is refused and nothing is overwritten', async ({ page }) => {
  await signIn(page, TEACHER);
  const [sowId] = await sowIdsFor(blank, termId);
  await page.goto(`${SIS}/classroom/sow/${sowId}`);

  await page.getByRole('button', { name: 'Edit week 2', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(/^Week 2 ·/)).toBeVisible();

  // Someone else saves Week 2 while the drawer is open.
  const theirs = 'E2E written by a colleague';
  const { error } = await db
    .from('scheme_of_work_weeks')
    .update({ topic: theirs, updated_at: new Date().toISOString() })
    .eq('sow_id', sowId)
    .eq('week_number', 2);
  expect(error).toBeNull();

  const mine = 'E2E my own Week 2 topic';
  await drawer.getByLabel('Topic').fill(mine);
  const saved = waitForWeekSave(page, 2);
  await drawer.getByRole('button', { name: 'Save Week 2' }).click();
  expect((await saved).status()).toBe(409);

  await expect(drawer.getByRole('alert')).toHaveText(
    'Someone else changed this week a moment ago — reload to see it.'
  );
  // What was typed is still there, and the drawer stayed open.
  await expect(drawer.getByLabel('Topic')).toHaveValue(mine);
  await shot(page, 'sow-stale-save.png');

  const { data: wk } = await db
    .from('scheme_of_work_weeks')
    .select('topic')
    .eq('sow_id', sowId)
    .eq('week_number', 2)
    .single();
  expect(wk?.topic).toBe(theirs);
});

// ── 5 ──────────────────────────────────────────────────────────────────────

test('copy from last year: topics come across and the extra week can go', async ({
  page,
}) => {
  const { weeks } = await loadTermWeeks(db, termId, copy.levelId);
  const n = weeks.filter((w) => w.kind === 'week').length;
  expect(n).toBeGreaterThan(1);

  // Last year's approved scheme: N + 1 weeks, so one has no place this year.
  const snapshot = {
    module: { title: 'E2E last year module', hoursPerWeek: '4' },
    weeks: Array.from({ length: n + 1 }, (_, i) => ({
      weekNumber: i + 1,
      topic: `E2E last year topic ${i + 1}`,
      learningOutcomes: null,
      textbookPages: null,
      activities: null,
      assessment: null,
      remarks: null,
    })),
  };
  const { data: seeded, error: seedErr } = await db
    .from('schemes_of_work')
    .insert({
      academic_year_id: prevAyId,
      term_id: prevTermId,
      subject_id: copy.subjectId,
      level_id: copy.levelId,
      state: 'approved',
      module: snapshot.module,
      approved_snapshot: snapshot,
      approved_at: new Date().toISOString(),
      started_from: 'blank',
      created_by: teacherId,
    })
    .select('id')
    .single();
  expect(seedErr).toBeNull();
  seededLastYearId = seeded!.id as string;

  await signIn(page, TEACHER);
  const drawer = await openStartDrawer(page, copy);

  // Offered, chosen already, and named.
  const copyOption = drawer.getByRole('radio', { name: /Copy from last year/ });
  await expect(copyOption).toBeChecked();
  const { data: prevAy } = await db
    .from('academic_years')
    .select('ay_code')
    .eq('id', prevAyId)
    .single();
  const lastLabel = `${prevAy!.ay_code} Term ${termNumber}`;
  await expect(drawer).toContainText(`Copy from ${lastLabel}`);
  await shot(page, 'sow-new-copy-drawer.png');

  const sowId = await createDraft(page);

  await expect(
    page.getByText(`${lastLabel} · ${copy.levelLabel} ${copy.subjectName}`, {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText(/^Copied from/)).toBeVisible();
  await expect(weekRow(page, 1)).toContainText('E2E last year topic 1');

  // The extra week is flagged and can be deleted.
  const extra = weekRow(page, n + 1);
  await expect(extra).toContainText('E2E last year topic ' + (n + 1));
  await expect(extra).toContainText(
    'Extra week from last year — merge it into another week or delete it'
  );
  await shot(page, 'sow-copied-extra-week.png');

  await extra.getByRole('button', { name: /^Delete$/ }).click();
  const deleted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(`/weeks/${n + 1}`) &&
      r.request().method() === 'DELETE'
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: `Delete Week ${n + 1}` })
    .click();
  expect((await deleted).ok()).toBe(true);
  await expect(weekRow(page, n + 1)).toHaveCount(0);

  const { data: sow } = await db
    .from('schemes_of_work')
    .select('started_from, copied_from_sow_id')
    .eq('id', sowId)
    .single();
  expect(sow).toEqual({
    started_from: 'copy',
    copied_from_sow_id: seededLastYearId,
  });
  const { data: rows } = await db
    .from('scheme_of_work_weeks')
    .select('week_number')
    .eq('sow_id', sowId);
  expect(rows).toHaveLength(n);
  expect((rows ?? []).some((r) => r.week_number === n + 1)).toBe(false);
});

// ── 6 ──────────────────────────────────────────────────────────────────────

test('someone else reads it but cannot edit it', async ({ page }) => {
  await signIn(page, ADMIN);
  const [sowId] = await sowIdsFor(blank, termId);
  await page.goto(`${SIS}/classroom/sow/${sowId}`);

  await expect(
    page.getByRole('heading', {
      name: `${blank.levelLabel} ${blank.subjectName}`,
    })
  ).toBeVisible();
  // The teacher's written week is readable.
  await expect(weekRow(page, 1)).toContainText('E2E fractions and decimals');

  await expect(page.getByRole('button', { name: /^Edit week/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit module details' })
  ).toHaveCount(0);
  await shot(page, 'sow-read-only.png');
});
