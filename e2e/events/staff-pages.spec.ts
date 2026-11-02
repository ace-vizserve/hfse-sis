import { expect, test, type Page } from '@playwright/test';
import { removeEvents, trackNewEvents } from './cleanup';

// Parent events, staff pages (LOCAL stack only): the list, New event, and one
// event's three tabs. Screenshots land in test-results/.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

async function adminSignIn(page: Page) {
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill('admin@local.test');
  await page.locator('input[type="password"]').fill('localdev123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

let created: string[] = [];
test.beforeEach(({ page }) => {
  created = trackNewEvents(page);
});
test.afterEach(() => removeEvents(created));

test('events list, New event, and the event page', async ({ page }) => {
  await adminSignIn(page);

  await page.goto(`${SIS}/sis/admin/events`);
  await expect(
    page.getByRole('heading', { name: /Parent events/ }).first()
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/events-list.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'New event' }).click();
  await page.waitForURL(/\/sis\/admin\/events\/[0-9a-f-]+\/build/);

  // One line above the table counts the drafts; Show them opens their tab.
  await page.goto(`${SIS}/sis/admin/events`);
  await expect(
    page.getByText(/published yet\. Parents can't see/)
  ).toBeVisible();
  await page.getByRole('link', { name: /^Show (them|it)$/ }).click();
  await expect(
    page.getByRole('tab', { name: /Not published/, selected: true })
  ).toBeVisible();
  await expect(page.getByText('Untitled event').first()).toBeVisible();
  await page.screenshot({
    path: 'test-results/events-list-not-published.png',
    fullPage: true,
  });

  // This test's own event only: it renames the link further down, and other
  // drafts on the local stack are someone's.
  await page
    .locator(`a[href="/sis/admin/events/${created[0]}"]`)
    .first()
    .click();
  await page.waitForURL(/\/sis\/admin\/events\/[0-9a-f-]+$/);
  await expect(page.getByRole('tab', { name: /^Registered/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Not joining/ })).toBeVisible();
  await expect(
    page.getByRole('tab', { name: /^Not registered yet/ })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(
    page
      .getByRole('button', { name: 'Edit event' })
      .or(page.getByRole('link', { name: 'Edit event' }))
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/events-event-page.png',
    fullPage: true,
  });

  // Settings on the event page saves the link and the page shows it.
  const slug = `page-check-${Date.now()}`;
  await page.getByRole('button', { name: 'Event settings' }).click();
  await page.getByRole('textbox', { name: 'Link' }).fill(slug);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(page.getByText(`/events/${slug}`)).toBeVisible();
});
