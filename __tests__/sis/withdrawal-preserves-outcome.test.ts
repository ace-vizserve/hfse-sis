import { describe, it, expect } from 'vitest';
import { buildWithdrawalAdmissionsPatch } from '@/app/api/sections/[id]/students/[enrolmentId]/route';

describe('post-enrolment withdrawal preserves the application outcome', () => {
  const BASE = {
    actorEmail: 'registrar@hfse.test',
    todayIso: '2026-06-26T00:00:00.000Z',
    admissionsAlreadyTerminal: false,
    withdrawalReason: 'Transferred to another school',
    withdrawalNotes: null,
  };

  it('does NOT write applicationStatus (outcome is append-only)', () => {
    const patch = buildWithdrawalAdmissionsPatch(BASE);
    expect('applicationStatus' in patch).toBe(false);
  });

  it('still writes applicationUpdatedDate and applicationUpdatedBy', () => {
    const patch = buildWithdrawalAdmissionsPatch(BASE);
    expect(patch.applicationUpdatedDate).toBe(BASE.todayIso);
    expect(patch.applicationUpdatedBy).toBe(BASE.actorEmail);
  });

  it('writes applicationTerminalReason when admissions is not already terminal', () => {
    const patch = buildWithdrawalAdmissionsPatch(BASE);
    expect(patch.applicationTerminalReason).toBe(BASE.withdrawalReason);
    expect(patch.applicationTerminalNotes).toBeNull();
  });

  it('skips applicationTerminalReason when admissions is already terminal', () => {
    const patch = buildWithdrawalAdmissionsPatch({
      ...BASE,
      admissionsAlreadyTerminal: true,
    });
    expect('applicationTerminalReason' in patch).toBe(false);
    expect('applicationTerminalNotes' in patch).toBe(false);
  });

  it('omits applicationTerminalReason when no withdrawal reason is provided', () => {
    const patch = buildWithdrawalAdmissionsPatch({
      ...BASE,
      withdrawalReason: undefined,
    });
    expect('applicationTerminalReason' in patch).toBe(false);
  });
});
