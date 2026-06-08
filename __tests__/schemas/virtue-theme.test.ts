import { describe, expect, it } from 'vitest';
import { VirtueThemeSchema } from '@/lib/schemas/virtue-theme';

// Zod v4 enforces strict RFC 4122 UUID format (version nibble [1-8], variant
// nibble [89abAB]). Use a valid v4 UUID for test fixtures.
const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('VirtueThemeSchema', () => {
  it('accepts a uuid termId + string theme', () => {
    const r = VirtueThemeSchema.safeParse({
      termId: VALID_UUID,
      virtueTheme: 'Diligence',
    });
    expect(r.success).toBe(true);
  });
  it('accepts null/empty theme (clears)', () => {
    expect(
      VirtueThemeSchema.safeParse({ termId: VALID_UUID, virtueTheme: null })
        .success
    ).toBe(true);
    expect(
      VirtueThemeSchema.safeParse({ termId: VALID_UUID, virtueTheme: '' })
        .success
    ).toBe(true);
  });
  it('rejects a non-uuid termId', () => {
    expect(
      VirtueThemeSchema.safeParse({ termId: 'nope', virtueTheme: 'x' }).success
    ).toBe(false);
  });
});
