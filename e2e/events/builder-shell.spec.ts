import { expect, test, type Page } from '@playwright/test';
import { removeEvents, trackNewEvents } from './cleanup';

// Parent events, full-screen builder shell (LOCAL stack only): New event lands
// in the builder, the title autosaves and survives a reload.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

// Dev-only: the root layout trips Next's Date.now() prerender check on EVERY
// SIS page, including the existing /sis/admin/events (see .next/dev/logs). Not
// from the builder, so it is ignored here; anything else fails the test.
const KNOWN_DEV_NOISE = /unstable value `Date\.now\(\)` while prerendering/;

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

test('builder: edit the title, it autosaves and survives a reload', async ({
  page,
}) => {
  // Listening from the start, so load-time errors count. Any console error or uncaught exception fails the test.
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN_DEV_NOISE.test(m.text()))
      errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await adminSignIn(page);
  await page.goto(`${SIS}/sis/admin/events`);
  await page.getByRole('button', { name: 'New event' }).click();
  await page.waitForURL(/\/sis\/admin\/events\/[0-9a-f-]+\/build/);

  const title = page.getByRole('textbox', { name: 'Event title' });
  await expect(title).toBeVisible();
  const name = `Builder check ${Date.now()}`;
  await title.fill(name);
  await expect(page.getByText(/saved just now/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Event title' })).toHaveValue(
    name
  );

  // The cog on the top bar: link, who it's for and how parents answer, saved
  // together and kept on reload.
  const slug = `camp-${Date.now()}`;
  await page.getByRole('button', { name: 'Event settings' }).click();
  await page
    .getByRole('textbox', { name: 'Link' })
    .fill(`Camp ${slug.slice(5)}`);
  await page.getByRole('combobox', { name: 'Who is it for?' }).click();
  await page.getByRole('option', { name: 'Primary', exact: true }).click();
  await page.getByRole('combobox', { name: 'How parents answer' }).click();
  await page.getByRole('option', { name: 'Register / Not joining' }).click();
  await page.screenshot({ path: 'test-results/events-builder-settings.png' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(`/events/${slug}`)).toBeVisible();
  await page.getByRole('button', { name: 'Event settings' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Who is it for?' })
  ).toHaveText('Primary');
  await expect(
    page.getByRole('combobox', { name: 'How parents answer' })
  ).toHaveText('Register / Not joining');
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
  await page.screenshot({
    path: 'test-results/events-builder.png',
    fullPage: true,
  });
});
