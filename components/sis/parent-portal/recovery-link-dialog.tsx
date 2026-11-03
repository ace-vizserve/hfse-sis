'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Check,
  CircleCheck,
  Copy,
  Link2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import type {
  RecoveryCheckResult,
  RecoveryLinkResult,
} from '@/lib/parent-portal/recovery';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  RECOVERY_SECTION_LABEL,
  RECOVERY_SECTIONS,
  RecoveryRecipientsSchema,
  type RecoverySection,
} from '@/lib/schemas/parent-portal';

const ROUTE = '/api/sis/admin/parent-portal/recovery-link';

type IncompleteRecord = Extract<RecoveryCheckResult, { category: string }>;

export function CopyLinkButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy the link. Select it and copy it by hand.');
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function RecordBadge({
  label,
  present,
  incomplete = false,
}: {
  label: string;
  present: boolean;
  incomplete?: boolean;
}) {
  if (present && !incomplete) {
    return (
      <Badge
        variant="outline"
        className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
      >
        <Check className="h-3 w-3" />
        {label}: on file
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
    >
      <X className="h-3 w-3" />
      {label}: {incomplete ? 'not finished' : 'missing'}
    </Badge>
  );
}

function StatusPanel({
  tone,
  title,
  children,
}: {
  tone: 'healthy' | 'caution' | 'failed';
  title: string;
  children: ReactNode;
}) {
  const Icon = tone === 'healthy' ? CircleCheck : TriangleAlert;
  const panel = {
    healthy: 'border-brand-mint bg-brand-mint/10',
    caution: 'border-brand-amber/45 bg-brand-amber/10',
    failed: 'border-destructive/30 bg-destructive/5',
  }[tone];
  const tile = {
    healthy: 'bg-brand-mint text-ink',
    caution: 'bg-brand-amber text-ink',
    failed: 'bg-destructive text-destructive-foreground',
  }[tone];
  return (
    <div className={`flex items-start gap-4 rounded-xl border p-5 ${panel}`}>
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl shadow-brand-tile ${tile}`}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-serif text-base font-semibold text-foreground">
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

function GeneratedLinkPanel({
  link,
  sentTo,
}: {
  link: RecoveryLinkResult;
  sentTo: string;
}) {
  const sections = link.sections
    .map((section) => RECOVERY_SECTION_LABEL[section].toLowerCase())
    .join(', ');
  return (
    <StatusPanel
      tone={link.emailSent ? 'healthy' : 'caution'}
      title={
        link.emailSent ? 'Link made and emailed' : 'Link made, not emailed'
      }
    >
      <div className="flex items-center gap-2">
        <Input
          readOnly
          aria-label="Recovery link"
          className="min-w-0 flex-1 font-mono text-[11px]"
          value={link.url}
          onFocus={(e) => e.target.select()}
        />
        <CopyLinkButton url={link.url} label="Copy" />
      </div>
      {link.emailSent ? (
        <p className="text-sm text-muted-foreground">Emailed to {sentTo}.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {link.emailError ?? 'The email could not be sent.'} Copy the link and
          send it to the family yourself.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        It lasts 7 days and asks for {sections}.
      </p>
    </StatusPanel>
  );
}

function CloseFooter() {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="outline">
          Close
        </Button>
      </DialogClose>
    </DialogFooter>
  );
}

function IncompleteRecordForm({
  record,
  saving,
  onSavingChange,
  onGenerated,
}: {
  record: IncompleteRecord;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onGenerated: (link: RecoveryLinkResult, sentTo: string) => void;
}) {
  const [sections, setSections] = useState<Set<RecoverySection>>(
    () => new Set(record.suggestedSections)
  );
  const [recipients, setRecipients] = useState(record.knownEmails ?? '');

  const run = useWriteAction();
  const mutation = useMutation({
    mutationFn: (values: {
      action: 'generate';
      enroleeNumber: string;
      sections?: RecoverySection[];
      recipientEmails: string;
    }) => apiFetch<RecoveryLinkResult>(ROUTE, jsonInit('POST', values)),
  });

  const applicationExists = record.present.applications;
  const parsedRecipients = RecoveryRecipientsSchema.safeParse(recipients);
  const recipientsError =
    recipients.trim() && !parsedRecipients.success
      ? parsedRecipients.error.issues[0]?.message
      : null;
  const canGenerate =
    parsedRecipients.success && (!applicationExists || sections.size > 0);

  function toggleSection(section: RecoverySection, checked: boolean) {
    setSections((current) => {
      const next = new Set(current);
      if (checked) next.add(section);
      else next.delete(section);
      return next;
    });
  }

  async function generate() {
    onSavingChange(true);
    await run(
      () =>
        mutation.mutateAsync({
          action: 'generate',
          enroleeNumber: record.enroleeNumber,
          // In the portal's order, whatever order they were ticked in.
          sections: applicationExists
            ? RECOVERY_SECTIONS.filter((section) => sections.has(section))
            : undefined,
          recipientEmails: recipients,
        }),
      {
        pending: 'Making the link…',
        // The panel says it when the email failed, with the link to copy.
        success: (link) =>
          link.emailSent
            ? {
                title: 'Link made and emailed',
                description: `Sent to ${recipients.trim()}.`,
              }
            : null,
        onResolved: (link) => onGenerated(link, recipients.trim()),
        // The table reads this year's rows itself; the dialog reloads them.
        refresh: false,
      }
    );
    onSavingChange(false);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <RecordBadge
          label="Application"
          present={record.present.applications}
          incomplete={record.applicationsIncomplete}
        />
        <RecordBadge label="Documents" present={record.present.documents} />
        <RecordBadge label="Status" present={record.present.status} />
      </div>

      <FieldGroup>
        {applicationExists ? (
          <Field>
            <FieldLabel>What should the family complete?</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {RECOVERY_SECTIONS.map((section) => (
                <label
                  key={section}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Checkbox
                    checked={sections.has(section)}
                    onCheckedChange={(checked) =>
                      toggleSection(section, checked === true)
                    }
                  />
                  {RECOVERY_SECTION_LABEL[section]}
                </label>
              ))}
            </div>
            <FieldDescription>
              {sections.size === 0
                ? 'Choose at least one.'
                : 'Ticked for you where something is missing.'}
            </FieldDescription>
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">
            There is no application on file, so the link asks the family for all
            of it.
          </p>
        )}

        <Field data-invalid={!!recipientsError}>
          <FieldLabel htmlFor="recovery-recipients">Send to</FieldLabel>
          <Input
            id="recovery-recipients"
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!recipientsError}
            placeholder="mother@example.com, father@example.com"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
          {recipientsError ? (
            <FieldError>{recipientsError}</FieldError>
          ) : (
            <FieldDescription>
              {record.knownEmails
                ? 'From what is on file. Check them before sending, with a comma between addresses.'
                : 'No email on file for this student. Put a comma between addresses.'}
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={saving}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={!canGenerate}
          loading={saving}
          loadingText="Making the link…"
          onClick={() => void generate()}
        >
          {!saving && <Link2 />}
          Generate and send
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Checks the record the moment it opens. The caller remounts this per opening,
 * so each one starts from a fresh answer.
 */
export function RecoveryLinkDialog({
  student,
  open,
  onOpenChange,
  onChanged,
}: {
  student: { enroleeNumber: string; name: string; linkUrl?: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A link was made, so the table's link status has moved on. */
  onChanged: () => void | Promise<unknown>;
}) {
  const { enroleeNumber, name } = student;
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [record, setRecord] = useState<RecoveryCheckResult | null>(null);
  const [generated, setGenerated] = useState<{
    link: RecoveryLinkResult;
    sentTo: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const run = useWriteAction();
  const mutation = useMutation({
    mutationFn: (values: { action: 'check'; enroleeNumber: string }) =>
      apiFetch<RecoveryCheckResult>(ROUTE, jsonInit('POST', values)),
  });

  async function check() {
    setChecking(true);
    setCheckError(null);
    await run(() => mutation.mutateAsync({ action: 'check', enroleeNumber }), {
      pending: 'Checking the record…',
      // A check changes nothing. The answer appears in the dialog.
      success: () => null,
      error: (err) => {
        setCheckError(
          err instanceof Error ? err.message : 'Could not check the record.'
        );
        return null;
      },
      onResolved: setRecord,
      refresh: false,
    });
    setChecking(false);
  }

  // Once per opening, including under React's double-run in development.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Send recovery link
          </DialogTitle>
          <DialogDescription>
            {name}, <span className="font-mono text-xs">{enroleeNumber}</span>
            {record && record.complete !== true ? `, ${record.category}` : ''}
          </DialogDescription>
        </DialogHeader>

        {student.linkUrl && !generated && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm text-muted-foreground">
            This student already has a link waiting.
            <CopyLinkButton url={student.linkUrl} label="Copy link" />
          </div>
        )}

        {checking ? (
          <div className="space-y-3" aria-label="Checking the record">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : checkError ? (
          <>
            <StatusPanel tone="failed" title="Could not check this record">
              <p className="text-sm text-muted-foreground">{checkError}</p>
            </StatusPanel>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Close
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="outline"
                onClick={() => void check()}
              >
                Try again
              </Button>
            </DialogFooter>
          </>
        ) : generated ? (
          <>
            <GeneratedLinkPanel
              link={generated.link}
              sentTo={generated.sentTo}
            />
            <CloseFooter />
          </>
        ) : record?.complete === true ? (
          <>
            <StatusPanel tone="healthy" title="Nothing is missing">
              <p className="text-sm text-muted-foreground">
                The application, documents and status records for{' '}
                {record.enroleeNumber} are all on file and complete, so there is
                nothing to send.
              </p>
            </StatusPanel>
            <CloseFooter />
          </>
        ) : record ? (
          <IncompleteRecordForm
            record={record}
            saving={saving}
            onSavingChange={setSaving}
            onGenerated={(link, sentTo) => {
              setGenerated({ link, sentTo });
              void onChanged();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
