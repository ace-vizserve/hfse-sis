import { expect, test, type Page } from '@playwright/test';
import { LOCAL_PASSWORD, localDb } from '../parent-portal/local-db';

// Scheme of work, phase 1 gate (LOCAL stack only): who heads each subject, and
// the approvers screen's new "Subject head for that subject" step. Everything a
// person would do is driven through the real screens in a browser; the local
// database is only read to arrange the data and to check what was saved.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';
const SOW_FLOW = 'markbook.scheme_of_work';
const SOW_TITLE = 'Classroom · Scheme of work approval';
const DECLARATION_TITLE = 'Attendance · Absence and travel declarations';
// Not "Subject head": the local stack's own scheme of work steps use that.
const STEP_LABEL = 'Subject head (e2e)';

const db = localDb();

type HeadRow = {
  subject_id: string;
  user_id: string;
  applies_to_level_type: string | null;
};

// What the suite found and must put back.
let savedHeads: HeadRow[] = [];
let stageIdsBefore: string[] = [];
let staff: { id: string; email: string };
// Chosen from the screen in test 1, reused by the rest.
let subjectName = '';
let subjectId = '';

test.describe.configure({ mode: 'serial' });

async function sowStageIds(): Promise<string[]> {
  const { data, error } = await db
    .from('approval_stages')
    .select('id')
    .eq('flow', SOW_FLOW);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

/** Puts the database back the way the suite found it. Safe to run twice. */
async function restore() {
  const added = (await sowStageIds()).filter(
    (id) => !stageIdsBefore.includes(id)
  );
  if (added.length) {
    await db.from('approval_stage_approvers').delete().in('stage_id', added);
    const { error } = await db.from('approval_stages').delete().in('id', added);
    if (error) throw error;
  }
  const { error: delErr } = await db
    .from('subject_heads')
    .delete()
    .not('id', 'is', null);
  if (delErr) throw delErr;
  if (savedHeads.length) {
    const { error } = await db.from('subject_heads').insert(savedHeads);
    if (error) throw error;
  }
}

test.beforeAll(async () => {
  // A staff account to name as a head: a seeded local one, not the admin.
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const pick = data.users.find(
    (u) =>
      u.email?.endsWith('@local.test') &&
      u.email !== 'admin@local.test' &&
      !u.banned_until
  );
  if (!pick?.email)
    throw new Error('No seeded staff account to name as a head.');
  staff = { id: pick.id, email: pick.email };

  const { data: heads, error: headsErr } = await db
    .from('subject_heads')
    .select('subject_id, user_id, applies_to_level_type');
  if (headsErr) throw headsErr;
  savedHeads = (heads ?? []) as HeadRow[];
  stageIdsBefore = await sowStageIds();

  // Start from "nobody heads anything", and with no step left by a crashed run.
  // The heads found are put back by afterAll.
  await restore();
  const { error: clearErr } = await db
    .from('subject_heads')
    .delete()
    .not('id', 'is', null);
  if (clearErr) throw clearErr;
});

test.afterAll(async () => {
  await restore();
});

// ── helpers ────────────────────────────────────────────────────────────────

async function adminSignIn(page: Page) {
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill('admin@local.test');
  await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function openSubjectHeads(page: Page) {
  await page.goto(`${SIS}/sis/admin/subject-heads`);
  await expect(
    page.getByRole('heading', { name: /Subject heads/ }).first()
  ).toBeVisible();
}

/** The row's "Edit" opens the drawer where heads are added and removed. */
async function openEditor(page: Page) {
  await subjectRow(page)
    .getByRole('button', { name: `Edit heads of ${subjectName}` })
    .click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

const removeButton = () =>
  new RegExp(`^Remove .+ as a head of ${subjectName}$`);

/** The answer to the Subject heads save, so no step hangs on a toast that may have gone. */
function waitForSave(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().includes('/api/sis-admin/subject-heads') &&
      r.request().method() === 'PUT' &&
      r.ok()
  );
}

function subjectRow(page: Page) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText(subjectName, { exact: true }) });
}

// The approvers page shows one flow at a time, on tabs; only the chosen tab's
// card is on the page.
function flowCard(page: Page, title: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}

// ── 1 & 2: subject heads ───────────────────────────────────────────────────

test('subject heads: an admin sets one, and it is saved', async ({ page }) => {
  await adminSignIn(page);
  await openSubjectHeads(page);
  await expect(page.getByText(/still need a head/)).toBeVisible();

  // The starting state is explicit: beforeAll cleared every head.
  const { count: headsAtStart } = await db
    .from('subject_heads')
    .select('id', { count: 'exact', head: true });
  expect(headsAtStart).toBe(0);

  // First subject on the screen that nobody heads yet, and a name that no other
  // subject's name contains, so the row can be told apart by its text.
  // Wait for the rows to render before reading them (the read does not wait).
  const nameCells = page.locator('tbody tr td:first-child span.font-medium');
  await expect(nameCells.first()).toBeVisible();
  const names = (await nameCells.allInnerTexts()).map((n) => n.trim());
  expect(names.length).toBeGreaterThan(0);
  subjectName =
    names.find((n) => names.filter((m) => m.includes(n)).length === 1) ??
    names[0];
  const { data: subj } = await db
    .from('subjects')
    .select('id')
    .eq('name', subjectName)
    .single();
  subjectId = subj!.id as string;
  await shot(page, 'subject-heads-before.png');

  await expect(subjectRow(page).getByText('Needs a head')).toBeVisible();
  const sheet = await openEditor(page);
  // Nobody named yet: nobody to remove.
  await expect(sheet.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await sheet.getByPlaceholder('Search staff').fill(staff.email);
  const saveResponse = waitForSave(page);
  await page.getByRole('option', { name: new RegExp(staff.email) }).click();
  // A subject taught in both halves asks which levels; "Every level" is the
  // plain one. Wait for whichever comes first (the save itself, or the
  // question) — an instant visibility check races the popover's next step.
  const everyLevel = page.getByRole('button', { name: 'Every level' });
  await Promise.race([
    saveResponse.then(() => undefined),
    everyLevel.waitFor({ state: 'visible' }),
  ]);
  if (await everyLevel.isVisible()) await everyLevel.click();

  // Saved: the server answered, the drawer lists them, the row says so.
  await saveResponse;
  await expect(
    sheet.getByRole('button', { name: removeButton() })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(subjectRow(page).getByText('Has a head')).toBeVisible();
  await shot(page, 'subject-heads-after.png');

  const { data: rows } = await db
    .from('subject_heads')
    .select('user_id, applies_to_level_type')
    .eq('subject_id', subjectId);
  expect(rows).toEqual([{ user_id: staff.id, applies_to_level_type: null }]);

  // Still there after a reload.
  await openSubjectHeads(page);
  await expect(subjectRow(page).getByText('Has a head')).toBeVisible();
});

test('subject heads: removing one', async ({ page }) => {
  await adminSignIn(page);
  await openSubjectHeads(page);
  const sheet = await openEditor(page);
  const saveResponse = waitForSave(page);
  await sheet.getByRole('button', { name: removeButton() }).click();
  await saveResponse;

  // Back to the plain "no head" state.
  await expect(sheet.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(subjectRow(page).getByText('Needs a head')).toBeVisible();
  await shot(page, 'subject-heads-removed.png');

  const { data: rows } = await db
    .from('subject_heads')
    .select('id')
    .eq('subject_id', subjectId);
  expect(rows).toEqual([]);
});

// ── 3 & 4: the approvers screen ────────────────────────────────────────────

test('approvers: the scheme of work flow offers a subject-head step', async ({
  page,
}) => {
  await adminSignIn(page);
  await page.goto(`${SIS}/sis/admin/approvers`);
  await page.getByRole('tab', { name: /^Scheme of work/ }).click();
  const sow = flowCard(page, SOW_TITLE);
  await expect(sow).toBeVisible();

  // The attendance flow never offers it.
  await page.getByRole('tab', { name: /^Absence declarations/ }).click();
  const attendance = flowCard(page, DECLARATION_TITLE);
  await attendance.getByRole('button', { name: 'Add a step' }).click();
  const attendanceDialog = page.getByRole('dialog');
  await expect(
    attendanceDialog.getByRole('radio', { name: /form class adviser/ })
  ).toBeVisible();
  await expect(
    attendanceDialog.getByRole('radio', {
      name: /Subject head for that subject/,
    })
  ).toHaveCount(0);
  await attendanceDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(attendanceDialog).toBeHidden();

  // The scheme of work flow does.
  await page.getByRole('tab', { name: /^Scheme of work/ }).click();
  await sow.getByRole('button', { name: 'Add a step' }).click();
  const dialog = page.getByRole('dialog');
  const option = dialog.getByRole('radio', {
    name: /Subject head for that subject/,
  });
  await expect(option).toBeVisible();
  await dialog.getByLabel('Step name').fill(STEP_LABEL);
  await option.check();
  await shot(page, 'sow-add-step.png');
  await dialog.getByRole('button', { name: 'Add the step' }).click();
  await expect(dialog).toBeHidden();

  // It is in the flow's list, and saved as a subject-head step.
  await expect(
    sow.getByRole('listitem').filter({ hasText: STEP_LABEL }).first()
  ).toBeVisible();
  const { data: stages } = await db
    .from('approval_stages')
    .select('label, resolver, is_active')
    .eq('flow', SOW_FLOW)
    .eq('label', STEP_LABEL);
  expect(stages).toEqual([
    { label: STEP_LABEL, resolver: 'subject_head', is_active: true },
  ]);
});

test('approvers: readiness tells the truth about subject heads', async ({
  page,
}) => {
  await adminSignIn(page);

  // The step is there and nobody heads any subject (the afterAll puts back any
  // that existed before). The card says so and points at the fix.
  await page.goto(`${SIS}/sis/admin/approvers`);
  await page.getByRole('tab', { name: /^Scheme of work/ }).click();
  const sow = flowCard(page, SOW_TITLE);
  await expect(sow.getByText('No subject heads set yet').first()).toBeVisible();
  await expect(
    sow.getByText(
      /Every scheme of work stops at .+ until its subject has a head/
    )
  ).toBeVisible();
  const link = sow.getByRole('link', { name: 'Set subject heads' });
  await expect(link).toHaveAttribute('href', '/sis/admin/subject-heads');
  await shot(page, 'sow-readiness-warning.png');

  // Somebody is set as head of one subject; the warning goes.
  const { error } = await db.from('subject_heads').insert({
    subject_id: subjectId,
    user_id: staff.id,
    applies_to_level_type: null,
  });
  expect(error).toBeNull();
  await page.reload();
  // Ready now, so the page opens on another tab.
  await page.getByRole('tab', { name: /^Scheme of work/ }).click();
  const sowAfter = flowCard(page, SOW_TITLE);
  await expect(sowAfter).toBeVisible();
  await expect(sowAfter.getByText('No subject heads set yet')).toHaveCount(0);
  await expect(sowAfter.getByText(/Every scheme of work stops at/)).toHaveCount(
    0
  );
  await expect(
    sowAfter.getByRole('link', { name: 'Set subject heads' })
  ).toHaveCount(0);
  await shot(page, 'sow-readiness-ready.png');
});
