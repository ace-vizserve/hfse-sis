// Defaults for a brand-new parent event (POST /api/sis/events). Pure — dates are
// worked on the Singapore calendar, the school's clock.

const SG_OFFSET = '+08:00';

function singaporeToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Starts a week from today, opens now, and closes at noon (Singapore) three
 * days before the start.
 */
export function newEventDefaults(now: Date): {
  startsOn: string;
  opensAt: string;
  closesAt: string;
} {
  const startsOn = addDays(singaporeToday(now), 7);
  const closeDay = addDays(startsOn, -3);
  return {
    startsOn,
    opensAt: now.toISOString(),
    closesAt: new Date(`${closeDay}T12:00:00${SG_OFFSET}`).toISOString(),
  };
}
