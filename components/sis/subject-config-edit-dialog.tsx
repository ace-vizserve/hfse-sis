'use client';

import { Scale } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SubjectConfigForm,
  type SubjectConfigFormDraft,
  type SubjectConfigFormSubject,
  type SubjectConfigDraft as SubjectConfigFormDraftAlias,
  type SubjectOption,
} from '@/components/sis/subject-config-form';

// Task 2 of the "Unified Subject Setup page" plan refactored this file's
// field state + mutations OUT into `components/sis/subject-config-form.tsx`
// (`SubjectConfigForm`) — the shared component now also renders inline
// (Step ①'s "needs attention" quick-fix) and in a Sheet drawer (Step ①'s
// per-row full Edit). This file is now pure Dialog CHROME: header, body =
// `<SubjectConfigForm>`, no footer (the form owns its own Save button for
// weights; grade type / grading method / reports-to auto-save). Behavior
// for both existing call sites (the Advanced-tab level tree's drag-drop
// tree + "All subjects" monitoring table, both in
// `components/sis/subject-level-tree.tsx`) is unchanged — same props, same
// open/save/close flow, same toasts — this is a pure extraction, not a
// redesign.

// Re-exported under the pre-extraction name so existing imports
// (`subject-level-tree.tsx`) keep working unchanged.
export type SubjectConfigDraft = SubjectConfigFormDraftAlias;

export function SubjectConfigEditDialog({
  draft,
  open,
  onOpenChange,
  subjects,
}: {
  draft: SubjectConfigFormDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: SubjectOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {/* §7.4 gradient icon tile — anchors the dialog's purpose visually. */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Scale className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {draft ? draft.ayCode : 'Subject weights'}
              </p>
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                {draft ? draft.name : 'Subject weights'}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                {draft
                  ? 'Changes apply to every grading sheet for this subject in every level it teaches. Locked sheets are not changed.'
                  : 'Pick a subject to edit.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {draft && (
          <SubjectConfigForm
            mode="edit"
            draft={draft}
            subjects={subjects}
            onSaved={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Create-weights dialog — opens from a subject chip attached to a level
// with no `subject_configs` row yet for this AY. Mirrors
// TemplateSubjectConfigCreateDialog's blank-start behavior (no
// level-profile auto-fill — weight is a property of the subject, not any
// one level, so there's no single level context to derive a default from
// even when the chip that opened it happens to live under one level).
// =====================================================================

export function SubjectConfigCreateDialog({
  subject,
  ayId,
  ayCode,
  open,
  onOpenChange,
}: {
  subject: SubjectConfigFormSubject | null;
  ayId: string;
  ayCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
              <Scale className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {ayCode}
              </p>
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                {subject ? `Set weights for ${subject.name}` : 'Set weights'}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                Applies to every level this subject is attached to in {ayCode}.
                Used the moment a grading sheet is generated.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {subject && (
          <SubjectConfigForm
            mode="create"
            subject={subject}
            ayId={ayId}
            ayCode={ayCode}
            subjects={[]}
            onSaved={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
