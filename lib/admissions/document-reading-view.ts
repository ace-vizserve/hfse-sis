// What a reviewer sees about an uploaded file: what the parent portal read from
// a passport against what the application says now, and how good the scan is.
// Free of I/O so a client component can import the types and a test can drive it
// directly.

export type StoredPassport = {
  expiry: string | null;
  number: string | null;
  /** Verified by its check digit. */
  birthDate?: string | null;
  /** The next three have no check digit: for a person to look at, as read. */
  name?: string | null;
  nationality?: string | null;
  sex?: string | null;
};

export type DocumentQuality = {
  pages: number;
  totalPages: number;
  fileBytes: number;
  /** A PDF with real text, as opposed to a picture of a page. Null for an image. */
  hasText: boolean | null;
  /** The file's own size for an image; null for a PDF. */
  width: number | null;
  height: number | null;
  sharpness: number;
  inkRatio: number;
  brightness: number;
  contrast: number;
};

export type StoredReading = {
  status: 'read' | 'unreadable' | 'timed_out' | 'failed' | 'not_read';
  passports: StoredPassport[];
  quality: DocumentQuality | null;
  /** When the portal reported it. */
  checkedAt?: string | null;
};

export type EnteredDetails = {
  number: string | null;
  expiry: string | null;
  name?: string | null;
  birthDate?: string | null;
};

export type DocumentReadingView = {
  status: StoredReading['status'];
  /** null when that value couldn't be verified from the file. */
  readNumber: string | null;
  readExpiry: string | null;
  enteredNumber: string | null;
  enteredExpiry: string | null;
  /** null when there is nothing to compare: one side or the other is blank. */
  numberMatches: boolean | null;
  expiryMatches: boolean | null;
  readBirthDate: string | null;
  enteredBirthDate: string | null;
  birthDateMatches: boolean | null;
  readName: string | null;
  enteredName: string | null;
  /** Whether every word of the shorter name is in the longer. The MRZ's name has no
   *  check digit and leaves names out, so a false here is worth a look, nothing more. */
  nameMatches: boolean | null;
  nationality: string | null;
  sex: string | null;
  checkedAt: string | null;
  /** The passport read has already expired. */
  expired: boolean;
  passportCount: number;
  quality: DocumentQuality | null;
};

const normalizeNumber = (value: string) =>
  value.replace(/\s/g, '').toUpperCase();
const dayOf = (value: string | null | undefined) => value?.slice(0, 10) ?? null;
const nameWords = (value: string) =>
  value
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
function namesAgree(a: string, b: string) {
  const [shorter, longer] = [nameWords(a), nameWords(b)].sort(
    (x, y) => x.length - y.length
  );
  return shorter.every((word) => longer.includes(word));
}

/** Compares with the passport in the file the entered details point at: the one
 *  whose number matches, else whose expiry matches, else the first. Must agree
 *  with what the portal checked at upload (`passportToCompare` there). */
export function compareReading(
  reading: StoredReading,
  entered: EnteredDetails,
  today: string
): DocumentReadingView {
  const enteredNumber = entered.number?.trim() || null;
  const enteredExpiry = dayOf(entered.expiry);
  const { passports } = reading;
  const compared =
    passports.find(
      (p) =>
        p.number &&
        enteredNumber &&
        normalizeNumber(p.number) === normalizeNumber(enteredNumber)
    ) ??
    passports.find((p) => p.expiry && p.expiry === enteredExpiry) ??
    passports[0];

  const readNumber = compared?.number ?? null;
  const readExpiry = compared?.expiry ?? null;
  const readBirthDate = compared?.birthDate ?? null;
  const enteredBirthDate = dayOf(entered.birthDate);
  const readName = compared?.name ?? null;
  const enteredName = entered.name?.trim() || null;
  return {
    status: reading.status,
    readNumber,
    readExpiry,
    enteredNumber,
    enteredExpiry,
    numberMatches:
      readNumber && enteredNumber
        ? normalizeNumber(readNumber) === normalizeNumber(enteredNumber)
        : null,
    expiryMatches:
      readExpiry && enteredExpiry ? readExpiry === enteredExpiry : null,
    readBirthDate,
    enteredBirthDate,
    birthDateMatches:
      readBirthDate && enteredBirthDate
        ? readBirthDate === enteredBirthDate
        : null,
    readName,
    enteredName,
    nameMatches:
      readName && enteredName ? namesAgree(readName, enteredName) : null,
    nationality: compared?.nationality ?? null,
    sex: compared?.sex ?? null,
    checkedAt: reading.checkedAt ?? null,
    expired: !!readExpiry && readExpiry <= today,
    passportCount: passports.length,
    quality: reading.quality,
  };
}

// Cut-offs checked by eye against real uploads of each document (2026-11-03).
// They are deliberately cautious, because a flag that cries wolf gets ignored:
// a normal ID photo on a dark backdrop averages about 80, and a clean scan of a
// card can score a few hundred on sharpness. A text-readability score was tried
// and dropped: it gave a perfectly legible birth certificate 0%.
const NEARLY_BLANK_INK = 0.003;
// Far apart because they measure different things: a scanned page is full of hard
// edges, and a good photo of a face has few.
const BLURRY_SCAN_SHARPNESS = 200;
const BLURRY_PHOTO_SHARPNESS = 15;
const VERY_DARK_BRIGHTNESS = 50;
const WASHED_OUT_CONTRAST = 10;
const SMALL_IMAGE_PX = 300;

const isBlurry = (quality: DocumentQuality) =>
  quality.sharpness <
  (quality.width === null ? BLURRY_SCAN_SHARPNESS : BLURRY_PHOTO_SHARPNESS);

/** The scan's measurements in words a reviewer can use, for the details view. */
export function qualityFacts(quality: DocumentQuality) {
  const kb = quality.fileBytes / 1024;
  const pages = quality.totalPages;
  return {
    kind:
      quality.width !== null
        ? `Photo, ${quality.width} × ${quality.height} px`
        : quality.hasText
          ? 'PDF with real text'
          : 'Scanned or photographed PDF',
    pages: `${pages} ${pages === 1 ? 'page' : 'pages'}`,
    size: kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`,
    sharpness: isBlurry(quality) ? 'Blurry' : 'Sharp',
    content:
      quality.inkRatio < NEARLY_BLANK_INK
        ? 'Almost nothing on it'
        : quality.inkRatio < 0.02
          ? 'Mostly empty page'
          : 'Has content',
    brightness:
      quality.brightness < VERY_DARK_BRIGHTNESS ? 'Very dark' : 'Normal',
    contrast: quality.contrast < WASHED_OUT_CONTRAST ? 'Washed out' : 'Normal',
  };
}

/** Anything about the scan worth a reviewer's second look; empty if nothing is.
 *  Hints only: the reviewer has the file on screen and decides. */
export function qualityNotes(quality: DocumentQuality | null): string[] {
  if (!quality) return [];
  const notes: string[] = [];
  // Says it first and alone: the others describe a page with something on it.
  if (quality.inkRatio < NEARLY_BLANK_INK) return ['Nearly blank'];
  if (isBlurry(quality)) notes.push('Looks blurry');
  if (quality.brightness < VERY_DARK_BRIGHTNESS) notes.push('Very dark');
  if (quality.contrast < WASHED_OUT_CONTRAST) notes.push('Washed out');
  if (
    quality.width !== null &&
    quality.height !== null &&
    Math.min(quality.width, quality.height) < SMALL_IMAGE_PX
  ) {
    notes.push(`Small image (${quality.width}×${quality.height})`);
  }
  return notes;
}

/** One word on how a reading came out, for a table cell. */
export function readingOutcome(
  view: DocumentReadingView
): 'matches' | 'differs' | 'expired' | 'not-read' | 'quality-only' {
  if (view.status === 'not_read') return 'quality-only';
  if (view.status !== 'read') return 'not-read';
  if (view.expired) return 'expired';
  if (
    view.numberMatches === false ||
    view.expiryMatches === false ||
    view.birthDateMatches === false
  ) {
    return 'differs';
  }
  return 'matches';
}
