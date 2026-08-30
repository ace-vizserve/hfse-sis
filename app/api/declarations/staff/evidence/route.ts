import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { staffEvidencePrefix } from '@/lib/declarations/staff-filing';

// POST /api/declarations/staff/evidence
//
// Takes one file — a medical certificate handed in at the office — and returns
// the object path to send with the filing itself. Two steps rather than one
// multipart POST, for the same reasons the parent's upload is separate: the
// filing body wants validating as JSON, and a separate upload gives the dialog
// a real progress bar and a retry.
//
// ⚠ THE SAME BUCKET AS THE PARENT'S, A DIFFERENT FOLDER. Files land in the
// existing public `parent-portal` bucket — where P-Files has kept passports,
// birth certificates and medical reports since the beginning — under
// `declarations/staff/<staff user id>/`. The parent's own uploads sit under
// `declarations/<parent user id>/`, and the two prefixes are what let each
// route refuse a path that is not the caller's own. A shared folder would make
// that check impossible to write on either side.
//
// ⚠ NO PDF MERGE, matching the parent route. An MC is a document of record and
// merging destroys the original.

const BUCKET = 'parent-portal';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB, matching p-files and the parent upload

/**
 * Accepted types, keyed by the extension we will actually write.
 *
 * ⚠ The extension comes from the VERIFIED MIME type, never from `file.name`. A
 * filename is caller-controlled and is the obvious way to smuggle a `.html`
 * into a bucket that serves its contents publicly.
 */
const ACCEPTED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(request: Request) {
  // The same four roles the daily attendance write accepts. The SECTION check
  // cannot happen here — an upload does not yet know which child it belongs
  // to, exactly as on the parent side — so it happens on the filing route,
  // which does. What this earns is only the right to put a file in the folder
  // named after you, and the filing route refuses any other folder.
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Choose a file to attach.' },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: 'Choose a file to attach.' },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'That file is larger than 10 MB. Please attach a smaller one.' },
      { status: 400 }
    );
  }

  const ext = ACCEPTED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Attach a PDF or a photo (JPG, PNG or WEBP).' },
      { status: 400 }
    );
  }

  // The uploader's own id in the path, not the student's: at upload time the
  // child is not known yet — the filing says that, and it is sent second. A
  // random name keeps two uploads a second apart from colliding.
  const path = `${staffEvidencePrefix(auth.user.id)}${randomUUID()}.${ext}`;

  const service = createServiceClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: false, contentType: file.type });

  if (uploadError) {
    console.error(
      '[declarations] staff evidence upload failed:',
      uploadError.message
    );
    return NextResponse.json(
      { error: 'Could not upload that file. Please try again.' },
      { status: 500 }
    );
  }

  // The PATH, not a URL. The public URL is derivable from it, and storing both
  // on the filing would invite them to disagree (migration 125).
  return NextResponse.json({ path }, { status: 201 });
}
