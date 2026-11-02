// Registration opens and closes are stored as instants, but staff think in
// Singapore wall-clock time. These two turn an instant into the date and time
// shown in the builder, and back. Singapore has no daylight saving, so the
// offset is always +08:00. Pure — no I/O.

const SG_OFFSET = '+08:00';

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "2026-11-05T12:00:00+08:00" instant → { date: '2026-11-05', time: '12:00' } in Singapore. */
export function sgParts(iso: string): { date: string; time: string } {
  const p = Object.fromEntries(
    PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value])
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  };
}

/** A Singapore date ('2026-11-05') and time ('12:00') → an ISO instant string. */
export function sgToIso(date: string, time: string): string {
  return new Date(`${date}T${time || '00:00'}:00${SG_OFFSET}`).toISOString();
}
