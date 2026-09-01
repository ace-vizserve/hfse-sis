'use client';

import { useMutation } from '@tanstack/react-query';
import { FileText, Merge, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { PASS_TYPES, type SlotMeta } from '@/lib/p-files/document-config';

/**
 * How long a replacement note is meant to be — the same 500 characters the
 * document-promise note allows, so the two notes on this module read as one
 * rule. It is guidance, not a gate: the counter turns red past it, and the
 * upload route stores whatever was typed. There is no schema for this note to
 * import the number from.
 */
const REPLACEMENT_NOTE_MAX = 500;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 30 MB
const ACCEPT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const ACCEPT_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function isAccepted(file: File): boolean {
  if (ACCEPT_TYPES.includes(file.type)) return true;
  const ext = file.name.toLowerCase().split('.').pop();
  return ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext ?? '');
}

type UploadDialogProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  expires: boolean;
  meta: SlotMeta | null;
  /** True when the slot already has a file — triggers "Replace" UX + note field. */
  isReplacement?: boolean;
  trigger?: React.ReactNode;
};

export function UploadDialog({
  enroleeNumber,
  slotKey,
  label,
  expires,
  meta,
  isReplacement,
  trigger,
}: UploadDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [expiryDate, setExpiryDate] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [passType, setPassType] = useState('');
  const [note, setNote] = useState('');

  function resetForm() {
    setSelectedFiles([]);
    setExpiryDate('');
    setPassportNumber('');
    setPassType('');
    setNote('');
    setDragging(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function addFiles(incoming: File[]) {
    const valid = incoming.filter(isAccepted);
    if (valid.length < incoming.length) {
      toast.error(
        'Some files were skipped — only PDF, JPG, and PNG are accepted'
      );
    }
    setSelectedFiles((prev) => [...prev, ...valid]);
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    // Reset the input so re-selecting the same file works
    if (fileRef.current) fileRef.current.value = '';
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) addFiles(files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Multipart/FormData upload. Pass the FormData body directly (no
  // content-type header, the browser sets the multipart boundary). Its bespoke
  // `body.error` surfaces via ApiError.message ('Upload failed').
  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) =>
      apiFetch<{ warning?: string }>(`/api/p-files/${enroleeNumber}/upload`, {
        method: 'POST',
        body: formData,
      }),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function upload(formData: FormData) {
    setBusy(true);
    await run(() => uploadMutation.mutateAsync(formData), {
      // Files are the slowest write in the app, so this one always earns its
      // pending toast.
      pending: `Uploading ${label}…`,
      // The route's `body.warning` means the file landed but something about it
      // needs saying — a merged PDF, a re-used slot. Raising it here and
      // returning `null` keeps the warning's own colour instead of dressing it
      // up as a plain success.
      success: (body) => {
        if (body.warning) {
          toast.warning(body.warning);
          return null;
        }
        return `${label} uploaded successfully`;
      },
      error: (err) => (err instanceof Error ? err.message : 'Upload failed'),
      onResolved: () => {
        setOpen(false);
        resetForm();
      },
    });
    setBusy(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      toast.error('Please select a file');
      return;
    }

    // Client-side validation: multi-file must all be PDFs
    if (selectedFiles.length > 1) {
      const nonPdf = selectedFiles.find((f) => !isPdf(f));
      if (nonPdf) {
        toast.error(
          'When uploading multiple files, all must be PDFs for merging'
        );
        return;
      }
    }

    // Size checks
    for (const file of selectedFiles) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" exceeds the 10 MB limit`);
        return;
      }
    }
    const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      toast.error('Total file size exceeds the 30 MB limit');
      return;
    }

    // Expiry required for expiring docs
    if (expires && !expiryDate) {
      toast.error('Expiry date is required for this document');
      return;
    }

    // Metadata required for passport/pass docs
    if (meta?.kind === 'passport' && !passportNumber.trim()) {
      toast.error('Passport / ID number is required');
      return;
    }
    if (meta?.kind === 'pass' && !passType) {
      toast.error('Pass type is required');
      return;
    }

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append('file', file);
    }
    formData.append('slotKey', slotKey);
    if (expiryDate) formData.append('expiryDate', expiryDate);
    if (meta?.kind === 'passport')
      formData.append('passportNumber', passportNumber.trim());
    if (meta?.kind === 'pass') formData.append('passType', passType);
    if (isReplacement && note.trim()) formData.append('note', note.trim());

    void upload(formData);
  }

  const hasFiles = selectedFiles.length > 0;
  const isMerge = selectedFiles.length > 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Upload className="size-3" />
            {isReplacement ? 'Replace' : 'Upload'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl!">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-serif tracking-tight">
              {isReplacement ? `Replace ${label}` : `Upload ${label}`}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              {isReplacement
                ? 'The current file will be archived and viewable via History. Drop multiple PDFs to merge them into one document.'
                : 'Upload on behalf of the parent. Drop multiple PDFs to merge them into one document.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            {/* ── Drop zone ── */}
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-foreground">
                Document{hasFiles && selectedFiles.length > 1 ? 's' : ''}
              </Label>

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileRef.current?.click();
                  }
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`group relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-all ${
                  dragging
                    ? 'border-primary bg-accent/80 shadow-sm'
                    : hasFiles
                      ? 'border-border/60 bg-muted/30 hover:border-primary/40 hover:bg-accent/40'
                      : 'border-border bg-muted/40 hover:border-primary/40 hover:bg-accent/40'
                }`}
              >
                <div
                  className={`flex size-10 items-center justify-center rounded-xl transition-colors ${
                    dragging
                      ? 'bg-primary text-primary-foreground shadow-brand-tile'
                      : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                  }`}
                >
                  <Upload className="size-5" />
                </div>

                {!hasFiles ? (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      {dragging
                        ? 'Drop files here'
                        : 'Click to browse or drag files here'}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      PDF, JPG, PNG · Max 10 MB per file
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click or drop to add more files
                  </p>
                )}

                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ACCEPT_EXTENSIONS}
                  className="hidden"
                  disabled={busy}
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {/* ── Selected files list ── */}
            {hasFiles && (
              <div className="space-y-2">
                {isMerge && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-accent/60 px-3 py-2">
                    <Merge className="size-3.5 shrink-0 text-primary" />
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                      {selectedFiles.length} PDFs will be merged into one
                    </p>
                  </div>
                )}
                <ul className="divide-y divide-border/50 rounded-lg border border-border/60 bg-background">
                  {selectedFiles.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 px-3 py-2">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                        {f.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="h-5 shrink-0 border-border bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground"
                      >
                        {formatSize(f.size)}
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(i);
                        }}
                        className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Passport number (passport slots only) ── */}
            {meta?.kind === 'passport' && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`passport-num-${slotKey}`}
                  className="text-[13px] font-medium text-foreground"
                >
                  Passport / ID number
                </Label>
                <Input
                  id={`passport-num-${slotKey}`}
                  type="text"
                  placeholder="e.g. E12345678"
                  value={passportNumber}
                  onChange={(e) => setPassportNumber(e.target.value)}
                  disabled={busy}
                  className="font-mono"
                />
              </div>
            )}

            {/* ── Pass type (pass slots only) ── */}
            {meta?.kind === 'pass' && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`pass-type-${slotKey}`}
                  className="text-[13px] font-medium text-foreground"
                >
                  Type of pass
                </Label>
                <Select
                  value={passType}
                  onValueChange={setPassType}
                  disabled={busy}
                >
                  <SelectTrigger id={`pass-type-${slotKey}`}>
                    <SelectValue placeholder="Select pass type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PASS_TYPES.map((pt) => (
                      <SelectItem key={pt} value={pt}>
                        {pt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ── Expiry date (all expiring docs) ── */}
            {expires && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`expiry-${slotKey}`}
                  className="text-[13px] font-medium text-foreground"
                >
                  Expiry date
                </Label>
                <DatePicker
                  id={`expiry-${slotKey}`}
                  value={expiryDate}
                  onChange={setExpiryDate}
                  disabled={busy}
                  placeholder="Select expiry date"
                />
                <p className="text-[11px] text-muted-foreground">
                  Required for expiring documents (passport, pass).
                </p>
              </div>
            )}

            {/* ── Replacement note (optional, only when replacing) ── */}
            {isReplacement && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`note-${slotKey}`}
                  className="text-[13px] font-medium text-foreground"
                >
                  Note{' '}
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Optional
                  </span>
                </Label>
                <RichTextEditor
                  id={`note-${slotKey}`}
                  value={note}
                  onChange={setNote}
                  disabled={busy}
                  placeholder="Why is this being replaced? e.g. Parent emailed an updated passport."
                  rows={2}
                  maxLength={REPLACEMENT_NOTE_MAX}
                />
                <p className="text-[11px] text-muted-foreground">
                  Shown in the History dialog alongside the archived file.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy}
              loadingText="Uploading…"
              disabled={!hasFiles}
            >
              {isMerge
                ? 'Merge & Upload'
                : isReplacement
                  ? 'Replace'
                  : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
