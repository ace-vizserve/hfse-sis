import { expect, test, type Page } from '@playwright/test';
import { arrangeTwoChildFamily, type Child } from './event-family';
import { LOCAL_PASSWORD, localDb } from './local-db';

// Parent event registration, end to end on the LOCAL stack: staff build and
// publish "E2E Field Trip" in the real SIS (localhost:3000); a parent with TWO
// children opens the short link on the real portal (localhost:5173), signs in,
// registers one child and declines for the other; staff see the statuses; the
// parent then edits the second child to "joining" and staff see two Registered.
const PORTAL = process.env.E2E_PORTAL_URL ?? 'http://localhost:5173';
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

const TITLE = 'E2E Field Trip';
const QUESTION = 'T-shirt size';
const REASON = 'E2E: we are away that week.';
const db = localDb();

let parentEmail = '';
let children: Child[] = [];
let restoreFamily = async () => {};
let eventId = '';
let slug = '';

test.describe.configure({ mode: 'serial' });

/** Removes the events this suite (and the Task 13 leftover) made, deepest rows first. */
async function cleanUp() {
  const { data: events } = await db
    .from('parent_events')
    .select('id')
    .or(`title.eq.${TITLE},slug.eq.task13-trip`);
  const ids = (events ?? []).map((e) => e.id as string);
  if (!ids.length) return;
  await db.from('parent_event_registrations').delete().in('event_id', ids);
  await db.from('parent_event_submissions').delete().in('event_id', ids);
  await db.from('parent_events').delete().in('id', ids);
}

test.beforeAll(async () => {
  await cleanUp();
  const family = await arrangeTwoChildFamily(db);
  parentEmail = family.parentEmail;
  children = family.children;
  restoreFamily = family.restore;
  console.log(
    `Parent ${parentEmail} · children ${children.map((c) => `${c.firstName} (${c.studentNumber})`).join(', ')}`
  );
});

test.afterAll(async () => {
  await restoreFamily();
  await cleanUp();
});

// ── helpers ────────────────────────────────────────────────────────────────

async function staffSignIn(page: Page) {
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill('admin@local.test');
  await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function parentSignInForm(page: Page) {
  await page.getByPlaceholder('name@example.com').fill(parentEmail);
  await page.getByPlaceholder('••••••••').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
}

/** The portal addresses a child by the first word of the given name. */
function given(child: Child) {
  return child.firstName.split(' ')[0];
}

function childCard(page: Page, child: Child) {
  return page.locator('[data-child]').filter({ hasText: child.firstName });
}

/** Fills the "Replying as" contact box when the portal asks for it. */
async function fillContactIfAsked(page: Page) {
  const name = page.locator('#parent-name');
  if (await name.isVisible()) {
    await name.fill('E2E Parent');
    await page.locator('#parent-phone').fill('91234567');
  }
}

async function openStaffEvent(page: Page) {
  await page.goto(`${SIS}/sis/admin/events/${eventId}`);
  await expect(page.getByRole('tab', { name: /^Registered/ })).toBeVisible();
}

// ── the story ─────────────────────────────────────────────────────────────

test('staff build and publish the event', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffSignIn(page);
  await page.goto(`${SIS}/sis/admin/events`);
  await page.getByRole('button', { name: 'New event' }).click();
  await page.waitForURL(/\/sis\/admin\/events\/[0-9a-f-]+\/build/);
  eventId = page.url().match(/events\/([0-9a-f-]+)\/build/)![1];

  await page.getByRole('textbox', { name: 'Event title' }).fill(TITLE);
  await expect(page.getByText('Filled in by the SIS:')).toBeVisible();

  // One section, asked per child, with a Pick one question.
  await page.getByRole('button', { name: 'Add section' }).click();
  await page
    .getByRole('textbox', { name: 'Section title' })
    .fill('Trip details');
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByRole('textbox', { name: 'Question title' }).fill(QUESTION);
  for (const [i, choice] of ['S', 'M', 'L'].entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Add choice' }).click();
    await page
      .getByRole('textbox', { name: `Choice ${i + 1}`, exact: true })
      .fill(choice);
  }

  // The family's e-signature (lands in its own "Sign" section, once per family).
  await page.getByRole('button', { name: 'Add e-signature' }).click();
  await page
    .getByRole('textbox', { name: 'Agreement text' })
    .fill('I agree to the trip terms.');

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published.')).toBeVisible();

  const { data: row } = await db
    .from('parent_events')
    .select('slug, published_at')
    .eq('id', eventId)
    .single();
  expect(row?.published_at).not.toBeNull();
  slug = row!.slug as string;
  expect(slug).toBeTruthy();
  await page.context().close();
});

test('parent opens the short link, signs in, registers one child and declines for the other', async ({
  page,
}) => {
  const [a, b] = children;

  // Logged out: the short link sends the parent to sign in, then to the form.
  await page.goto(`${PORTAL}/events/${slug}`);
  await page.waitForURL(/\/login/);
  await parentSignInForm(page);
  await page.waitForURL(new RegExp(`/admission/services/events/${slug}`));
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

  // Step 1: who is joining.
  await fillContactIfAsked(page);
  await childCard(page, a)
    .getByRole('radio', { name: 'Allowing my child to join' })
    .click();
  await childCard(page, b).getByRole('radio', { name: 'Not allowing' }).click();
  await childCard(page, b)
    .getByLabel(/Reason for not allowing/)
    .fill(REASON);
  await page.getByRole('button', { name: `Continue to ${given(a)}` }).click();

  // Step 2: the joining child's questions (the declined child has no step).
  await page.getByRole('radio', { name: 'M', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 3: once for the family.
  await expect(page.getByText('For the family', { exact: true })).toBeVisible();
  await page.getByLabel('Your full name').fill('E2E Parent');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL(/\/admission\/services\/events$/);

  // The list now shows one badge per child.
  const row = page.locator('[data-event-row]').filter({ hasText: TITLE });
  await expect(row).toContainText('Registered');
  await expect(row).toContainText('Not joining');
});

test('staff see 1 Registered, 1 Not joining and the answer column', async ({
  page,
}) => {
  const [a, b] = children;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffSignIn(page);
  await openStaffEvent(page);

  await expect(
    page.getByRole('tab', { name: /^Registered\s*1/ })
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: /^Not joining\s*1/ })
  ).toBeVisible();

  await page.getByRole('tab', { name: /^Registered/ }).click();
  await expect(
    page.getByRole('columnheader', { name: QUESTION })
  ).toBeVisible();
  const rowA = page.getByRole('row').filter({ hasText: a.firstName });
  await expect(rowA).toContainText('M');

  await page.getByRole('tab', { name: /^Not joining/ }).click();
  const rowB = page.getByRole('row').filter({ hasText: b.firstName });
  await expect(rowB).toContainText(REASON);
  await page.screenshot({
    path: 'test-results/events-e2e-staff.png',
    fullPage: true,
  });
  await page.context().close();
});

test('parent edits the second child to joining; staff see 2 Registered', async ({
  page,
  browser,
}) => {
  const [a, b] = children;

  await page.goto(`${PORTAL}/login`);
  await parentSignInForm(page);
  await page.waitForURL(/\/admission\//);
  await page.goto(`${PORTAL}/admission/services/events`);
  const row = page.locator('[data-event-row]').filter({ hasText: TITLE });
  // One child is "Not joining" (answered), so nothing is left unanswered: Edit.
  await row.getByRole('link', { name: 'Edit' }).click();
  await page.waitForURL(new RegExp(`/events/${slug}$`));

  await childCard(page, b)
    .getByRole('radio', { name: 'Allowing my child to join' })
    .click();
  // Both children are joining now: a step each (the portal orders them its own
  // way). A keeps its saved answer; B, newly joining, picks a size.
  await page.getByRole('button', { name: /^Continue to / }).click();
  for (let i = 0; i < 2; i++) {
    const onB = await page
      .getByText(new RegExp(b.firstName))
      .first()
      .isVisible();
    if (onB) await page.getByRole('radio', { name: 'L', exact: true }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();
  }
  await expect(page.getByText('For the family', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/admission\/services\/events$/);

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await staff.setViewportSize({ width: 1440, height: 1000 });
  await staffSignIn(staff);
  await openStaffEvent(staff);
  await expect(
    staff.getByRole('tab', { name: /^Registered\s*2/ })
  ).toBeVisible();
  await expect(
    staff.getByRole('tab', { name: /^Not joining\s*0/ })
  ).toBeVisible();
  await staffContext.close();
});
