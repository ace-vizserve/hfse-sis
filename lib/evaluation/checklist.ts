import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Server-only reads for Evaluation Phase 2 (checklists, subject comments,
// PTC feedback). Writes go through the API routes under /api/evaluation/*.

export type ChecklistItemRow = {
  id: string;
  term_id: string;
  subject_id: string;
  level_id: string;
  item_text: string;
  sort_order: number;
};

export type ChecklistResponseRow = {
  id: string;
  term_id: string;
  student_id: string;
  section_id: string;
  checklist_item_id: string;
  is_checked: boolean;
};

export type SubjectCommentRow = {
  id: string;
  term_id: string;
  student_id: string;
  section_id: string;
  subject_id: string;
  comment: string | null;
};

export type PtcFeedbackRow = {
  id: string;
  term_id: string;
  student_id: string;
  section_id: string;
  feedback: string | null;
};

// List checklist items for one (term × subject × level). Used by the
// SIS Admin editor and the subject-teacher tick UI.
export async function listChecklistItems(
  termId: string,
  subjectId: string,
  levelId: string,
): Promise<ChecklistItemRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('evaluation_checklist_items')
    .select('id, term_id, subject_id, level_id, item_text, sort_order')
    .eq('term_id', termId)
    .eq('subject_id', subjectId)
    .eq('level_id', levelId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[evaluation] listChecklistItems failed:', error.message);
    return [];
  }
  return (data ?? []) as ChecklistItemRow[];
}

// Load all responses for a section × term. Keyed by (student, item) for
// fast grid lookup.
export async function getResponsesBySectionTerm(
  sectionId: string,
  termId: string,
): Promise<Map<string, ChecklistResponseRow>> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('evaluation_checklist_responses')
    .select('id, term_id, student_id, section_id, checklist_item_id, is_checked')
    .eq('section_id', sectionId)
    .eq('term_id', termId);
  const map = new Map<string, ChecklistResponseRow>();
  if (error) {
    console.error('[evaluation] getResponsesBySectionTerm failed:', error.message);
    return map;
  }
  for (const r of (data ?? []) as ChecklistResponseRow[]) {
    map.set(`${r.student_id}|${r.checklist_item_id}`, r);
  }
  return map;
}

export async function getSubjectCommentsBySectionTerm(
  sectionId: string,
  termId: string,
  subjectId: string,
): Promise<Map<string, SubjectCommentRow>> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('evaluation_subject_comments')
    .select('id, term_id, student_id, section_id, subject_id, comment')
    .eq('section_id', sectionId)
    .eq('term_id', termId)
    .eq('subject_id', subjectId);
  const map = new Map<string, SubjectCommentRow>();
  if (error) {
    console.error('[evaluation] getSubjectCommentsBySectionTerm failed:', error.message);
    return map;
  }
  for (const r of (data ?? []) as SubjectCommentRow[]) {
    map.set(r.student_id, r);
  }
  return map;
}

export async function getPtcFeedbackBySectionTerm(
  sectionId: string,
  termId: string,
): Promise<Map<string, PtcFeedbackRow>> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('evaluation_ptc_feedback')
    .select('id, term_id, student_id, section_id, feedback')
    .eq('section_id', sectionId)
    .eq('term_id', termId);
  const map = new Map<string, PtcFeedbackRow>();
  if (error) {
    console.error('[evaluation] getPtcFeedbackBySectionTerm failed:', error.message);
    return map;
  }
  for (const r of (data ?? []) as PtcFeedbackRow[]) {
    map.set(r.student_id, r);
  }
  return map;
}

// For the subject-teacher gate: which (section × subject) pairs does this
// teacher teach? Used to scope what the Checklists tab shows on
// /evaluation/sections/[sectionId] — a teacher only sees the subject(s)
// they're assigned to for that section.
export async function listTeacherSubjectsForSection(
  userId: string,
  sectionId: string,
): Promise<string[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('teacher_assignments')
    .select('subject_id')
    .eq('teacher_user_id', userId)
    .eq('section_id', sectionId)
    .eq('role', 'subject_teacher');
  if (error) return [];
  return ((data ?? []) as Array<{ subject_id: string | null }>)
    .map((r) => r.subject_id)
    .filter((s): s is string => !!s);
}
