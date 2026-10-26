import { expect, test, type Page } from '@playwright/test';

// The same two features against PRODUCTION: the deployed portal calling
// https://sis.hfse.edu.sg and the production database. There is no service key
// here and nothing is arranged behind the scenes — only what a parent and a
// member of staff can do through the screens.
//
// Read-only by default. Filing writes a real declaration on a real child, so it
// only runs with E2E_PROD_FILE=1, and it is always TURNED DOWN by the adviser
// (with a note saying it was a test) so no class register is ever marked.
//
//   E2E_PORTAL_URL      the portal to drive (staging until the features reach main)
//   E2E_SIS_URL         default https://sis.hfse.edu.sg
//   E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD   a parent login on production
//   E2E_PROD_FILE=1     also file one declaration and have it turned down
//   E2E_ADVISER_EMAIL / E2E_ADVISER_PASSWORD the child's form class adviser
const PORTAL =
  process.env.E2E_PORTAL_URL ?? 'https://online-admission-staging.vercel.app';
const SIS = process.env.E2E_SIS_URL ?? 'https://sis.hfse.edu.sg';
const PARENT_EMAIL = process.env.E2E_PARENT_EMAIL ?? '';
const PARENT_PASSWORD = process.env.E2E_PARENT_PASSWORD ?? '';
const FILE = process.env.E2E_PROD_FILE === '1';
const ADVISER_EMAIL = process.env.E2E_ADVISER_EMAIL ?? '';
const ADVISER_PASSWORD = process.env.E2E_ADVISER_PASSWORD ?? '';
const TEST_NOTE = `Automated test by the SIS team, please ignore (${new Date().toISOString().slice(0, 16)})`;
const TEST_REASON = 'Automated test, not a real absence. No action needed.';

test.describe.configure({ mode: 'serial' });
test.skip(
  !PARENT_EMAIL || !PARENT_PASSWORD,
  'Set E2E_PARENT_EMAIL and E2E_PARENT_PASSWORD.'
);

async function parentSignIn(page: Page) {
  await page.goto(`${PORTAL}/login`);
  await page.getByPlaceholder('name@example.com').fill(PARENT_EMAIL);
  await page.getByPlaceholder('••••••••').fill(PARENT_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/admission\//);
}

function sisCall(page: Page, path: string) {
  return page.waitForResponse(
    (r) =>
      r.url().startsWith(`${SIS}/api/parent/v2/${path}`) &&
      r.request().method() === 'GET'
  );
}

test('report card: the list loads from the SIS, and a published card opens', async ({
  page,
}) => {
  await parentSignIn(page);
  const students = sisCall(page, 'students');
  await page.goto(`${PORTAL}/admission/report-cards`);
  const res = await students;
  expect(res.status()).toBe(200);

  const { students: kids } = (await res.json()) as {
    students: Array<{ publications?: unknown[] }>;
  };
  const published = kids.some((k) => (k.publications ?? []).length > 0);
  test.skip(
    !published,
    'This parent has no report card published right now; the list itself loaded.'
  );

  const card = sisCall(page, 'report-card');
  await page
    .getByRole('button', { name: /Term \d/ })
    .first()
    .click();
  expect((await card).status()).toBe(200);
  await expect(page.getByText('Student Progress Report')).toBeVisible();
  await expect(page.getByText(/unable to load report card/i)).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('prod-report-card.png'),
    fullPage: true,
  });
});

test('declarations: the list and the child picker load from the SIS', async ({
  page,
}) => {
  await parentSignIn(page);
  const list = sisCall(page, 'declarations');
  await page.goto(`${PORTAL}/admission/services/declarations`);
  expect((await list).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Absence & Travel' })
  ).toBeVisible();

  const kids = sisCall(page, 'enrolled-students');
  await page.goto(`${PORTAL}/admission/services/declarations/new`);
  expect((await kids).status()).toBe(200);
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('prod-declarations.png'),
    fullPage: true,
  });
});

test('declaration: file one, the adviser turns it down, the parent reads why', async ({
  page,
  browser,
}) => {
  test.skip(
    !FILE,
    'Filing is off. Set E2E_PROD_FILE=1 to write one real (turned-down) declaration.'
  );
  test.skip(
    !ADVISER_EMAIL || !ADVISER_PASSWORD,
    'Set E2E_ADVISER_EMAIL and E2E_ADVISER_PASSWORD.'
  );

  await parentSignIn(page);

  // Which child the first checkbox is, and which days that child already has a
  // live filing on — the SIS rightly refuses those, so they are skipped.
  const listRes = sisCall(page, 'declarations');
  await page.goto(`${PORTAL}/admission/services/declarations`);
  const { declarations } = (await (await listRes).json()) as {
    declarations: Array<{
      studentNumber: string;
      startDate: string;
      endDate: string;
      status: string;
    }>;
  };
  const kidsRes = sisCall(page, 'enrolled-students');
  await page.goto(`${PORTAL}/admission/services/declarations/new`);
  const { students } = (await (await kidsRes).json()) as {
    students: Array<{ studentNumber: string }>;
  };
  const child = students[0].studentNumber;
  const taken = declarations.filter(
    (d) =>
      d.studentNumber === child &&
      (d.status === 'pending' || d.status === 'approved')
  );

  const sgDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(d);
  const candidates: string[] = [];
  for (const d = new Date(); candidates.length < 8; ) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const iso = sgDate(d);
    if (!taken.some((t) => t.startDate <= iso && iso <= t.endDate))
      candidates.push(iso);
  }

  // A day the school turns out to be shut is refused; start again on the next one.
  const sent = page.getByRole('heading', { name: 'Sent to the school' });
  const refused = page.getByText(/school is closed|already/i);
  let filed = false;
  let filedOn = '';
  for (const iso of candidates.slice(0, 4)) {
    filedOn = iso;
    await page.goto(`${PORTAL}/admission/services/declarations/new`);
    const next = page.getByRole('button', { name: 'Continue' });
    await page.getByRole('checkbox').first().check();
    await next.click();
    await page.getByRole('radio', { name: 'Absence' }).check();
    await next.click();
    const cell = page.locator(`td[data-day="${iso}"] button`);
    if (!(await cell.isVisible()))
      await page.getByRole('button', { name: /next month/i }).click();
    await cell.click();
    await next.click();
    await page.getByRole('radio', { name: 'Without' }).check();
    await next.click();
    await page.getByLabel('Note for the teacher').fill(TEST_NOTE);
    await next.click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(sent.or(refused).first()).toBeVisible();
    if (await sent.isVisible()) {
      filed = true;
      break;
    }
  }
  expect(filed).toBe(true);

  // The adviser finds it in the SIS queue and turns it down — nothing is marked.
  const staff = await (await browser.newContext()).newPage();
  await staff.goto(`${SIS}/login`);
  await staff.getByPlaceholder('you@hfse.edu.sg').fill(ADVISER_EMAIL);
  await staff.locator('input[type="password"]').fill(ADVISER_PASSWORD);
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await staff.waitForURL((u) => !u.pathname.startsWith('/login'));
  await staff.goto(`${SIS}/attendance/declarations`);
  // The queue shows the child's number and the dates, not the parent's note.
  const shownDate = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${filedOn}T00:00:00`));
  await staff
    .getByRole('row')
    .filter({ hasText: child })
    .filter({ hasText: shownDate })
    .getByRole('button', { name: /read and decide/i })
    .click();
  // Make sure it is OUR filing before turning anything down.
  await expect(staff.getByRole('dialog')).toContainText(TEST_NOTE);
  const sheet = staff.getByRole('dialog');
  await sheet.getByLabel('Add a note').click();
  await staff.keyboard.type(TEST_REASON);
  await sheet.getByRole('button', { name: 'Turn down' }).click();
  await expect(sheet).toBeHidden();
  await staff.context().close();

  await page.goto(`${PORTAL}/admission/services/declarations`);
  await expect(page.getByText(TEST_REASON)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('prod-declaration-turned-down.png'),
    fullPage: true,
  });
});
