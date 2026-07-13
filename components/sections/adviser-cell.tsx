import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { StaffAvatar } from '@/components/sis/staff-visuals';
import { StatusBadge } from '@/components/ui/status-badge';

// Adviser cell for the SIS/Markbook/Attendance/Evaluation section-list
// tables. Rows only carry the adviser's display name (no email/id at this
// join), so the avatar's initials are derived from that name alone —
// StaffAvatar already handles that (staffInitials()). The avatar is opt-in
// (`showAvatar`, default off): only the SIS Admin sections list adopts the
// person-row anatomy (Task V4b-C); the other three modules' rows are dense
// 11–13px text and must render exactly as before.
//
// `flagMissing` (default off, layout redesign pass) swaps the plain-text
// "Unassigned" for a real StatusBadge warning pill — a missing adviser
// blocks FCA write-ups and report-card publishing (Zeigarnik Effect: this
// was already tracked on the Hub attention feed and the AY Setup checklist,
// invisible on the two screens — Sections list/detail — where it's actually
// fixed). Scoped to the SIS Admin sections table only; Markbook/Attendance/
// Evaluation's section lists keep the plain-text "Unassigned" they've
// always had — this isn't their fix to make.
export function AdviserCell({
  name,
  showAvatar = false,
  flagMissing = false,
}: {
  name: string | null;
  showAvatar?: boolean;
  flagMissing?: boolean;
}) {
  if (!name) {
    if (flagMissing) {
      return (
        <StatusBadge tone="warning" icon={AlertTriangle}>
          No adviser
        </StatusBadge>
      );
    }
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
