-- 100_school_config_parent_read.sql
--
-- Let parents read the school letterhead.
--
-- Problem: the report card on the external parent portal rendered with an empty
-- letterhead — no school name, address, phone, website or registration number.
-- The portal reads `school_config` directly using the parent's own session, and
-- the only SELECT policy on that table is `school_config_role_read`
-- (022_school_config.sql), which requires `current_user_role() is not null`.
-- Parents are deliberately null-role users, so the query returned zero rows and
-- the header fell back to blank. The data was correct in the table the whole
-- time (verified on production).
--
-- Why widen the policy rather than have the portal read it from the report-card
-- payload (where `buildReportCard` already attaches it via the service client):
-- both work, and the payload route needs no migration — but this one fixes the
-- portal with no change to its code, and it matches how parents already read
-- `report_card_publications` (`rcp_parent_read`, 007_report_card_publications.sql,
-- same `current_user_role() is null` predicate). Keeping both routes open also
-- means a future portal screen that needs the letterhead outside a report card
-- (a fee letter, a certificate) doesn't need another migration.
--
-- Why this is safe to expose: every column on this row is either already
-- printed on the report card the parent is being shown, or is public record —
-- school name, address, phone, website, contact email, PEI registration number
-- and period (a regulatory disclosure), principal and CEO names (they sign the
-- card), logo url. The remaining columns are school policy that parents are
-- told anyway: the award thresholds appear in the report-card legend, and the
-- leave allowances are printed on the attendance sheets. There is no PII of any
-- other family here, and no credential.
--
-- SELECT only. The three write-denial policies from 022 are untouched, so this
-- stays read-only for every non-service caller.

alter table public.school_config enable row level security;

drop policy if exists school_config_parent_read on public.school_config;

-- Parents (null-role authenticated users) can read the single config row.
-- The table holds exactly one row (id = 1), so there is nothing to scope.
create policy school_config_parent_read
  on public.school_config for select
  to authenticated
  using (public.current_user_role() is null);

comment on policy school_config_parent_read on public.school_config is
  'Parents (null-role) read the letterhead + signatory names for the report card they are already authorised to view. SELECT only; mirrors rcp_parent_read on report_card_publications.';
