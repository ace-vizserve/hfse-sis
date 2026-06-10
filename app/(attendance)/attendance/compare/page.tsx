import { redirect } from 'next/navigation';

// Attendance "Compare" was replaced by the Attendance Health Insights surface —
// spec docs/superpowers/specs/2026-06-10-module-insights-design.md.
// Old links/bookmarks land on Insights.
export default function AttendanceCompareRedirect() {
  redirect('/attendance/insights');
}
