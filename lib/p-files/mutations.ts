import type { SupabaseClient } from '@supabase/supabase-js';

export type RevisionSnapshot = {
  ayCode: string;
  enroleeNumber: string;
  slotKey: string;
  archivedUrl: string;
  archivedPath: string;
  /**
   * The OLD url at the time of replacement. Migration 033 also captures
   * this column so the parent-portal direct-write trigger can dedupe
   * against this row via the partial unique index on
   * `(ay_code, enrolee_number, slot_key, previous_url)`. The route should
   * pass `currentUrl` (whatever the docs row held before the move).
   */
  previousUrl: string;
  statusSnapshot: string | null;
  expirySnapshot: string | null;
  passportNumberSnapshot: string | null;
  passTypeSnapshot: string | null;
  note: string | null;
  replacedByUserId: string;
  replacedByEmail: string | null;
};

// Inserts one row into `p_file_revisions` capturing the pre-replacement
// snapshot when a P-Files officer replaces a document. Service-role
// client only. The DB trigger (migration 033) catches parent-portal
// direct re-uploads via a separate path; this function only handles the
// SIS officer flow and tags the row as `source = 'pfile-upload'`.
export async function createRevision(
  service: SupabaseClient,
  snap: RevisionSnapshot,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await service
    .from('p_file_revisions')
    .insert({
      ay_code: snap.ayCode,
      enrolee_number: snap.enroleeNumber,
      slot_key: snap.slotKey,
      archived_url: snap.archivedUrl,
      archived_path: snap.archivedPath,
      previous_url: snap.previousUrl,
      status_snapshot: snap.statusSnapshot,
      expiry_snapshot: snap.expirySnapshot,
      passport_number_snapshot: snap.passportNumberSnapshot,
      pass_type_snapshot: snap.passTypeSnapshot,
      note: snap.note,
      replaced_by_user_id: snap.replacedByUserId,
      replaced_by_email: snap.replacedByEmail,
      source: 'pfile-upload',
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}
