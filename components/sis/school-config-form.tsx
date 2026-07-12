'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReportCardLetterhead } from '@/components/report-card/report-card-letterhead';
import { ReportCardSignatureBlock } from '@/components/report-card/report-card-signature-block';
import type { SchoolConfig } from '@/lib/sis/school-config';

// Renders the ACTUAL letterhead + T4 signature-block components with the
// form's live values — reuses report-card-letterhead.tsx and the extracted
// report-card-signature-block.tsx verbatim (Task 11), so a missing field is
// visibly missing here in exactly the same way it will be on the real
// printed card, never a re-derived approximation.
export function SchoolConfigPreview({ config }: { config: SchoolConfig }) {
  return (
    <div className="rounded-xl border-2 border-hairline-strong bg-card p-4 shadow-sm">
      <ReportCardLetterhead config={config} />
      <ReportCardSignatureBlock
        isFinal
        formClassAdviser="Joann R."
        principalName={config.principalName}
        ceoName={config.ceoName}
      />
    </div>
  );
}

// School-wide settings form. Singleton row (id=1); patches via
// PATCH /api/sis/admin/school-config. Empty string clears a field.
export function SchoolConfigForm({ current }: { current: SchoolConfig }) {
  const router = useRouter();
  const [principal, setPrincipal] = useState(current.principalName);
  const [ceo, setCeo] = useState(current.ceoName);
  const [windowDays, setWindowDays] = useState(
    String(current.defaultPublishWindowDays)
  );
  const [compassionateDefault, setCompassionateDefault] = useState(
    String(current.defaultCompassionateAllowancePerYear)
  );
  const [vlDefault, setVlDefault] = useState(
    String(current.defaultVlAllowancePerTerm)
  );
  const [bronzeMin, setBronzeMin] = useState(
    String(current.subjectAwardBronzeMin)
  );
  const [silverMin, setSilverMin] = useState(
    String(current.subjectAwardSilverMin)
  );
  const [goldMin, setGoldMin] = useState(String(current.subjectAwardGoldMin));
  const [awardMax, setAwardMax] = useState(String(current.subjectAwardMax));
  // Letterhead fields (migration 054)
  const [orgName, setOrgName] = useState(current.organizationName);
  const [addr1, setAddr1] = useState(current.addressLine1);
  const [addr2, setAddr2] = useState(current.addressLine2);
  const [phone, setPhone] = useState(current.phoneNumber);
  const [website, setWebsite] = useState(current.websiteUrl);
  const [email, setEmail] = useState(current.contactEmail);
  const [pei, setPei] = useState(current.peiRegistrationNumber);
  const [peiStart, setPeiStart] = useState(
    current.peiRegistrationStartDate ?? ''
  );
  const [peiEnd, setPeiEnd] = useState(current.peiRegistrationEndDate ?? '');
  const [logoUrl, setLogoUrl] = useState(current.logoUrl);
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    principal !== current.principalName ||
    ceo !== current.ceoName ||
    String(current.defaultPublishWindowDays) !== windowDays ||
    String(current.defaultCompassionateAllowancePerYear) !==
      compassionateDefault ||
    String(current.defaultVlAllowancePerTerm) !== vlDefault ||
    String(current.subjectAwardBronzeMin) !== bronzeMin ||
    String(current.subjectAwardSilverMin) !== silverMin ||
    String(current.subjectAwardGoldMin) !== goldMin ||
    String(current.subjectAwardMax) !== awardMax ||
    orgName !== current.organizationName ||
    addr1 !== current.addressLine1 ||
    addr2 !== current.addressLine2 ||
    phone !== current.phoneNumber ||
    website !== current.websiteUrl ||
    email !== current.contactEmail ||
    pei !== current.peiRegistrationNumber ||
    peiStart !== (current.peiRegistrationStartDate ?? '') ||
    peiEnd !== (current.peiRegistrationEndDate ?? '') ||
    logoUrl !== current.logoUrl;

  async function save() {
    const days = Number(windowDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      toast.error('Publish window must be 1–365 days');
      return;
    }
    const compassionate = Number(compassionateDefault);
    if (
      !Number.isInteger(compassionate) ||
      compassionate < 0 ||
      compassionate > 30
    ) {
      toast.error('Compassionate leave must be 0–30 days');
      return;
    }
    const vl = Number(vlDefault);
    if (!Number.isInteger(vl) || vl < 0 || vl > 10) {
      toast.error('Vacation leave must be 0–10 days per term');
      return;
    }
    const bronze = Number(bronzeMin);
    const silver = Number(silverMin);
    const gold = Number(goldMin);
    const max = Number(awardMax);
    const validNumbers = [bronze, silver, gold, max].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 100
    );
    if (!validNumbers) {
      toast.error('Award thresholds must be between 0 and 100');
      return;
    }
    if (!(bronze < silver && silver < gold && gold <= max)) {
      toast.error(
        'Award thresholds must be strictly increasing — Bronze < Silver < Gold ≤ Max'
      );
      return;
    }
    if (peiStart && peiEnd && peiStart > peiEnd) {
      toast.error('Registration period start date must be before the end date');
      return;
    }
    const logoTrimmed = logoUrl.trim();
    if (logoTrimmed && !/^https?:\/\/.+/.test(logoTrimmed)) {
      toast.error('Logo URL must start with http:// or https://');
      return;
    }
    saveMutation.mutate({
      principalName: principal.trim(),
      ceoName: ceo.trim(),
      defaultPublishWindowDays: days,
      defaultCompassionateAllowancePerYear: compassionate,
      defaultVlAllowancePerTerm: vl,
      subjectAwardBronzeMin: bronze,
      subjectAwardSilverMin: silver,
      subjectAwardGoldMin: gold,
      subjectAwardMax: max,
      organizationName: orgName.trim(),
      addressLine1: addr1.trim(),
      addressLine2: addr2.trim(),
      phoneNumber: phone.trim(),
      websiteUrl: website.trim(),
      contactEmail: email.trim(),
      peiRegistrationNumber: pei.trim(),
      peiRegistrationStartDate: peiStart || null,
      peiRegistrationEndDate: peiEnd || null,
      logoUrl: logoTrimmed,
    });
  }

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch('/api/sis/admin/school-config', jsonInit('PATCH', payload)),
    onSuccess: () => {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      router.refresh();
    },
    onError: (e) => {
      // Preserve the original `body?.error ?? 'save failed'` fallback string.
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });
  const saving = saveMutation.isPending;

  // Assembled fresh each render from this form's own state so the preview
  // updates live as fields change (pure render, no debounce needed). Only
  // the letterhead + signature fields this preview reads are overridden;
  // everything else (attendance/award fields — not shown in the preview)
  // spreads unchanged from `current`.
  const liveConfig: SchoolConfig = {
    ...current,
    principalName: principal,
    ceoName: ceo,
    organizationName: orgName,
    addressLine1: addr1,
    addressLine2: addr2,
    phoneNumber: phone,
    websiteUrl: website,
    contactEmail: email,
    peiRegistrationNumber: pei,
    peiRegistrationStartDate: peiStart || null,
    peiRegistrationEndDate: peiEnd || null,
    logoUrl,
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <Tabs defaultValue="general">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="letterhead">Letterhead</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="awards">Awards</TabsTrigger>
          </TabsList>

          {/* ── General ── */}
          <TabsContent value="general" className="mt-6 space-y-6">
            <div className="space-y-4">
              <p className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
                Report-card signatures
              </p>
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
                    Shown under the Principal signature line on final (T4)
                    report cards.
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
                    Shown under the Founder &amp; CEO signature line on final
                    (T4) report cards.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-5">
              <p className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
                Publishing default
              </p>
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="windowDays">
                  Default publish window (days)
                </Label>
                <Input
                  id="windowDays"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={windowDays}
                  onChange={(e) =>
                    setWindowDays(
                      e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  Default for the publication window (1–365). Registrar can
                  override per publish.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* ── Letterhead ── */}
          <TabsContent value="letterhead" className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <p className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
                Organisation details
              </p>
              <p className="text-[13px] text-muted-foreground">
                These values appear on every printed report card and the
                parent-portal preview. Changes take effect immediately on the
                next report-card render.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="orgName">Organisation name</Label>
                <Input
                  id="orgName"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. HFSE Global Education Group"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="addr1">Address line 1</Label>
                <Input
                  id="addr1"
                  value={addr1}
                  onChange={(e) => setAddr1(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. 223 Mountbatten Road, #01-08, 223@Mountbatten"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="addr2">Address line 2</Label>
                <Input
                  id="addr2"
                  value={addr2}
                  onChange={(e) => setAddr2(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Singapore 398008"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. +65 6451 0080"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website">Website URL</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. https://hfse.edu.sg"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="contactEmail">Contact email</Label>
                <Input
                  id="contactEmail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. enquiry@hfse.edu.sg"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="logoUrl">Logo image URL</Label>
                <Input
                  id="logoUrl"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  maxLength={500}
                  placeholder="https://…  (leave blank to use the bundled HFSE wordmark)"
                />
                <p className="text-[11px] text-muted-foreground">
                  Paste a publicly accessible image URL. Leave blank to use the
                  default HFSE wordmark.
                </p>
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  PEI registration
                </p>
                <p className="text-[13px] text-muted-foreground">
                  The registration number and period shown on the bottom row of
                  the letterhead. Leave the dates blank to omit the period from
                  the printed header.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="pei">PEI registration number</Label>
                  <Input
                    id="pei"
                    value={pei}
                    onChange={(e) => setPei(e.target.value)}
                    maxLength={64}
                    placeholder="e.g. 201541283N"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="peiStart">Registration period · Start</Label>
                  <DatePicker
                    id="peiStart"
                    value={peiStart}
                    onChange={setPeiStart}
                    placeholder="Pick start date"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="peiEnd">Registration period · End</Label>
                  <DatePicker
                    id="peiEnd"
                    value={peiEnd}
                    onChange={setPeiEnd}
                    placeholder="Pick end date"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Attendance ── */}
          <TabsContent value="attendance" className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <p className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
                Leave allowances
              </p>
              <p className="text-[13px] text-muted-foreground">
                School-wide defaults for how many leave days each student gets.
                Individual students can be adjusted from their attendance
                profile.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="compassionateDefault">
                  Urgent / compassionate leave (days per year)
                </Label>
                <Input
                  id="compassionateDefault"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={compassionateDefault}
                  onChange={(e) =>
                    setCompassionateDefault(
                      e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  HFSE policy: 5 days per academic year. Used when no
                  per-student override is set.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vlDefault">
                  Vacation leave (days per term)
                </Label>
                <Input
                  id="vlDefault"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={vlDefault}
                  onChange={(e) =>
                    setVlDefault(
                      e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  HFSE policy: 1 per term (4 per year total). Unused days do not
                  carry forward.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* ── Awards ── */}
          <TabsContent value="awards" className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <p className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
                Award thresholds
              </p>
              <p className="text-[13px] text-muted-foreground">
                Score cut-offs for the Subject Award (per subject) and Overall
                Academic Award (per student). The same ladder applies to both.
                Thresholds must be strictly increasing: Bronze &lt; Silver &lt;
                Gold ≤ Max.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="bronzeMin">Bronze (min)</Label>
                <Input
                  id="bronzeMin"
                  type="text"
                  inputMode="decimal"
                  value={bronzeMin}
                  onChange={(e) =>
                    setBronzeMin(
                      e.target.value.replace(/[^0-9.]/g, '').slice(0, 5)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  Below this → Not eligible. Default 88.5.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="silverMin">Silver (min)</Label>
                <Input
                  id="silverMin"
                  type="text"
                  inputMode="decimal"
                  value={silverMin}
                  onChange={(e) =>
                    setSilverMin(
                      e.target.value.replace(/[^0-9.]/g, '').slice(0, 5)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  Bronze tops out below this. Default 91.5.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goldMin">Gold (min)</Label>
                <Input
                  id="goldMin"
                  type="text"
                  inputMode="decimal"
                  value={goldMin}
                  onChange={(e) =>
                    setGoldMin(
                      e.target.value.replace(/[^0-9.]/g, '').slice(0, 5)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  Silver tops out below this. Default 95.5.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="awardMax">Maximum</Label>
                <Input
                  id="awardMax"
                  type="text"
                  inputMode="decimal"
                  value={awardMax}
                  onChange={(e) =>
                    setAwardMax(
                      e.target.value.replace(/[^0-9.]/g, '').slice(0, 5)
                    )
                  }
                  className="text-right font-mono tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  Upper bound for Gold. Default 100.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Live preview
          </p>
          <SchoolConfigPreview config={liveConfig} />
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
