import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { createServiceClient } from '@/lib/supabase/service';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';
import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';

// POST /api/parent/v2/declarations/evidence
//
// Takes one file — a medical certificate — and returns the object path to hand
// back in the declaration itself. Two steps rather than one multipart POST for
// the whole form, because the declaration body carries a list of children, a
// date range and a note that all want validating as JSON, and because a
// separate upload gives the portal a real progress bar and a retry.
//
// ⚠ WHERE THE FILE GOES, and why there is no new bucket. It lands in the
// EXISTING public `parent-portal` bucket, in the `declarations/` folder Mr Ace
// created (2026-08-27). An earlier design made private storage its own phase,
// citing migration 121's refusal to store warning letters because it would be
// "the app's FIRST private file". That does not survive checking: P-Files has
// kept passports, birth certificates and medical reports in this same
// public-by-URL bucket since the beginning (`DOCUMENT_SLOTS`). A medical
// certificate is the same category of document. The broader point — that the
// whole document store is public-by-URL — is true, predates this feature, and
// is one project across every document type rather than a special case here.
//
// ⚠ NO PDF MERGE. `app/api/p-files/[enroleeNumber]/upload/route.ts` merges
// multiple PDFs into one with `pdf-merger-js`; this route deliberately does
// not. An MC is a document of record and merging destroys the original.

const BUCKET = 'parent-portal';
const FOLDER = 'declarations';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB, matching the p-files limit
const CORS_METHODS = 'POST, OPTIONS';

/**
 * Accepted types, keyed by the extension we will actually write.
 *
 * ⚠ The extension comes from the VERIFIED MIME type, never from `file.name`.
 * A filename is attacker-controlled and is the obvious way to smuggle a
 * `.html` into a bucket that serves its contents publicly.
 */
const ACCEPTED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), CORS_METHODS),
  });
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);

  const ip = getClientIp(request);
  const ipRl = rateLimit({
    ip,
    scope: 'parent-v2-evidence',
    ipMax: 10,
    windowSecs: 60,
  });
  if (ipRl.limited) return tooManyRequests(ipRl.retryAfter, cors);

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) {
    return NextResponse.json(
      { error: 'missing Bearer token' },
      { status: 401, headers: cors }
    );
  }

  const service = createServiceClient();
  const { data: userData, error: authError } =
    await service.auth.getUser(token);
  if (authError || !userData.user?.email) {
    return NextResponse.json(
      { error: 'invalid or expired token' },
      { status: 401, headers: cors }
    );
  }
  const email = userData.user.email.trim().toLowerCase();

  const userRl = rateLimit({
    ip,
    userId: userData.user.id,
    scope: 'parent-v2-evidence',
    ipMax: 10,
    userMax: 5,
    windowSecs: 60,
  });
  if (userRl.limited) return tooManyRequests(userRl.retryAfter, cors);

  // ⚠ A verified token is not enough to earn an upload. Anyone with a Supabase
  // account in this project — including a staff member, or a stale applicant —
  // holds a valid token. Only somebody with a child on the roll has any reason
  // to put a file in this bucket, so the linkage check gates the upload as well
  // as the filing.
  const linked = await getAllStudentsByParentEmail(email);
  if (linked.length === 0) {
    return NextResponse.json(
      { error: 'No children are linked to this account.' },
      { status: 403, headers: cors }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'expected a file upload' },
      { status: 400, headers: cors }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: 'Choose a file to attach.' },
      { status: 400, headers: cors }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'That file is larger than 10 MB. Please attach a smaller one.' },
      { status: 400, headers: cors }
    );
  }

  const ext = ACCEPTED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Attach a PDF or a photo (JPG, PNG or WEBP).' },
      { status: 400, headers: cors }
    );
  }

  // The parent's own id in the path, not a student number: at upload time we do
  // not yet know which child the file belongs to — the declaration says that,
  // and it is filed second. A random name keeps two uploads a second apart from
  // colliding.
  const path = `${FOLDER}/${userData.user.id}/${randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: false, contentType: file.type });

  if (uploadError) {
    console.error(
      '[declarations] evidence upload failed:',
      uploadError.message
    );
    return NextResponse.json(
      { error: 'Could not upload that file. Please try again.' },
      { status: 500, headers: cors }
    );
  }

  // The PATH, not a URL. The public URL is derivable from it, and storing both
  // on the declaration would invite them to disagree.
  return NextResponse.json({ path }, { status: 201, headers: cors });
}
