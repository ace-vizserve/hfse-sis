import { NextResponse } from 'next/server';

// Write-ups save from the browser through supabase-js since migration 150, and
// the `evaluation_writeups_audit` trigger writes the audit row. Nothing calls
// this route any more; left reachable it would log every save TWICE (once here,
// once from the trigger), so it answers 410 like its retired siblings.
export function PATCH() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
