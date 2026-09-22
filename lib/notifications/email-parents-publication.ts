import 'server-only';

import { Resend } from 'resend';
import { getParentEmailsForSection } from '@/lib/supabase/admissions';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { createServiceClient } from '@/lib/supabase/service';
import { escapeHtml, renderEmailFrame } from '@/lib/notifications/email-frame';

// Server-only. Sends a "report card published" notification to every unique
// parent email address linked to the given section. Best-effort: failures
// are logged and counted but do NOT throw — publication is the source of
// truth, email is a courtesy nudge.
//
// Template:
//   Subject: "{LEVEL} {SECTION} · {TERM} Report Card is ready for viewing"
//   Body:    deep-link to the parent portal (enrol.hfse.edu.sg), NOT the
//            SIS directly — parents always enter via the SSO handoff.
export async function emailParentsPublication(args: {
  sectionId: string;
  termId: string;
  publishFrom: string;
  publishUntil: string;
}): Promise<{ sent: number; failed: number; recipients: number }> {
  const apiKey = process.env.RESEND_API_KEY;
  const portalUrl = process.env.NEXT_PUBLIC_PARENT_PORTAL_URL;
  if (!apiKey || !portalUrl) {
    console.warn(
      '[notify] skipping parent email: RESEND_API_KEY or NEXT_PUBLIC_PARENT_PORTAL_URL unset'
    );
    return { sent: 0, failed: 0, recipients: 0 };
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  // Fetch section + level + term labels for the subject line.
  const [sectionRes, termRes] = await Promise.all([
    service
      .from('sections')
      .select('name, level:levels(label)')
      .eq('id', args.sectionId)
      .single(),
    service
      .from('terms')
      .select('label, term_number')
      .eq('id', args.termId)
      .single(),
  ]);

  type SectionRow = {
    name: string;
    level: { label: string | null } | { label: string | null }[] | null;
  };
  const section = sectionRes.data as SectionRow | null;
  const level = section
    ? Array.isArray(section.level)
      ? section.level[0]
      : section.level
    : null;
  const term = termRes.data as { label: string; term_number: number } | null;

  const sectionLabel =
    (level?.label ? `${level.label} ` : '') + (section?.name ?? '');
  const termLabel = term?.label ?? `Term ${term?.term_number ?? ''}`;

  const recipients = await getParentEmailsForSection(args.sectionId, ayCode);
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, recipients: 0 };
  }

  const resend = new Resend(apiKey);
  // Class stays in front of the school's wording: a parent with children in
  // two classes receives two of these, and the subject is the only thing that
  // tells them apart in an inbox list.
  const subject = `${sectionLabel} · ${termLabel} Report Card is ready for viewing`;
  const windowLine = `${new Date(args.publishFrom).toLocaleString('en-SG')} → ${new Date(
    args.publishUntil
  ).toLocaleString('en-SG')}`;

  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      Dear Parent,
    </p>
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      The ${escapeHtml(termLabel)} report card for <strong>${escapeHtml(sectionLabel)}</strong> is now
      available to view on the HFSE parent portal.
    </p>
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 8px;">
      The report card will be available for your viewing during the timeframe
      indicated below.
    </p>
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 24px;">
      <strong>Viewing window:</strong><br/>
      <span style="font-family:monospace;color:#475569;">${escapeHtml(windowLine)}</span>
    </p>
  `;

  const html = renderEmailFrame({
    headline: "Your child's report card is available",
    bodyHtml,
    ctas: [
      {
        label: `View ${termLabel} report card`,
        href: portalUrl,
      },
    ],
    reviewLinkHtml: `
      <p style="font-size:14px;line-height:24px;color:#1d1c1d;margin:0 0 16px;">
        Sign in to the parent portal with the same email and password you use
        for enrolment. If you have trouble signing in, please contact the
        school office.
      </p>
    `,
  });
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? 'HFSE SIS <noreply@hfse.edu.sg>';

  let sent = 0;
  let failed = 0;
  const devTo =
    process.env.NODE_ENV !== 'production' ? 'ace.vizserve@gmail.com' : null;
  for (const to of recipients) {
    try {
      const res = await resend.emails.send({
        from: fromAddress,
        to: devTo ?? to,
        subject,
        html,
      });
      if (res.error) {
        failed += 1;
        console.error('[notify] resend error for', to, res.error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.error('[notify] resend throw for', to, e);
    }
  }
  return { sent, failed, recipients: recipients.length };
}
