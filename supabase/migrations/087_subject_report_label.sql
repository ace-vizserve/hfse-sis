-- 087_subject_report_label.sql
--
-- Adds a report-card display label to `subjects`, independent of the
-- catalog `name`. Nullable, no default — absence means "fall back to
-- `name`" everywhere the report card resolves a subject's label
-- (lib/report-card/build-report-card.ts). No backfill: every existing
-- subject keeps showing its current `name` on the report card unchanged
-- until an admin explicitly sets a report_label via Subject Setup.

alter table public.subjects add column if not exists report_label text;
