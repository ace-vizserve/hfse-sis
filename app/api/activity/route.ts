import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import {
  loadActivityPage,
  type ActivityCursor,
  type ActivityTab,
} from '@/lib/activity/feed';

// GET /api/activity
//
// Backs the header Activity panel. Everything the browser knows about the feed
// comes through here.
//
// ⚠ SERVED, NOT READ DIRECT. `grade_change_requests` admits any account with a
// role, so the scoping in `loadActivityPage` is the only thing that keeps one
// teacher out of another's mark changes. See lib/activity/feed.ts.
//
// ⚠ THE BADGE DOES NOT COME THROUGH HERE. `useChangeRequestCount` and
// `useDeclarationCount` stay on their live RLS-scoped browser queries so the
// number cannot drift from the queue it points at (KD #196).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const TABS: ReadonlySet<string> = new Set([
  'general',
  'grade_change',
  'student_declaration',
]);

export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;

  const rawTab = params.get('tab') ?? 'general';
  const tab: ActivityTab = TABS.has(rawTab)
    ? (rawTab as ActivityTab)
    : 'general';

  const rawLimit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.trunc(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // The cursor round-trips as "<iso>|<id>" — two fields, one param, no JSON to
  // parse from a query string.
  let cursor: ActivityCursor = null;
  const rawCursor = params.get('cursor');
  if (rawCursor) {
    const [at, ...rest] = rawCursor.split('|');
    const id = rest.join('|');
    if (at && id) cursor = { at, id };
  }

  try {
    const page = await loadActivityPage(createServiceClient(), {
      userId: auth.user.id,
      role: auth.role,
      tab,
      cursor,
      limit,
    });
    return NextResponse.json(page);
  } catch (e) {
    console.error(
      '[activity] feed failed:',
      e instanceof Error ? e.message : String(e)
    );
    // ⚠ 200 with an explicit failure flag, not a 500. This panel opens over
    // whatever the person was doing; a thrown error there costs them the page.
    return NextResponse.json({
      events: [],
      nextCursor: null,
      waiting: [],
      partial: true,
      truncated: false,
    });
  }
}
