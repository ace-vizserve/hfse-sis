import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

// Supabase OAuth / magic-link / email-confirm callback.
// Email+password login doesn't use this, but keep it wired up for later.
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit({
    ip,
    scope: 'auth-callback',
    ipMax: 10,
    windowSecs: 60,
  });
  if (rl.limited) return tooManyRequests(rl.retryAfter);

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Only honour a same-origin relative path — `${origin}${next}` with an
  // attacker-supplied `next` like `@evil.com` (→ https://host@evil.com) or
  // `//evil.com` is an open redirect. `/\` is also rejected (browsers treat
  // a backslash like a forward slash when parsing URLs).
  const rawNext = searchParams.get('next') ?? '/';
  const next =
    rawNext.startsWith('/') &&
    !rawNext.startsWith('//') &&
    !rawNext.startsWith('/\\')
      ? rawNext
      : '/';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const service = createServiceClient();
      await logAction({
        service,
        actor: { id: data.user.id, email: data.user.email ?? null },
        action: 'user.login',
        entityType: 'user_account',
        entityId: data.user.id,
        context: {
          provider: data.session?.user.app_metadata?.provider ?? 'magic_link',
          redirect_to: next,
        },
      });
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
