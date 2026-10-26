import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import {
  buildTemplate,
  type TemplateWeek,
} from '../../__tests__/sow/fixtures/build-template';
import { parseSowWorkbook } from '../../lib/sow/excel-import';
import { loadTermWeeks } from '../../lib/sow/weeks';
import { LOCAL_PASSWORD, localDb } from '../parent-portal/local-db';

// Scheme of work, phase 4 gate (LOCAL stack only): the Excel import and the
// download. A workbook in the school's template layout (invented content, built
// here, never the school's real file) is imported into a draft through the real
// drawer, and the draft is downloaded again; the module details and every
// week's text must come back the same. The local database arranges the setup
// and checks what was saved.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';
const TEACHER = 'teacher18@local.test';
const MODULE_TITLE = 'E2E Imported Module';

const db = localDb();

type Group = {
  subjectId: string;
  subjectName: string;
  levelId: string;
  levelLabel: string;
  track: 'Standard' | 'Global';
  mine: { id: string; name: string }[];
};

let teacherId = '';
let termId = '';
let termNumber = 0;
let ayId = '';
let group: Group;
let otherLevelLabel = '';
let termWeekCount = 0;
let goodFile = '';
let wrongTabFile = '';
let textFile = '';
let sowId = '';
const createdSowIds = new Set<string>();

test.describe.configure({ mode: 'serial' });

async function sowIdsFor(g: Group): Promise<string[]> {
  const { data, error } = await db
    .from('schemes_of_work')
    .select('id')
    .eq('term_id', termId)
    .match({
      subject_id: g.subjectId,
      level_id: g.levelId,
      track: g.track,
    });
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

/** Removes every scheme this suite owns (weeks and classes cascade). Safe to run twice. */
async function cleanup() {
  const ids = new Set(createdSowIds);
  if (group && termId) for (const id of await sowIdsFor(group)) ids.add(id);
  if (ids.size === 0) return;
  const { error } = await db
    .from('schemes_of_work')
    .delete()
    .in('id', [...ids]);
  if (error) throw error;
}

/** Rich text as the plain lines a person reads. */
function flat(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<\/p>\s*<p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function weeksOf(count: number): TemplateWeek[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      number: n,
      topic: `E2E topic ${n}`,
      outcomes: `E2E outcome ${n}a\nE2E outcome ${n}b`,
      pages: `E2E pages ${n}0-${n}9`,
      activities: `E2E activity ${n}\n\nE2E second paragraph ${n}`,
      remarks: `E2E remark ${n}`,
    };
  });
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

  const { data: assigns, error: assignErr } = await db
    .from('teacher_assignments')
    .select(
      'subject_id, section_id, sections!inner(id, name, level_id, class_type, academic_year_id, levels(label)), subjects(name)'
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
      levels: { label: string };
    };
    if (s.academic_year_id !== ayId) continue;
    if (!configured.has(a.subject_id)) continue;
    if (!offered.has(`${a.subject_id}|${s.level_id}`)) continue;
    const track = s.class_type === 'Global' ? 'Global' : 'Standard';
    const key = `${a.subject_id}|${s.level_id}|${track}`;
    const g = groups.get(key) ?? {
      subjectId: a.subject_id as string,
      subjectName: (a.subjects as unknown as { name: string }).name,
      levelId: s.level_id,
      levelLabel: s.levels.label,
      track: track as 'Standard' | 'Global',
      mine: [],
    };
    g.mine.push({ id: s.id, name: s.name });
    groups.set(key, g);
  }

  // A group with no scheme this term (a crashed run's leftovers are removed
  // first, so its group counts as free).
  const candidates = [...groups.values()];
  const rest: Group[] = [];
  for (const g of candidates) {
    const ids = await sowIdsFor(g);
    // Leftovers of this suite carry its module title; anything else is real.
    if (ids.length === 0) {
      rest.push(g);
      continue;
    }
    const { data: mods } = await db
      .from('schemes_of_work')
      .select('id, module')
      .in('id', ids);
    if (
      (mods ?? []).every(
        (m) => (m.module as { title?: string })?.title === MODULE_TITLE
      )
    ) {
      await db.from('schemes_of_work').delete().in('id', ids);
      rest.push(g);
    }
  }
  if (rest.length < 1) {
    throw new Error(
      `${TEACHER} needs a subject x level x track group with no scheme of work in Term ${termNumber}.`
    );
  }
  group = rest[0];

  const { weeks } = await loadTermWeeks(db, termId, group.levelId);
  termWeekCount = weeks.filter((w) => w.kind === 'week').length;
  expect(termWeekCount).toBeGreaterThan(1);

  // A level of another name, for the wrong-tab file.
  const { data: levels } = await db.from('levels').select('id, label');
  const other = (levels ?? []).find(
    (l) => l.id !== group.levelId && l.label !== group.levelLabel
  );
  if (!other) throw new Error('No second level to build the wrong tab from.');
  otherLevelLabel = other.label as string;
  expect(otherLevelLabel).not.toBe(group.levelLabel);

  // The workbooks, in the test's own output folder.
  const out = test.info().outputPath.bind(test.info());
  goodFile = out('e2e-sow-template.xlsx');
  writeFileSync(
    goodFile,
    Buffer.from(
      buildTemplate([
        {
          name: group.levelLabel,
          weeks: weeksOf(termWeekCount),
          header: { 'Module Title': MODULE_TITLE },
        },
      ])
    )
  );
  wrongTabFile = out('e2e-sow-wrong-level.xlsx');
  writeFileSync(
    wrongTabFile,
    Buffer.from(
      buildTemplate([{ name: otherLevelLabel, weeks: weeksOf(termWeekCount) }])
    )
  );
  textFile = out('e2e-sow-not-excel.xlsx');
  writeFileSync(textFile, 'this is plain text, not a workbook\n');
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

function listRow(page: Page, g: Group) {
  return page.getByRole('row').filter({
    has: page.getByText(g.subjectName, { exact: true }),
    hasText: `${g.levelLabel} · ${g.track}`,
  });
}

async function openImportDrawer(page: Page) {
  await page.goto(`${SIS}/classroom/sow?term=${termNumber}`);
  await listRow(page, group).getByRole('button', { name: 'Start SOW' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('New SOW', { exact: true })).toBeVisible();
  await drawer.getByRole('radio', { name: /Import from Excel/ }).click();
  return drawer;
}

const isPreview = (r: { url(): string; request(): { method(): string } }) =>
  new URL(r.url()).pathname === '/api/sow/import' &&
  new URL(r.url()).searchParams.get('preview') === '1' &&
  r.request().method() === 'POST';

// ── 1 ──────────────────────────────────────────────────────────────────────

test('import shows what it read before anything is saved', async ({ page }) => {
  expect(await sowIdsFor(group)).toEqual([]);
  await signIn(page, TEACHER);
  const drawer = await openImportDrawer(page);

  const previewed = page.waitForResponse(isPreview);
  await drawer.locator('#new-sow-file').setInputFiles(goodFile);
  expect((await previewed).ok()).toBe(true);

  await expect(
    drawer.getByText(
      `${MODULE_TITLE} · ${termWeekCount} weeks read from the ${group.levelLabel} tab`,
      { exact: true }
    )
  ).toBeVisible();
  // The file has exactly the term's weeks, so there is nothing to warn about.
  await expect(drawer.locator('ul.list-disc')).toHaveCount(0);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await shot(page, 'sow-import-preview.png');

  // Reading is not saving.
  expect(await sowIdsFor(group)).toEqual([]);
});

// ── 2 ──────────────────────────────────────────────────────────────────────

test('create draft from the import: module details and every week are saved', async ({
  page,
}) => {
  await signIn(page, TEACHER);
  const drawer = await openImportDrawer(page);
  const previewed = page.waitForResponse(isPreview);
  await drawer.locator('#new-sow-file').setInputFiles(goodFile);
  await previewed;
  await expect(drawer.getByText(/weeks read from the/)).toBeVisible();

  const created = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/sow/import' &&
      !new URL(r.url()).searchParams.has('preview') &&
      r.request().method() === 'POST'
  );
  await drawer.getByRole('button', { name: 'Create draft' }).click();
  const res = await created;
  expect(res.ok()).toBe(true);
  await page.waitForURL(/\/classroom\/sow\/[0-9a-f-]{36}$/);
  sowId = new URL(page.url()).pathname.split('/').pop()!;
  createdSowIds.add(sowId);

  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: `${group.levelLabel} ${group.subjectName}`,
    })
  ).toBeVisible();
  await shot(page, 'sow-imported-draft.png');

  // What the workbook held, read by the same parser the server uses.
  const parsed = parseSowWorkbook(
    new Uint8Array(readFileSync(goodFile)).buffer,
    group.levelLabel,
    { termWeekCount }
  );
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.sow.warnings).toEqual([]);

  const { data: sow } = await db
    .from('schemes_of_work')
    .select('started_from, state, module')
    .eq('id', sowId)
    .single();
  expect(sow?.started_from).toBe('import');
  expect(sow?.state).toBe('draft');
  expect(sow?.module).toEqual(parsed.sow.module);
  expect((sow?.module as { title: string }).title).toBe(MODULE_TITLE);

  const { data: weeks } = await db
    .from('scheme_of_work_weeks')
    .select(
      'week_number, topic, learning_outcomes, textbook_pages, activities, remarks'
    )
    .eq('sow_id', sowId)
    .order('week_number');
  expect(weeks).toHaveLength(termWeekCount);
  for (const w of parsed.sow.weeks) {
    const row = weeks!.find((r) => r.week_number === w.weekNumber);
    expect(row, `week ${w.weekNumber}`).toBeTruthy();
    expect(row!.topic).toBe(`E2E topic ${w.weekNumber}`);
    expect(flat(row!.learning_outcomes)).toBe(
      `E2E outcome ${w.weekNumber}a\nE2E outcome ${w.weekNumber}b`
    );
    expect(row!.textbook_pages).toBe(
      `E2E pages ${w.weekNumber}0-${w.weekNumber}9`
    );
    expect(flat(row!.activities)).toBe(
      `E2E activity ${w.weekNumber}\n\nE2E second paragraph ${w.weekNumber}`
    );
    expect(flat(row!.remarks)).toBe(`E2E remark ${w.weekNumber}`);
  }
});

// ── 3 ──────────────────────────────────────────────────────────────────────

test('a wrong file is refused in plain words and nothing is written', async ({
  page,
}) => {
  // Test 2 made the draft; take it away so "nothing written" can be proven.
  await db.from('schemes_of_work').delete().eq('id', sowId);
  createdSowIds.delete(sowId);
  expect(await sowIdsFor(group)).toEqual([]);

  await signIn(page, TEACHER);
  const drawer = await openImportDrawer(page);

  const refused = page.waitForResponse(isPreview);
  await drawer.locator('#new-sow-file').setInputFiles(wrongTabFile);
  expect((await refused).status()).toBe(400);
  await expect(
    drawer.getByText(`This file has no tab for ${group.levelLabel}.`, {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Create draft' })
  ).toBeDisabled();
  await shot(page, 'sow-import-wrong-tab.png');
  expect(await sowIdsFor(group)).toEqual([]);

  const refusedText = page.waitForResponse(isPreview);
  await drawer.locator('#new-sow-file').setInputFiles(textFile);
  expect((await refusedText).status()).toBe(400);
  await expect(
    drawer.getByText(
      'This file could not be read. Choose an Excel (.xlsx) file.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Create draft' })
  ).toBeDisabled();
  await shot(page, 'sow-import-not-excel.png');
  expect(await sowIdsFor(group)).toEqual([]);
});

// ── 4 ──────────────────────────────────────────────────────────────────────

test('download gives back the module details and every week', async ({
  page,
}) => {
  // Import again (the draft from test 2 was removed by test 3).
  await signIn(page, TEACHER);
  const drawer = await openImportDrawer(page);
  const previewed = page.waitForResponse(isPreview);
  await drawer.locator('#new-sow-file').setInputFiles(goodFile);
  await previewed;
  await drawer.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/classroom\/sow\/[0-9a-f-]{36}$/);
  sowId = new URL(page.url()).pathname.split('/').pop()!;
  createdSowIds.add(sowId);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const saved = test.info().outputPath('downloaded-sow.xlsx');
  await download.saveAs(saved);

  const parsed = parseSowWorkbook(
    new Uint8Array(readFileSync(saved)).buffer,
    group.levelLabel,
    { termWeekCount }
  );
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.sow.warnings).toEqual([]);

  const { data: sow } = await db
    .from('schemes_of_work')
    .select('module')
    .eq('id', sowId)
    .single();
  expect(parsed.sow.module).toEqual(sow?.module);

  const { data: weeks } = await db
    .from('scheme_of_work_weeks')
    .select(
      'week_number, topic, learning_outcomes, textbook_pages, activities, assessment, remarks'
    )
    .eq('sow_id', sowId)
    .order('week_number');
  expect(parsed.sow.weeks).toHaveLength(weeks!.length);
  for (const row of weeks!) {
    const w = parsed.sow.weeks.find((x) => x.weekNumber === row.week_number);
    expect(w, `week ${row.week_number}`).toBeTruthy();
    expect(w!.topic).toBe(row.topic ?? '');
    // The sheet holds plain text, where a paragraph break and a line break
    // are both one line break; every line of text must survive.
    const lines = (s: string) => s.split(/\n+/).filter((l) => l !== '');
    expect(lines(flat(w!.learningOutcomes))).toEqual(
      lines(flat(row.learning_outcomes))
    );
    expect(w!.textbookPages).toBe(row.textbook_pages ?? '');
    // The template has one column for activities and assessment together.
    expect(lines(flat(w!.activities))).toEqual(
      lines(flat(row.activities) + '\n' + flat(row.assessment))
    );
    expect(lines(flat(w!.remarks))).toEqual(lines(flat(row.remarks)));
  }
});

// ── 5 ──────────────────────────────────────────────────────────────────────

test("someone who can't read the scheme can't download it", async ({
  page,
}) => {
  // A teacher with no class in this subject at all, and no subject headship.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const { data: onSubject } = await db
    .from('teacher_assignments')
    .select('teacher_user_id')
    .eq('subject_id', group.subjectId);
  const { data: heads } = await db
    .from('subject_heads')
    .select('user_id')
    .eq('subject_id', group.subjectId);
  const blocked = new Set([
    teacherId,
    ...(onSubject ?? []).map((r) => r.teacher_user_id as string),
    ...(heads ?? []).map((r) => r.user_id as string),
  ]);
  const outsider = (users?.users ?? []).find(
    (u) =>
      /^teacher\d+@local\.test$/.test(u.email ?? '') &&
      !blocked.has(u.id) &&
      !u.banned_until
  );
  if (!outsider?.email) {
    throw new Error('No local teacher without a class in this subject.');
  }

  await signIn(page, outsider.email);
  const res = await page.request.get(`${SIS}/api/sow/${sowId}/excel`);
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toMatch(/could not be found/);
});
