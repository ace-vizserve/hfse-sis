import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  clearOwnDeclarations,
  declarationByNote,
  E2E_MARK,
  findScenario,
  freeSchoolDays,
  LOCAL_PASSWORD,
  localDb,
  openPublicationWindow,
  registerMark,
  type Scenario,
} from './local-db';

// The parent portal's two SIS-backed features, end to end on the LOCAL stack:
// the real portal (localhost:5173, `staging` branch of ../app-online-admission)
// calling the real SIS (localhost:3000), with staff deciding in the real SIS.
const PORTAL = process.env.E2E_PORTAL_URL ?? 'http://localhost:5173';
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

const db = localDb();
let s: Scenario;
let restoreWindow: () => Promise<void> = async () => {};
let days: string[] = [];
const startedAt = new Date().toISOString();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  s = await findScenario(db);
  await clearOwnDeclarations(db, s);
  restoreWindow = await openPublicationWindow(db, s);
  days = await freeSchoolDays(db, s);
  if (days.length < 3)
    throw new Error(`Need 3 free school days ahead, found ${days.length}.`);
  console.log(
    `Parent ${s.parentEmail} · child ${s.firstName} ${s.lastName} (${s.studentNumber}) · ` +
      `adviser ${s.adviserEmail} · officer ${s.officerEmail} · days ${days.slice(0, 3).join(', ')}`
  );
});

test.afterAll(async () => {
  await restoreWindow();
});

// ── helpers ────────────────────────────────────────────────────────────────

async function parentSignIn(page: Page) {
  await page.goto(`${PORTAL}/login`);
  await page.getByPlaceholder('name@example.com').fill(s.parentEmail);
  await page.getByPlaceholder('••••••••').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/admission\//);
}

async function staffPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill(email);
  await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

/** Click a day in the portal's calendar, paging forward a month at a time. */
async function pickDay(page: Page, isoDate: string) {
  const day = page.locator(`td[data-day="${isoDate}"] button`);
  for (let i = 0; i < 13 && !(await day.isVisible()); i++) {
    await page.getByRole('button', { name: /next month/i }).click();
  }
  await day.click();
}

type Filing = {
  date: string;
  kind: 'absence' | 'travel';
  note: string;
  certificate?: boolean;
  country?: string;
};

async function fileDeclaration(page: Page, f: Filing) {
  await page.goto(`${PORTAL}/admission/services/declarations/new`);
  const next = page.getByRole('button', { name: 'Continue' });

  // Who
  await page.getByRole('checkbox', { name: new RegExp(s.firstName) }).check();
  await next.click();
  // Absence or travel
  await page
    .getByRole('radio', { name: f.kind === 'travel' ? 'Travel' : 'Absence' })
    .check();
  await next.click();
  // When
  await pickDay(page, f.date);
  await next.click();

  if (f.kind === 'travel') {
    await page.locator('#destination-country').click();
    await page.getByPlaceholder(/search/i).fill(f.country ?? 'Malaysia');
    await page
      .getByRole('option', { name: new RegExp(f.country ?? 'Malaysia') })
      .first()
      .click();
    await next.click();
  } else {
    await page
      .getByRole('radio', {
        name: f.certificate ? 'With medical certificate' : 'Without',
      })
      .check();
    await next.click();
    if (f.certificate) {
      await page.locator('input[type="file"]').setInputFiles({
        name: 'medical-certificate.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(
          '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
        ),
      });
      await page.getByRole('button', { name: /upload file/i }).click();
      await expect(page.getByText('Certificate attached')).toBeVisible();
      await next.click();
    }
  }

  // Note, review, submit
  await page.getByLabel('Note for the teacher').fill(f.note);
  await next.click();
  await expect(page.getByText('Check this over')).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sent to the school' })
  ).toBeVisible();
}

async function waitForDeclaration(note: string) {
  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.requestId ?? '')
    .not.toBe('');
  return (await declarationByNote(db, s, note))!;
}

async function decide(
  browser: Browser,
  email: string,
  requestId: string,
  action: 'approve' | 'reject',
  note?: string
) {
  const page = await staffPage(browser, email);
  await page.goto(`${SIS}/attendance/declarations?req=${requestId}`);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  if (note) {
    await sheet.getByLabel('Add a note').click();
    await page.keyboard.type(note);
  }
  await sheet
    .getByRole('button', {
      name: action === 'approve' ? 'Approve' : 'Turn down',
    })
    .click();
  await expect(sheet).toBeHidden();
  await page.context().close();
}

async function statusRow(page: Page, note: string) {
  await page.goto(`${PORTAL}/admission/services/declarations`);
  return page
    .getByRole('row')
    .filter({ hasText: note.replace(`${E2E_MARK} `, '') });
}

// ── the story ─────────────────────────────────────────────────────────────

test('report card: the parent opens the published term and sees the school’s card', async ({
  page,
}) => {
  await parentSignIn(page);
  await page.goto(`${PORTAL}/admission/report-cards`);

  await expect(page.getByText(new RegExp(s.lastName))).toBeVisible();
  await page
    .getByRole('button', {
      name: new RegExp(`Term ${s.publication.termNumber}`),
    })
    .first()
    .click();

  // The card the SIS built: letterhead, the child, and the adviser's own words.
  if (s.organizationName)
    await expect(page.getByText(s.organizationName).first()).toBeVisible();
  await expect(page.getByText(new RegExp(s.lastName)).first()).toBeVisible();
  await expect(
    page.getByText(s.writeupText.slice(0, 60), { exact: false }).first()
  ).toBeVisible();
  await expect(page.getByText(/unable to load report card/i)).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('report-card.png'),
    fullPage: true,
  });
});

test('absence without a certificate: filed, approved by adviser then officer, register marked', async ({
  page,
  browser,
}) => {
  const note = `${E2E_MARK} absence, approve ${startedAt}`;
  await parentSignIn(page);
  await fileDeclaration(page, { date: days[0], kind: 'absence', note });

  const filed = await waitForDeclaration(note);
  await expect(await statusRow(page, note)).toContainText('With the school');

  await decide(browser, s.adviserEmail, filed.requestId, 'approve');
  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.status)
    .toBe('pending');
  await decide(browser, s.officerEmail, filed.requestId, 'approve');
  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.status)
    .toBe('approved');

  await expect(await statusRow(page, note)).toContainText('Approved');

  // The point of the whole flow: the class register now says excused, medical.
  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.registerWrittenAt)
    .not.toBeNull();
  const mark = await registerMark(db, s, days[0]);
  expect(mark).toMatchObject({ status: 'EX', ex_reason: 'mc' });
  expect(mark!.recorded_at >= startedAt).toBe(true);

  // Filing the same day again is refused with the "already approved" sentence.
  await fileDeclarationExpectingClash(page, days[0]);
});

async function fileDeclarationExpectingClash(page: Page, date: string) {
  await page.goto(`${PORTAL}/admission/services/declarations/new`);
  const next = page.getByRole('button', { name: 'Continue' });
  await page.getByRole('checkbox', { name: new RegExp(s.firstName) }).check();
  await next.click();
  await page.getByRole('radio', { name: 'Absence' }).check();
  await next.click();
  await pickDay(page, date);
  await next.click();
  await page.getByRole('radio', { name: 'Without' }).check();
  await next.click();
  await page
    .getByLabel('Note for the teacher')
    .fill(`${E2E_MARK} clash ${startedAt}`);
  await next.click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/already/i).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sent to the school' })
  ).toHaveCount(0);
}

test('travel: filed, approved, register marked as vacation', async ({
  page,
  browser,
}) => {
  const note = `${E2E_MARK} travel, approve ${startedAt}`;
  await parentSignIn(page);
  await fileDeclaration(page, {
    date: days[1],
    kind: 'travel',
    note,
    country: 'Malaysia',
  });

  const filed = await waitForDeclaration(note);
  await decide(browser, s.adviserEmail, filed.requestId, 'approve');
  await decide(browser, s.officerEmail, filed.requestId, 'approve');
  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.status)
    .toBe('approved');
  await expect(await statusRow(page, note)).toContainText('Approved');

  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.registerWrittenAt)
    .not.toBeNull();
  const mark = await registerMark(db, s, days[1]);
  expect(mark).toMatchObject({ status: 'EX', ex_reason: 'vacation' });
});

test('absence with a certificate, turned down: the parent reads the school’s reason', async ({
  page,
  browser,
}) => {
  const note = `${E2E_MARK} absence + MC, reject ${startedAt}`;
  const reason =
    'The certificate is unreadable, please upload a clearer photo.';
  await parentSignIn(page);
  await fileDeclaration(page, {
    date: days[2],
    kind: 'absence',
    note,
    certificate: true,
  });

  const filed = await waitForDeclaration(note);
  await decide(browser, s.adviserEmail, filed.requestId, 'reject', reason);
  await expect
    .poll(async () => (await declarationByNote(db, s, note))?.status)
    .toBe('rejected');

  const row = await statusRow(page, note);
  await expect(row).toContainText('Not approved');
  await expect(page.getByText(reason)).toBeVisible();
  expect(await registerMark(db, s, days[2])).toBeNull();
});
