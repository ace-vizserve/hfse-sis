import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildCannedCalendar,
  buildCannedEvents,
  buildTermTemplates,
  LEVELS,
  SCHOOL_CONFIG_DEFAULTS,
  SECTIONS,
  SUBJECTS,
} from './fixtures';
import type { SectionClassType } from '@/lib/schemas/section';
import { applyTrackBundle } from '@/lib/sis/section-track';
import { weightBucketForSubjectCode } from '@/lib/sis/subjects/weight-defaults';

// Structural seeder for the Test environment. Populates the reference +
// AY-scoped config a school needs before students can be enrolled, grades
// entered, or attendance marked. Idempotent end-to-end — every upsert
// uses a unique constraint + `ignoreDuplicates` or a guarded `if` on
// current state, so re-running is safe.
//
// Runs on every switch-to-Test (via `switchEnvironment('test')`). Cheap
// enough to do unconditionally (~800 calendar rows + ~30 config rows on
// cold seed, zero diffs on warm re-run).

export type StructureSeedResult = {
  levels_inserted: number;
  subjects_inserted: number;
  sections_inserted: number;
  subject_configs_inserted: number;
  subject_level_offerings_inserted: number;
  terms_updated: number;
  calendar_days_inserted: number;
  calendar_events_inserted: number;
  school_config_applied: boolean;
  grading_sheets_created: number;
  grading_sheets_totals_set: number;
  grading_sheets_labels_set: number;
};

export async function ensureTestStructure(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
  options?: { targetYear?: number; forceOverwriteDates?: boolean }
): Promise<StructureSeedResult> {
  const targetYear = options?.targetYear ?? new Date().getFullYear();
  const forceOverwrite =
    options?.forceOverwriteDates ?? /^AY9/.test(testAy.ay_code);
  const templates = buildTermTemplates(targetYear);
  const cannedCalendar = buildCannedCalendar(targetYear);
  const cannedEvents = buildCannedEvents(targetYear);

  const result: StructureSeedResult = {
    levels_inserted: 0,
    subjects_inserted: 0,
    sections_inserted: 0,
    subject_configs_inserted: 0,
    subject_level_offerings_inserted: 0,
    terms_updated: 0,
    calendar_days_inserted: 0,
    calendar_events_inserted: 0,
    school_config_applied: false,
    grading_sheets_created: 0,
    grading_sheets_totals_set: 0,
    grading_sheets_labels_set: 0,
  };

  // ---- 1. levels (global reference) ----
  {
    const { data, error } = await service
      .from('levels')
      .upsert(LEVELS, { onConflict: 'code', ignoreDuplicates: true })
      .select('id, code');
    if (error) {
      console.error('[structural seeder] levels upsert failed:', error.message);
    }
    result.levels_inserted = data?.length ?? 0;
  }

  const { data: levelsRows } = await service
    .from('levels')
    .select('id, code, level_type');
  const levels = (levelsRows ?? []) as Array<{
    id: string;
    code: string;
    level_type: 'primary' | 'secondary';
  }>;
  const levelByCode = new Map(levels.map((l) => [l.code, l]));

  // ---- 2. subjects (global reference) ----
  {
    const rows = SUBJECTS.map((s) => ({
      code: s.code,
      name: s.name,
      is_examinable: s.is_examinable,
    }));
    const { data, error } = await service
      .from('subjects')
      .upsert(rows, { onConflict: 'code', ignoreDuplicates: true })
      .select('id, code');
    if (error) {
      console.error(
        '[structural seeder] subjects upsert failed:',
        error.message
      );
    }
    result.subjects_inserted = data?.length ?? 0;
  }

  const { data: subjectsRows } = await service
    .from('subjects')
    .select('id, code');
  const subjects = (subjectsRows ?? []) as Array<{ id: string; code: string }>;
  const subjectByCode = new Map(subjects.map((s) => [s.code, s]));

  // ---- 3. sections (AY-scoped) ----
  {
    const rows = SECTIONS.flatMap((s) => {
      const lv = levelByCode.get(s.level_code);
      if (!lv) return [];
      return [
        {
          academic_year_id: testAy.id,
          level_id: lv.id,
          name: s.name,
          schedule: s.schedule,
        },
      ];
    });
    if (rows.length > 0) {
      const { data, error } = await service
        .from('sections')
        .upsert(rows, {
          onConflict: 'academic_year_id,level_id,name',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error) {
        console.error(
          '[structural seeder] sections upsert failed:',
          error.message
        );
      }
      result.sections_inserted = data?.length ?? 0;
    }
  }

  // ---- 4. subject_configs (AY-scoped, one row per subject — migration
  //         080 collapse) + subject_level_offerings (which levels teach
  //         which subjects, AY-scoped) ----
  //
  // Weight is a property of the SUBJECT now, not the level it happens to
  // be taught at (the level-type-keyed weightProfileFor default-fill bug
  // this replaces — see lib/sis/subjects/weight-defaults.ts for the
  // verified real buckets). A subject that's taught at more than one level
  // (every SUBJECTS entry here, since each is tagged to a whole level
  // TYPE) gets exactly one subject_configs row and N subject_level_
  // offerings rows (one per matching level).
  {
    const configRows: Array<{
      academic_year_id: string;
      subject_id: string;
      ww_weight: number;
      pt_weight: number;
      qa_weight: number;
      ww_max_slots: number;
      pt_max_slots: number;
    }> = [];
    const offeringRows: Array<{
      subject_id: string;
      level_id: string;
      academic_year_id: string;
    }> = [];

    for (const subj of SUBJECTS) {
      const s = subjectByCode.get(subj.code);
      if (!s) continue;

      // reportOnly subjects (e.g. Mother Tongue post-migration-081) exist
      // in the catalog + fan into another subject's report-card column via
      // subject_report_map, but never get their own subject_configs /
      // subject_level_offerings rows — Filipino/Mandarin carry the real
      // scores now.
      if (subj.reportOnly) continue;

      const bucket = weightBucketForSubjectCode(subj.code);
      configRows.push({
        academic_year_id: testAy.id,
        subject_id: s.id,
        ww_weight: bucket.ww,
        pt_weight: bucket.pt,
        qa_weight: bucket.qa,
        ww_max_slots: 5,
        pt_max_slots: 5,
      });

      for (const lv of levels) {
        if (subj.level_type !== lv.level_type) continue;
        // levelCodes (e.g. Mandarin -> P1-P5, not the full P1-P6 Primary
        // range) narrows the offering to specific level codes within the
        // matching level_type. Omitted for every other entry — unchanged
        // behaviour (every level whose level_type matches gets a row).
        if (subj.levelCodes && !subj.levelCodes.includes(lv.code)) continue;
        offeringRows.push({
          subject_id: s.id,
          level_id: lv.id,
          academic_year_id: testAy.id,
        });
      }
    }

    if (configRows.length > 0) {
      const { data, error } = await service
        .from('subject_configs')
        .upsert(configRows, {
          onConflict: 'academic_year_id,subject_id',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error) {
        console.error(
          '[structural seeder] subject_configs upsert failed:',
          error.message
        );
      }
      result.subject_configs_inserted = data?.length ?? 0;
    }

    if (offeringRows.length > 0) {
      const { data, error } = await service
        .from('subject_level_offerings')
        .upsert(offeringRows, {
          onConflict: 'subject_id,level_id,academic_year_id',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error) {
        console.error(
          '[structural seeder] subject_level_offerings upsert failed:',
          error.message
        );
      }
      result.subject_level_offerings_inserted = data?.length ?? 0;
    }
  }

  // ---- 4b. section_subjects: explicit per-section attachment ----
  // The old `sync_section_subjects_for_ay` RPC blanket-attached every
  // level-offered subject to every section — a shortcut that stopped
  // matching reality once real section creation (app/api/sections/route.ts)
  // was changed to start every new section with ZERO subjects attached,
  // leaving the registrar to attach what applies explicitly (the
  // track-bundle apply for Secondary, or the Section Subjects panel /
  // Mother Tongue language choice for anything else). This seeder now
  // mirrors that same explicit, per-section workflow instead of the RPC's
  // shortcut, so seeded test data looks like something a registrar
  // actually built, not a fixture-only shape.
  //
  // Still runs in this exact spot, before step 9 — create_grading_sheets_
  // for_ay (migration 080) resolves grading-sheet eligibility THROUGH
  // section_subjects, so any section left with none would silently get
  // zero seeded grading sheets and the test AY's dashboards/grading pages
  // would render empty.
  {
    // Re-read sections fresh: step 3's upsert only returns rows it
    // actually inserted (ignoreDuplicates), so a warm re-run needs a full
    // read to see every section this seeder is responsible for — including
    // any class_type already set by a prior run or a registrar edit, which
    // must never be clobbered.
    const { data: sectionRows } = await service
      .from('sections')
      .select('id, name, level_id, class_type')
      .eq('academic_year_id', testAy.id);
    const sectionsForAy = (sectionRows ?? []) as Array<{
      id: string;
      name: string;
      level_id: string;
      class_type: SectionClassType | null;
    }>;
    const levelById = new Map(levels.map((l) => [l.id, l]));

    // subject_configs, fresh (migration 080 collapse: one row per subject
    // per AY, keyed by subject_id — not per level) — needed to resolve
    // Primary's offered subject codes to config ids for the direct insert
    // below.
    const { data: configRows } = await service
      .from('subject_configs')
      .select('id, subject_id')
      .eq('academic_year_id', testAy.id);
    const configIdBySubjectId = new Map(
      ((configRows ?? []) as Array<{ id: string; subject_id: string }>).map(
        (c) => [c.subject_id, c.id]
      )
    );

    // Deterministic per-level index for each Primary section, taken from
    // the SECTIONS fixture's own order (not DB row order, which isn't
    // guaranteed stable) — every level's counter starts fresh at 0, since
    // the Mother-Tongue-language choice alternates WITHIN a level (one P1
    // section does Filipino, another P1 section does Mandarin).
    const primaryFixtureIndexByKey = new Map<string, number>();
    {
      const counters = new Map<string, number>();
      for (const s of SECTIONS) {
        const idx = counters.get(s.level_code) ?? 0;
        primaryFixtureIndexByKey.set(`${s.level_code}|${s.name}`, idx);
        counters.set(s.level_code, idx + 1);
      }
    }

    // Deterministic index for each Secondary section, sequential ACROSS the
    // whole fixture (not reset per level) — SECTIONS has exactly one
    // section per Secondary level (S1-S4), so a per-level index would
    // always read 0 and every Secondary section would land on the same
    // track. A cross-fixture index gives S1/S3 → Global, S2/S4 → Standard,
    // so seeded test data actually exercises both tracks.
    const secondaryFixtureIndexByKey = new Map<string, number>();
    {
      let i = 0;
      for (const s of SECTIONS) {
        const lv = levelByCode.get(s.level_code);
        if (lv?.level_type !== 'secondary') continue;
        secondaryFixtureIndexByKey.set(`${s.level_code}|${s.name}`, i);
        i += 1;
      }
    }

    const sectionSubjectRows: Array<{
      section_id: string;
      subject_config_id: string;
    }> = [];

    for (const section of sectionsForAy) {
      const level = levelById.get(section.level_id);
      if (!level) continue;
      const key = `${level.code}|${section.name}`;

      if (level.level_type === 'secondary') {
        const idx = secondaryFixtureIndexByKey.get(key) ?? 0;
        const assignedClassType: SectionClassType =
          idx % 2 === 0 ? 'Global' : 'Standard';
        // Never overwrite an already-set class_type (a prior seeder run or
        // a registrar edit) — only assign when it's still null.
        const classType = section.class_type ?? assignedClassType;

        if (!section.class_type) {
          const { error } = await service
            .from('sections')
            .update({ class_type: classType })
            .eq('id', section.id);
          if (error) {
            console.error(
              '[structural seeder] section class_type update failed:',
              error.message
            );
          }
        }

        try {
          await applyTrackBundle(service, {
            sectionId: section.id,
            academicYearId: testAy.id,
            classType,
          });
        } catch (e) {
          console.error(
            '[structural seeder] applyTrackBundle failed:',
            e instanceof Error ? e.message : e
          );
        }
        continue;
      }

      // Primary: attach every subject offered at this level except pick
      // exactly one of FIL/MANDARIN (never both) — alternating which one
      // across sections at the same level by fixture index, matching the
      // real "one section is Mother Tongue (Filipino), another is Mother
      // Tongue (Mandarin)" pattern. Levels where only one of the two is
      // offered at all (e.g. P6 — MANDARIN's fixture entry is scoped to
      // P1-P5 only) never drop the one that IS offered.
      const offeredForLevel = SUBJECTS.filter((subj) => {
        if (subj.reportOnly) return false;
        if (subj.level_type !== 'primary') return false;
        if (subj.levelCodes && !subj.levelCodes.includes(level.code))
          return false;
        return true;
      });
      const hasFil = offeredForLevel.some((s) => s.code === 'FIL');
      const hasMandarin = offeredForLevel.some((s) => s.code === 'MANDARIN');
      const dropCode =
        hasFil && hasMandarin
          ? (primaryFixtureIndexByKey.get(key) ?? 0) % 2 === 0
            ? 'MANDARIN'
            : 'FIL'
          : null;

      for (const subj of offeredForLevel) {
        if (subj.code === dropCode) continue;
        const subject = subjectByCode.get(subj.code);
        if (!subject) continue;
        const configId = configIdBySubjectId.get(subject.id);
        if (!configId) continue;
        sectionSubjectRows.push({
          section_id: section.id,
          subject_config_id: configId,
        });
      }
    }

    if (sectionSubjectRows.length > 0) {
      const { error } = await service
        .from('section_subjects')
        .upsert(sectionSubjectRows, {
          onConflict: 'section_id,subject_config_id',
          ignoreDuplicates: true,
        });
      if (error) {
        console.error(
          '[structural seeder] section_subjects upsert failed:',
          error.message
        );
      }
    }
  }

  // ---- 5. terms: update with dates + virtue_theme + grading_lock_date ----
  // Terms already exist (created by create_academic_year RPC).
  const { data: termsRows } = await service
    .from('terms')
    .select(
      'id, term_number, start_date, end_date, virtue_theme, grading_lock_date'
    )
    .eq('academic_year_id', testAy.id);
  const terms = (termsRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    virtue_theme: string | null;
    grading_lock_date: string | null;
  }>;
  const termByNumber = new Map(terms.map((t) => [t.term_number, t]));

  for (const tmpl of templates) {
    const existing = termByNumber.get(tmpl.term_number);
    if (!existing) continue;

    // For test AYs (^AY9 codes), force-overwrite term dates so re-running
    // the seeder under new TERM_TEMPLATES values applies. For production
    // AYs (^AY[0-8]), keep the existing fill-blanks behavior so registrar
    // edits aren't clobbered.
    const patch: Record<string, unknown> = {};
    if (forceOverwrite || !existing.start_date)
      patch.start_date = tmpl.start_date;
    if (forceOverwrite || !existing.end_date) patch.end_date = tmpl.end_date;
    if (forceOverwrite || (!existing.virtue_theme && tmpl.virtue_theme))
      patch.virtue_theme = tmpl.virtue_theme;
    if (forceOverwrite || !existing.grading_lock_date)
      patch.grading_lock_date = tmpl.grading_lock_date;

    if (Object.keys(patch).length === 0) continue;

    const { error } = await service
      .from('terms')
      .update(patch)
      .eq('id', existing.id);
    if (!error) result.terms_updated += 1;
    else
      console.error('[structural seeder] terms update failed:', error.message);
  }

  // Re-read terms (in case dates were just filled in) — downstream calendar
  // seeder needs the populated date range to scope its weekday fan-out.
  const { data: termsFresh } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id);
  const termsWithDates = (
    (termsFresh ?? []) as Array<{
      id: string;
      term_number: number;
      start_date: string | null;
      end_date: string | null;
    }>
  ).filter(
    (
      t
    ): t is {
      id: string;
      term_number: number;
      start_date: string;
      end_date: string;
    } => !!t.start_date && !!t.end_date
  );

  // ---- 6. school_calendar: weekdays + canned holidays ----
  if (termsWithDates.length > 0) {
    // Build the weekday-school_day set first, then overlay canned entries
    // (holidays win when they collide with a weekday).
    const overlay = new Map<
      string,
      { day_type: string; label: string | null; hbl_overlay: boolean }
    >();
    for (const c of cannedCalendar) {
      overlay.set(c.date, {
        day_type: c.day_type,
        label: c.label,
        hbl_overlay: c.hblOverlay ?? false,
      });
    }

    // Migration 037 widened the unique key from (term_id, date) to
    // (term_id, audience, date) so primary + secondary can each carry a
    // row on the same date. The seeder writes audience='all' rows; the
    // upsert's onConflict target must match the post-037 key or PostgREST
    // skips inserts silently (no error, no rows) — which then leaves
    // school_calendar empty and downstream attendance seeding inserts
    // zero rows because schoolDays.length === 0.
    // Migration 051: hbl_overlay column — true on marking days + awards
    // deliberation day (school_holiday+HBL dual-label per AY 2026 calendar).
    const rows: Array<{
      term_id: string;
      date: string;
      day_type: string;
      is_holiday: boolean;
      hbl_overlay: boolean;
      label: string | null;
      audience: 'all';
    }> = [];

    for (const t of termsWithDates) {
      const start = parseIso(t.start_date);
      const end = parseIso(t.end_date);
      const cursor = new Date(start);
      while (cursor.getTime() <= end.getTime()) {
        const iso = formatIso(cursor);
        const dow = cursor.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const overlayEntry = overlay.get(iso);

        if (overlayEntry) {
          // Overlay includes weekends too (e.g., a Saturday public holiday
          // still belongs on the calendar for completeness; the grid won't
          // render it but the data's correct).
          rows.push({
            term_id: t.id,
            date: iso,
            day_type: overlayEntry.day_type,
            is_holiday:
              overlayEntry.day_type !== 'school_day' &&
              overlayEntry.day_type !== 'hbl',
            hbl_overlay: overlayEntry.hbl_overlay,
            label: overlayEntry.label,
            audience: 'all',
          });
        } else if (!isWeekend) {
          rows.push({
            term_id: t.id,
            date: iso,
            day_type: 'school_day',
            is_holiday: false,
            hbl_overlay: false,
            label: null,
            audience: 'all',
          });
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (rows.length > 0) {
      const { data, error } = await service
        .from('school_calendar')
        .upsert(rows, {
          onConflict: 'term_id,audience,date',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error) {
        console.error(
          '[structural seeder] school_calendar upsert failed:',
          error.message
        );
      }
      result.calendar_days_inserted = data?.length ?? 0;
    }
  }

  // ---- 7. calendar_events (optional overlay dots) ----
  if (termsWithDates.length > 0) {
    // Best-effort map of a canned event's date range to whichever term
    // contains the start_date.
    const eventRows: Array<{
      term_id: string;
      start_date: string;
      end_date: string;
      label: string;
      category: string;
      audience: string;
    }> = [];
    for (const ev of cannedEvents) {
      const hostTerm = termsWithDates.find(
        (t) => ev.start_date >= t.start_date && ev.start_date <= t.end_date
      );
      if (!hostTerm) continue;
      eventRows.push({
        term_id: hostTerm.id,
        start_date: ev.start_date,
        end_date: ev.end_date,
        label: ev.label,
        category: ev.category,
        audience: ev.audience,
      });
    }

    if (eventRows.length > 0) {
      // No unique constraint on calendar_events — check existence by
      // (term, start, end, label) before inserting to stay idempotent.
      const { data: existing } = await service
        .from('calendar_events')
        .select('term_id, start_date, end_date, label')
        .in(
          'term_id',
          eventRows.map((r) => r.term_id)
        );
      const key = (r: {
        term_id: string;
        start_date: string;
        end_date: string;
        label: string;
      }) => `${r.term_id}|${r.start_date}|${r.end_date}|${r.label}`;
      const existingSet = new Set(
        (
          (existing ?? []) as Array<{
            term_id: string;
            start_date: string;
            end_date: string;
            label: string;
          }>
        ).map((r) => key(r))
      );
      const toInsert = eventRows.filter((r) => !existingSet.has(key(r)));
      if (toInsert.length > 0) {
        const { data, error } = await service
          .from('calendar_events')
          .insert(toInsert)
          .select('id');
        if (error) {
          console.error(
            '[structural seeder] calendar_events insert failed:',
            error.message
          );
        }
        result.calendar_events_inserted = data?.length ?? 0;
      }
    }
  }

  // ---- 8. school_config: fill defaults only if singleton is blank ----
  {
    const { data: row } = await service
      .from('school_config')
      .select('id, principal_name, ceo_name, pei_registration_number')
      .eq('id', 1)
      .maybeSingle();

    if (!row) {
      // No row — insert with Test defaults.
      const { error } = await service.from('school_config').insert({
        id: 1,
        principal_name: SCHOOL_CONFIG_DEFAULTS.principal_name,
        ceo_name: SCHOOL_CONFIG_DEFAULTS.ceo_name,
        pei_registration_number: SCHOOL_CONFIG_DEFAULTS.pei_registration_number,
        default_publish_window_days:
          SCHOOL_CONFIG_DEFAULTS.default_publish_window_days,
      });
      if (!error) result.school_config_applied = true;
    } else {
      const r = row as {
        id: number;
        principal_name: string;
        ceo_name: string;
        pei_registration_number: string;
      };
      const untouched =
        !r.principal_name.trim() &&
        !r.ceo_name.trim() &&
        !r.pei_registration_number.trim();
      if (untouched) {
        const { error } = await service
          .from('school_config')
          .update({
            principal_name: SCHOOL_CONFIG_DEFAULTS.principal_name,
            ceo_name: SCHOOL_CONFIG_DEFAULTS.ceo_name,
            pei_registration_number:
              SCHOOL_CONFIG_DEFAULTS.pei_registration_number,
            default_publish_window_days:
              SCHOOL_CONFIG_DEFAULTS.default_publish_window_days,
          })
          .eq('id', 1);
        if (!error) result.school_config_applied = true;
      }
    }
  }

  // ---- 9. Grading sheets ----
  // Fires the idempotent bulk-create RPC so every (section × subject × term)
  // gets a shell sheet. Then populate ww_totals/pt_totals/qa_total on any
  // sheet that's still using the primitive defaults. These totals drive the
  // formula — without them, grade_entries can't compute quarterly_grade.
  {
    const { data: rpcResult } = await service.rpc(
      'create_grading_sheets_for_ay',
      {
        p_ay_id: testAy.id,
      }
    );
    const inserted =
      typeof rpcResult === 'object' && rpcResult && 'inserted' in rpcResult
        ? Number((rpcResult as { inserted: unknown }).inserted ?? 0)
        : 0;
    result.grading_sheets_created = inserted;

    // Find sheets in this AY that still have default-empty totals. Update
    // them with canonical WW/PT slot lists (10-point each) + the qa_max
    // from their subject_config.
    const { data: termRows } = await service
      .from('terms')
      .select('id')
      .eq('academic_year_id', testAy.id);
    const termIds = (termRows ?? []).map((r) => (r as { id: string }).id);

    if (termIds.length > 0) {
      const { data: sheets } = await service
        .from('grading_sheets')
        .select('id, ww_totals, pt_totals, qa_total, subject_config_id')
        .in('term_id', termIds);

      type SheetRow = {
        id: string;
        ww_totals: number[] | null;
        pt_totals: number[] | null;
        qa_total: number | null;
        subject_config_id: string;
      };
      const sheetList = (sheets ?? []) as SheetRow[];
      const needsUpdate = sheetList.filter(
        (s) =>
          (s.ww_totals ?? []).length === 0 ||
          (s.pt_totals ?? []).length === 0 ||
          s.qa_total == null
      );

      if (needsUpdate.length > 0) {
        // Pull qa_max per subject_config in one batched query.
        const configIds = [
          ...new Set(needsUpdate.map((s) => s.subject_config_id)),
        ];
        const { data: cfgs } = await service
          .from('subject_configs')
          .select('id, qa_max')
          .in('id', configIds);
        const qaMaxById = new Map(
          ((cfgs ?? []) as Array<{ id: string; qa_max: number | null }>).map(
            (c) => [c.id, c.qa_max ?? 30]
          )
        );

        // Default canonical slot totals: 2 WW × 10, 3 PT × 10. Registrar
        // can add/remove slots via the totals editor later.
        for (const sheet of needsUpdate) {
          const ww =
            (sheet.ww_totals ?? []).length > 0 ? sheet.ww_totals! : [10, 10];
          const pt =
            (sheet.pt_totals ?? []).length > 0
              ? sheet.pt_totals!
              : [10, 10, 10];
          const qa =
            sheet.qa_total ?? qaMaxById.get(sheet.subject_config_id) ?? 30;
          const { error } = await service
            .from('grading_sheets')
            .update({ ww_totals: ww, pt_totals: pt, qa_total: qa })
            .eq('id', sheet.id);
          if (!error) result.grading_sheets_totals_set += 1;
        }
      }

      // ---- 9b. slot_labels — seed slot labels + dates (migration 057 / KD #105) ----
      // Sets {label, date, page} entries on any sheet whose slot_labels is NULL so
      // the publish-readiness slot-date check (KD #105) doesn't perpetually fire an
      // amber warning and SlotChips render dates. Only writes NULL sheets —
      // idempotent across re-runs (a sheet with any slot_labels value is skipped).
      {
        const { data: unlabelledSheets } = await service
          .from('grading_sheets')
          .select('id, term_id, ww_totals, pt_totals')
          .in('term_id', termIds)
          .is('slot_labels', null);

        const unlabelled = (unlabelledSheets ?? []) as Array<{
          id: string;
          term_id: string;
          ww_totals: number[] | null;
          pt_totals: number[] | null;
        }>;

        // Build a term-id → date-range map from the freshly-read terms so
        // each slot date falls inside its sheet's term window.
        const termDateMap = new Map(termsWithDates.map((t) => [t.id, t]));

        // Returns an ISO date clamped to [term.start_date, term.end_date].
        const slotDate = (termId: string, offsetDays: number): string => {
          const term = termDateMap.get(termId);
          if (!term) return new Date().toISOString().slice(0, 10);
          const d = parseIso(term.start_date);
          d.setDate(d.getDate() + offsetDays);
          const end = parseIso(term.end_date);
          return formatIso(d.getTime() <= end.getTime() ? d : end);
        };

        for (const sheet of unlabelled) {
          const wwCount = Math.max(1, (sheet.ww_totals ?? [10, 10]).length);
          const ptCount = Math.max(1, (sheet.pt_totals ?? [10, 10, 10]).length);
          // WW slots: spaced 3 weeks apart starting from week 2 of term.
          // PT slots: spaced 2 weeks apart starting from week 4 of term.
          const slotLabels = {
            ww: Array.from({ length: wwCount }, (_, i) => ({
              label: `Written Work ${i + 1}`,
              date: slotDate(sheet.term_id, 7 + i * 21),
              page: null,
            })),
            pt: Array.from({ length: ptCount }, (_, i) => ({
              label: `Performance Task ${i + 1}`,
              date: slotDate(sheet.term_id, 21 + i * 14),
              page: null,
            })),
            qa: 'Quarterly Assessment',
          };
          const { error } = await service
            .from('grading_sheets')
            .update({ slot_labels: slotLabels })
            .eq('id', sheet.id);
          if (!error) result.grading_sheets_labels_set += 1;
        }
      }
    }
  }

  return result;
}

// ---- local date helpers (avoid tz drift) ----
function parseIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`bad iso: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
