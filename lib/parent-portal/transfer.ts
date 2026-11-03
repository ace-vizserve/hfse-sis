import type { SupabaseClient } from '@supabase/supabase-js';

import { prefixFor } from '@/lib/admissions/_shared';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Transfer records: a parent picked the wrong academic year in the portal, so a
// superadmin moves the application to the right one. A port of the portal's
// `move-student-ay` edge function, which only accepts the shared portal admin
// login. These are fresh applications, so nothing else in the SIS is re-pointed.
//
// The one change from the portal is that a failed move undoes itself: it used to
// stop wherever it failed, and never looked at whether its deletes worked.

const BUCKET = 'parent-portal';

// Copied from the portal's `move-student-ay/index.ts`. A slot not on this list
// keeps its link to the from-year's folder, and its file stays there.
export const DOC_URL_FIELDS = [
  'passport',
  'birthCert',
  'pass',
  'educCert',
  'motherPassport',
  'motherPass',
  'fatherPassport',
  'fatherPass',
  'idPicture',
  'form12',
  'medical',
  'uploadFormDocument',
  'icaPhoto',
  'financialSupportDocs',
  'vaccinationInformation',
  'guardianPassport',
  'guardianPass',
];

export const APP_URL_FIELDS = ['enroleePhoto'];

// Left for the to-year's table to fill in. `fts` is generated: writing it fails.
export const STRIP_FIELDS = new Set(['id', 'idx', 'created_at', 'fts']);

// A row going back where it came from keeps its own id and date.
const NEVER_WRITTEN_FIELDS = new Set(['idx', 'fts']);

const KEEPS_STUDENT_NUMBER = new Set(['Current', 'VizSchool Current']);

const TABLES = ['applications', 'documents', 'status'] as const;
type TableKind = (typeof TABLES)[number];

type Row = Record<string, unknown>;

export type TransferApplication = {
  enroleeNumber: string;
  studentNumber: string | null;
  name: string;
  level: string | null;
  category: string | null;
  /**
   * A documents or status row with no application behind it. The portal writes
   * the three tables separately, so these exist, and they need a recovery link
   * most. There is no application to move.
   */
  applicationMissing: boolean;
};

export type TransferResult =
  | {
      ok: true;
      newEnroleeNumber: string;
      newStudentNumber: string;
      /** For the audit row. */
      studentName: string;
      oldStudentNumber: string | null;
      warning?: string;
    }
  | {
      ok: false;
      error: string;
      /** The move failed AND could not be fully undone: the audit log records it. */
      needsChecking?: boolean;
    };

/** One student in a bulk move's answer. */
export type TransferRowResult = { enroleeNumber: string } & TransferResult;

export type TransferResponse = {
  results: TransferRowResult[];
  moved: number;
  failed: number;
};

function tableName(slug: string, kind: TableKind): string {
  return `${slug}_enrolment_${kind}`;
}

function without(row: Row, fields: Set<string>): Row {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !fields.has(key))
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// Missing name parts vanish rather than print as "null": live rows can be
// incomplete. The full name is what is left when there are no parts at all.
function displayName(row: Row): string {
  const given = [text(row.firstName), text(row.middleName)]
    .filter(Boolean)
    .join(' ');
  const name = [text(row.lastName), given].filter(Boolean).join(', ');
  return name || text(row.enroleeFullName) || 'No name on the record';
}

function storagePath(url: string): string | null {
  const marker = '/parent-portal/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}

function remapUrl(url: string, fromSlug: string, toSlug: string): string {
  return url.replaceAll(`/${fromSlug}/`, `/${toSlug}/`);
}

function remapUrlFields(
  row: Row,
  fields: string[],
  fromSlug: string,
  toSlug: string
): Row {
  const result = { ...row };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value) {
      result[field] = remapUrl(value, fromSlug, toSlug);
    }
  }
  return result;
}

type FileMove = { from: string; to: string };

// Each destination comes from the remapped link, so a copy always lands where
// the link now points. A link with no from-year folder in it remaps to itself:
// the portal failed the whole move trying to copy that file onto itself, but the
// link is still good and the file may be another year's, so it is left alone.
function filesToMove(
  sources: { row: Row | null; fields: string[] }[],
  fromSlug: string,
  toSlug: string
): FileMove[] {
  const moves = new Map<string, string>();
  for (const { row, fields } of sources) {
    if (!row) continue;
    for (const field of fields) {
      const url = row[field];
      if (typeof url !== 'string' || !url) continue;
      const from = storagePath(url);
      const to = storagePath(remapUrl(url, fromSlug, toSlug));
      if (from && to && from !== to) moves.set(from, to);
    }
  }
  return [...moves].map(([from, to]) => ({ from, to }));
}

/**
 * Current and VizSchool Current keep their student number. Anyone else gets the
 * portal's default: the first letter of their number or H, then year and id.
 */
export function nextStudentNumber(
  category: string | null | undefined,
  currentStudentNumber: string | null | undefined,
  yy: string,
  nextId: number
): string {
  if (currentStudentNumber && category && KEEPS_STUDENT_NUMBER.has(category)) {
    return currentStudentNumber;
  }
  const prefix = currentStudentNumber ? currentStudentNumber[0] : 'H';
  return `${prefix}${yy}${String(nextId).padStart(4, '0')}`;
}

function enroleeNumberFor(yy: string, id: number): string {
  return `E${yy}${String(id).padStart(4, '0')}`;
}

export async function listApplications(
  service: SupabaseClient,
  ayCode: string
): Promise<TransferApplication[]> {
  const slug = prefixFor(ayCode);
  // All three or none: a read that failed must not look like a shorter list.
  const [applications, documents, statuses] = await Promise.all([
    fetchAllPages<Row>((from, to) =>
      service
        .from(tableName(slug, 'applications'))
        .select(
          'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, middleName, levelApplied, category'
        )
        .not('enroleeNumber', 'is', null)
        .order('lastName', { ascending: true })
        .range(from, to)
    ),
    fetchAllPages<Row>((from, to) =>
      service
        .from(tableName(slug, 'documents'))
        .select('enroleeNumber, studentNumber')
        .not('enroleeNumber', 'is', null)
        .range(from, to)
    ),
    fetchAllPages<Row>((from, to) =>
      service
        .from(tableName(slug, 'status'))
        .select('enroleeNumber, enroleeName, enroleeType, levelApplied')
        .not('enroleeNumber', 'is', null)
        .range(from, to)
    ),
  ]);

  const withApplication = new Set(
    applications.map((row) => row.enroleeNumber as string)
  );
  const statusByNumber = new Map(
    statuses.map((row) => [row.enroleeNumber as string, row])
  );
  const documentsByNumber = new Map(
    documents.map((row) => [row.enroleeNumber as string, row])
  );
  const orphans = new Set(
    [...statusByNumber.keys(), ...documentsByNumber.keys()].filter(
      (enroleeNumber) => !withApplication.has(enroleeNumber)
    )
  );

  return [
    ...applications.map((row) => ({
      enroleeNumber: row.enroleeNumber as string,
      studentNumber: text(row.studentNumber),
      name: displayName(row),
      level: text(row.levelApplied),
      category: text(row.category),
      applicationMissing: false,
    })),
    ...[...orphans].map((enroleeNumber) => {
      const status = statusByNumber.get(enroleeNumber);
      return {
        enroleeNumber,
        studentNumber: text(
          documentsByNumber.get(enroleeNumber)?.studentNumber
        ),
        name: text(status?.enroleeName) ?? 'No name on the record',
        level: text(status?.levelApplied),
        category: text(status?.enroleeType),
        applicationMissing: true,
      };
    }),
  ];
}

// What this move has done so far, which is exactly what an undo may touch.
type MoveProgress = {
  newEnroleeNumber: string | null;
  inserted: TableKind[];
  copied: string[];
  deleted: { kind: TableKind; row: Row }[];
  /** The undo could not put a source row back, so the to-year copy stayed. */
  keptCopy: boolean;
};

async function readSource(
  service: SupabaseClient,
  fromSlug: string,
  kind: TableKind,
  enroleeNumber: string
): Promise<Row | null> {
  const { data, error } = await service
    .from(tableName(fromSlug, kind))
    .select('*')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  // A read that failed is not a row that does not exist. Moving on would leave
  // that row behind in the from-year.
  if (error) {
    throw new Error(`Could not read the ${kind} record: ${error.message}`);
  }
  return data as Row | null;
}

async function firstFreeId(
  service: SupabaseClient,
  toSlug: string,
  yy: string
): Promise<number> {
  const { data: highest, error } = await service
    .from(tableName(toSlug, 'applications'))
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not read the year to move to: ${error.message}`);
  }

  for (let id = Number(highest?.id ?? 0) + 1; ; id += 1) {
    const candidate = enroleeNumberFor(yy, id);
    const checks = await Promise.all(
      TABLES.map((kind) =>
        service
          .from(tableName(toSlug, kind))
          .select('enroleeNumber')
          .eq('enroleeNumber', candidate)
          .limit(1)
      )
    );
    const failed = checks.find((check) => check.error);
    if (failed?.error) {
      throw new Error(
        `Could not read the year to move to: ${failed.error.message}`
      );
    }
    if (checks.every((check) => (check.data ?? []).length === 0)) return id;
  }
}

async function insertRow(
  service: SupabaseClient,
  toSlug: string,
  kind: TableKind,
  row: Row,
  progress: MoveProgress
): Promise<void> {
  // Noted before the call: an insert whose answer is lost may still have landed,
  // and the undo removes by number, which is safe if nothing is there.
  progress.inserted.push(kind);
  const { error } = await service.from(tableName(toSlug, kind)).insert(row);
  if (error) {
    throw new Error(
      `Could not add the ${kind} record to the new year: ${error.message}`
    );
  }
}

async function deleteSourceRow(
  service: SupabaseClient,
  fromSlug: string,
  kind: TableKind,
  row: Row,
  enroleeNumber: string,
  progress: MoveProgress
): Promise<void> {
  // Noted before the call: a delete whose answer is lost may still have landed.
  // The undo looks at what is actually there before putting anything back.
  progress.deleted.push({ kind, row });
  const { data, error } = await service
    .from(tableName(fromSlug, kind))
    .delete()
    .eq('enroleeNumber', enroleeNumber)
    .select('enroleeNumber');
  if (error) {
    throw new Error(
      `Could not remove the ${kind} record from the old year: ${error.message}`
    );
  }
  // No error and nothing removed is still a delete that did not work.
  if (!data || data.length === 0) {
    throw new Error(
      `The ${kind} record was not removed from the old year. Nothing was deleted.`
    );
  }
}

// Puts things back and returns the sentence to show. Source rows go back first:
// if one will not, the to-year copy is the only copy of it left, so everything
// in the to-year stays and the message says where it is.
async function undoMove(
  service: SupabaseClient,
  fromSlug: string,
  toSlug: string,
  progress: MoveProgress,
  reason: string
): Promise<string> {
  const { newEnroleeNumber, inserted, copied, deleted } = progress;

  const notRestored: string[] = [];
  for (const { kind, row } of [...deleted].reverse()) {
    try {
      const stillThere = await readSource(
        service,
        fromSlug,
        kind,
        String(row.enroleeNumber)
      );
      if (stillThere) continue;
    } catch (e) {
      notRestored.push(
        `${kind} (${e instanceof Error ? e.message : 'could not be checked'})`
      );
      continue;
    }
    const { error } = await service
      .from(tableName(fromSlug, kind))
      .insert(without(row, NEVER_WRITTEN_FIELDS));
    if (error) notRestored.push(`${kind} (${error.message})`);
  }
  if (notRestored.length > 0) {
    progress.keptCopy = true;
    return `${reason} The old year's ${notRestored.join(', ')} could not be put back, so the copy in the new year was kept as ${newEnroleeNumber}. Check this record before moving it again.`;
  }

  const notRemoved: string[] = [];
  for (const kind of [...inserted].reverse()) {
    const { error } = await service
      .from(tableName(toSlug, kind))
      .delete()
      .eq('enroleeNumber', newEnroleeNumber as string);
    if (error) notRemoved.push(`${kind} record (${error.message})`);
  }
  if (copied.length > 0) {
    const { error } = await service.storage.from(BUCKET).remove(copied);
    if (error) {
      notRemoved.push(`copied files ${copied.join(', ')} (${error.message})`);
    }
  }
  if (notRemoved.length > 0) {
    return `${reason} The student is still in the old year, but these could not be removed from the new year under ${newEnroleeNumber}: ${notRemoved.join('; ')}.`;
  }
  return `${reason} The student is still in the old year.`;
}

// The move is done by now, so nothing here may undo it.
async function removeOldFiles(
  service: SupabaseClient,
  paths: string[]
): Promise<string | undefined> {
  if (paths.length === 0) return undefined;
  const warn = (left: string[]) =>
    `The move is done, but these old files could not be removed: ${left.join(', ')}.`;
  try {
    const { data, error } = await service.storage.from(BUCKET).remove(paths);
    if (error) return warn(paths);
    const removed = new Set((data ?? []).map((file) => file.name));
    const left = paths.filter((path) => !removed.has(path));
    return left.length > 0 ? warn(left) : undefined;
  } catch {
    return warn(paths);
  }
}

/**
 * Moves one application, with its documents, status and files. Either the
 * student ends up in the to-year only, or `ok: false` says what happened.
 * Never throws, so one bad student cannot stop a bulk move.
 */
export async function transferOne(
  service: SupabaseClient,
  input: { sourceAy: string; targetAy: string; enroleeNumber: string }
): Promise<TransferResult> {
  const { enroleeNumber } = input;
  // `prefixFor` is the only form the tables and the bucket's folders use:
  // `AY2027` from `listAyCodes` is `ay2027` to them.
  const fromSlug = prefixFor(input.sourceAy);
  const toSlug = prefixFor(input.targetAy);
  const yy = toSlug.slice(-2);

  const progress: MoveProgress = {
    newEnroleeNumber: null,
    inserted: [],
    copied: [],
    deleted: [],
    keptCopy: false,
  };

  let application: Row;
  let newStudentNumber: string;
  let sourcePaths: string[];

  try {
    const [app, doc, status] = await Promise.all([
      readSource(service, fromSlug, 'applications', enroleeNumber),
      readSource(service, fromSlug, 'documents', enroleeNumber),
      readSource(service, fromSlug, 'status', enroleeNumber),
    ]);
    if (!app) {
      return {
        ok: false,
        error: `No application for ${enroleeNumber} in that year. It may already have been moved.`,
      };
    }
    application = app;

    const moves = filesToMove(
      [
        { row: app, fields: APP_URL_FIELDS },
        { row: doc, fields: DOC_URL_FIELDS },
      ],
      fromSlug,
      toSlug
    );
    sourcePaths = moves.map((move) => move.from);

    const nextId = await firstFreeId(service, toSlug, yy);
    const newEnroleeNumber = enroleeNumberFor(yy, nextId);
    progress.newEnroleeNumber = newEnroleeNumber;
    newStudentNumber = nextStudentNumber(
      text(app.category),
      text(app.studentNumber),
      yy,
      nextId
    );

    await insertRow(
      service,
      toSlug,
      'applications',
      remapUrlFields(
        {
          ...without(app, STRIP_FIELDS),
          enroleeNumber: newEnroleeNumber,
          studentNumber: newStudentNumber,
        },
        APP_URL_FIELDS,
        fromSlug,
        toSlug
      ),
      progress
    );
    if (doc) {
      await insertRow(
        service,
        toSlug,
        'documents',
        remapUrlFields(
          {
            ...without(doc, STRIP_FIELDS),
            enroleeNumber: newEnroleeNumber,
            // The portal left the old number here. This row has its own copy.
            ...('studentNumber' in doc
              ? { studentNumber: newStudentNumber }
              : {}),
          },
          DOC_URL_FIELDS,
          fromSlug,
          toSlug
        ),
        progress
      );
    }
    if (status) {
      await insertRow(
        service,
        toSlug,
        'status',
        { ...without(status, STRIP_FIELDS), enroleeNumber: newEnroleeNumber },
        progress
      );
    }

    for (const { from, to } of moves) {
      const { error } = await service.storage.from(BUCKET).copy(from, to);
      if (error) {
        throw new Error(`Could not copy ${from}: ${error.message}`);
      }
      // Only what this move made: a file already at `to` fails above and stays.
      progress.copied.push(to);
    }

    if (status) {
      await deleteSourceRow(
        service,
        fromSlug,
        'status',
        status,
        enroleeNumber,
        progress
      );
    }
    if (doc) {
      await deleteSourceRow(
        service,
        fromSlug,
        'documents',
        doc,
        enroleeNumber,
        progress
      );
    }
    await deleteSourceRow(
      service,
      fromSlug,
      'applications',
      app,
      enroleeNumber,
      progress
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'The move stopped.';
    try {
      const error = await undoMove(service, fromSlug, toSlug, progress, reason);
      return { ok: false, error, needsChecking: progress.keptCopy };
    } catch (undoError) {
      const why =
        undoError instanceof Error ? undoError.message : 'it stopped part way';
      return {
        ok: false,
        error: `${reason} Putting things back also failed: ${why}. Check ${enroleeNumber} in both years before trying again.`,
        needsChecking: true,
      };
    }
  }

  const warning = await removeOldFiles(service, sourcePaths);
  return {
    ok: true,
    newEnroleeNumber: progress.newEnroleeNumber as string,
    newStudentNumber,
    studentName: displayName(application),
    oldStudentNumber: text(application.studentNumber),
    ...(warning ? { warning } : {}),
  };
}
