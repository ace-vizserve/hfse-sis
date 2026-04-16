-- 010_realtime_change_requests.sql
--
-- Enable Supabase Realtime for grade_change_requests so the sidebar
-- badge can update live via postgres_changes subscriptions.

alter publication supabase_realtime add table public.grade_change_requests;
