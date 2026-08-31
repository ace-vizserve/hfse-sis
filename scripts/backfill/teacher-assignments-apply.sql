-- AY2026 teacher assignments, generated from
-- Teachers Deployment_Updated 29 Jun 26_Teacherscopy (1).xlsx
-- 123 rows. 11 skipped — see the generator report.
--
-- Not included, deliberately:
--   adviser SECONDARY FOUR EXCELLENCE — names more than one person: Ms Med & Ms Elaine
--   PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS) — Mother Tongue (Mandarin): no account for "- Jasmine"
--   PRIMARY TWO HONESTY - MORNING (GLOBAL CLASS) — Mother Tongue (Mandarin): no account for "- Jasmine"
--   PRIMARY TWO HUMILITY - MORNING (STANDARD) — STAR: shared by Ms Jing + Mr Hanafi — name the teacher of record
--   P3RIMARY THREE COURTESY - MORNING (GLOBAL) — Mother Tongue (Mandarin): no account for "Ms Li"
--   PRIMARY FOUR DILIGENCE - MORNING (GLOBAL) — Mother Tongue: no account for "Ms Li"
--   PRIMARY FOUR DILIGENCE - MORNING (GLOBAL) — STAR (Sports, Talent, Arts and Rhythm): shared by Ms Jing + Mr Hanafi — name the teacher of record
--   PRIMARY FIVE COMMITMENT- MORNING (GLOBAL CLASS) — "Mother Tongue": section holds 2 language sheets (MANDARIN, FIL) — cannot tell which language this slot means
--   SECONDARY THREE CONSISTENCY — English: no account for "Relief Teacher"
--   SECONDARY THREE CONSISTENCY — Humanities: shared by Ms.Elaine + Ms.Carl — name the teacher of record
--   SECONDARY FOUR EXCELLENCE — Humanities: shared by Ms Elaine + Ms.Carl — name the teacher of record

begin;

insert into public.teacher_assignments
  (teacher_user_id, section_id, subject_id, role)
values
  -- PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS) — Ms Kristel
  ('90732eae-2846-4a50-be97-627489bd624e'::uuid, '286ab5fe-7295-4217-86a7-e7c0ad61033d'::uuid, null, 'form_adviser'),
  -- PRIMARY ONE OBEDIENCE - MORNING (STANDARD) — Ms Arlene
  ('47707b1d-ce0e-424e-a659-b89c9458aab7'::uuid, '026b6164-3a28-4018-9d78-fe33c829c5e0'::uuid, null, 'form_adviser'),
  -- PRIMARY TWO HONESTY - MORNING (GLOBAL CLASS) — Ms Shaf
  ('8a65baf9-ad1c-489e-8fec-e4e39694657e'::uuid, '39036083-dec0-4a50-a042-be9f378d9f7d'::uuid, null, 'form_adviser'),
  -- PRIMARY TWO HUMILITY - MORNING (STANDARD) — Mr Wai
  ('8b84dca5-4669-451c-b2ac-d37b74d9157e'::uuid, '6cd76da2-7951-488a-916b-ef8bf57f5fdd'::uuid, null, 'form_adviser'),
  -- P3RIMARY THREE COURTESY - MORNING (GLOBAL) — Ms Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, '861a8d20-fe8c-4796-af21-d874d3e75725'::uuid, null, 'form_adviser'),
  -- PRIMARY THREE COURAGEOUS - MORNING — Ms Jenny
  ('8cf450f7-5a81-4101-81dc-b412554beea6'::uuid, 'b8af4f08-47cd-4715-a3f6-ce1c70ad83a4'::uuid, null, 'form_adviser'),
  -- PRIMARY THREE RESPONSIBILITY - AFTERNOON (STANDARD) — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '9774dac2-0796-40f3-961f-04db042fa805'::uuid, null, 'form_adviser'),
  -- PRIMARY FOUR DILIGENCE - MORNING (GLOBAL) — Ms Aida
  ('f8de6706-e89e-41c1-b29c-da119c466ef6'::uuid, 'a37b469e-8fa5-4a7d-b731-dbfa87549a97'::uuid, null, 'form_adviser'),
  -- PRIMARY FOUR TRUST- AM — Ms Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, '06836e47-8df0-4221-86eb-4c101d906b48'::uuid, null, 'form_adviser'),
  -- PRIMARY FIVE COMMITMENT- MORNING (GLOBAL CLASS) — Mr Joseph
  ('588c57c3-0940-4fab-a381-d62606288c98'::uuid, 'c447af0c-3213-4f60-830b-f900bfe93c2d'::uuid, null, 'form_adviser'),
  -- PRIMARY FIVE TENACITY - MORNING (STANDARD CLASS) — Ms Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, 'e0335890-590a-4e31-a891-b1250c3a07a8'::uuid, null, 'form_adviser'),
  -- PRIMARY FIVE PERSEVERANCE- AFTERNOON — Ms Melissa
  ('3671352d-b309-4c2c-a8b2-59db31341d37'::uuid, 'ba2ff320-53d3-488e-9bff-5c6561341c77'::uuid, null, 'form_adviser'),
  -- PRIMARY SIX GRIT- MORNING — Ms Parmi
  ('ee210a6a-abbc-446b-a61f-d5cfda6d9f11'::uuid, 'c42cff36-b096-4309-883b-d0894cc1b823'::uuid, null, 'form_adviser'),
  -- PRIMARY SIX LOYALTY - MORNING — Ms Lhen
  ('2b582646-cee5-405d-acbf-6f1ac1f3104e'::uuid, 'c48c811f-2435-46e4-8ac1-2e5448832a06'::uuid, null, 'form_adviser'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Ms Sharon
  ('e1e0bad5-9d9f-48f2-9188-147041821248'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, null, 'form_adviser'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Ms Carl
  ('7e6e95a0-4df8-4669-8a7b-00a85873e0f9'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, null, 'form_adviser'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Ms Tina
  ('d40c11c8-453c-4eb7-92ca-1c0b1d34337d'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, null, 'form_adviser'),
  -- SECONDARY THREE CONSISTENCY — Ms Koh
  ('f33d4e4a-7ae2-410b-8e90-7927cc5147b2'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, null, 'form_adviser'),
  -- PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS) — STAR — Ms Arlene
  ('47707b1d-ce0e-424e-a659-b89c9458aab7'::uuid, '286ab5fe-7295-4217-86a7-e7c0ad61033d'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS) — Science — Ms Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, '286ab5fe-7295-4217-86a7-e7c0ad61033d'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS) — Mathematics — Mr Wai
  ('8b84dca5-4669-451c-b2ac-d37b74d9157e'::uuid, '286ab5fe-7295-4217-86a7-e7c0ad61033d'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS) — English — Ms Kristel
  ('90732eae-2846-4a50-be97-627489bd624e'::uuid, '286ab5fe-7295-4217-86a7-e7c0ad61033d'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY ONE OBEDIENCE - MORNING (STANDARD) — English — Ms Carl
  ('7e6e95a0-4df8-4669-8a7b-00a85873e0f9'::uuid, '026b6164-3a28-4018-9d78-fe33c829c5e0'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY ONE OBEDIENCE - MORNING (STANDARD) — Mother Tongue (Filipino) — Ms Arlene
  ('47707b1d-ce0e-424e-a659-b89c9458aab7'::uuid, '026b6164-3a28-4018-9d78-fe33c829c5e0'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY ONE OBEDIENCE - MORNING (STANDARD) — Science — Ms. Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '026b6164-3a28-4018-9d78-fe33c829c5e0'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY ONE OBEDIENCE - MORNING (STANDARD) — Mathematics — Ms. Shaf
  ('8a65baf9-ad1c-489e-8fec-e4e39694657e'::uuid, '026b6164-3a28-4018-9d78-fe33c829c5e0'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY ONE OBEDIENCE - MORNING (STANDARD) — STAR — Ms Arlene
  ('47707b1d-ce0e-424e-a659-b89c9458aab7'::uuid, '026b6164-3a28-4018-9d78-fe33c829c5e0'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HONESTY - MORNING (GLOBAL CLASS) — English — Ms.Shaf
  ('8a65baf9-ad1c-489e-8fec-e4e39694657e'::uuid, '39036083-dec0-4a50-a042-be9f378d9f7d'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HONESTY - MORNING (GLOBAL CLASS) — STAR — Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, '39036083-dec0-4a50-a042-be9f378d9f7d'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HONESTY - MORNING (GLOBAL CLASS) — Science — Ms Arlene
  ('47707b1d-ce0e-424e-a659-b89c9458aab7'::uuid, '39036083-dec0-4a50-a042-be9f378d9f7d'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HONESTY - MORNING (GLOBAL CLASS) — Mathematics — Ms Shaf
  ('8a65baf9-ad1c-489e-8fec-e4e39694657e'::uuid, '39036083-dec0-4a50-a042-be9f378d9f7d'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HUMILITY - MORNING (STANDARD) — Mother Tongue (Filipino) — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '6cd76da2-7951-488a-916b-ef8bf57f5fdd'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HUMILITY - MORNING (STANDARD) — Science — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '6cd76da2-7951-488a-916b-ef8bf57f5fdd'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HUMILITY - MORNING (STANDARD) — English — Ms.Kristel
  ('90732eae-2846-4a50-be97-627489bd624e'::uuid, '6cd76da2-7951-488a-916b-ef8bf57f5fdd'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY TWO HUMILITY - MORNING (STANDARD) — Mathematics — Mr Wai
  ('8b84dca5-4669-451c-b2ac-d37b74d9157e'::uuid, '6cd76da2-7951-488a-916b-ef8bf57f5fdd'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- P3RIMARY THREE COURTESY - MORNING (GLOBAL) — Mathematics — Mr Wai
  ('8b84dca5-4669-451c-b2ac-d37b74d9157e'::uuid, '861a8d20-fe8c-4796-af21-d874d3e75725'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- P3RIMARY THREE COURTESY - MORNING (GLOBAL) — English — Mr.Shaf
  ('8a65baf9-ad1c-489e-8fec-e4e39694657e'::uuid, '861a8d20-fe8c-4796-af21-d874d3e75725'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- P3RIMARY THREE COURTESY - MORNING (GLOBAL) — Science — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '861a8d20-fe8c-4796-af21-d874d3e75725'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- P3RIMARY THREE COURTESY - MORNING (GLOBAL) — STAR — Ms Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, '861a8d20-fe8c-4796-af21-d874d3e75725'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY THREE COURAGEOUS - MORNING — English — Ms Kristel
  ('90732eae-2846-4a50-be97-627489bd624e'::uuid, 'b8af4f08-47cd-4715-a3f6-ce1c70ad83a4'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY THREE COURAGEOUS - MORNING — Mathematics — Ms Jenny
  ('8cf450f7-5a81-4101-81dc-b412554beea6'::uuid, 'b8af4f08-47cd-4715-a3f6-ce1c70ad83a4'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY THREE COURAGEOUS - MORNING — Science — Ms. Aida
  ('f8de6706-e89e-41c1-b29c-da119c466ef6'::uuid, 'b8af4f08-47cd-4715-a3f6-ce1c70ad83a4'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY THREE COURAGEOUS - MORNING — Mother Tongue (Filipino) — Ms Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, 'b8af4f08-47cd-4715-a3f6-ce1c70ad83a4'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY THREE COURAGEOUS - MORNING — STAR — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, 'b8af4f08-47cd-4715-a3f6-ce1c70ad83a4'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY THREE RESPONSIBILITY - AFTERNOON (STANDARD) — Science — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '9774dac2-0796-40f3-961f-04db042fa805'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY THREE RESPONSIBILITY - AFTERNOON (STANDARD) — Mother Tongue (Filipino) — Ms Karen
  ('446ede4b-62d1-4170-95a5-4826b9a16f1b'::uuid, '9774dac2-0796-40f3-961f-04db042fa805'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY THREE RESPONSIBILITY - AFTERNOON (STANDARD) — STAR — Ms.Shaf
  ('8a65baf9-ad1c-489e-8fec-e4e39694657e'::uuid, '9774dac2-0796-40f3-961f-04db042fa805'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY THREE RESPONSIBILITY - AFTERNOON (STANDARD) — English — Mr.Joseph
  ('588c57c3-0940-4fab-a381-d62606288c98'::uuid, '9774dac2-0796-40f3-961f-04db042fa805'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY THREE RESPONSIBILITY - AFTERNOON (STANDARD) — Mathematics — Ms Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, '9774dac2-0796-40f3-961f-04db042fa805'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR DILIGENCE - MORNING (GLOBAL) — English — Mr Joseph
  ('588c57c3-0940-4fab-a381-d62606288c98'::uuid, 'a37b469e-8fa5-4a7d-b731-dbfa87549a97'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR DILIGENCE - MORNING (GLOBAL) — Mathematics — Ms Parmi
  ('ee210a6a-abbc-446b-a61f-d5cfda6d9f11'::uuid, 'a37b469e-8fa5-4a7d-b731-dbfa87549a97'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR DILIGENCE - MORNING (GLOBAL) — Science — Ms Aida
  ('f8de6706-e89e-41c1-b29c-da119c466ef6'::uuid, 'a37b469e-8fa5-4a7d-b731-dbfa87549a97'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR TRUST- AM — Mother Tongue — Ms Lhen
  ('2b582646-cee5-405d-acbf-6f1ac1f3104e'::uuid, '06836e47-8df0-4221-86eb-4c101d906b48'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR TRUST- AM — STAR (Sports, Talent, Arts and Rhythm) — Ms Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, '06836e47-8df0-4221-86eb-4c101d906b48'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR TRUST- AM — Science — Ms. Aida
  ('f8de6706-e89e-41c1-b29c-da119c466ef6'::uuid, '06836e47-8df0-4221-86eb-4c101d906b48'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR TRUST- AM — Mathematics — Ms Parmi
  ('ee210a6a-abbc-446b-a61f-d5cfda6d9f11'::uuid, '06836e47-8df0-4221-86eb-4c101d906b48'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY FOUR TRUST- AM — English — Ms Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, '06836e47-8df0-4221-86eb-4c101d906b48'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE COMMITMENT- MORNING (GLOBAL CLASS) — STAR (Sports, Talent, Arts and Rhythm) — Ms Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, 'c447af0c-3213-4f60-830b-f900bfe93c2d'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE COMMITMENT- MORNING (GLOBAL CLASS) — Science — Ms Melissa
  ('3671352d-b309-4c2c-a8b2-59db31341d37'::uuid, 'c447af0c-3213-4f60-830b-f900bfe93c2d'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE COMMITMENT- MORNING (GLOBAL CLASS) — English — Mr Joseph
  ('588c57c3-0940-4fab-a381-d62606288c98'::uuid, 'c447af0c-3213-4f60-830b-f900bfe93c2d'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE COMMITMENT- MORNING (GLOBAL CLASS) — Mathematics — Ms Jenny
  ('8cf450f7-5a81-4101-81dc-b412554beea6'::uuid, 'c447af0c-3213-4f60-830b-f900bfe93c2d'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE TENACITY - MORNING (STANDARD CLASS) — Science — Ms Parmi
  ('ee210a6a-abbc-446b-a61f-d5cfda6d9f11'::uuid, 'e0335890-590a-4e31-a891-b1250c3a07a8'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE TENACITY - MORNING (STANDARD CLASS) — Mother Tongue — Ms.Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, 'e0335890-590a-4e31-a891-b1250c3a07a8'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE TENACITY - MORNING (STANDARD CLASS) — STAR — Ms Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, 'e0335890-590a-4e31-a891-b1250c3a07a8'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE TENACITY - MORNING (STANDARD CLASS) — English — Mr Joseph
  ('588c57c3-0940-4fab-a381-d62606288c98'::uuid, 'e0335890-590a-4e31-a891-b1250c3a07a8'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE TENACITY - MORNING (STANDARD CLASS) — Mathematics — Ms Koh
  ('f33d4e4a-7ae2-410b-8e90-7927cc5147b2'::uuid, 'e0335890-590a-4e31-a891-b1250c3a07a8'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE PERSEVERANCE- AFTERNOON — Mother Tongue — Ms Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, 'ba2ff320-53d3-488e-9bff-5c6561341c77'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE PERSEVERANCE- AFTERNOON — STAR (Sports, Talent, Arts and Rhythm) — Ms Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, 'ba2ff320-53d3-488e-9bff-5c6561341c77'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE PERSEVERANCE- AFTERNOON — Science — Ms Melissa
  ('3671352d-b309-4c2c-a8b2-59db31341d37'::uuid, 'ba2ff320-53d3-488e-9bff-5c6561341c77'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE PERSEVERANCE- AFTERNOON — English — Ms.Sharon
  ('e1e0bad5-9d9f-48f2-9188-147041821248'::uuid, 'ba2ff320-53d3-488e-9bff-5c6561341c77'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY FIVE PERSEVERANCE- AFTERNOON — Mathematics — Ms Parmi
  ('ee210a6a-abbc-446b-a61f-d5cfda6d9f11'::uuid, 'ba2ff320-53d3-488e-9bff-5c6561341c77'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY SIX GRIT- MORNING — Mathematics — Ms J
  ('2d5d2149-200a-4690-bb4d-6b95c3d06f11'::uuid, 'c42cff36-b096-4309-883b-d0894cc1b823'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY SIX GRIT- MORNING — STAR (Sports, Talent, Arts and Rhythm) — Ms Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, 'c42cff36-b096-4309-883b-d0894cc1b823'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY SIX GRIT- MORNING — Mother Tongue — Ms Lhen
  ('2b582646-cee5-405d-acbf-6f1ac1f3104e'::uuid, 'c42cff36-b096-4309-883b-d0894cc1b823'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- PRIMARY SIX GRIT- MORNING — English — Ms Radhika
  ('4b474c1f-bec4-43b6-8fed-2f617e5f31fd'::uuid, 'c42cff36-b096-4309-883b-d0894cc1b823'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY SIX GRIT- MORNING — Science — Ms Parmi
  ('ee210a6a-abbc-446b-a61f-d5cfda6d9f11'::uuid, 'c42cff36-b096-4309-883b-d0894cc1b823'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY SIX LOYALTY - MORNING — Mathematics — Ms Jenny
  ('8cf450f7-5a81-4101-81dc-b412554beea6'::uuid, 'c48c811f-2435-46e4-8ac1-2e5448832a06'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- PRIMARY SIX LOYALTY - MORNING — English — Mr Joseph
  ('588c57c3-0940-4fab-a381-d62606288c98'::uuid, 'c48c811f-2435-46e4-8ac1-2e5448832a06'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- PRIMARY SIX LOYALTY - MORNING — STAR (Sports, Talent, Arts and Rhythm) — Ms Melissa
  ('3671352d-b309-4c2c-a8b2-59db31341d37'::uuid, 'c48c811f-2435-46e4-8ac1-2e5448832a06'::uuid, '4bd196ef-ebb2-4811-9226-fb196af973eb'::uuid, 'subject_teacher'),
  -- PRIMARY SIX LOYALTY - MORNING — Science — Ms Mae
  ('4df3c031-f285-4da5-b740-31785569c0a6'::uuid, 'c48c811f-2435-46e4-8ac1-2e5448832a06'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- PRIMARY SIX LOYALTY - MORNING — Mother Tongue — Ms Lhen
  ('2b582646-cee5-405d-acbf-6f1ac1f3104e'::uuid, 'c48c811f-2435-46e4-8ac1-2e5448832a06'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — English — Ms Sharon
  ('e1e0bad5-9d9f-48f2-9188-147041821248'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Mathematics — Ms J
  ('2d5d2149-200a-4690-bb4d-6b95c3d06f11'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Humanities — Ms Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, '7485f3c8-20fa-481b-adc0-4f64e24760a1'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Global Perspectives — Mr Jun
  ('d5c1d91a-84cf-4a49-b695-d0b65382e18e'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, 'c2a02271-8a38-4352-a635-95bd77a4d39d'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Science — Ms Tina
  ('d40c11c8-453c-4eb7-92ca-1c0b1d34337d'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Computing — Ms Lhen
  ('2b582646-cee5-405d-acbf-6f1ac1f3104e'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, 'ced635e1-0cdf-4e75-93ce-5963c0e69499'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Physical Education and Health — Mr Hanafi
  ('c5c6d956-618f-4d81-859c-7af792155b9f'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, '9a41e3f6-de89-4db9-8e18-68d40b55d1eb'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Arts and Design — Ms.Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, '58674e34-5c1c-4119-8127-fa32ba6c7c98'::uuid, 'subject_teacher'),
  -- SECONDARY ONE DISCIPLINE 1 GLOBAL — Pastoral Ministry & Personal Development — Ms Sharon
  ('e1e0bad5-9d9f-48f2-9188-147041821248'::uuid, 'c4106706-f834-43c9-82a5-c68e8867718b'::uuid, 'b46994ff-f203-446f-bed9-2afa2b5f2534'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Mother Tongue — Ms Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — History — Ms Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, '46455f51-1f25-47b5-a092-5fb5e906f214'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — English — Ms.Sharon
  ('e1e0bad5-9d9f-48f2-9188-147041821248'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Mathematics — Ms.Koh
  ('f33d4e4a-7ae2-410b-8e90-7927cc5147b2'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Literature — Ms Carl
  ('7e6e95a0-4df8-4669-8a7b-00a85873e0f9'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, 'd55d1b29-076b-4906-953b-7c996647994e'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Science — Mr Jun
  ('d5c1d91a-84cf-4a49-b695-d0b65382e18e'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Contemporary Art — Ms.Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, '92ba3ac8-196a-48b2-9748-860829b28843'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Physical Education and Health — Mr Hanafi
  ('c5c6d956-618f-4d81-859c-7af792155b9f'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, 'adcdd22a-3288-46ad-9051-84c37d8910ee'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 2 STANDARD — Pastoral Ministry & Personal Development — Ms Carl
  ('7e6e95a0-4df8-4669-8a7b-00a85873e0f9'::uuid, '2b3db403-8838-4221-a15c-d5b1ee26dbf6'::uuid, 'b46994ff-f203-446f-bed9-2afa2b5f2534'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Mathematics — Ms Koh
  ('f33d4e4a-7ae2-410b-8e90-7927cc5147b2'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Computing — Ms Lhen
  ('2b582646-cee5-405d-acbf-6f1ac1f3104e'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, 'ced635e1-0cdf-4e75-93ce-5963c0e69499'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Humanities — Ms Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, '7485f3c8-20fa-481b-adc0-4f64e24760a1'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Science — Ms.Tina
  ('d40c11c8-453c-4eb7-92ca-1c0b1d34337d'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — English — Ms Sharon
  ('e1e0bad5-9d9f-48f2-9188-147041821248'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Global Perspectives — Mr Jun
  ('d5c1d91a-84cf-4a49-b695-d0b65382e18e'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, 'c2a02271-8a38-4352-a635-95bd77a4d39d'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Art & Design — Ms.Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, '58674e34-5c1c-4119-8127-fa32ba6c7c98'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Physical Education and Health — Mr Hanafi
  ('c5c6d956-618f-4d81-859c-7af792155b9f'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, '9a41e3f6-de89-4db9-8e18-68d40b55d1eb'::uuid, 'subject_teacher'),
  -- SECONDARY TWO INTEGRITY 1 GLOBAL — Pastoral Ministry & Personal Development — Ms Tina
  ('d40c11c8-453c-4eb7-92ca-1c0b1d34337d'::uuid, '389b1098-642f-4388-9e28-5e9a53b668e0'::uuid, 'b46994ff-f203-446f-bed9-2afa2b5f2534'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Contemporary Art — Ms.Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, '92ba3ac8-196a-48b2-9748-860829b28843'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Science — Ms. Tina
  ('d40c11c8-453c-4eb7-92ca-1c0b1d34337d'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Literature — Ms.Carl
  ('7e6e95a0-4df8-4669-8a7b-00a85873e0f9'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, 'd55d1b29-076b-4906-953b-7c996647994e'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Mother Tongue — Ms Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Mathematics — Ms Koh
  ('f33d4e4a-7ae2-410b-8e90-7927cc5147b2'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Physical Education and Health — Mr Hanafi
  ('c5c6d956-618f-4d81-859c-7af792155b9f'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, 'adcdd22a-3288-46ad-9051-84c37d8910ee'::uuid, 'subject_teacher'),
  -- SECONDARY THREE CONSISTENCY — Pastoral Ministry & Personal Development — Ms.Koh
  ('f33d4e4a-7ae2-410b-8e90-7927cc5147b2'::uuid, '7124bc7f-d0a9-4576-91cc-d31e93980eff'::uuid, 'b46994ff-f203-446f-bed9-2afa2b5f2534'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Science — Ms Chandana
  ('670c63ff-3703-4f98-9c15-c55a5a79a865'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, 'a549213a-fb49-4184-adab-645c32b2ac45'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — English — Elaine
  ('71b6eba9-be4b-4313-a72d-bb22d9dd27b9'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, '7fdaec0c-8371-4187-98c2-2b68ebf39263'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Contemporary Art — Ms.Jing
  ('d95b529e-b8ce-4513-b488-125ac2f5a070'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, '92ba3ac8-196a-48b2-9748-860829b28843'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Literature — Ms Elaine
  ('71b6eba9-be4b-4313-a72d-bb22d9dd27b9'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, 'd55d1b29-076b-4906-953b-7c996647994e'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Mother Tongue — Ms.Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, 'be3c2031-b303-4975-acea-a43aa23b504b'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Mathematics — Ms.J
  ('2d5d2149-200a-4690-bb4d-6b95c3d06f11'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, 'a182869b-ddfe-4307-a5c6-b05386d7d3f9'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Physical Education and Health — Mr Hanafi
  ('c5c6d956-618f-4d81-859c-7af792155b9f'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, 'adcdd22a-3288-46ad-9051-84c37d8910ee'::uuid, 'subject_teacher'),
  -- SECONDARY FOUR EXCELLENCE — Pastoral Ministry & Personal Development — Ms.Med
  ('9f09e7d2-8428-495d-98e9-7b914572ab9a'::uuid, '337b12fd-e188-4484-bd3b-bb445826c2d5'::uuid, 'b46994ff-f203-446f-bed9-2afa2b5f2534'::uuid, 'subject_teacher')
on conflict do nothing;

commit;
