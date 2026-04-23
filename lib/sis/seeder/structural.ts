import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CANNED_CALENDAR,
  CANNED_EVENTS,
  LEVELS,
  SCHOOL_CONFIG_DEFAULTS,
  SECTIONS,
  SUBJECTS,
  TERM_TEMPLATES,
} from './fixtures';

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
  terms_updated: number;
  calendar_days_inserted: number;
  calendar_events_inserted: number;
  school_config_applied: boolean;
  grading_sheets_created: number;
  grading_sheets_totals_set: number;
};

export async function ensureTestStructure(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string },
): Promise<StructureSeedResult> {
  const result: StructureSeedResult = {
    levels_inserted: 0,
    subjects_inserted: 0,
    sections_inserted: 0,
    subject_configs_inserted: 0,
    terms_updated: 0,
    calendar_days_inserted: 0,
    calendar_events_inserted: 0,
    school_config_applied: false,
    grading_sheets_created: 0,
    grading_sheets_totals_set: 0,
  };

  // ---- 1. levels (global reference) ----
  {
    const { data } = await service
      .from('levels')
      .upsert(LEVELS, { onConflict: 'code', ignoreDuplicates: true })
      .select('id, code');
    result.levels_inserted = data?.length ?? 0;
  }

  const { data: levelsRows } = await service.from('levels').select('id, code, level_type');
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
    const { data } = await service
      .from('subjects')
      .upsert(rows, { onConflict: 'code', ignoreDuplicates: true })
      .select('id, code');
    result.subjects_inserted = data?.length ?? 0;
  }

  const { data: subjectsRows } = await service.from('subjects').select('id, code');
  const subjects = (subjectsRows ?? []) as Array<{ id: string; code: string }>;
  const subjectByCode = new Map(subjects.map((s) => [s.code, s]));

  // ---- 3. sections (AY-scoped) ----
  {
    const rows = SECTIONS.flatMap((s) => {
      const lv = levelByCode.get(s.level_code);
      if (!lv) return [];
      return [{ academic_year_id: testAy.id, level_id: lv.id, name: s.name }];
    });
    if (rows.length > 0) {
      const { data } = await service
        .from('sections')
        .upsert(rows, {
          onConflict: 'academic_year_id,level_id,name',
          ignoreDuplicates: true,
        })
        .select('id');
      result.sections_inserted = data?.length ?? 0;
    }
  }

  // ---- 4. subject_configs (AY-scoped) ----
  {
    const rows: Array<{
      academic_year_id: string;
      subject_id: string;
      level_id: string;
      ww_weight: number;
      pt_weight: number;
      qa_weight: number;
      ww_max_slots: number;
      pt_max_slots: number;
    }> = [];

    for (const lv of levels) {
      for (const subj of SUBJECTS) {
        if (subj.level_type !== lv.level_type) continue;
        const s = subjectByCode.get(subj.code);
        if (!s) continue;
        rows.push({
          academic_year_id: testAy.id,
          subject_id: s.id,
          level_id: lv.id,
          ww_weight: lv.level_type === 'primary' ? 0.4 : 0.3,
          pt_weight: lv.level_type === 'primary' ? 0.4 : 0.5,
          qa_weight: 0.2,
          ww_max_slots: 5,
          pt_max_slots: 5,
        });
      }
    }

    if (rows.length > 0) {
      const { data } = await service
        .from('subject_configs')
        .upsert(rows, {
          onConflict: 'academic_year_id,subject_id,level_id',
          ignoreDuplicates: true,
        })
        .select('id');
      result.subject_configs_inserted = data?.length ?? 0;
    }
  }

  // ---- 5. terms: update with dates + virtue_theme + grading_lock_date ----
  // Terms already exist (created by create_academic_year RPC).
  const { data: termsRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, virtue_theme, grading_lock_date, is_current')
    .eq('academic_year_id', testAy.id);
  const terms = (termsRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    virtue_theme: string | null;
    grading_lock_date: string | null;
    is_current: boolean;
  }>;
  const termByNumber = new Map(terms.map((t) => [t.term_number, t]));

  for (const tmpl of TERM_TEMPLATES) {
    const existing = termByNumber.get(tmpl.term_number);
    if (!existing) continue;

    // Only fill blanks — never overwrite registrar-edited values.
    const patch: Record<string, unknown> = {};
    if (!existing.start_date) patch.start_date = tmpl.start_date;
    if (!existing.end_date) patch.end_date = tmpl.end_date;
    if (!existing.virtue_theme && tmpl.virtue_theme) patch.virtue_theme = tmpl.virtue_theme;
    if (!existing.grading_lock_date) patch.grading_lock_date = tmpl.grading_lock_date;

    if (Object.keys(patch).length === 0) continue;

    const { error } = await service.from('terms').update(patch).eq('id', existing.id);
    if (!error) result.terms_updated += 1;
  }

  // Re-read terms (in case dates were just filled in) — downstream calendar
  // seeder needs the populated date range to scope its weekday fan-out.
  const { data: termsFresh } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id);
  const termsWithDates = ((termsFresh ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  }>).filter((t): t is { id: string; term_number: number; start_date: string; end_date: string } =>
    !!t.start_date && !!t.end_date,
  );

  // ---- 6. school_calendar: weekdays + canned holidays ----
  if (termsWithDates.length > 0) {
    // Build the weekday-school_day set first, then overlay canned entries
    // (holidays win when they collide with a weekday).
    const overlay = new Map<string, { day_type: string; label: string | null }>();
    for (const c of CANNED_CALENDAR) {
      overlay.set(c.date, { day_type: c.day_type, label: c.label });
    }

    const rows: Array<{
      term_id: string;
      date: string;
      day_type: string;
      is_holiday: boolean;
      label: string | null;
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
            is_holiday: overlayEntry.day_type !== 'school_day' && overlayEntry.day_type !== 'hbl',
            label: overlayEntry.label,
          });
        } else if (!isWeekend) {
          rows.push({
            term_id: t.id,
            date: iso,
            day_type: 'school_day',
            is_holiday: false,
            label: null,
          });
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (rows.length > 0) {
      const { data } = await service
        .from('school_calendar')
        .upsert(rows, {
          onConflict: 'term_id,date',
          ignoreDuplicates: true,
        })
        .select('id');
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
    }> = [];
    for (const ev of CANNED_EVENTS) {
      const hostTerm = termsWithDates.find(
        (t) => ev.start_date >= t.start_date && ev.start_date <= t.end_date,
      );
      if (!hostTerm) continue;
      eventRows.push({
        term_id: hostTerm.id,
        start_date: ev.start_date,
        end_date: ev.end_date,
        label: ev.label,
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
          eventRows.map((r) => r.term_id),
        );
      const key = (r: { term_id: string; start_date: string; end_date: string; label: string }) =>
        `${r.term_id}|${r.start_date}|${r.end_date}|${r.label}`;
      const existingSet = new Set(
        ((existing ?? []) as Array<{
          term_id: string;
          start_date: string;
          end_date: string;
          label: string;
        }>).map((r) => key(r)),
      );
      const toInsert = eventRows.filter((r) => !existingSet.has(key(r)));
      if (toInsert.length > 0) {
        const { data } = await service.from('calendar_events').insert(toInsert).select('id');
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
        default_publish_window_days: SCHOOL_CONFIG_DEFAULTS.default_publish_window_days,
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
            pei_registration_number: SCHOOL_CONFIG_DEFAULTS.pei_registration_number,
            default_publish_window_days: SCHOOL_CONFIG_DEFAULTS.default_publish_window_days,
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
    const { data: rpcResult } = await service.rpc('create_grading_sheets_for_ay', {
      p_ay_id: testAy.id,
    });
    const inserted = typeof rpcResult === 'object' && rpcResult && 'inserted' in rpcResult
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
          s.qa_total == null,
      );

      if (needsUpdate.length > 0) {
        // Pull qa_max per subject_config in one batched query.
        const configIds = [...new Set(needsUpdate.map((s) => s.subject_config_id))];
        const { data: cfgs } = await service
          .from('subject_configs')
          .select('id, qa_max')
          .in('id', configIds);
        const qaMaxById = new Map(
          ((cfgs ?? []) as Array<{ id: string; qa_max: number | null }>).map((c) => [
            c.id,
            c.qa_max ?? 30,
          ]),
        );

        // Default canonical slot totals: 2 WW × 10, 3 PT × 10. Registrar
        // can add/remove slots via the totals editor later.
        for (const sheet of needsUpdate) {
          const ww = (sheet.ww_totals ?? []).length > 0 ? sheet.ww_totals! : [10, 10];
          const pt = (sheet.pt_totals ?? []).length > 0 ? sheet.pt_totals! : [10, 10, 10];
          const qa = sheet.qa_total ?? qaMaxById.get(sheet.subject_config_id) ?? 30;
          const { error } = await service
            .from('grading_sheets')
            .update({ ww_totals: ww, pt_totals: pt, qa_total: qa })
            .eq('id', sheet.id);
          if (!error) result.grading_sheets_totals_set += 1;
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
