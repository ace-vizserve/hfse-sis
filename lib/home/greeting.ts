export type GreetingBucket = 'morning' | 'afternoon' | 'evening';

/**
 * Time-of-day greeting bucket for the home page hero, from an SGT hour
 * (0–23, see lib/dates.ts::sgHour). Pure so it's testable without mocking
 * the clock — callers pass the hour in.
 */
export function greetingForHour(hour: number): {
  label: string;
  bucket: GreetingBucket;
} {
  if (hour >= 5 && hour < 12)
    return { label: 'Good morning', bucket: 'morning' };
  if (hour >= 12 && hour < 18)
    return { label: 'Good afternoon', bucket: 'afternoon' };
  return { label: 'Good evening', bucket: 'evening' };
}
