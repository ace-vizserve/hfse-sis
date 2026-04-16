import { Resend } from 'resend';
import { getParentEmailsForSection } from '@/lib/supabase/admissions';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { createServiceClient } from '@/lib/supabase/service';

// Server-only. Sends a "report card published" notification to every unique
// parent email address linked to the given section. Best-effort: failures
// are logged and counted but do NOT throw — publication is the source of
// truth, email is a courtesy nudge.
//
// Template:
//   Subject: "Report card available — {LEVEL} {SECTION} · {TERM}"
//   Body:    deep-link to the parent portal (enrol.hfse.edu.sg), NOT the
//            markbook directly — parents always enter via the SSO handoff.
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
      '[notify] skipping parent email: RESEND_API_KEY or NEXT_PUBLIC_PARENT_PORTAL_URL unset',
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
  const subject = `Report card available — ${sectionLabel} · ${termLabel}`;
  const windowLine = `${new Date(args.publishFrom).toLocaleString('en-SG')} → ${new Date(
    args.publishUntil,
  ).toLocaleString('en-SG')}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0F172A;">
      <p style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #64748B; margin: 0 0 12px;">
        HFSE International School
      </p>
      <h1 style="font-size: 22px; margin: 0 0 16px; color: #0F172A;">
        Your child's report card is available
      </h1>
      <p style="line-height: 1.6; margin: 0 0 12px;">
        Dear Parent,
      </p>
      <p style="line-height: 1.6; margin: 0 0 12px;">
        The ${termLabel} report card for <strong>${sectionLabel}</strong> is now
        available to view on the HFSE parent portal.
      </p>
      <p style="line-height: 1.6; margin: 0 0 20px;">
        <strong>Viewing window:</strong><br/>
        <span style="font-family: monospace; color: #475569;">${windowLine}</span>
      </p>
      <p style="margin: 24px 0;">
        <a href="${portalUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Open parent portal
        </a>
      </p>
      <p style="line-height: 1.6; font-size: 13px; color: #64748B; margin: 24px 0 0;">
        Sign in at the parent portal with the same email and password you use
        for enrolment. If you have trouble signing in, please contact the
        school registrar.
      </p>
    </div>
  `;
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? 'HFSE Markbook <noreply@hfse.edu.sg>';

  let sent = 0;
  let failed = 0;
  const devTo = process.env.NODE_ENV !== 'production' ? 'ace.vizserve@gmail.com' : null;
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
