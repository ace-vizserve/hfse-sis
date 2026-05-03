import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';

export type StaffMember = {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
};

type Options = {
  /**
   * When `true` (default), users with `app_metadata.disabled === true` are
   * dropped from the result. Set to `false` for admin surfaces that need to
   * see and re-enable the disabled accounts.
   */
  excludeDisabled?: boolean;
};

/**
 * Returns auth users with `app_metadata.role === 'teacher'`. Sorted by
 * display name. 5-min cache shared with the `teacher-emails` tag so any
 * user-list invalidation hits both layers.
 *
 * Returns Array (not Map) because Next 16's unstable_cache JSON-serializes
 * Maps as `{}`. Callers iterate or build their own Map.
 *
 * Used by surfaces that need a "pick a teacher" combobox — e.g. the
 * teacher_name dropdown on /markbook/grading/new.
 */
export function getTeacherList(options: Options = {}): Promise<StaffMember[]> {
  const excludeDisabled = options.excludeDisabled ?? true;
  return unstable_cache(
    async () => {
      try {
        const service = createServiceClient();
        const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
        const out: StaffMember[] = [];
        for (const u of data?.users ?? []) {
          if (!u.email) continue;
          const meta = (u.app_metadata ?? {}) as { role?: string; disabled?: boolean };
          const role =
            meta.role ?? ((u.user_metadata as { role?: string } | null)?.role ?? null);
          if (role !== 'teacher') continue;
          const disabled = meta.disabled === true;
          if (excludeDisabled && disabled) continue;
          const userMeta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
          const name = (userMeta.full_name ?? userMeta.name ?? u.email).trim();
          out.push({ id: u.id, email: u.email, name, disabled });
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return out;
      } catch {
        return [];
      }
    },
    ['teacher-list', excludeDisabled ? 'active' : 'all'],
    { revalidate: 300, tags: ['teacher-emails'] },
  )();
}
