import { describe, expect, it } from 'vitest';

import {
  classifyUrgency,
  compareSlotsByUrgency,
  isActionable,
  urgencyDescriptor,
  type SlotUrgencyInput,
} from '@/lib/p-files/urgency';

describe('urgencyDescriptor — missing-slot honesty (hasFile)', () => {
  it("status='missing' with hasFile=true reads 'On file — awaiting status update' (a file exists, it just hasn't been triaged)", () => {
    const slot: SlotUrgencyInput = {
      key: 'idPicture',
      status: 'missing',
      expiryDate: null,
      hasFile: true,
    };
    expect(urgencyDescriptor(slot)).toBe('On file — awaiting status update');
  });

  it("status='missing' with hasFile=false (explicit) keeps 'Missing — never uploaded'", () => {
    const slot: SlotUrgencyInput = {
      key: 'idPicture',
      status: 'missing',
      expiryDate: null,
      hasFile: false,
    };
    expect(urgencyDescriptor(slot)).toBe('Missing — never uploaded');
  });

  it("status='missing' with hasFile omitted defaults to 'Missing — never uploaded' (back-compat for existing callers)", () => {
    const slot: SlotUrgencyInput = {
      key: 'idPicture',
      status: 'missing',
      expiryDate: null,
    };
    expect(urgencyDescriptor(slot)).toBe('Missing — never uploaded');
  });

  it('hasFile is ignored for every other urgency kind — copy is unchanged', () => {
    expect(
      urgencyDescriptor({
        key: 'passport',
        status: 'expired',
        expiryDate: null,
        hasFile: true,
      })
    ).toBe('Expired');
    expect(
      urgencyDescriptor({
        key: 'passport',
        status: 'rejected',
        expiryDate: null,
        hasFile: true,
      })
    ).toBe('Rejected — needs replacement');
    expect(
      urgencyDescriptor({
        key: 'passport',
        status: 'uploaded',
        expiryDate: null,
        hasFile: true,
      })
    ).toBe('Awaiting registrar review');
    expect(
      urgencyDescriptor({
        key: 'passport',
        status: 'to-follow',
        expiryDate: null,
        hasFile: true,
      })
    ).toBe('Parent promised — pending re-upload');
    expect(
      urgencyDescriptor({
        key: 'passport',
        status: 'valid',
        expiryDate: null,
        hasFile: false,
      })
    ).toBe('On file');
    expect(
      urgencyDescriptor({
        key: 'passport',
        status: 'na',
        expiryDate: null,
        hasFile: true,
      })
    ).toBe('Not applicable');
  });
});

describe('classifyUrgency / compareSlotsByUrgency / isActionable — hasFile does not affect ranking', () => {
  it('classifyUrgency returns the same kind regardless of hasFile', () => {
    const withFile: SlotUrgencyInput = {
      key: 'idPicture',
      status: 'missing',
      expiryDate: null,
      hasFile: true,
    };
    const withoutFile: SlotUrgencyInput = {
      key: 'idPicture',
      status: 'missing',
      expiryDate: null,
      hasFile: false,
    };
    expect(classifyUrgency(withFile)).toBe('missing');
    expect(classifyUrgency(withoutFile)).toBe('missing');
    expect(isActionable(classifyUrgency(withFile))).toBe(true);
  });

  it('compareSlotsByUrgency ordering is unaffected by hasFile', () => {
    const expired: SlotUrgencyInput = {
      key: 'a-passport',
      status: 'expired',
      expiryDate: null,
      hasFile: true,
    };
    const missing: SlotUrgencyInput = {
      key: 'b-medical',
      status: 'missing',
      expiryDate: null,
      hasFile: true,
    };
    // Same relative order as when hasFile is absent — expired still ranks
    // ahead of missing.
    expect(compareSlotsByUrgency(expired, missing)).toBeLessThan(0);
  });
});
