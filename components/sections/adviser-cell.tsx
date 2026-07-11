import * as React from 'react';

import { StaffAvatar } from '@/components/sis/staff-visuals';

// Adviser cell for the SIS/Markbook/Attendance/Evaluation section-list
// tables. Rows only carry the adviser's display name (no email/id at this
// join), so the avatar's initials are derived from that name alone —
// StaffAvatar already handles that (staffInitials()). The avatar is opt-in
// (`showAvatar`, default off): only the SIS Admin sections list adopts the
// person-row anatomy (Task V4b-C); the other three modules' rows are dense
// 11–13px text and must render exactly as before. Unassigned stays
// text-only either way: there's no name to draw initials from, so a
// placeholder avatar tile would just add visual noise without carrying
// information.
export function AdviserCell({
  name,
  showAvatar = false,
}: {
  name: string | null;
  showAvatar?: boolean;
}) {
  if (!name) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
  }
  if (!showAvatar) {
    return <span className="text-sm text-foreground">{name}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <StaffAvatar name={name} size={8} />
      <span className="text-sm text-foreground">{name}</span>
    </span>
  );
}
