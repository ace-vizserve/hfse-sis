'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SchoolConfig } from '@/lib/sis/school-config';

// School-wide settings form. Singleton row (id=1); patches via
// PATCH /api/sis/admin/school-config. Empty string clears a field.
export function SchoolConfigForm({ current }: { current: SchoolConfig }) {
  const router = useRouter();
  const [principal, setPrincipal] = useState(current.principalName);
  const [ceo, setCeo] = useState(current.ceoName);
  const [pei, setPei] = useState(current.peiRegistrationNumber);
  const [windowDays, setWindowDays] = useState(
    String(current.defaultPublishWindowDays),
  );
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    principal !== current.principalName ||
    ceo !== current.ceoName ||
    pei !== current.peiRegistrationNumber ||
    String(current.defaultPublishWindowDays) !== windowDays;

  async function save() {
    const days = Number(windowDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      toast.error('Publish window must be 1–365 days');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/sis/admin/school-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          principalName: principal.trim(),
          ceoName: ceo.trim(),
          peiRegistrationNumber: pei.trim(),
          defaultPublishWindowDays: days,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'save failed');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="principal">School Principal name</Label>
          <Input
            id="principal"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            maxLength={120}
            placeholder="e.g. Dr Jane Smith"
          />
          <p className="text-[11px] text-muted-foreground">
            Shown under the Principal signature line on final (T4) report cards.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ceo">Founder &amp; CEO name</Label>
          <Input
            id="ceo"
            value={ceo}
            onChange={(e) => setCeo(e.target.value)}
            maxLength={120}
            placeholder="e.g. John Doe"
          />
          <p className="text-[11px] text-muted-foreground">
            Shown under the Founder &amp; CEO signature line on final (T4) report cards.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pei">PEI registration number</Label>
          <Input
            id="pei"
            value={pei}
            onChange={(e) => setPei(e.target.value)}
            maxLength={64}
            placeholder="e.g. 200512345K"
          />
          <p className="text-[11px] text-muted-foreground">
            Rendered as a subtle line under the report-card title.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="windowDays">Default publish window (days)</Label>
          <Input
            id="windowDays"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={windowDays}
            onChange={(e) =>
              setWindowDays(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))
            }
            className="text-right font-mono tabular-nums"
          />
          <p className="text-[11px] text-muted-foreground">
            Default for the publication window (1–365). Registrar can override per publish.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {justSaved && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-primary">
            <CheckCircle2 className="size-3.5" /> Saved
          </span>
        )}
        <Button type="submit" disabled={saving || !dirty} className="gap-1.5">
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
