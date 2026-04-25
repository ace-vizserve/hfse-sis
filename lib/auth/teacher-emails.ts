import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Returns a cached `userId -> email` map for all auth users.
 *
 * Replaces ad-hoc `service.auth.admin.listUsers({ perPage: 1000 })` calls
 * that previously sat inside drill loaders, blocking the loader on every
 * cache miss. With this single shared 5-min cache, all dashboards + drill
 * loaders share one Auth Admin call per 5 minutes.
 *
 * Returns Array<[userId, email]> rather than Map directly because Next 16's
 * unstable_cache JSON-serializes the return value; Map round-trips as `{}`.
 * Callers reconstruct the Map via `new Map(await getTeacherEmailMap())`.
 *
 * 5-min TTL is fine — teachers rarely change emails, and the email is only
 * used as a display field on drill rows. Stale email is harmless.
 */
export function getTeacherEmailMap(): Promise<Array<[string, string]>> {
  return unstable_cache(
    async () => {
      try {
        const service = createServiceClient();
        const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
        const out: Array<[string, string]> = [];
        for (const u of data?.users ?? []) {
          if (u.email) out.push([u.id, u.email]);
        }
        return out;
      } catch {
        return [];
      }
    },
    ['teacher-emails-map'],
    { revalidate: 300, tags: ['teacher-emails'] },
  )();
}
