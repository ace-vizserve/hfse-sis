import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

// LOCAL stack. Failed sign-in, sign-in, a server download, a browser download and
// sign-out each leave one audit row.
const SIS = process.env.E2E_SIS_URL ?? 'http://localhost:3000';

const sql = (q: string) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_hfse-markbook',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-F',
      '|',
      '-c',
      q,
    ],
    { encoding: 'utf8' }
  ).trim();

const since = () => sql(`select now()`);
const rows = (from: string, action: string) =>
  sql(
    `select actor_email || '|' || context::text from audit_log where action='${action}' and created_at >= '${from}' order by created_at`
  );

test('sign-in, downloads and sign-out are logged', async ({
  page,
  request,
}) => {
  const from = since();

  await page.goto(`${SIS}/login`);
  const email = page.getByPlaceholder('you@hfse.edu.sg');
  const password = page.locator('input[type="password"]');
  const submit = page.getByRole('button', { name: 'Sign in' });

  await email.fill('admin@local.test');
  await password.fill('definitely-wrong');
  await submit.click();
  await expect
    .poll(() => rows(from, 'user.login_failed'))
    .toContain('admin@local.test');
  expect(rows(from, 'user.login_failed')).not.toContain('definitely-wrong');

  await password.fill('local.test');
  await submit.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect
    .poll(() => rows(from, 'user.login'))
    .toContain('admin@local.test');

  // A server-built file.
  const file = await page.request.get(
    `${SIS}/api/markbook/masterfile/export?template=summary&format=csv`
  );
  expect(file.status()).toBe(200);
  await expect
    .poll(() => rows(from, 'data.export'))
    .toContain('Academic overview');

  // A browser-built table CSV reports through the event route.
  const event = await page.request.post(`${SIS}/api/audit-log/export-event`, {
    data: { file: 'check.csv', rows: 3, page: '/check' },
  });
  expect(event.status()).toBe(200);
  await expect.poll(() => rows(from, 'data.export')).toContain('check.csv');

  // Nobody can log a sign-in for someone without a session.
  const anon = await request.post(`${SIS}/api/auth/event`, {
    data: { event: 'signed_in' },
  });
  expect(anon.status()).toBe(401);

  await page.goto(`${SIS}/sis`);
  await page.locator('[data-sidebar="footer"] button').first().click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.waitForURL(/\/login/);
  await expect
    .poll(() => rows(from, 'user.logout'))
    .toContain('admin@local.test');
});
