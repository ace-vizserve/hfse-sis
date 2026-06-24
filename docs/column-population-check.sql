-- Column-population fidelity check — are the surfaced dashboard/insights columns
-- actually filled in real data? Swap `ay2026` for the AY you want to check.
-- Run in the Supabase SQL editor (read-only). Compare each *_filled count to total_rows.
-- The biggest exposures are Query B (enrolee_type, app_updated_date) + Query C (expiry).

-- ── Query A — ay2026_enrolment_applications (parent-portal owned) ──────────────
select
  count(*)                                                           as total_rows,
  count("howDidYouKnowAboutHFSEIS")
    filter (where trim("howDidYouKnowAboutHFSEIS") <> '')            as referral_filled,
  count("feedbackRating")                                           as feedback_rating_filled,
  count("feedbackComments")
    filter (where trim("feedbackComments") <> '')                   as feedback_comments_filled,
  count("feedbackConsent")                                          as feedback_consent_filled,
  count("preCourseAnswer")
    filter (where trim("preCourseAnswer") <> '')                    as precourse_answer_filled,
  count(category) filter (where trim(category) <> '')                as category_filled,
  count("levelApplied") filter (where trim("levelApplied") <> '')    as level_applied_filled
from public.ay2026_enrolment_applications;

-- ── Query B — ay2026_enrolment_status (SIS-funnel owned) — RUN FIRST ───────────
select
  count(*)                                                          as total_rows,
  count("applicationStatus")                                       as app_status_filled,
  count("applicationUpdatedDate")                                  as app_updated_date_filled,   -- expect ~0
  count("enroleeType") filter (where trim("enroleeType") <> '')     as enrolee_type_filled,       -- expect low?
  count("applicationTerminalReason")                               as terminal_reason_filled,
  count("assessmentGradeMath")
    filter (where trim("assessmentGradeMath") <> '')               as assess_math_filled,
  count("assessmentGradeEnglish")
    filter (where trim("assessmentGradeEnglish") <> '')           as assess_english_filled,
  count("registrationUpdateDate")                                  as registration_date_filled,
  count("documentUpdatedDate")                                     as document_date_filled,
  count("assessmentUpdatedDate")                                   as assessment_date_filled,
  count("contractUpdatedDate")                                     as contract_date_filled,
  count("feeUpdatedDate")                                          as fee_date_filled,
  count("classUpdatedDate")                                        as class_date_filled,
  count("suppliesUpdatedDate")                                     as supplies_date_filled,
  count("orientationUpdatedDate")                                  as orientation_date_filled
from public.ay2026_enrolment_status;

-- ── Query C — ay2026_enrolment_documents (renewal dashboard inputs) — RUN FIRST ─
select
  count(*)                                                         as total_rows,
  count("passportExpiry")                                          as passport_exp_filled,
  count("passExpiry")                                              as pass_exp_filled,
  count("motherPassportExpiry")                                    as mother_passport_exp_filled,
  count("motherPassExpiry")                                        as mother_pass_exp_filled,
  count("fatherPassportExpiry")                                    as father_passport_exp_filled,
  count("fatherPassExpiry")                                        as father_pass_exp_filled,
  count("guardianPassportExpiry")                                  as guardian_passport_exp_filled,
  count("guardianPassExpiry")                                      as guardian_pass_exp_filled,
  count("passportStatus")  filter (where trim("passportStatus") <> '')  as passport_status_filled,
  count("medicalStatus")   filter (where trim("medicalStatus") <> '')   as medical_status_filled,
  count("idPictureStatus") filter (where trim("idPictureStatus") <> '') as idpic_status_filled
from public.ay2026_enrolment_documents;

-- ── Query D — public.section_students (Records, AY-scoped via sections join) ───
select
  count(*)                                                         as total_rows,
  count(ss.enrollment_status)                                      as status_filled,
  count(ss.enrollment_date)                                        as enroll_date_filled,
  count(*) filter (where ss.enrollment_status = 'withdrawn')       as withdrawn_rows,
  count(ss.withdrawal_date)
    filter (where ss.enrollment_status = 'withdrawn')              as withdrawal_date_of_withdrawn,
  count(ss.withdrawal_reason)
    filter (where ss.enrollment_status = 'withdrawn')              as withdrawal_reason_of_withdrawn,
  count(ss.late_enrollee_term_number)                              as late_term_filled,
  count(ss.enrolee_number)                                         as enrolee_number_filled,
  count(ss.index_number)                                           as index_number_filled
from public.section_students ss
join public.sections s        on s.id = ss.section_id
join public.academic_years ay on ay.id = s.academic_year_id
where ay.ay_code = 'AY2026';
