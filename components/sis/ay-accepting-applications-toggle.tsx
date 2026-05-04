"use client";

import { Loader2, MailCheck, MailX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Tiny inline toggle for the AY list row — flips `accepting_applications`
// post-creation per KD #77. Admin / superadmin only on the surface, but
// the API enforces the role gate too.
//
// Idempotent: if the value already matches, the API returns ok+unchanged
// and the button just re-renders without a refresh.
export function AyAcceptingApplicationsToggle({
  ayCode,
  current,
  isCurrentAy,
}: {
  ayCode: string;
  current: boolean;
  isCurrentAy: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/sis/ay-setup/accepting-applications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ay_code: ayCode, accepting: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "toggle failed");
      toast.success(
        next
          ? `${ayCode} now accepting applications — appears in the Admissions sidebar.`
          : `${ayCode} closed for new applications.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "toggle failed");
    } finally {
      setBusy(false);
    }
  }

  // Closing applications on the *current* AY is unusual and would block
  // mid-year transfers via the parent portal — guard with a clear hint.
  const guardCloseCurrent = isCurrentAy && current;

  return (
    <Button
      type="button"
      size="sm"
      variant={current ? "default" : "outline"}
      disabled={busy}
      onClick={() => flip(!current)}
      title={
        guardCloseCurrent
          ? "Closing the current AY blocks the parent portal — do this only at AY rollover."
          : current
            ? "Click to close: parent portal will reject new applications for this AY."
            : "Click to open: parent portal accepts applications + AY surfaces in Admissions sidebar."
      }>
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : current ? (
        <MailCheck className="size-3.5" />
      ) : (
        <MailX className="size-3.5" />
      )}
      {current ? "Open for apps" : "Closed"}
    </Button>
  );
}
