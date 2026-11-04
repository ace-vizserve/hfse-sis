import {
  compareReading,
  type DocumentReadingView,
  type EnteredDetails,
  type StoredReading,
} from '@/lib/admissions/document-reading-view';
import { sgToday } from '@/lib/dates';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

/** Only passports get read; every other document just has its scan quality measured. */
export const PASSPORT_SLOTS = DOCUMENT_SLOTS.filter(
  (slot) => slot.meta?.kind === 'passport'
);

/** Whose name and birthday a passport slot should carry, on the applications table. */
function personColumns(slotKey: string) {
  const prefix = slotKey.replace(/Passport$/, '').replace(/^passport$/, '');
  return prefix
    ? { name: `${prefix}FullName`, birthDate: `${prefix}BirthDay` }
    : { name: 'enroleeFullName', birthDate: 'birthDay' };
}

/** Columns on the applications table holding what the parent entered. */
export const PASSPORT_ENTERED_COLUMNS = [
  ...new Set(
    PASSPORT_SLOTS.flatMap((slot) => {
      const person = personColumns(slot.key);
      return [
        slot.meta!.numberCol,
        slot.meta!.expiryCol,
        person.name,
        person.birthDate,
      ];
    })
  ),
];

/** What the application says for a slot. Blank for anything but a passport. */
export function enteredDetails(
  slotKey: string,
  app: Record<string, string | null> | undefined
): EnteredDetails {
  const slot = PASSPORT_SLOTS.find((s) => s.key === slotKey);
  if (!slot || !app) return { number: null, expiry: null };
  const person = personColumns(slotKey);
  return {
    number: app[slot.meta!.numberCol] ?? null,
    expiry: app[slot.meta!.expiryCol] ?? null,
    name: app[person.name] ?? null,
    birthDate: app[person.birthDate] ?? null,
  };
}

// A URL is long, and every one goes in the query string.
const URLS_PER_QUERY = 50;

/** The stored reading for each file URL that has one. */
export async function loadStoredReadings(
  urls: string[]
): Promise<Map<string, StoredReading>> {
  const client = createAdmissionsClient();
  const readings = new Map<string, StoredReading>();
  const unique = [...new Set(urls)];
  for (let i = 0; i < unique.length; i += URLS_PER_QUERY) {
    const { data, error } = await client
      .from('document_readings')
      .select('file_url, status, passports, quality, created_at')
      .in('file_url', unique.slice(i, i + URLS_PER_QUERY));
    // A missing reading only costs the reviewer a hint: they still have the file.
    if (error) {
      console.error('[document-readings] fetch error', error.message);
      continue;
    }
    for (const row of data ?? []) {
      readings.set(row.file_url as string, {
        status: row.status as StoredReading['status'],
        passports: row.passports as StoredReading['passports'],
        quality: row.quality as StoredReading['quality'],
        checkedAt: row.created_at as string,
      });
    }
  }
  return readings;
}

/** What's known about one student's documents, by slot key, for a detail page. */
export async function loadSlotReadings(
  ayCode: string,
  enroleeNumber: string,
  urlBySlot: Record<string, string | null | undefined>
): Promise<Record<string, DocumentReadingView>> {
  const urls = Object.values(urlBySlot).filter(
    (url): url is string => typeof url === 'string' && url.startsWith('http')
  );
  if (urls.length === 0) return {};

  const stored = await loadStoredReadings(urls);
  if (stored.size === 0) return {};

  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const { data, error } = await createAdmissionsClient()
    .from(`ay${year}_enrolment_applications`)
    .select(PASSPORT_ENTERED_COLUMNS.join(', '))
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (error) {
    console.error('[document-readings] application fetch error', error.message);
    return {};
  }
  const app = (data ?? {}) as unknown as Record<string, string | null>;

  const today = sgToday();
  const views: Record<string, DocumentReadingView> = {};
  for (const slot of DOCUMENT_SLOTS) {
    const url = urlBySlot[slot.key];
    const reading = url ? stored.get(url) : undefined;
    if (!reading) continue;
    views[slot.key] = compareReading(
      reading,
      enteredDetails(slot.key, app),
      today
    );
  }
  return views;
}
