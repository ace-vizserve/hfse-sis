// The Phase 7 check (P-Files history + outreach, house points, portal drafts
// and recovery tokens, discount codes + the AY2027 funnel), called from
// `verify`. Prints the counts against production (prod-profile.md) and proves:
//   * every revision came through a real path (no row without a replaced
//     link; parent-portal rows name the parent's login, the one pfile-upload
//     row names the officer and its archived file is in the bucket), the
//     status / expiry mix and the per-enrolee spread are production-shaped,
//     some slots have several versions (incl. after Expired and Rejected),
//     and every `replaced_at` is a simulated moment before TODAY;
//   * the app's own loaders read them: the P-Files dashboard
//     (`getDocumentDashboardData`, `getSlotStatusMix`, `getRevisionsOverTime`)
//     and a slot's history (`getDocumentRevisions`, newest first);
//   * outreach: one promise + two email reminders, the promised slot "To follow";
//   * house points: every event 'pick' with no date, every entry with an
//     award from its OWN rubric, every student entrant an AY2026 child with a
//     house, one team per student per event, and the standings from the
//     page's loader (`loadAyEvents` → `sumTotals` → `rankStandings`) equal to
//     the same totals summed independently in SQL (a team credits each
//     distinct house once);
//   * drafts / tokens by type, year, step and category; no draft expired; each
//     unused token's record is status + documents with no applications row
//     (what the portal's recovery-link reads as missing {applications});
//   * no revision predates its application;
//   * discount codes and the AY2027 funnel as the people phase wrote them.
// Ends with a content fingerprint (two rebuilds must print the same one).

import { createHash } from 'node:crypto';

import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { sumTotals } from '@/lib/house-points/compute';
import { loadAyEvents } from '@/lib/house-points/queries';
import { rankStandings } from '@/lib/house-points/standings';
import {
  getRevisionsOverTime,
  getSlotStatusMix,
} from '@/lib/p-files/dashboard';
import {
  getDocumentDashboardData,
  getDocumentRevisions,
} from '@/lib/p-files/queries';
import { listHouses } from '@/lib/sis/houses';

import { LOCAL_PARENT_MARK, TODAY } from '../lib/constants';
import { sql, sqlRows } from '../lib/local';

const num = (q: string) => Number(sql(q).trim());
const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}
const table = (title: string, rows: string[][]) => {
  console.log(`  ${title}`);
  for (const r of rows) console.log(`    ${r.join(' | ')}`);
};

export async function verifyPfilesHouses(): Promise<void> {
  // ── P-Files revisions ─────────────────────────────────────────────────
  const total = num('select count(*) from p_file_revisions');
  table(
    'p_file_revisions by source (prod 6,336: parent-portal 6,334 / sis-direct 1 / pfile-upload 1)',
    sqlRows(
      `select source, count(*) from p_file_revisions group by 1 order by 2 desc`
    )
  );
  table(
    'status_snapshot (prod Valid 45% / Uploaded 38% / Expired 16% / For submission 0.6% / Rejected 0.3%)',
    sqlRows(`select coalesce(status_snapshot, '<null>'), count(*), round(100.0 * count(*) / ${total || 1}, 1) || '%'
               from p_file_revisions group by 1 order by 2 desc`)
  );
  const [expiryPct, enrolees, p50, p90, max] = sqlRows(`
    with per as (select ay_code, enrolee_number, count(*) n from p_file_revisions group by 1, 2)
    select (select round(100.0 * count(expiry_snapshot) / greatest(count(*), 1)) from p_file_revisions),
           count(*), percentile_disc(0.5) within group (order by n),
           percentile_disc(0.9) within group (order by n), max(n) from per`)[0];
  console.log(
    `  revisions ${total} (target ~1.5k); expiry_snapshot ${expiryPct}% (prod 65%); ${enrolees} enrolees, per enrolee p50 ${p50} / p90 ${p90} / max ${max} (prod 9 / 11 / 18)`
  );
  table(
    'by AY (prod AY2025 3,288 / AY2026 3,044 / AY2027 4)',
    sqlRows(
      `select ay_code, count(*), count(distinct enrolee_number) from p_file_revisions group by 1 order by 1`
    )
  );
  check(total >= 1350 && total <= 1700, `revisions ${total}, want ~1.5k`);
  check(
    Number(p50) >= 7 && Number(p50) <= 11,
    `per-enrolee p50 ${p50}, want ~9`
  );
  check(
    Number(expiryPct) >= 55 && Number(expiryPct) <= 75,
    `expiry ${expiryPct}%`
  );
  for (const [source, want] of [
    ['sis-direct', 1],
    ['pfile-upload', 1],
  ] as const)
    check(
      num(
        `select count(*) from p_file_revisions where source = '${source}'`
      ) === want,
      `${source} rows != ${want}`
    );
  check(
    num(`select count(*) from p_file_revisions where previous_url is null`) ===
      0,
    'a revision with no replaced link'
  );
  const parentRows = num(
    `select count(*) from p_file_revisions r where source = 'parent-portal'
        and exists (select 1 from auth.users u where u.email = r.replaced_by_email
                     and u.raw_app_meta_data->>'${LOCAL_PARENT_MARK.key}' = '${LOCAL_PARENT_MARK.value}')`
  );
  const parentTotal = num(
    `select count(*) from p_file_revisions where source = 'parent-portal'`
  );
  check(
    parentRows === parentTotal,
    `${parentTotal - parentRows} parent-portal rows not by a parent login`
  );
  const archived = sqlRows(
    `select archived_path, replaced_by_email from p_file_revisions where source = 'pfile-upload'`
  )[0];
  const archivedInBucket =
    !!archived &&
    num(
      `select count(*) from storage.objects where bucket_id = 'parent-portal' and name = '${archived[0]}'`
    ) === 1;
  check(
    archivedInBucket && archived[1] === 'documents@local.test',
    'pfile-upload archive missing / wrong officer'
  );
  const late = num(
    `select count(*) from p_file_revisions where replaced_at >= '${TODAY}'::date`
  );
  check(late === 0, `${late} revisions dated on/after TODAY`);
  // A document cannot be replaced before the application it belongs to.
  const early = num(`select count(*) from p_file_revisions r join (
      select 'AY2025' ay, "enroleeNumber" en, created_at from ay2025_enrolment_applications
      union all select 'AY2026', "enroleeNumber", created_at from ay2026_enrolment_applications
      union all select 'AY2027', "enroleeNumber", created_at from ay2027_enrolment_applications) a
      on a.ay = r.ay_code and a.en = r.enrolee_number
     where r.replaced_at < a.created_at`);
  check(early === 0, `${early} revisions dated before their application`);
  const multi = sqlRows(`
    select ay_code, enrolee_number, slot_key, count(*),
           bool_or(status_snapshot = 'Expired'), bool_or(status_snapshot = 'Rejected')
      from p_file_revisions group by 1, 2, 3 having count(*) > 1 order by 4 desc, 1, 2, 3`);
  const afterExpired = num(
    `select count(*) from p_file_revisions where status_snapshot = 'Expired'`
  );
  const afterRejected = num(
    `select count(*) from p_file_revisions where status_snapshot = 'Rejected'`
  );
  console.log(
    `  slots with several versions: ${multi.length} (${multi.filter((m) => m[4] === 't').length} began Expired, ${multi.filter((m) => m[5] === 't').length} began Rejected); re-uploads after Expired ${afterExpired}, after Rejected ${afterRejected}`
  );
  check(multi.length >= 10, 'too few multi-version slots');
  check(
    afterExpired > 0 && afterRejected > 0,
    'no re-upload after Expired / Rejected'
  );
  if (multi[0]) {
    const [ay, en, slot, n] = multi[0];
    const history = await getDocumentRevisions(ay, en, slot);
    const ordered = history.every(
      (h, i) => i === 0 || h.replacedAt <= history[i - 1].replacedAt
    );
    console.log(
      `  getDocumentRevisions(${ay}, ${en}, ${slot}) -> ${history.length} versions, newest first: ${history.map((h) => `${h.replacedAt.slice(0, 10)} ${h.statusSnapshot}`).join(', ')}`
    );
    check(history.length === Number(n) && ordered, 'slot history loader');
  }
  const dash = await getDocumentDashboardData('AY2026');
  const mix = await getSlotStatusMix('AY2026');
  const weeks = await getRevisionsOverTime('AY2026', 24);
  console.log(
    `  P-Files dashboard AY2026: ${dash.summary.totalStudents} students, ${dash.summary.fullyComplete} complete, expiring<=90d ${dash.summary.expiringSoon90}; slot mix ${JSON.stringify(mix)}; revisions in the last 24 weeks ${weeks.reduce((s, w) => s + w.count, 0)}`
  );
  check(dash.summary.totalStudents > 0, 'P-Files dashboard read nobody');

  // ── Outreach ──────────────────────────────────────────────────────────
  const outreach = sqlRows(
    `select ay_code, kind, coalesce(channel, ''), slot_key, count(*) from p_file_outreach group by 1, 2, 3, 4 order by 1, 2, 4`
  );
  table(
    'p_file_outreach (prod AY2026: promise fatherPassport 1, reminder email fatherPassport 1)',
    outreach
  );
  check(
    num(`select count(*) from p_file_outreach`) === 3,
    'outreach rows != 3'
  );
  check(
    num(
      `select count(*) from p_file_outreach where kind = 'reminder' and channel = 'email'`
    ) === 2,
    'reminders != 2 email'
  );
  const promised = sqlRows(
    `select o.enrolee_number, to_jsonb(d)->>(o.slot_key || 'Status') from p_file_outreach o
       join ay2026_enrolment_documents d on d."enroleeNumber" = o.enrolee_number where o.kind = 'promise'`
  )[0];
  check(promised?.[1] === 'To follow', 'promised slot is not To follow');

  // ── House points ──────────────────────────────────────────────────────
  const [ev, en, pl, tm, mb] =
    sqlRows(`select (select count(*) from house_point_events),
      (select count(*) from house_point_entries), (select count(*) from house_point_places),
      (select count(*) from house_point_teams), (select count(*) from house_point_team_members)`)[0];
  console.log(
    `  house points: events ${ev} (8; prod 10), entries ${en} (~120; prod 214), places ${pl} (~30; prod 37), teams ${tm} (8; prod 12), members ${mb} (~15; prod 21)`
  );
  table(
    'events (type | entrant | mode | held_on null | entries | teams | places | with award | points min-max)',
    sqlRows(`select e.event_type, e.entrant_kind, e.placement_mode, e.held_on is null,
               (select count(*) from house_point_entries x where x.event_id = e.id),
               (select count(*) from house_point_teams t where t.event_id = e.id),
               (select count(*) from house_point_places p where p.event_id = e.id),
               (select count(*) from house_point_entries x where x.event_id = e.id and x.place_id is not null),
               (select min(points) || '-' || max(points) from house_point_places p where p.event_id = e.id)
             from house_point_events e order by 1, 2, 5 desc`)
  );
  check(
    Number(ev) === 8 && Number(pl) === 30 && Number(tm) === 8,
    'house-points counts'
  );
  check(
    num(
      `select count(*) from house_point_events where placement_mode <> 'pick' or held_on is not null`
    ) === 0,
    'an event not pick / dated'
  );
  check(
    num(`select count(*) from house_point_entries x left join house_point_places p on p.id = x.place_id
          where p.id is null or p.event_id <> x.event_id`) === 0,
    'an entry without an award from its own rubric'
  );
  check(
    num(`select count(*) from house_point_entries x join section_students ss on ss.id = x.section_student_id
           join students st on st.id = ss.student_id join sections s on s.id = ss.section_id
           join academic_years a on a.id = s.academic_year_id
          where st.house_id is null or a.ay_code <> 'AY2026'`) === 0,
    'a student entrant without a house / outside AY2026'
  );
  check(
    num(`select count(*) from (select t.event_id, m.section_student_id from house_point_team_members m
           join house_point_teams t on t.id = m.team_id group by 1, 2 having count(*) > 1) d`) ===
      0,
    'a student on two teams in one event'
  );
  const ayId = await getAyIdByCode('AY2026');
  const houses = await listHouses();
  const events = await loadAyEvents(ayId!, houses);
  const totals = sumTotals(
    events.map((e) => e.totals),
    houses.map((h) => h.id)
  );
  const standings = rankStandings(houses, totals);
  console.log(
    `  standings (/records/house-points loader): ${standings.map((s) => `${s.place}. ${s.house.name} ${s.total}`).join(', ')}`
  );
  const sqlTotals = new Map(
    sqlRows(`with credit as (
        select p.points, st.house_id from house_point_entries x join house_point_places p on p.id = x.place_id
          join section_students ss on ss.id = x.section_student_id join students st on st.id = ss.student_id
        union all
        select p.points, x.house_id from house_point_entries x join house_point_places p on p.id = x.place_id
         where x.house_id is not null
        union all
        select p.points, h.house_id from house_point_entries x join house_point_places p on p.id = x.place_id
          join (select distinct m.team_id, st.house_id from house_point_team_members m
                  join section_students ss on ss.id = m.section_student_id join students st on st.id = ss.student_id
                 where st.house_id is not null) h on h.team_id = x.team_id)
      select house_id, sum(points) from credit where house_id is not null group by 1`).map(
      ([h, n]) => [h, Number(n)]
    )
  );
  check(
    houses.every((h) => (sqlTotals.get(h.id) ?? 0) === totals[h.id]),
    'standings loader disagrees with the SQL totals'
  );

  // ── Portal drafts + recovery tokens ───────────────────────────────────
  table(
    'application_drafts (type | year | tab | n)  [prod hfse-is ay2027 upload-req 8 / student-info 2 / family-info 1, ay2026 upload-req 1; reenrol ay2027 9]',
    sqlRows(
      `select type, academic_year, coalesce(current_tab, ''), count(*) from application_drafts group by 1, 2, 3 order by 1, 2, 4 desc`
    )
  );
  table(
    'enrolment_recovery_tokens (year | category | missing | used | notified | n)  [prod 9, all {applications}, mostly New ay2027]',
    sqlRows(`select academic_year, category, missing_tables::text, used_at is not null, notified_at is not null, count(*)
               from enrolment_recovery_tokens group by 1, 2, 3, 4, 5 order by 1, 2, 4, 5`)
  );
  check(num('select count(*) from application_drafts') === 10, 'drafts != 10');
  check(
    num('select count(*) from enrolment_recovery_tokens') === 5,
    'tokens != 5'
  );
  check(
    num(`select count(*) from application_drafts d join auth.users u on u.id = d.user_id
          where u.raw_app_meta_data->>'${LOCAL_PARENT_MARK.key}' = '${LOCAL_PARENT_MARK.value}'`) ===
      10,
    'a draft not owned by a seeded parent login'
  );
  // Drafts are dated from the real run date: none may have expired.
  check(
    num(`select count(*) from application_drafts where expires_at <= now()`) ===
      0,
    'a draft has already expired'
  );
  // What the portal's `recovery-link` reads for each token's enrolee: an
  // unused link's record has status + documents and NO applications row
  // (missing {applications}); a used link's record has since been completed.
  const tokenRecords = sqlRows(`select t.used_at is not null,
      (select count(*) from ay2027_enrolment_applications a where a."enroleeNumber" = t.enrolee_number)
        + (select count(*) from ay2026_enrolment_applications a where t.academic_year = 'ay2026' and a."enroleeNumber" = t.enrolee_number),
      (select count(*) from ay2027_enrolment_status s where s."enroleeNumber" = t.enrolee_number)
        + (select count(*) from ay2026_enrolment_status s where t.academic_year = 'ay2026' and s."enroleeNumber" = t.enrolee_number),
      (select count(*) from ay2027_enrolment_documents d where d."enroleeNumber" = t.enrolee_number)
        + (select count(*) from ay2026_enrolment_documents d where t.academic_year = 'ay2026' and d."enroleeNumber" = t.enrolee_number)
    from enrolment_recovery_tokens t order by t.token`);
  const unusedOk = tokenRecords.filter(
    ([used, a, s, d]) => used === 'f' && a === '0' && s === '1' && d === '1'
  ).length;
  const usedOk = tokenRecords.filter(
    ([used, a, s, d]) => used === 't' && a === '1' && s === '1' && d === '1'
  ).length;
  const unusedN = tokenRecords.filter(([used]) => used === 'f').length;
  console.log(
    `  recovery-token records: unused ${unusedOk} of ${unusedN} are status + documents with no application; used ${usedOk} of ${tokenRecords.length - unusedN} complete`
  );
  check(
    unusedN > 0 &&
      unusedOk === unusedN &&
      usedOk === tokenRecords.length - unusedN,
    'a recovery token does not point at the record shape the portal expects'
  );

  // ── Discount codes + AY2027 funnel (written by `people`) ──────────────
  const codes =
    sqlRows(`select 'AY2025', count(*) from ay2025_discount_codes union all
      select 'AY2026', count(*) from ay2026_discount_codes union all select 'AY2027', count(*) from ay2027_discount_codes`);
  const ay27Names = sqlRows(
    `select "discountCode" from ay2027_discount_codes order by id`
  ).map((r) => r[0]);
  const funnel =
    sqlRows(`select a.category, coalesce(s."applicationStatus", '<none>'), count(*)
      from ay2027_enrolment_applications a left join ay2027_enrolment_status s using ("enroleeNumber") group by 1, 2 order by 1, 2`);
  console.log(
    `  discount codes ${codes.map((c) => c.join(' ')).join(', ')} (prod 0 / 20 / 10); AY2027 codes ${ay27Names.join(', ')}`
  );
  table(
    'AY2027 funnel (category | status | n)  [prod Current 257 Submitted / 3 Enrolled, New 47 / 2]',
    funnel
  );
  check(
    codes.map((c) => c[1]).join(',') === '0,20,10' &&
      ay27Names.every((c) => /^AY27(JUL|AUG|SEP|OCT|NOV)(CUR|NEW)$/.test(c)),
    'discount codes'
  );

  // ── Fingerprint ───────────────────────────────────────────────────────
  // Stable columns only: no ids / created_at (database defaults) and not the
  // promise's run-date-relative `promised_until` (lib/constants.ts).
  const fp = createHash('sha256')
    .update(
      sql(`select ay_code, enrolee_number, slot_key, source, coalesce(status_snapshot, ''), coalesce(expiry_snapshot::text, ''),
             md5(previous_url), coalesce(archived_path, ''), coalesce(replaced_by_email, ''), replaced_at
           from p_file_revisions order by 1, 2, 3, 10`)
    )
    .update(
      sql(`select ay_code, enrolee_number, slot_key, kind, coalesce(channel, ''), coalesce(recipient_email, ''),
             md5(coalesce(note, '')), coalesce(created_by_email, '') from p_file_outreach order by 1, 2, 3, 4`)
    )
    .update(
      sql(`select e.name, e.event_type, e.entrant_kind,
             (select string_agg(p.label || ':' || coalesce(p.rank::text, '') || ':' || p.points, ',' order by p.sort_order)
                from house_point_places p where p.event_id = e.id),
             (select string_agg(coalesce(st.student_number, t.name, h.code) || '=' || coalesce(p.label, ''), ','
                                order by coalesce(st.student_number, t.name, h.code))
                from house_point_entries x left join house_point_places p on p.id = x.place_id
                left join section_students ss on ss.id = x.section_student_id left join students st on st.id = ss.student_id
                left join house_point_teams t on t.id = x.team_id left join houses h on h.id = x.house_id
               where x.event_id = e.id),
             (select string_agg(t.name || ':' || (select string_agg(st.student_number, '+' order by st.student_number)
                       from house_point_team_members m join section_students ss on ss.id = m.section_student_id
                       join students st on st.id = ss.student_id where m.team_id = t.id), ',' order by t.name)
                from house_point_teams t where t.event_id = e.id)
           from house_point_events e order by 1`)
    )
    .update(
      // Drafts are dated from the run date: their spacing counts, not the
      // dates (the form's own `createdAt` copy is left out for the same reason).
      sql(`select draft_id, user_id, type, coalesce(academic_year, ''), md5((form_state - 'createdAt')::text),
             coalesce(current_tab, ''), completed_tabs::text,
             last_saved_at - (select max(last_saved_at) from application_drafts), last_saved_at - created_at,
             expires_at - last_saved_at, coalesce(enrolee_number, '')
           from application_drafts order by 1`)
    )
    .update(
      sql(`select token, academic_year, enrolee_number, coalesce(student_number, ''), category, missing_tables::text,
             created_by, created_at, expires_at, coalesce(used_at::text, ''), coalesce(notified_email, ''),
             coalesce(md5(student_name), '') from enrolment_recovery_tokens order by 1`)
    )
    .digest('hex')
    .slice(0, 16);
  console.log(`  pfiles/house-points/portal fingerprint: ${fp}`);
  if (failures.length)
    throw new Error(
      `phase 7 check failed:\n    - ${failures.join('\n    - ')}`
    );
  console.log('  phase 7 check: PASS');
}
