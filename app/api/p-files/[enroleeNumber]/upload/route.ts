import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import PDFMerger from 'pdf-merger-js';
import { requireAnyCapability } from '@/lib/auth/require-capability';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { createRevision } from '@/lib/p-files/mutations';
import { isStudentEnrolled } from '@/lib/p-files/queries';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 30 MB total
const BUCKET = 'parent-portal';

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    (file.name ?? '').toLowerCase().endsWith('.pdf')
  );
}

function isImage(file: File): boolean {
  const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (imageMimeTypes.includes(file.type)) return true;
  const ext = (file.name ?? '').toLowerCase().split('.').pop() ?? '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

// Strip everything up to and including `/<bucket>/` from a Supabase Storage
// public URL, returning the object path within the bucket. Returns null if
// the URL does not contain the expected prefix.
function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const tail = url.slice(idx + marker.length);
  // Trim any query string or fragment, then decode percent-encoding so that
  // storage.move() receives the raw path (e.g. "Elijah ID.jpg" not "Elijah%20ID.jpg").
  const encoded = tail.split('?')[0].split('#')[0];
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function extFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : 'pdf';
}

// POST /api/p-files/[enroleeNumber]/upload
// Multipart form: file(s) + slotKey + optional metadata fields + optional note.
// Single file: upload as-is. Multiple files: merge PDFs server-side.
//
// When a file already exists for the slot, the current object is MOVED to
// `<prefix>/<enroleeNumber>/<slotKey>/revisions/<iso>.<ext>` and one row is
// inserted into `p_file_revisions` capturing the snapshot. The canonical
// path is then overwritten with the new upload. P-Files no longer validates
// documents — it is a repository, and `{slotKey}Status` is always written
// as 'Valid' for staff uploads.
//
// SERVES APPLICANTS AS WELL AS ENROLLED STUDENTS since 2026-09-01 (KD #204).
// Enrolment state no longer decides WHETHER an upload is allowed, only which
// capability it requires — see the block below the size and file-type checks.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Gate on holding EITHER side's upload capability; which one is actually
  // required is decided below, once we know whether this student has enrolled.
  // The document PATCH does exactly this with the two `validate`s — same
  // shape, deliberately, so there is one rule to learn rather than two.
  //
  // BEFORE 2026-09-01 this asked for `documents_post_enrolment.upload` alone
  // and there was no pre-enrolment counterpart to ask for. See the enrolment
  // block further down for why that stopped being tenable.
  const auth = await requireAnyCapability([
    'documents_pre_enrolment.upload',
    'documents_post_enrolment.upload',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'invalid form data' }, { status: 400 });
  }

  const files = formData
    .getAll('file')
    .filter((f): f is File => f instanceof File);
  const slotKey = formData.get('slotKey') as string | null;
  const expiryDate = formData.get('expiryDate') as string | null;
  const passportNumber = formData.get('passportNumber') as string | null;
  const passType = formData.get('passType') as string | null;
  const noteRaw = formData.get('note');
  const note =
    typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim() : null;

  if (files.length === 0 || !slotKey) {
    return NextResponse.json(
      { error: 'file and slotKey are required' },
      { status: 400 }
    );
  }

  const slot = DOCUMENT_SLOTS.find((s) => s.key === slotKey);
  if (!slot) {
    return NextResponse.json(
      { error: `invalid slotKey: ${slotKey}` },
      { status: 400 }
    );
  }

  if (slot.expires && !expiryDate) {
    return NextResponse.json(
      { error: 'expiryDate is required for expiring documents' },
      { status: 400 }
    );
  }

  // Validate metadata for expiring docs
  if (slot.meta?.kind === 'passport' && !passportNumber) {
    return NextResponse.json(
      { error: 'passportNumber is required for passport documents' },
      { status: 400 }
    );
  }
  if (slot.meta?.kind === 'pass' && !passType) {
    return NextResponse.json(
      { error: 'passType is required for pass documents' },
      { status: 400 }
    );
  }

  // Size limits
  let totalSize = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 10 MB limit` },
        { status: 400 }
      );
    }
    totalSize += file.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: 'Total file size exceeds 30 MB limit' },
      { status: 400 }
    );
  }

  // Slot-based file type restrictions
  if (slotKey === 'idPicture') {
    if (files.length > 1) {
      return NextResponse.json(
        { error: 'ID Picture only accepts a single image file' },
        { status: 400 }
      );
    }
    if (!isImage(files[0])) {
      return NextResponse.json(
        { error: 'ID Picture must be an image file (JPG, PNG, GIF, or WEBP)' },
        { status: 400 }
      );
    }
  } else {
    if (files.length === 1 && !isPdf(files[0])) {
      return NextResponse.json(
        { error: `"${slot.label}" must be a PDF file` },
        { status: 400 }
      );
    }
    // Multi-file: all must be PDFs for merging
    if (files.length > 1) {
      const nonPdf = files.find((f) => !isPdf(f));
      if (nonPdf) {
        return NextResponse.json(
          {
            error:
              'When uploading multiple files, all must be PDFs for merging',
          },
          { status: 400 }
        );
      }
    }
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;

  // ── Which side of enrolment is this upload on? ──
  //
  // This block used to REFUSE every applicant with a 422: "P-Files uploads are
  // only available for enrolled students." That was right while P-Files was
  // enrolled-only (KD #31, KD #71) — an applicant had no folder here to upload
  // into. KD #204 put applicants on the P-Files list and gave them folders,
  // and the refusal became the thing standing between the office and a
  // document THE SCHOOL ITSELF PRODUCES: `assessmentResult` ("Assessment
  // Result and Interview") is never offered by the parent portal, so it had no
  // way into an applicant's folder at all.
  //
  // Replaced by the same rule the document PATCH uses for validation: enrolment
  // state selects the capability, and the holder set decides. Mr Ace was asked
  // whether staff should reach every slot for an applicant or only the eight
  // school-produced forms, and chose every slot ("yes let them upload
  // everthing", 2026-09-01) — so there is deliberately NO per-slot narrowing
  // here. One rule on both sides of enrolment.
  //
  // ⚠ A staff upload writes `{slotKey}Status = 'Valid'` below, on both sides.
  // For an applicant that means a staff-uploaded file skips the admissions
  // review queue — accepted knowingly: a staff member has already looked at
  // the file, which is what that queue exists to do. It is also what has always
  // happened after enrolment.
  const enrolled = await isStudentEnrolled(ayCode, enroleeNumber);
  const requiredCapability = enrolled
    ? 'documents_post_enrolment.upload'
    : 'documents_pre_enrolment.upload';

  if (!auth.capabilities.includes(requiredCapability)) {
    return enrolled
      ? NextResponse.json(
          {
            error:
              "This student has enrolled, so their documents belong with the enrolled students' files — which you don't have permission to add to.",
            code: 'enrolled_documents_pfiles_only',
          },
          { status: 403 }
        )
      : NextResponse.json(
          {
            error:
              "This applicant hasn't enrolled yet, so their documents belong with the applicants' files — which you don't have permission to add to.",
            code: 'unenrolled_documents_admissions_only',
          },
          { status: 403 }
        );
  }

  // ── Look up current state for this slot to see if we need to archive ──
  const selectCols = [
    `"${slotKey}"`,
    `"${slotKey}Status"`,
    ...(slot.expires ? [`"${slotKey}Expiry"`] : []),
  ].join(', ');

  const { data: currentDoc } = await service
    .from(`${prefix}_enrolment_documents`)
    .select(selectCols)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();

  const currentRow = (currentDoc ?? {}) as Record<string, unknown>;
  const currentUrl =
    typeof currentRow[slotKey] === 'string'
      ? (currentRow[slotKey] as string)
      : null;
  const currentStatus =
    typeof currentRow[`${slotKey}Status`] === 'string'
      ? (currentRow[`${slotKey}Status`] as string)
      : null;
  const currentExpiry =
    slot.expires && typeof currentRow[`${slotKey}Expiry`] === 'string'
      ? (currentRow[`${slotKey}Expiry`] as string)
      : null;

  // Snapshot passport / pass metadata if we'll be archiving
  let currentPassportNumber: string | null = null;
  let currentPassType: string | null = null;
  if (currentUrl && slot.meta) {
    const metaCol = slot.meta.numberCol;
    const { data: appRow } = await service
      .from(`${prefix}_enrolment_applications`)
      .select(`"${metaCol}"`)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    const val = (appRow as Record<string, unknown> | null)?.[metaCol];
    if (typeof val === 'string') {
      if (slot.meta.kind === 'passport') currentPassportNumber = val;
      else currentPassType = val;
    }
  }

  // Prepare the new file buffer to upload
  let uploadBuffer: Buffer;
  let contentType: string;
  let ext: string;

  if (files.length === 1) {
    // Single file — keep original format
    const file = files[0];
    uploadBuffer = Buffer.from(await file.arrayBuffer());
    contentType = file.type || 'application/octet-stream';
    ext = file.name.split('.').pop() ?? 'pdf';
  } else {
    // Multiple PDFs — merge
    try {
      const merger = new PDFMerger();
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        await merger.add(buffer);
      }
      uploadBuffer = (await merger.saveAsBuffer()) as Buffer;
      contentType = 'application/pdf';
      ext = 'pdf';
    } catch {
      return NextResponse.json(
        {
          error:
            'Failed to merge PDFs. Please check that all files are valid PDF documents.',
        },
        { status: 400 }
      );
    }
  }

  const canonicalPath = `${prefix}/${enroleeNumber}/${slotKey}.${ext}`;

  // ── Archive the current file (if any) before overwriting ──
  let didReplace = false;
  if (currentUrl) {
    const currentPath = extractStoragePath(currentUrl, BUCKET);
    if (currentPath) {
      const currentExt = extFromPath(currentPath);
      const iso = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = `${prefix}/${enroleeNumber}/${slotKey}/revisions/${iso}.${currentExt}`;

      const { error: moveError } = await service.storage
        .from(BUCKET)
        .move(currentPath, archivePath);

      if (moveError) {
        // If the source doesn't exist the move errors — treat as a soft miss
        // (the DB had a URL but storage didn't). Log and proceed without
        // archiving rather than blocking the replacement.
        console.error(
          `[p-files] archive move failed for ${enroleeNumber}/${slotKey}:`,
          moveError.message
        );
      } else {
        const { data: archiveUrlData } = service.storage
          .from(BUCKET)
          .getPublicUrl(archivePath);
        const archivedUrl = archiveUrlData.publicUrl;

        const revResult = await createRevision(service, {
          ayCode,
          enroleeNumber,
          slotKey,
          archivedUrl,
          archivedPath: archivePath,
          // previousUrl mirrors the row's pre-replacement URL so the
          // migration-033 trigger's INSERT (which fires after the docs
          // UPDATE below) collides with this row via the partial unique
          // index on (ay_code, enrolee_number, slot_key, previous_url)
          // and silently no-ops via ON CONFLICT DO NOTHING. Without this
          // we'd get duplicate revision rows for every officer upload.
          previousUrl: currentUrl,
          statusSnapshot: currentStatus,
          expirySnapshot: currentExpiry,
          passportNumberSnapshot: currentPassportNumber,
          passTypeSnapshot: currentPassType,
          note,
          replacedByUserId: auth.user.id,
          replacedByEmail: auth.user.email ?? null,
        });
        if (!revResult.ok) {
          console.error(
            `[p-files] createRevision failed for ${enroleeNumber}/${slotKey}:`,
            revResult.error
          );
        }
        didReplace = true;
      }
    }
  }

  // ── Upload the new file to the canonical path ──
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(canonicalPath, uploadBuffer, { upsert: true, contentType });

  if (uploadError) {
    return NextResponse.json(
      { error: `storage upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Get public URL
  const { data: urlData } = service.storage
    .from(BUCKET)
    .getPublicUrl(canonicalPath);
  const publicUrl = urlData.publicUrl;

  // --- Table 1: enrolment_documents (file URL + status + expiry) ---
  const docFields: Record<string, unknown> = {
    [slotKey]: publicUrl,
    [`${slotKey}Status`]: 'Valid',
  };
  if (slot.expires && expiryDate) {
    docFields[`${slotKey}Expiry`] = expiryDate;
  }

  // `.select()` so we can tell an UPDATE that matched nothing from one that
  // worked. PostgREST reports both as success, and the difference is not
  // hypothetical now that applicants upload here: the documents row is created
  // by the parent portal when a family submits an application, so an enrolee
  // who reached these tables another way (an import, a walk-in registered by
  // the office) may have a status row and no documents row. Without this the
  // file lands in storage, the record never changes, and the screen says the
  // upload succeeded — the worst of the three outcomes.
  const { data: updated, error: docError } = await service
    .from(`${prefix}_enrolment_documents`)
    .update(docFields)
    .eq('enroleeNumber', enroleeNumber)
    .select('"enroleeNumber"');

  if (docError) {
    return NextResponse.json(
      { error: `db update failed: ${docError.message}` },
      { status: 500 }
    );
  }

  if (((updated as unknown[] | null)?.length ?? 0) === 0) {
    return NextResponse.json(
      {
        error:
          "This student has no document record for this academic year yet, so there's nowhere to file the upload. Ask an administrator to add them to this year's records, then try again.",
        code: 'no_document_row',
      },
      { status: 409 }
    );
  }

  // --- Table 2: enrolment_applications (passport number / pass type + expiry) ---
  if (slot.meta) {
    const appFields: Record<string, unknown> = {
      [slot.meta.expiryCol]: expiryDate,
    };
    if (slot.meta.kind === 'passport') {
      appFields[slot.meta.numberCol] = passportNumber;
    } else {
      appFields[slot.meta.numberCol] = passType;
    }

    const { error: appError } = await service
      .from(`${prefix}_enrolment_applications`)
      .update(appFields)
      .eq('enroleeNumber', enroleeNumber);

    if (appError) {
      // Best-effort: file is uploaded, warn but don't fail
      console.error(
        `[p-files] enrolment_applications update failed for ${enroleeNumber}:`,
        appError.message
      );
      invalidateDrillTags('p-files', ayCode);
      return NextResponse.json({
        ok: true,
        url: publicUrl,
        replaced: didReplace,
        warning:
          'Document uploaded but application metadata update failed. Please update manually.',
      });
    }
  }

  // --- Audit log ---
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'pfile.upload',
    entityType: 'enrolment_document',
    entityId: enroleeNumber,
    context: {
      slotKey,
      label: slot.label,
      fileCount: files.length,
      merged: files.length > 1,
      replaced: didReplace,
      expiryDate: expiryDate ?? undefined,
      ...(note ? { note } : {}),
      ...(slot.meta?.kind === 'passport' ? { passportNumber } : {}),
      ...(slot.meta?.kind === 'pass' ? { passType } : {}),
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('p-files', ayCode);

  return NextResponse.json({ ok: true, url: publicUrl, replaced: didReplace });
}
