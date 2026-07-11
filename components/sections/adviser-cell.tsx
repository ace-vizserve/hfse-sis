import * as React from 'react';

import { StaffAvatar } from '@/components/sis/staff-visuals';

// Adviser cell for the SIS/Markbook/Attendance section-list tables. Rows only
// carry the adviser's display name (no email/id at this join), so the
// avatar's initials are derived from that name alone — StaffAvatar already
// handles that (staffInitials()). Unassigned stays text-only: there's no
// name to draw initials from, so a placeholder avatar tile would just add
// visual noise without carrying information.
export function AdviserCell({ name }: { name: string | null }) {
  if (!name) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <StaffAvatar name={name} size={8} />
      <span className="text-sm text-foreground">{name}</span>
    </span>
  );
}
