import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { arrangeTwoChildFamily, type Child } from './event-family';
import { LOCAL_PASSWORD, localDb } from './local-db';

// One real HFSE event, end to end on the LOCAL stack: the Pandayan Leadership
// Camp section of the school's MS Form (files/forms/event-form.pdf, pages
// 11-16), copied question for question. Staff create it in the real SIS and
// publish it from the builder; a parent with two children answers on the real
// portal (localhost:5173, aimed at the local stack), one child joining and one
// not; the answers then come back on the event page, in the CSV and in the
// tables. The dates move to the future so registration is open; the rest is
// the school's wording.
const PORTAL = process.env.E2E_PORTAL_URL ?? 'http://localhost:5173';
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

const TITLE = 'Pandayan Leadership Camp 2026';
const SLUG = 'pandayan-camp-e2e';
const REASON = 'E2E: the family is abroad that week.';
const SIGNER = 'Dela Cruz, Juan';
const db = localDb();

let parentEmail = '';
let children: Child[] = [];
let restoreFamily = async () => {};
let eventId = '';

test.describe.configure({ mode: 'serial' });

const question = (
  id: string,
  type: string,
  label: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  type,
  label,
  help: '',
  required: true,
  imageUrl: null,
  choices: [],
  allowOther: false,
  agreement: '',
  showWhen: null,
  ...over,
});

const ACKNOWLEDGEMENTS = [
  'DATE: 14-16 July 2026',
  'VENUE: Singapore Discovery Centre, 510 Upper Jurong Rd, Singapore 638365',
  'FEE: $385+GST (Installment Options Available)',
  'DEADLINE OF REGISTRATION: 30 June 2026, 12NN (no ammendments after this date)',
];
const SHIRT_SIZES = ['2XS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
const MEDICAL = [
  'chest pains, high blood pressure, heart problems such as heart murmur, extra heartbeat or any other heart abnormality',
  'fits, epilepsy, fainting attacks, migraine, severe head injury',
  'asthma, bronchitis, tuberculosis, sinusitis or any other lung problems',
  'eye problems or poor vision',
  'ear problems or profound deafness',
  'bone or joint injury',
  'None',
  'Other',
];
const DECLARATION =
  'I declare that all the information provided is true. My child is currently not suffering from any acute ailments or diseases.';
const DISMISSAL = [
  'My child will be fetched from school by me/another parent/guardian.',
  'My child will commute by himself/herself going home.',
];
const PRIMARY_FOUR = [
  'OPTION A : Camper to stay overnight.',
  'OPTION B: Camper to be fetched every night and returned to camp in the mornings. Please refer to the advisory letter for the pick up and drop off timings.',
  'Primary Five to Secondary Three (NOT APPLICABLE)',
];
const PAYMENT = [
  'FULL PAYMENT | SGD 419.65 (July)',
  '2 INSTALLMENTS x SGD 209.83 (July, August)',
  '3 INSTALLMENTS x SGD 139.89 (July, August, September)',
  '4 INSTALLMENTS x SGD 104.92 (July, August, September, October)',
];
const INDEMNITY = `I hereby declare that the above named student is my child/ward. This waiver is given in consideration of my child/ward being allowed to participate in the program.

I acknowledge and accept that my child's/ward's involvement in any activity is entirely voluntary and all risks that come with his/her participation are freely and voluntarily assumed by the student and me. For the avoidance of doubt, the terms "participate" and "participation" are not restricted to active involvement but are deemed to include the student's mere presence of attendance at or in the activity.

I have ensured that my child/ward understands that it is important for his/her safety, and for the safety of the group that any rules, directions, and instructions given by the organizers and volunteers are obeyed.

In consideration of my child/ward being allowed to participate in any activity, I hereby agree not to hold any accompanying employee or volunteer of HFSE International School and Innotrek Pte. Ltd. liable for any personal injury, death, expense, loss and/or damage caused to and/or suffered by my child/ward unless the same is proved to be the direct result of any negligent act or willful default of any employee or volunteer of HFSE International School and Innotrek Pte. Ltd.

I agree to indemnify them against and hold them harmless from any expense loss and/or damage arising from or pursuant to my child's/ward's participation, which is not the direct result of any negligent act or willful default of any employee or volunteer of HFSE International School and Innotrek Pte. Ltd.

I further give permission to HFSE International School and Innotrek Pte. Ltd. to act, through any accompanying employee or volunteer on my behalf, to make appropriate decisions including authorization of emergency evacuation, medical attention, and/or treatment as recommended by a physician and/or hospital in the event of an emergency.`;

const FORM = {
  sections: [
    {
      id: 'child-camp',
      title: 'Registration',
      description: 'Asked for each child who is joining the camp.',
      scope: 'child',
      allowingOnly: false,
      questions: [
        question('ack', 'tick_many', 'ACKNOWLEDGEMENT', {
          choices: ACKNOWLEDGEMENTS,
        }),
        question('shirt', 'pick_one', 'SHIRT SIZE', {
          choices: SHIRT_SIZES,
          allowOther: true,
        }),
        question('medical', 'tick_many', 'MEDICAL CONDITIONS', {
          choices: MEDICAL,
        }),
        question(
          'medical-more',
          'long',
          'If you selected any condition above, please provide more details here (write N/A if none).'
        ),
        question(
          'dietary',
          'short',
          'SPECIAL DIETARY REQUIREMENTS/RESTRICTIONS (Write NA if none)'
        ),
        question(
          'allergies',
          'short',
          'FOOD/DRUG ALLERGIES (write NA if none)'
        ),
        question('medication', 'short', 'MEDICATION TAKEN (write NA if none)'),
        question(
          'declaration',
          'tick_many',
          'MEDICAL DECLARATION BY PARENT OF CAMP PARTICIPANT',
          { choices: [DECLARATION] }
        ),
        question(
          'learning',
          'short',
          'ADDITIONAL LEARNING NEEDS / SUPPORT NEEDED (Write NA if none)'
        ),
        question('swimmer', 'pick_one', 'IS YOUR CHILD A SWIMMER', {
          choices: ['Yes', 'No'],
        }),
        question(
          'dismissal',
          'pick_one',
          'AUTHORIZED MODE OF DISMISSAL (16 July 2026, 1 PM)',
          {
            help: '(Note: Bus-takers cannot join their bus due to their dismissal time.)',
            choices: DISMISSAL,
          }
        ),
        question('p4', 'pick_one', 'For PRIMARY FOUR STUDENTS', {
          choices: PRIMARY_FOUR,
        }),
      ],
    },
    {
      id: 'family-camp',
      title: 'Emergency contacts, indemnity and payment',
      description: 'Asked once per family.',
      scope: 'family',
      allowingOnly: false,
      questions: [
        question(
          'contact-1',
          'short',
          'EMERGENCY CONTACT PERSON 1: Full Name / Contact Number /Relationship to Student',
          { help: 'E.g. Juan Dela Cruz / 1234 5678 / Mother' }
        ),
        question(
          'contact-2',
          'short',
          'EMERGENCY CONTACT PERSON 2: Full Name / Contact Number /Relationship to Student',
          { help: 'E.g. Juan Dela Cruz / 1234 5678 / Father' }
        ),
        question('indemnity', 'signature', 'INDEMNITY FORM', {
          agreement: INDEMNITY,
        }),
        question('payment', 'pick_one', 'PAYMENT OPTION', {
          choices: PAYMENT,
        }),
      ],
    },
  ],
};

function singaporeDate(fromNowDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
  }).format(new Date(Date.now() + fromNowDays * 86_400_000));
}

/** Removes this suite's event, deepest rows first. */
async function cleanUp() {
  const { data: events } = await db
    .from('parent_events')
    .select('id')
    .eq('title', TITLE);
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
});

test.afterAll(async () => {
  await restoreFamily();
  await cleanUp();
});

async function staffSignIn(page: Page) {
  await page.goto(`${SIS}/login`);
  await page.getByPlaceholder('you@hfse.edu.sg').fill('admin@local.test');
  await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** One question on the portal's form, found by the id staff gave it. */
const q = (page: Page, id: string) => page.locator(`[data-question="${id}"]`);

async function tick(page: Page, id: string, choices: string[]) {
  for (const choice of choices) {
    await q(page, id).getByRole('checkbox', { name: choice }).click();
  }
}

async function pick(page: Page, id: string, choice: string) {
  await q(page, id).getByRole('radio', { name: choice, exact: true }).click();
}

test('staff copy the camp form and publish it from the builder', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffSignIn(page);
  await page.goto(`${SIS}/sis/admin/events`);
  await page.getByRole('button', { name: 'New event' }).click();
  await page.waitForURL(/\/sis\/admin\/events\/[0-9a-f-]+\/build/);
  eventId = page.url().match(/events\/([0-9a-f-]+)\/build/)![1];

  // The same save the builder makes, with the whole form at once.
  const res = await page.request.patch(`${SIS}/api/sis/events/${eventId}`, {
    data: {
      slug: SLUG,
      form: FORM,
      details: {
        title: TITLE,
        description:
          'PANDAYAN Leadership Camp 2026: Rising Leaders, Radiating Change\nPARTICIPANTS: Primary Four to Secondary Three Students\nFEE: $385+GST (Installment Options Available)',
        startsOn: singaporeDate(20),
        endsOn: singaporeDate(22),
        timeLabel: '',
        venue:
          'Singapore Discovery Centre, 510 Upper Jurong Rd, Singapore 638365',
        scope: { audience: 'all', levels: [], sectionIds: [] },
        answerMode: 'consent',
        opensAt: new Date(Date.now() - 3_600_000).toISOString(),
        closesAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);

  // The builder opens the copied form, every question in place.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Event title' })).toHaveValue(
    TITLE
  );
  await expect(page.getByText('SHIRT SIZE')).toBeVisible();
  await expect(page.getByText('PAYMENT OPTION')).toBeVisible();
  await expect(page.getByText(`/events/${SLUG}`)).toBeVisible();
  const asked = page.getByRole('combobox', {
    name: 'How this section is asked',
  });
  await expect(asked.first()).toHaveText(/Asked for each child/);
  await expect(asked.last()).toHaveText(/Asked once per family/);
  await page.screenshot({
    path: 'test-results/pandayan-builder.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published.')).toBeVisible();
  await page.context().close();
});

test('the parent sees it needs attention, then answers the whole form', async ({
  page,
}) => {
  const [a, b] = children;
  await page.setViewportSize({ width: 1280, height: 1000 });

  // Logged out: the short link goes through login to the form.
  await page.goto(`${PORTAL}/events/${SLUG}`);
  await page.waitForURL(/\/login/);
  await page.getByPlaceholder('name@example.com').fill(parentEmail);
  await page.getByPlaceholder('••••••••').fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(new RegExp(`/admission/services/events/${SLUG}`));
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

  // Before answering, the Events page says it needs attention for both children.
  await page.goto(`${PORTAL}/admission/services/events`);
  const row = page.locator('[data-event-row]').filter({ hasText: TITLE });
  await expect(row).toContainText('Not registered yet');
  await page.screenshot({
    path: 'test-results/pandayan-parent-list-before.png',
    fullPage: true,
  });
  await row.getByRole('link', { name: 'Register' }).click();
  await page.waitForURL(new RegExp(`/events/${SLUG}$`));

  // Step 1: who is joining. The SIS already knows this parent's name and phone
  // from the application, so they are not asked to type them.
  const card = (child: Child) =>
    page.locator('[data-child]').filter({ hasText: child.firstName });
  await expect(card(a)).toBeVisible();
  await expect(page.getByText('Replying as')).toBeVisible();
  await expect(page.locator('#parent-name')).toBeHidden();
  await card(a)
    .getByRole('radio', { name: 'Allowing my child to join' })
    .click();
  await card(b).getByRole('radio', { name: 'Not allowing' }).click();
  await card(b)
    .getByLabel(/Reason for not allowing/)
    .fill(REASON);
  await page.getByRole('button', { name: new RegExp(`^Continue to `) }).click();

  // Required questions hold the parent back with a message.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('This question is required.').first()
  ).toBeVisible();

  // Step 2: the joining child, every kind of question on the camp form.
  await tick(page, 'ack', ACKNOWLEDGEMENTS);
  await pick(page, 'shirt', 'M');
  await tick(page, 'medical', [MEDICAL[2], MEDICAL[3]]);
  await q(page, 'medical-more')
    .getByRole('textbox')
    .fill('Mild asthma, carries an inhaler.');
  await q(page, 'dietary').getByRole('textbox').fill('No pork');
  await q(page, 'allergies').getByRole('textbox').fill('Peanuts');
  await q(page, 'medication').getByRole('textbox').fill('NA');
  await tick(page, 'declaration', [DECLARATION]);
  await q(page, 'learning').getByRole('textbox').fill('NA');
  await pick(page, 'swimmer', 'No');
  await pick(page, 'dismissal', DISMISSAL[0]);
  await pick(page, 'p4', PRIMARY_FOUR[0]);
  await page.screenshot({
    path: 'test-results/pandayan-parent-child-step.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 3: once for the family.
  await expect(page.getByText('For the family', { exact: true })).toBeVisible();
  await q(page, 'contact-1')
    .getByRole('textbox')
    .fill('Maria Dela Cruz / 9123 4567 / Mother');
  await q(page, 'contact-2')
    .getByRole('textbox')
    .fill('Juan Dela Cruz / 9765 4321 / Father');
  await page.getByLabel('Your full name').fill(SIGNER);
  await pick(page, 'payment', PAYMENT[1]);
  await page.screenshot({
    path: 'test-results/pandayan-parent-family-step.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL(/\/admission\/services\/events$/);

  // Back on the list: one status per child, nothing left unanswered.
  const after = page.locator('[data-event-row]').filter({ hasText: TITLE });
  await expect(after).toContainText('Registered');
  await expect(after).toContainText('Not joining');
  await expect(after).not.toContainText('Not registered yet');
  await page.screenshot({
    path: 'test-results/pandayan-parent-list-after.png',
    fullPage: true,
  });
});

test('the answers come back: the tables, the event page and the CSV', async ({
  page,
}) => {
  const [a, b] = children;

  // The tables.
  const { data: students } = await db
    .from('students')
    .select('id, student_number')
    .in('student_number', [a.studentNumber, b.studentNumber]);
  const idOf = (c: Child) =>
    students!.find((s) => s.student_number === c.studentNumber)!.id as string;
  const { data: regs } = await db
    .from('parent_event_registrations')
    .select('student_id, status, not_joining_reason, answers')
    .eq('event_id', eventId);
  expect(regs).toHaveLength(2);
  const regA = regs!.find((r) => r.student_id === idOf(a))!;
  const regB = regs!.find((r) => r.student_id === idOf(b))!;
  expect(regA.status).toBe('registered');
  expect(regA.answers).toEqual({
    ack: ACKNOWLEDGEMENTS,
    shirt: 'M',
    medical: [MEDICAL[2], MEDICAL[3]],
    'medical-more': 'Mild asthma, carries an inhaler.',
    dietary: 'No pork',
    allergies: 'Peanuts',
    medication: 'NA',
    declaration: [DECLARATION],
    learning: 'NA',
    swimmer: 'No',
    dismissal: DISMISSAL[0],
    p4: PRIMARY_FOUR[0],
  });
  expect(regB.status).toBe('not_joining');
  expect(regB.not_joining_reason).toBe(REASON);
  expect(regB.answers).toEqual({});

  const { data: submission } = await db
    .from('parent_event_submissions')
    .select('parent_email, family_answers, signature_name, signed_at')
    .eq('event_id', eventId)
    .single();
  expect(submission!.parent_email).toBe(parentEmail);
  expect(submission!.family_answers).toEqual({
    'contact-1': 'Maria Dela Cruz / 9123 4567 / Mother',
    'contact-2': 'Juan Dela Cruz / 9765 4321 / Father',
    payment: PAYMENT[1],
  });
  expect(submission!.signature_name).toBe(SIGNER);
  expect(submission!.signed_at).not.toBeNull();

  // The event page.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await staffSignIn(page);
  await page.goto(`${SIS}/sis/admin/events/${eventId}`);
  await expect(
    page.getByRole('tab', { name: /^Registered\s*1/ })
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: /^Not joining\s*1/ })
  ).toBeVisible();
  await page.getByRole('tab', { name: /^Registered/ }).click();
  const rowA = page.getByRole('row').filter({ hasText: a.firstName });
  await expect(rowA).toContainText('No pork');
  await expect(rowA).toContainText(PAYMENT[1]);
  await expect(rowA).toContainText(SIGNER);
  await page.screenshot({
    path: 'test-results/pandayan-staff-registered.png',
    fullPage: true,
  });

  // The CSV of the Registered tab: every answer staff need, one row per child.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  for (const heading of [
    'SHIRT SIZE',
    'MEDICAL CONDITIONS',
    'EMERGENCY CONTACT PERSON 1',
    'Signed by',
    'PAYMENT OPTION',
  ]) {
    expect(csv).toContain(heading);
  }
  for (const value of [
    a.studentNumber,
    'No pork',
    'Peanuts',
    'Mild asthma, carries an inhaler.',
    'Maria Dela Cruz / 9123 4567 / Mother',
    SIGNER.split(',')[0],
    PAYMENT[1],
  ]) {
    expect(csv).toContain(value);
  }

  await page.getByRole('tab', { name: /^Not joining/ }).click();
  const rowB = page.getByRole('row').filter({ hasText: b.firstName });
  await expect(rowB).toContainText(REASON);
});
