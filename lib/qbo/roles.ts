import type { Role } from '@/lib/auth/roles';

/**
 * Who may create or link a QuickBooks invoice on a stage (decided 2026-10-14).
 * Narrower than STUDENT_RECORD_WRITERS: academic_coordinator keeps Edit stage
 * but does not invoice.
 */
export const QBO_INVOICE_ROLES = [
  'admissions',
  'school_admin',
  'superadmin',
] as const satisfies readonly Role[];

/** Connecting / disconnecting the school's QuickBooks company. */
export const QBO_ADMIN_ROLES = [
  'superadmin',
] as const satisfies readonly Role[];

export function canInvoiceInQbo(role: string | null | undefined): boolean {
  return !!role && (QBO_INVOICE_ROLES as readonly string[]).includes(role);
}
