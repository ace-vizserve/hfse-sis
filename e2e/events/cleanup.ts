import type { Page } from '@playwright/test';
import { localDb } from '../parent-portal/local-db';

// Every event a spec creates through New event, removed again once the test
// ends, so the local events list does not fill with test leftovers. The ids
// come from the builder URL New event lands on. LOCAL stack only: localDb()
// refuses any other database.

const BUILDER_URL = /\/sis\/admin\/events\/([0-9a-f-]{36})\/build/;
const BUCKET = 'parent-portal';

/** Starts noting the id of every event the page opens in the builder. */
export function trackNewEvents(page: Page): string[] {
  const ids: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const id = BUILDER_URL.exec(frame.url())?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

/** Deletes the events with their answers and uploaded pictures, deepest rows first. */
export async function removeEvents(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = localDb();
  await db.from('parent_event_registrations').delete().in('event_id', ids);
  await db.from('parent_event_submissions').delete().in('event_id', ids);
  for (const id of ids) {
    const { data: files } = await db.storage.from(BUCKET).list(`events/${id}`);
    if (files?.length) {
      await db.storage
        .from(BUCKET)
        .remove(files.map((f) => `events/${id}/${f.name}`));
    }
  }
  const { error } = await db.from('parent_events').delete().in('id', ids);
  if (error) throw error;
}
