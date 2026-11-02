import { expect, test, type Page } from '@playwright/test';
import { removeEvents, trackNewEvents } from './cleanup';

// Parent events, builder form (LOCAL stack only). Event A gets a section (asked
// for each child who is joining), a Pick one question with a picture, a Tick all
// that apply question, a Short answer shown only for one answer, and the
// e-signature; it all autosaves and survives a reload. Event B then copies A's
// sections, has a label edited and is published at once; the edit is saved.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

// Same dev-only noise as builder-shell.spec.ts; anything else fails the test.
const KNOWN_DEV_NOISE = /unstable value `Date\.now\(\)` while prerendering/;

// A 1×1 PNG, uploaded as the sizing picture.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function adminSignIn(page: Page) {
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill('admin@local.test');
  await page.locator('input[type="password"]').fill('localdev123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function newEvent(page: Page, title: string) {
  await page.goto(`${SIS}/sis/admin/events`);
  await page.getByRole('button', { name: 'New event' }).click();
  await page.waitForURL(/\/sis\/admin\/events\/[0-9a-f-]+\/build/);
  await page.getByRole('textbox', { name: 'Event title' }).fill(title);
  await expect(page.getByText('Filled in by the SIS:')).toBeVisible();
}

async function waitForSave(page: Page) {
  // The autosave waits 800 ms after the last edit, then saves.
  await page.waitForTimeout(1200);
  await expect(page.getByText(/saving…/)).toHaveCount(0);
  await expect(page.getByText(/couldn't save/)).toHaveCount(0);
}

async function addChoices(page: Page, choices: string[]) {
  for (let i = 0; i < choices.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add choice' }).click();
    await page
      .getByRole('textbox', { name: `Choice ${i + 1}`, exact: true })
      .fill(choices[i]);
  }
}

let created: string[] = [];
test.beforeEach(({ page }) => {
  created = trackNewEvents(page);
});
test.afterEach(() => removeEvents(created));

test('builder: sections and questions autosave, copy and publish', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN_DEV_NOISE.test(m.text()))
      errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await adminSignIn(page);
  const titleA = `Form check A ${Date.now()}`;
  await newEvent(page, titleA);

  // A section asked for each child who is joining (there is no switch to
  // widen or narrow it: per-child sections are for joining children only).
  await page.getByRole('button', { name: 'Add section' }).click();
  await page
    .getByRole('textbox', { name: 'Section title' })
    .fill('Camp details');
  await expect(
    page.getByRole('combobox', { name: 'How this section is asked' })
  ).toHaveText('Asked for each child who is joining');
  await expect(page.getByRole('switch')).toHaveCount(0);

  // A Pick one question with three choices and a picture.
  await page.getByRole('button', { name: 'Add question' }).click();
  await page
    .getByRole('textbox', { name: 'Question title' })
    .fill('Does your child eat meat?');
  await page
    .getByRole('textbox', { name: 'Question description' })
    .fill('For the camp menu.');
  await addChoices(page, ['Yes', 'No', 'Only fish']);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add a picture' }).click();
  await (
    await chooser
  ).setFiles({ name: 'sizing.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Picture added.')).toBeVisible();

  // A Tick all that apply question with three choices.
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByRole('combobox', { name: 'Question type' }).click();
  await page.getByRole('option', { name: 'Tick all that apply' }).click();
  await page
    .getByRole('textbox', { name: 'Question title' })
    .fill('Medical conditions');
  await addChoices(page, ['Asthma', 'Heart problems', 'None']);

  // A Short answer shown only when the first is "Only fish".
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByRole('combobox', { name: 'Question type' }).click();
  await page.getByRole('option', { name: 'Short answer' }).click();
  await page
    .getByRole('textbox', { name: 'Question title' })
    .fill('Which fish can they eat?');
  await page.getByRole('button', { name: 'Show only when…' }).click();
  await page.getByRole('combobox', { name: 'Question', exact: true }).click();
  await page.getByRole('option', { name: 'Does your child eat meat?' }).click();
  await page.getByRole('combobox', { name: 'Is answered' }).click();
  await page.getByRole('option', { name: 'Only fish' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Shown only when “Only fish”')).toBeVisible();

  // The e-signature (goes into a new "Sign" section asked once per family).
  await page.getByRole('button', { name: 'Add e-signature' }).click();
  await page
    .getByRole('textbox', { name: 'Agreement text' })
    .fill('I agree to the camp terms.');
  await expect(page.getByText('Always required')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add e-signature' })
  ).toBeDisabled();

  await waitForSave(page);
  await page.reload();

  await expect(page.getByText('Camp details')).toBeVisible();
  await expect(page.getByText('Does your child eat meat?')).toBeVisible();
  await expect(page.getByText('For the camp menu.')).toBeVisible();
  await expect(
    page.locator('img[src*="sizing"], img[src*="/events/"]')
  ).toBeVisible();
  await expect(page.getByText('Only fish', { exact: true })).toBeVisible();
  await expect(page.getByText('Medical conditions')).toBeVisible();
  await expect(page.getByText('Heart problems')).toBeVisible();
  await expect(page.getByText('Which fish can they eat?')).toBeVisible();
  await expect(page.getByText('Shown only when “Only fish”')).toBeVisible();
  await expect(page.getByText('Sign', { exact: true })).toBeVisible();
  await expect(page.getByText('I agree to the camp terms.')).toBeVisible();
  await expect(page.getByText('Type your full name to sign')).toBeVisible();

  // Selecting a card opens its editor, with the toolbar beside it.
  await page
    .getByRole('group', { name: 'Question: Does your child eat meat?' })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Question title' })
  ).toHaveValue('Does your child eat meat?');
  await page.screenshot({
    path: 'test-results/events-builder-form.png',
    fullPage: true,
  });

  // Event B copies A's sections.
  await newEvent(page, `Form check B ${Date.now()}`);
  await page.getByRole('button', { name: 'Copy from another event' }).click();
  await page.getByRole('radio', { name: titleA }).click();
  await page.getByRole('button', { name: 'Copy sections' }).click();
  await expect(page.getByText('Camp details')).toBeVisible();
  await expect(page.getByText('Medical conditions')).toBeVisible();
  await expect(page.getByText('Shown only when “Only fish”')).toBeVisible();

  // Edit a label and publish straight away: the edit must be saved first.
  await page
    .getByRole('group', { name: 'Question: Medical conditions' })
    .click();
  await page
    .getByRole('textbox', { name: 'Question title' })
    .fill('Medical conditions (tick all)');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Medical conditions (tick all)')).toBeVisible();
  await expect(page.getByText(/Parent events · Published/)).toBeVisible();

  expect(errors).toEqual([]);
});
