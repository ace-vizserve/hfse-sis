// Phase "publication" (plan phase 3): production's one report-card
// publication — AY2026 Term 3, one class, a four-day window.
//
// Write path: POST /api/report-card-publications, mirrored (the route gates on
// a cookie session). The route's own gate is the app's
// `computePublishReadiness`: HARD blockers refuse the publish, SOFT gaps are
// published past and snapshotted on the row (production's one row has gaps).
//
// ⚠ ORDER. An interim card's hard gate includes the adviser comments for
// Terms 1..N (evaluation_writeups), which the evaluation phase writes. So this
// phase runs after it (index.ts); run without those comments, the publish is
// REFUSED by the real gate — reported, not forced. Nothing is ever written
// past a hard blocker.
//
// ⚠ "NOTIFIED" IS NOT REPRODUCED. The route claims `notified_at`, emails the
// parents, and releases the claim when nothing was sent. The seeder never
// sends mail, so the claim is always released: the row has no notified_at.
//
// Idempotent: a section × term that already has a publication is left alone.

import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { computePublishReadiness } from '@/lib/markbook/publish-readiness';
import { emailParentsPublication } from '@/lib/notifications/email-parents-publication';

import { service, sqlRows } from '../lib/local';
import { STAFF, emailOf, staffId } from './staff';

/** The published class: a small AY2026 class with a form adviser. */
export const PUBLICATION = {
  ay: 'AY2026',
  term: 3,
  level: 'P3',
  section: 'Courtesy',
  from: '2026-09-14T00:00:00+08:00',
  until: '2026-09-18T00:00:00+08:00',
} as const;

export type PublicationOutcome =
  | { published: true; id: string }
  | { published: false; reason: string };

export async function runPublication(): Promise<PublicationOutcome> {
  const sb = service();
  const coord = STAFF.find((s) => s.key === 'coord')!;
  const actor = {
    id: staffId(coord),
    email: emailOf(coord),
    role: coord.roles[0],
  };
  const rows =
    sqlRows(`select s.id, t.id, (select count(*) from report_card_publications p
        where p.section_id = s.id and p.term_id = t.id)
      from sections s join levels l on l.id = s.level_id
      join academic_years a on a.id = s.academic_year_id
      join terms t on t.academic_year_id = a.id and t.term_number = ${PUBLICATION.term}
     where a.ay_code = '${PUBLICATION.ay}' and l.code = '${PUBLICATION.level}' and s.name = '${PUBLICATION.section}'`);
  if (rows.length !== 1) throw new Error('publication: target class not found');
  const [sectionId, termId, existing] = rows[0];
  if (Number(existing) > 0) {
    console.log('  publication already there — skipped');
    return { published: true, id: '' };
  }

  const readiness = await computePublishReadiness(sb, sectionId, termId);
  if ('error' in readiness)
    throw new Error(`publication: readiness: ${readiness.error}`);
  if (readiness.hardBlockers.length > 0) {
    const reason = readiness.hardBlockers
      .map((b) => `${b.code} (${b.label})`)
      .join('; ');
    console.log(
      `  publication REFUSED by the app's publish gate: ${reason} — not forced`
    );
    return { published: false, reason };
  }

  const from = new Date(PUBLICATION.from).toISOString();
  const until = new Date(PUBLICATION.until).toISOString();
  const publishedWithGaps =
    readiness.softGaps.length > 0
      ? { gaps: readiness.softGaps, by: actor.email, at: from }
      : null;
  const { data, error } = await sb
    .from('report_card_publications')
    .upsert(
      {
        section_id: sectionId,
        term_id: termId,
        publish_from: from,
        publish_until: until,
        published_by: actor.email,
        published_with_gaps: publishedWithGaps,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'section_id,term_id' }
    )
    .select('id, section_id, term_id, publish_from, publish_until, notified_at')
    .single();
  if (error || !data)
    throw new Error(`publication: ${error?.message ?? 'upsert failed'}`);

  // The route's notify claim: claim, send, release when nothing went out.
  let notification: {
    sent: number;
    failed: number;
    recipients: number;
  } | null = null;
  const { data: claimed } = await sb
    .from('report_card_publications')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('notified_at', null)
    .select('id');
  if (Array.isArray(claimed) && claimed.length > 0) {
    notification = await emailParentsPublication({
      sectionId: data.section_id,
      termId: data.term_id,
      publishFrom: data.publish_from,
      publishUntil: data.publish_until,
    });
    if (notification.sent === 0) {
      await sb
        .from('report_card_publications')
        .update({ notified_at: null })
        .eq('id', data.id);
    }
  }

  const [[sectionName, levelLabel, termLabel, termNumber]] =
    sqlRows(`select s.name, l.label, t.label, t.term_number
      from sections s join levels l on l.id = s.level_id, terms t
     where s.id = '${sectionId}' and t.id = '${termId}'`);
  await logAction({
    service: sb,
    actor,
    action: 'publication.create',
    entityType: 'report_card_publication',
    entityId: data.id,
    context: {
      section_id: data.section_id,
      term_id: data.term_id,
      section_name: sectionName,
      level_label: levelLabel,
      term_label: termLabel,
      term_number: Number(termNumber),
      publish_from: data.publish_from,
      publish_until: data.publish_until,
      previous_publish_from: null,
      previous_publish_until: null,
      first_publish: true,
      notification,
      overridden: readiness.softGaps.length > 0,
      gaps: readiness.softGaps.map((g) => g.code),
    },
  });
  invalidateDrillTags('markbook', PUBLICATION.ay);
  console.log(
    `  published ${PUBLICATION.level} ${PUBLICATION.section} Term ${PUBLICATION.term} ${from}..${until}; soft gaps: ${readiness.softGaps.map((g) => g.code).join(', ') || 'none'}`
  );
  return { published: true, id: data.id };
}
