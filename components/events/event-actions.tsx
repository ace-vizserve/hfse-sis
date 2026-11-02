'use client';

import { Copy, Lock, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { builderHref } from '@/lib/events/display';

// Buttons shared by the Parent events list and an event's own page.

export async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success('Link copied.');
  } catch {
    toast.error('Could not copy. Select the link and copy it by hand.');
  }
}

export function NewEventButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/sis/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled event' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || !body.id) {
        toast.error(body.error ?? 'Could not create the event.');
        setBusy(false);
        return;
      }
      router.push(builderHref(body.id));
    } catch {
      toast.error('Could not create the event.');
      setBusy(false);
    }
  }

  return (
    <Button onClick={create} disabled={busy}>
      <Plus className="size-4" />
      New event
    </Button>
  );
}

export function CopyLinkButton({ link }: { link: string }) {
  return (
    <Button variant="outline" onClick={() => copyLink(link)}>
      <Copy className="size-4" />
      Copy link
    </Button>
  );
}

export async function closeRegistration(
  id: string,
  refresh: () => void
): Promise<void> {
  try {
    const res = await fetch(`/api/sis/events/${id}/close`, { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? 'Could not close registration.');
      return;
    }
    toast.success('Registration closed.');
    refresh();
  } catch {
    toast.error('Could not close registration.');
  }
}

export function CloseRegistrationButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await closeRegistration(id, () => router.refresh());
        setBusy(false);
      }}
    >
      <Lock className="size-4" />
      Close registration
    </Button>
  );
}
