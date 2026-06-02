'use client';

import { Loader2, Mail, MailX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Admissions early-bird control (KD #77). Opens / switches / closes the single
// upcoming AY that accepts applications. The flip itself is school_admin+ only
// (canManage); other roles see a read-only state. When no future AY exists,
// the only pointer to SIS Admin (for AY creation) is shown.

export type EarlyBirdCandidate = { ayCode: string; label: string };

export function EarlyBirdAyControl({
  candidates,
  openAyCode,
  canManage,
}: {
  candidates: EarlyBirdCandidate[];
  openAyCode: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string>(openAyCode ?? '');

  async function flip(ayCode: string, accepting: boolean) {
    setBusy(true);
    try {
      const res = await fetch('/api/sis/ay-setup/accepting-applications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ay_code: ayCode, accepting }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Update failed');
      toast.success(
        accepting
          ? `Early-bird applications open for ${ayCode}.`
          : `Early-bird applications closed for ${ayCode}.`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = (
    <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
      Early-bird applications
    </CardDescription>
  );

  // No future AY exists → the only pointer to SIS Admin (for creation).
  if (candidates.length === 0) {
    return (
      <Card>
        <CardHeader>
          {eyebrow}
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            No future academic year yet
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Create the upcoming year first, then come back here to open
          early-bird.{' '}
          <Link
            href="/sis/ay-setup"
            className="font-medium text-primary underline underline-offset-2"
          >
            Go to AY Setup →
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Read-only for non-managers (admissions / registrar).
  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          {eyebrow}
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {openAyCode ? `Open for ${openAyCode}` : 'No upcoming year is open'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask an administrator to open or change the early-bird year.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        {eyebrow}
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {openAyCode ? `Open for ${openAyCode}` : 'No upcoming year is open'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Select value={picked} onValueChange={setPicked} disabled={busy}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Pick a future year" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.ayCode} value={c.ayCode}>
                {c.label} ({c.ayCode})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          disabled={busy || !picked || picked === openAyCode}
          onClick={() => flip(picked, true)}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          {openAyCode ? 'Switch to this year' : 'Open early-bird'}
        </Button>
        {openAyCode && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => flip(openAyCode, false)}
          >
            <MailX className="size-4" />
            Close early-bird
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
