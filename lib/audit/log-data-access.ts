import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';

// Who took or opened personal data. Reads change nothing, so no other record of
// them exists. Logged when the file is about to go out, naming what it held and
// never the data itself. Like every audit write, a failure here never stops the
// person's download.
export async function logDataAccess(
  guard: {
    user: { id: string; email?: string | null };
    role: string | null;
  },
  action: 'data.export' | 'data.view',
  what: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  try {
    await logAction({
      service: createServiceClient(),
      actor: {
        id: guard.user.id,
        email: guard.user.email ?? null,
        role: guard.role,
      },
      action,
      entityType: 'data_access',
      entityId: null,
      context: { what, ...context },
    });
  } catch (e) {
    // logAction never throws, but building the client can.
    console.error('[audit] data access not logged', { action, what, error: e });
  }
}
