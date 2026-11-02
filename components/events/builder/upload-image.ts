'use client';

import { toast } from 'sonner';

import { apiFetch } from '@/lib/query/fetcher';

/**
 * Lets staff pick a picture and uploads it to the event's image route.
 * Resolves the picture's public URL, or null when nothing was chosen or the
 * upload failed (the failure is toasted).
 */
export function pickAndUploadImage(eventId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const body = new FormData();
      body.append('file', file);
      const pending = toast.loading('Adding the picture…');
      try {
        const res = await apiFetch<{ url: string }>(
          `/api/sis/events/${eventId}/image`,
          { method: 'POST', body }
        );
        toast.success('Picture added.', { id: pending });
        resolve(res.url);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Could not add the picture.',
          { id: pending }
        );
        resolve(null);
      }
    });
    input.click();
  });
}
