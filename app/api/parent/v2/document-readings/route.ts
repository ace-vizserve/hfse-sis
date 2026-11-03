import { NextResponse } from 'next/server';

import { corsHeaders } from '@/lib/cors';
import {
  getClientIp,
  rateLimit,
  tooManyRequests,
  userRateLimit,
} from '@/lib/rate-limit';
import { DocumentReadingSchema } from '@/lib/schemas/document-reading';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/parent/v2/document-readings
//
// After a parent uploads a document, the portal reports what it found, for the
// admin who reviews it: for a passport what its OCR read, and how good the scan is.
//
// ⚠ THE REPORT COMES FROM THE PARENT'S BROWSER, so it is evidence for the
// reviewer, never a decision. Nothing here approves a document, and the reviewer
// still has the file itself on screen.
//
// ⚠ NO LINKAGE CHECK, unlike the declarations routes. A wizard upload happens
// before the application exists, so a new applicant has no child to link to yet.
// What stops a parent writing over someone else's reading is that the first write
// for a URL wins and upload URLs are timestamped: by the time another account
// could learn a URL, the uploader's reading is already there.

const CORS_METHODS = 'POST, OPTIONS';
const BUCKET_PATH = '/storage/v1/object/public/parent-portal/';

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
    scope: 'parent-v2-document-readings',
    ipMax: 30,
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
  if (authError || !userData.user) {
    return NextResponse.json(
      { error: 'invalid or expired token' },
      { status: 401, headers: cors }
    );
  }

  const userRl = userRateLimit({
    userId: userData.user.id,
    scope: 'parent-v2-document-readings',
    userMax: 20,
    windowSecs: 60,
  });
  if (userRl.limited) return tooManyRequests(userRl.retryAfter, cors);

  const body = await request.json().catch(() => null);
  const parsed = DocumentReadingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad reading' },
      { status: 400, headers: cors }
    );
  }
  const reading = parsed.data;

  // Only a file in our own document bucket can have a reading.
  const ourBucket = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')}${BUCKET_PATH}`;
  if (!reading.fileUrl.startsWith(ourBucket)) {
    return NextResponse.json(
      { error: 'not a parent portal file' },
      { status: 400, headers: cors }
    );
  }

  const { error } = await service.from('document_readings').upsert(
    {
      file_url: reading.fileUrl,
      status: reading.status,
      passports: reading.passports,
      quality: reading.quality,
      entered_number: reading.enteredNumber,
      entered_expiry: reading.enteredExpiry,
      submitted_by: userData.user.id,
    },
    { onConflict: 'file_url', ignoreDuplicates: true }
  );
  if (error) {
    console.error('[document-readings] insert failed', error.message);
    return NextResponse.json(
      { error: 'could not save the reading' },
      { status: 500, headers: cors }
    );
  }

  return NextResponse.json({ ok: true }, { headers: cors });
}
