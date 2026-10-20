// Where an audit row's "Open" link goes — ONE resolver for every audit log.
//
// Each audit page used to decide this for itself (Markbook linked a sheet,
// Attendance a register, the other seven nothing), so the column drifted page
// by page. Every audit page now maps its rows through `auditRowLink`, and the
// mapping lives here, once.
//
// ⚠ NO LINK IS BETTER THAN A BROKEN ONE. A target is built only from what the
// row itself stores — `entity_type`, `entity_id` and `context` — and never from
// a per-row lookup. Where the id a page needs is not in the row (older rows
// written before a context key existed, bulk jobs with no single record), the
// answer is `null` and the row shows no link, rather than a link that 404s.
//
// ⚠ AND NONE THE VIEWER WOULD BE BOUNCED FROM. A target is offered only when
// `isRouteAllowed(path, role)` lets the viewer in, and — where the page itself
// is narrower than its route rule (a teacher may open /markbook, but only the
// sheets she teaches) — only to the roles the page admits on its own.
//
// Billing's QuickBooks rows (`qbo_*`) are not mapped here: Billing is a module
// production does not have yet, and its links live in `lib/billing/audit-links.ts`.

import { hrefPathname, isRouteAllowed, type Role } from '@/lib/auth/roles';
import { attendanceAuditLink } from '@/lib/audit/attendance-links';

export type AuditLinkRow = {
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  context: Record<string, unknown> | null;
};

export type AuditRowLink = { href: string; label: string };

/** A link plus the roles its page admits, when narrower than the route rule. */
export type AuditLinkTarget = AuditRowLink & { roles?: readonly Role[] };

/**
 * The office roles. Pages that open a CLASS (a grading sheet, a register, a
 * class's write-ups) admit a teacher only for the classes she teaches, which a
 * row cannot tell us — so those targets are offered to the office roles only.
 * No audit log admits a teacher today; this keeps it true if one ever does.
 */
const OFFICE: readonly Role[] = [
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Student numbers (H250340) and enrolee numbers (E260087): letters + digits. */
const STUDENT_KEY = /^[A-Za-z]{1,3}\d{3,}$/;
const AY_CODE = /^AY\d{4}$/;

function str(ctx: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = ctx[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function uuidOf(value: string | null): string | null {
  return value && UUID.test(value) ? value : null;
}

function studentKeyOf(value: string | null): string | null {
  return value && STUDENT_KEY.test(value) ? value : null;
}

/** The AY a row names — `ay_code`, or the "AY2026" inside a term label. */
function ayOf(ctx: Record<string, unknown>): string | null {
  const code = str(ctx, 'ay_code');
  if (code && AY_CODE.test(code)) return code;
  const label = str(ctx, 'term_label', 'label');
  const match = label?.match(/\bAY\d{4}\b/);
  return match ? match[0] : null;
}

function studentNumberOf(ctx: Record<string, unknown>): string | null {
  return studentKeyOf(str(ctx, 'studentNumber', 'student_number'));
}

/** The student's record — cross-year, so keyed on studentNumber (Hard Rule #4). */
function studentRecord(
  ctx: Record<string, unknown>,
  tab?: string
): AuditLinkTarget | null {
  const sn = studentNumberOf(ctx);
  if (!sn) return null;
  return {
    href: `/records/students/${encodeURIComponent(sn)}${tab ? `?tab=${tab}` : ''}`,
    label: 'Open student',
  };
}

/**
 * An application. The enrolee number restarts every year, so it is only a
 * record together with its AY — no AY, no link.
 */
function application(
  enroleeNumber: string | null,
  ctx: Record<string, unknown>,
  tab?: string
): AuditLinkTarget | null {
  const en = studentKeyOf(enroleeNumber);
  const ay = ayOf(ctx);
  if (!en || !ay) return null;
  const q = new URLSearchParams({ ay });
  if (tab) q.set('tab', tab);
  return {
    href: `/admissions/applications/${encodeURIComponent(en)}?${q.toString()}`,
    label: 'Open application',
  };
}

function sheet(id: string | null): AuditLinkTarget | null {
  const sheetId = uuidOf(id);
  return sheetId
    ? {
        href: `/markbook/grading/${sheetId}`,
        label: 'Open sheet',
        roles: OFFICE,
      }
    : null;
}

function staffMember(id: string | null): AuditLinkTarget | null {
  const userId = uuidOf(id);
  return userId
    ? { href: `/sis/admin/staff/${userId}`, label: 'Open staff member' }
    : null;
}

/**
 * The page for the record this row touched, before any role check. Exported
 * for the test and for Billing's resolver; pages call `auditRowLink`.
 */
export function auditRowTarget(row: AuditLinkRow): AuditLinkTarget | null {
  const ctx = row.context ?? {};
  const id = row.entity_id;

  switch (row.entity_type) {
    case 'grading_sheet':
      return sheet(id);

    case 'grade_entry':
      return sheet(str(ctx, 'grading_sheet_id'));

    case 'grade_change_request': {
      const reqId = uuidOf(id);
      if (!reqId) return null;
      // The queue lists one year at a time, so the request's own year goes
      // along — opened in another year, `?req=` matches nothing.
      const ay = ayOf(ctx);
      const q = new URLSearchParams({ req: reqId });
      if (ay) q.set('ay', ay);
      return {
        href: `/markbook/change-requests?${q.toString()}`,
        label: 'Open request',
        roles: OFFICE,
      };
    }

    case 'report_card_publication': {
      const sectionId = uuidOf(str(ctx, 'section_id'));
      const ay = ayOf(ctx);
      const term = ctx['term_number'];
      if (!sectionId || !ay || typeof term !== 'number') return null;
      const q = new URLSearchParams({
        ay,
        section_id: sectionId,
        term: String(term),
      });
      return {
        href: `/markbook/report-cards?${q.toString()}`,
        label: 'Open report cards',
        roles: OFFICE,
      };
    }

    case 'attendance_daily': {
      const link = attendanceAuditLink({
        action: row.action,
        entity_type: row.entity_type,
        entity_id: id,
        context: ctx,
      });
      return link ? { ...link, label: 'Open register', roles: OFFICE } : null;
    }

    case 'student_declaration': {
      // `?req=` takes the APPROVAL REQUEST, not the declaration — see
      // lib/declarations/cell-filings.ts. Only decision rows carry it.
      const reqId = uuidOf(str(ctx, 'request_id'));
      return reqId
        ? {
            href: `/attendance/declarations?req=${reqId}`,
            label: 'Open declaration',
            roles: OFFICE,
          }
        : null;
    }

    case 'enrolment_application':
      // House changes record no AY, so the cross-year student record it is.
      return (
        application(id ?? str(ctx, 'enroleeNumber'), ctx) ?? studentRecord(ctx)
      );

    case 'enrolment_status':
      return application(id ?? str(ctx, 'enroleeNumber'), ctx);

    case 'enrolment_document': {
      // entity_id is `E260194:fatherPassport` or a bare `E260282`.
      const en = str(ctx, 'enroleeNumber') ?? id?.split(':')[0] ?? null;
      return application(en, ctx, 'documents');
    }

    case 'section_student':
      return studentRecord(ctx);

    case 'student_discipline_record':
      return studentRecord(ctx, 'discipline');

    case 'section': {
      const sectionId = uuidOf(id);
      return sectionId
        ? { href: `/sis/sections/${sectionId}`, label: 'Open section' }
        : null;
    }

    case 'evaluation_writeup': {
      const sectionId = uuidOf(str(ctx, 'section_id'));
      if (!sectionId) return null;
      const termId = uuidOf(str(ctx, 'term_id'));
      return {
        href: `/evaluation/sections/${sectionId}${termId ? `?term_id=${termId}` : ''}`,
        label: 'Open write-ups',
        roles: OFFICE,
      };
    }

    case 'classroom_note': {
      const sectionId = uuidOf(str(ctx, 'section_id') ?? id);
      return sectionId
        ? {
            href: `/classroom/${sectionId}`,
            label: 'Open class',
            roles: OFFICE,
          }
        : null;
    }

    case 'house_point_event':
    case 'house_point_entry':
    case 'house_point_team': {
      const eventId = uuidOf(
        str(ctx, 'event_id') ??
          (row.entity_type === 'house_point_event' ? id : null)
      );
      return eventId
        ? { href: `/records/house-points/${eventId}`, label: 'Open event' }
        : null;
    }

    case 'teacher_assignment':
      if (row.action.startsWith('assignment.relief.')) {
        return { href: '/sis/admin/cover', label: 'Open cover' };
      }
      return staffMember(str(ctx, 'teacher_user_id'));

    case 'user_account':
      return staffMember(id);

    case 'academic_year': {
      const ay = ayOf(ctx) ?? str(ctx, 'to_ay');
      return {
        href:
          ay && AY_CODE.test(ay) ? `/sis/ay-setup?ay=${ay}` : '/sis/ay-setup',
        label: 'Open year setup',
      };
    }

    case 'term': {
      const ay = ayOf(ctx);
      return {
        href: ay ? `/sis/ay-setup?ay=${ay}` : '/sis/ay-setup',
        label: 'Open year setup',
      };
    }

    case 'subject_config': {
      const ay = ayOf(ctx);
      return {
        href: ay ? `/sis/admin/subjects?ay=${ay}` : '/sis/admin/subjects',
        label: 'Open subject setup',
      };
    }

    case 'approver_assignment':
    case 'approval_stage_approver':
      return { href: '/sis/admin/approvers', label: 'Open approvers' };

    default:
      return null;
  }
}

/** A target, if `role` may open it — the gate every resolver goes through. */
export function gateAuditLink(
  target: AuditLinkTarget | null,
  role: Role | null
): AuditRowLink | null {
  if (!target) return null;
  if (!isRouteAllowed(hrefPathname(target.href), role)) return null;
  if (target.roles && (role == null || !target.roles.includes(role))) {
    return null;
  }
  return { href: target.href, label: target.label };
}

/** The "Open" link for one audit row, as `role` would be allowed to follow it. */
export function auditRowLink(
  row: AuditLinkRow,
  role: Role | null
): AuditRowLink | null {
  return gateAuditLink(auditRowTarget(row), role);
}
