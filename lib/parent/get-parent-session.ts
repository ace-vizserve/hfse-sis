import { cookies } from 'next/headers';

import { PARENT_SESSION_COOKIE, verifyParentSession } from './cookie';

export type ParentSession = { email: string };

export async function getParentSession(): Promise<ParentSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(PARENT_SESSION_COOKIE)?.value;
  const payload = verifyParentSession(value);
  if (!payload) return null;
  return { email: payload.email };
}
