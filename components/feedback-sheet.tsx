'use client';

import { useState } from 'react';
import { ExternalLink, MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

// The school's Microsoft Form, embedded rather than linked so nobody has to
// leave the page they were working on to report what is wrong with it.
// Responses live in the form's own Responses tab — this app stores nothing,
// which is why there is no table, no API route and no schema behind this file.
//
// Plain constants rather than env vars: both are public URLs with nothing to
// protect and no per-environment variant.
const FORM_EMBED_URL =
  'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=b-yBnCdMQUybyTQSMoqylxtE6uf6nWFPjOy7MQf3paZUQ0RUQUo2SE5MUjRaTFRaNTBKTDQwM084MS4u&embed=true';
const FORM_PAGE_URL = 'https://forms.cloud.microsoft/r/0ZZZYb45w8';

/**
 * "Feedback" in the header of every module.
 *
 * Deliberately a labelled outline button and not an icon: every other control
 * in that bar is a bare grey glyph, and a feedback form nobody notices collects
 * nothing. Outline rather than the default variant because the default carries
 * the Aurora Vault gradient, and one primary CTA per page (09-design-system.md
 * §2.3) belongs to the page underneath, not to the chrome.
 */
export function FeedbackSheet() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquarePlus aria-hidden />
          {/* Icon-only below sm — the header is tight on a phone, and this is
              a desktop tool. The accessible name survives either way. */}
          <span className="hidden sm:inline">Feedback</span>
          <span className="sr-only sm:hidden">Send feedback</span>
        </Button>
      </SheetTrigger>

      {/* `flex flex-col` is required: sheetVariants is a plain block with
          h-full, so the frame's `flex-1` would otherwise be inert and the
          footer would fall off the bottom (components/ui/sheet.tsx:29).

          `sm:max-w-none` is deliberate, and has to be written out rather than
          simply omitted: the `right` variant ships `w-3/4 sm:max-w-md`, so
          leaving it off caps the drawer at 448px. Full width is the point —
          the form gets the whole screen. */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-[23px] font-semibold tracking-tight">
            Send feedback
          </SheetTitle>
        </SheetHeader>

        {/* Mounted only while open, so a closed drawer costs nothing (KD #56)
            and a half-typed report never surfaces in somebody's next session.
            ⚠ `min-h-0` is load-bearing: a flex child defaults to
            min-height:auto and refuses to shrink, which pushes the footer
            below the fold. */}
        {open && (
          <iframe
            loading="lazy"
            src={FORM_EMBED_URL}
            title="Report a problem or suggest an idea"
            className="min-h-0 flex-1 border-0"
            allowFullScreen
          />
        )}

        {/* ⚠ NOT decoration. The form requires a Microsoft sign-in, and
            Microsoft's login page refuses to render inside a frame — so
            somebody without a live M365 session in this browser sees a blank
            white box and no explanation. Most staff arrive already signed in
            from Outlook or Teams and never meet this; the ones who do need a
            way out that does not involve asking whether the SIS is broken. */}
        <div className="border-t border-border px-6 py-3">
          <a
            href={FORM_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Form not loading? Open it in a new tab
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
