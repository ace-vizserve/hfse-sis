// Categorical vocabularies for the `people` phase, per academic year, taken
// from the production profile (aggregates only, 2026-10-07). Weights are
// production's raw counts, so the mess comes along: spelling variants,
// trailing spaces, junk dropdown picks ("Antarctica", "Option 2", "Testing"),
// and the NULL share. Free text is generated elsewhere, never copied.

import type { Distribution } from '../lib/distribution';

export type Ay = 'AY2025' | 'AY2026' | 'AY2027';
export const AYS: Ay[] = ['AY2025', 'AY2026', 'AY2027'];

type PerAy<T> = Record<Ay, Distribution<T>>;

// ── The child ─────────────────────────────────────────────────────────────

export const NATIONALITY: PerAy<string> = {
  AY2025: [
    ['Philippines', 400],
    ['Singapore', 371],
    ['Indonesia', 6],
    ['Bangladesh', 6],
    ['Aruba', 4],
    ['Malaysia', 4],
    ['China', 4],
    ['India', 4],
    ['Italy', 3],
    ['Viet Nam', 3],
    ['Thailand', 3],
    ['Sri Lanka', 2],
    ['United Kingdom', 2],
    ['Vietnam', 1],
    ['Sint Maarten (Dutch part)', 1],
    ['Bermuda', 1],
    ['Iran', 1],
    ['United States', 1],
    ['Myanmar', 1],
  ],
  AY2026: [
    ['Philippines', 314],
    ['Singapore', 146],
    ['India', 6],
    ['Bangladesh', 6],
    ['Vietnam', 5],
    ['United Kingdom', 4],
    ['Myanmar', 4],
    ['Indonesia', 4],
    ['Malaysia', 2],
    ['Sri Lanka', 1],
    ['Belgium', 1],
    ['South Korea', 1],
    ['Taiwan', 1],
    ['Bermuda', 1],
    ['Angola', 1],
    ['United States', 1],
    ['Algeria', 1],
  ],
  AY2027: [
    ['Philippines', 218],
    ['Singapore', 76],
    ['Vietnam', 5],
    ['United Kingdom', 2],
    ['Germany', 2],
    ['Japan', 1],
    ['India', 1],
    ['United States', 1],
    ['Algeria', 1],
    ['South Korea', 1],
    ['Falkland Islands', 1],
  ],
};

/** The child's own pass. `''` is production's blank-string entry. */
export const STUDENT_PASS: PerAy<string | null> = {
  AY2025: [
    ['Dependent Pass', 672],
    ['Long Term Visit Pass', 64],
    ['Singapore PR', 45],
    ["Dependent's Pass (DP)", 26],
    ['Singaporean', 11],
    ['Student Pass', 4],
  ],
  AY2026: [
    ['Dependent Pass', 403],
    ['Long Term Visit Pass', 37],
    ['Singapore PR', 33],
    [null, 7],
    ['Student Pass', 7],
    ["Dependent's Pass (DP)", 7],
    ['Dependant Pass', 5],
    ['', 1],
  ],
  AY2027: [
    ['Dependent Pass', 248],
    ['Long Term Visit Pass', 22],
    ['Singapore PR', 17],
    ['', 7],
    ['Student Pass', 6],
    [null, 6],
    ["Dependent's Pass (DP)", 2],
    ['Long-Term Visit Pass (LTVP)', 1],
  ],
};

export const RELIGION: PerAy<string> = {
  AY2025: [
    ['Roman Catholic', 523],
    ['Christianity', 180],
    ['Islam', 25],
    ['Others', 25],
    ['Catholic', 17],
    ['Buddhism', 10],
    ['Hinduism', 9],
    ['ROMAN CATHOLIC', 8],
    ['CATHOLIC', 6],
    ['Other', 5],
    ['Christian', 4],
    ['Roman Catholic ', 3],
    ['BORN AGAIN CHRISTIAN', 2],
    ['IEMELIF', 2],
  ],
  AY2026: [
    ['Roman Catholic', 347],
    ['Christianity', 101],
    ['Islam', 18],
    ['Buddhism', 8],
    ['Others', 6],
    ['Other', 5],
    ['Hinduism', 5],
    ['Catholic', 4],
    ['CHRISTIAN', 2],
    ['ROMAN CATHOLIC', 2],
    ['MEMBERS CHURCH OF GOD INTERNATIONAL', 1],
  ],
  AY2027: [
    ['Roman Catholic', 236],
    ['Christianity', 48],
    ['Other', 6],
    ['Others', 4],
    ['Islam', 4],
    ['Buddhism', 3],
    ['Catholic', 2],
    ['Hinduism', 2],
    ['CHRISTIAN', 2],
    ['ROMAN CATHOLIC', 1],
  ],
};

/** Filled only when `religion` is Other/Others (and a few stray ones). */
export const RELIGION_OTHER: Distribution<string> = [
  ['Free Thinker', 3],
  ['NIL', 3],
  ['Church of Christ', 2],
  ['Iglesia Ni Cristo', 3],
  ['Protestant', 2],
  ['NA', 2],
  ['UECFI', 1],
  ['INC', 1],
  ['No religion', 1],
  ['Nil', 1],
  ['', 1],
];

export const PRIMARY_LANGUAGE: Distribution<string> = [
  ['English', 426],
  ['ENGLISH', 94],
  ['Filipino', 45],
  ['English ', 40],
  ['Tagalog', 30],
  ['english', 19],
  ['English, Filipino', 12],
  ['English and Tagalog', 7],
  ['FILIPINO', 7],
  ['Tagalog, English', 7],
  ['English / Filipino', 5],
  ['Tagalog/English', 5],
  ['English & Tagalog', 5],
  ['English/Tagalog', 5],
  ['English & Bangali', 4],
  ['Vietnamese', 3],
  ['Tamil', 2],
  ['Engllish', 1],
  ['English , Myanmar', 1],
  ['MIX OF ENGLISH TAGALOG AND BISAYA', 1],
  ['Testing Four', 1],
  ['E', 1],
];

export const GENDER: Distribution<string> = [
  ['Male', 445],
  ['Female', 377],
];

export const CLASS_TYPE: PerAy<string | null> = {
  AY2025: [
    ['Standard Class (ENGLISH + TAGALOG)', 609],
    ['Global Class 1 (ENGLISH + MANDARIN)', 108],
    [null, 79],
    ['Enrichment Class', 13],
    ['Global Class 2 (ENGLISH + TAMIL)', 6],
    ['Global Class 3 (ENGLISH + FRENCH)', 6],
    ['Global Class (CAMBRIDGE)', 1],
  ],
  AY2026: [
    ['Standard Class (ENGLISH + TAGALOG)', 378],
    ['Global Class 1 (ENGLISH + MANDARIN)', 69],
    ['Enrichment Class', 23],
    ['Global Class (CAMBRIDGE)', 18],
    ['Global Class 2 (ENGLISH + TAMIL)', 3],
    ['Global Class 3 (ENGLISH + FRENCH)', 3],
    ['Standard Class 1 (ENGLISH + FILIPINO)', 1],
    ['STANDARD 1 (ENGLISH + FILIPINO)', 1],
    ['Global Class (Cambridge)', 1],
    ['Standard Class (English + Tagalog)', 1],
    ['Standard (ENGLISH + TAGALOG)', 1],
    ['Standard Class (ENGLISH + FILIPINO)', 1],
  ],
  AY2027: [
    ['Standard Class (ENGLISH + FILIPINO)', 239],
    ['GLOBAL (ENGLISH + MANDARIN)', 27],
    ['Global Class (CAMBRIDGE)', 21],
    ['Global Class 1 (ENGLISH + MANDARIN)', 10],
    ['Global Class-Cambridge', 5],
    ['Enrichment Class', 2],
    ['Global Class- Cambridge', 1],
    ['Global Class-Cambridge (ENGLISH+MANDARIN)', 1],
    ['Global Class Cambridge', 1],
    ['Standard Class (ENGLISH + TAGALOG)', 1],
    ['Global Class 3 (ENGLISH + FRENCH)', 1],
  ],
};

export const PREFERRED_SCHEDULE: PerAy<string | null> = {
  AY2025: [
    ['Morning', 360],
    ['Whole Day', 238],
    ['Afternoon', 131],
    [null, 79],
    ['Morning (Waitlist)', 14],
  ],
  AY2026: [
    ['Morning', 276],
    ['Whole Day', 164],
    ['Afternoon', 60],
  ],
  AY2027: [
    ['Morning', 163],
    ['Whole Day', 107],
    ['Afternoon', 39],
  ],
};

export const YES_NO_BUS: PerAy<string | null> = {
  AY2025: [
    ['No', 576],
    ['Yes', 167],
    [null, 79],
  ],
  AY2026: [
    ['No', 406],
    ['Yes', 91],
    [null, 3],
  ],
  AY2027: [
    ['No', 250],
    ['Yes', 59],
  ],
};
export const YES_NO_CARE: PerAy<string | null> = {
  AY2025: [
    ['No', 657],
    ['Yes', 86],
    [null, 79],
  ],
  AY2026: [
    ['No', 448],
    ['Yes', 49],
    [null, 3],
  ],
  AY2027: [
    ['No', 284],
    ['Yes', 25],
  ],
};
export const YES_NO_UNIFORM: PerAy<string | null> = {
  AY2025: [
    ['Yes', 476],
    ['No', 267],
    [null, 79],
  ],
  AY2026: [
    ['Yes', 305],
    ['No', 191],
    [null, 4],
  ],
  AY2027: [
    [null, 289],
    ['Yes', 20],
  ],
};

export const PAYMENT_OPTION: PerAy<string | null> = {
  AY2025: [
    [null, 259],
    ['Option 1', 239],
    ['Option 3', 198],
    ['Option 2', 126],
  ],
  AY2026: [
    ['Option 3', 260],
    ['Option 1', 163],
    ['Option 2', 76],
    ['Not Applicable', 1],
  ],
  AY2027: [
    ['Option 3', 133],
    ['Option 1', 113],
    ['Option 2', 57],
    ['Not Applicable', 6],
  ],
};

export const CONTRACT_SIGNATORY: PerAy<string | null> = {
  AY2025: [
    [null, 818],
    ['Father', 4],
  ],
  AY2026: [
    ['Mother', 287],
    ['Father', 213],
  ],
  AY2027: [
    ['Mother', 163],
    ['Father', 146],
  ],
};

export const DISCOUNT1: PerAy<string | null> = {
  AY2025: [
    [null, 410],
    ['AY25EB05EC', 256],
    ['Referred by someone', 44],
    ['AY25SIB01', 35],
    ['AY25EB06EC', 30],
    ['AY25OH01EN', 23],
    ['AY25EB07EC', 8],
    ['AY25EB01EN', 7],
    ['AY25EB02EN', 5],
    ['AY25EB04EN', 3],
    ['AY25EB03EN', 1],
  ],
  AY2026: [
    [null, 211],
    ['AY26JulCUR', 190],
    ['AY26SEPCUR', 39],
    ['AY26AUGCUR', 31],
    ['AY26JulNEW', 12],
    ['AY26OHIS', 6],
    ['AY26JulTRF', 5],
    ['AY26SEPNEW', 3],
    ['AY26OHNEW', 2],
    ['AY26OHTRF', 1],
  ],
  AY2027: [
    ['AY27JULCUR', 178],
    [null, 41],
    ['AY27AUGCUR', 40],
    ['AY27SEPCUR', 22],
    ['AY27JULNEW', 11],
    ['AY27SEPNEW', 8],
    ['AY27AUGNEW', 6],
    ['AY27OCTNEW', 2],
    ['AY27OCTCUR', 1],
  ],
};
export const DISCOUNT2: PerAy<string | null> = {
  AY2025: [
    [null, 791],
    ['AY25SIB01', 11],
    ['AY25OH01EN', 8],
    ['Referred by someone', 6],
    ['AY25EB05EC', 5],
    ['AY25EB01EN', 1],
  ],
  AY2026: [
    [null, 487],
    ['AY26JulNEW', 7],
    ['AY26JulTRF', 3],
    ['AY26SEPNEW', 2],
    ['AY26OHYS', 1],
  ],
  AY2027: [
    [null, 308],
    ['Sibling Discount', 1],
  ],
};
export const DISCOUNT3: PerAy<string | null> = {
  AY2025: [
    [null, 818],
    ['AY25EB01EN', 3],
    ['Referred by someone', 1],
  ],
  AY2026: [
    [null, 499],
    ['AY26JulNEW', 1],
  ],
  AY2027: [[null, 1]],
};

export const LIVING_WITH: Distribution<string> = [
  ['Parents', 416],
  ['Parent/S', 67],
  ['Family', 62],
  ['Mother', 38],
  ['Parents ', 36],
  ['Both Parents', 24],
  ['Parents And Sibling', 14],
  ['Parent/S, Brothers / Sisters', 11],
  ['Parent', 7],
  ['Parent/s', 8],
  ['Parents And Siblings', 6],
  ['Father', 5],
  ['Immediate Family', 4],
  ['Father And Mother', 4],
  ['Family ', 4],
  ['Parrents', 4],
  ['Father & Mother', 2],
  ['Text', 2],
  ['Both', 2],
  ['Parents, Siblings, And Carer', 2],
  ['Parents And Sister', 2],
  ['N/a', 1],
  ['Renting Hdb', 1],
  ['Tenants', 1],
];

export const MARITAL: PerAy<string> = {
  AY2025: [
    ['Married', 473],
    ['MARRIED', 84],
    ['Married in Church', 68],
    ['Married ', 46],
    ['married', 32],
    ['Married Civilly', 29],
    ['Single', 12],
    ['Single Parent', 6],
    ['SINGLE', 5],
    ['Divorced', 5],
    ['married ', 4],
    ['Divorced ', 3],
    ['MARIED', 2],
    ['UNMARRIED', 2],
    ['Never Married', 2],
    ['Legally Married', 2],
    ['divorced', 2],
    ['Text', 2],
    ['Marries', 2],
    ['Maried', 2],
    ['Partners', 2],
  ],
  AY2026: [
    ['Married', 386],
    ['MARRIED', 32],
    ['Married in Church', 17],
    ['Single', 17],
    ['married', 13],
    ['Married Civilly', 9],
    ['Married ', 7],
    ['Divorced', 5],
    ['Separated', 2],
    ['Widow', 1],
    ['NA', 1],
    ['N/A', 1],
    ['Married in Church but is currently separated/single parent ', 1],
    ['Common Law', 1],
    ['Domestic Partner', 1],
  ],
  AY2027: [
    ['Married', 260],
    ['Single', 17],
    ['MARRIED', 8],
    ['Married in Church', 6],
    ['married', 4],
    ['Divorced', 3],
    ['Married Civilly', 3],
    ['Married ', 2],
    ['NA', 1],
    ['Widow', 1],
    ['Separated', 1],
    ['Common Law', 1],
  ],
};

// ── Parents ───────────────────────────────────────────────────────────────

export const PARENT_NATIONALITY: Distribution<string> = [
  ['Philippines', 620],
  ['Singapore', 485],
  ['Bangladesh', 15],
  ['India', 14],
  ['Indonesia', 11],
  ['Viet Nam', 6],
  ['Vietnam', 5],
  ['Malaysia', 7],
  ['United Kingdom', 6],
  ['Myanmar', 5],
  ['Australia', 4],
  ['Germany', 4],
  ['United States', 4],
  ['Albania', 3],
  ['China', 3],
  ['Italy', 3],
  ['Sri Lanka', 3],
  ['Antarctica', 3],
  ['Filipino', 1],
  ['Andorra', 2],
  ['United States Of America', 2],
  ['Iran, Islamic Republic of', 1],
];

export const FATHER_PASS: PerAy<string | null> = {
  AY2025: [
    ['S-PASS', 274],
    ['E-PASS', 251],
    [null, 96],
    ['Permanent Resident', 75],
    ['Dependent Pass', 67],
    ['Other', 28],
    ['S-pass', 14],
    ['E-pass', 13],
    ['PR', 2],
    ['Dependant Pass', 1],
    ['Long Term Visit Pass', 1],
  ],
  AY2026: [
    ['S-PASS', 179],
    ['E-PASS', 159],
    ['Permanent Resident', 55],
    ['Dependent Pass', 44],
    [null, 30],
    ['Other', 18],
    ['S-pass', 7],
    ['E-pass', 6],
    ['Dependant Pass', 1],
    ['Long Term Visit Pass', 1],
  ],
  AY2027: [
    ['S-PASS', 120],
    ['E-PASS', 96],
    ['Permanent Resident', 31],
    ['Dependent Pass', 25],
    [null, 22],
    ['Other', 10],
    ['S-pass', 2],
    ['E-pass', 1],
    ['Dependant Pass', 1],
    ['Long-Term Visit Pass', 1],
  ],
};
export const MOTHER_PASS: PerAy<string | null> = {
  AY2025: [
    ['S-PASS', 263],
    ['Dependent Pass', 230],
    ['E-PASS', 158],
    ['Permanent Resident', 89],
    [null, 31],
    ['Other', 18],
    ['Dependant Pass', 14],
    ['S-pass', 9],
    ['E-pass', 8],
    ['PR', 1],
    ['Long Term Visit Pass', 1],
  ],
  AY2026: [
    ['S-PASS', 177],
    ['Dependent Pass', 143],
    ['E-PASS', 86],
    ['Permanent Resident', 61],
    ['Other', 14],
    [null, 6],
    ['S-pass', 5],
    ['E-pass', 4],
    ['Dependant Pass', 3],
    ['Long Term Visit Pass', 1],
  ],
  AY2027: [
    ['S-PASS', 124],
    ['Dependent Pass', 81],
    ['E-PASS', 56],
    ['Permanent Resident', 31],
    [null, 7],
    ['Other', 7],
    ['Dependant Pass', 2],
    ['Long Term Visit Pass', 1],
  ],
};

export const PARENT_RELIGION: Distribution<string> = [
  ['Roman Catholic', 291],
  ['Catholic', 98],
  ['Christian', 70],
  ['ROMAN CATHOLIC', 69],
  ['CATHOLIC', 27],
  ['Roman Catholic ', 27],
  ['Christianity', 24],
  ['CHRISTIAN', 19],
  ['Islam', 15],
  ['CHRISTIANITY', 12],
  ['roman catholic', 10],
  ['Catholic ', 9],
  ['Christian ', 6],
  ['ISLAM', 6],
  ['RC', 5],
  ['christian', 5],
  ['Buddhism', 5],
  ['Roman catholic', 5],
  ['Iglesia Ni Cristo', 4],
  ['islam', 3],
  ['JW', 3],
  ['IEMELIF', 3],
  ['Free Thinker', 3],
  ['catholic ', 3],
  ['NIL', 3],
  ['NA', 2],
  ['Testing', 2],
  ['-', 1],
  ['R.CATHOLIC', 1],
  ['Roman Cathlic', 1],
  ['Aglipayan ', 1],
  ['HINDU', 1],
];

export const GUARDIAN_NATIONALITY: Distribution<string> = [
  ['Singapore', 97],
  ['Philippines', 94],
  ['Bangladesh', 2],
  ['Option 2', 1],
  ['Iran, Islamic Republic of', 1],
  ['Norway', 1],
];

export const COMPANIES = [
  'Lumen Logistics Pte Ltd',
  'Harbourline Marine Services',
  'Kopi Corner F&B',
  'Northpoint Clinic',
  'Brightwave Engineering',
  'Tanjong Freight',
  'Merlion Facilities Mgmt',
  'Orchid Health Group',
  'Pacific Ridge Construction',
  'Skyline Data Systems',
  'Seabreeze Hotel',
  'Marina Bayfront Retail',
  'Sunrise Childcare',
  'Jurong Precision Tools',
  'Evergreen Cleaning Services',
  'Atlas Shipping Agencies',
  'Helix BioLabs',
  'Kallang Auto Works',
  'Self-employed',
  'Housewife',
  'NA',
  'N/A',
  'Changi General Services',
] as const;

export const POSITIONS = [
  'Engineer',
  'Senior Engineer',
  'Nurse',
  'Staff Nurse',
  'Accountant',
  'Project Manager',
  'Technician',
  'Supervisor',
  'Chef',
  'Driver',
  'IT Consultant',
  'Admin Executive',
  'Sales Executive',
  'Operations Manager',
  'Teacher',
  'Housewife',
  'Homemaker',
  'Business Owner',
  'Analyst',
  'Marine Surveyor',
  'Quantity Surveyor',
  'Pharmacist',
  'NA',
] as const;

// ── Level labels ──────────────────────────────────────────────────────────

/** SIS level code → canonical label (`levels.label`). */
export const LEVEL_LABEL: Record<string, string> = {
  YS: 'Youngstarters',
  P1: 'Primary One',
  P2: 'Primary Two',
  P3: 'Primary Three',
  P4: 'Primary Four',
  P5: 'Primary Five',
  P6: 'Primary Six',
  S1: 'Secondary One',
  S2: 'Secondary Two',
  S3: 'Secondary Three',
  S4: 'Secondary Four',
};

export const LEVEL_ORDER = [
  'YS',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'S1',
  'S2',
  'S3',
  'S4',
] as const;
export type LevelCode = (typeof LEVEL_ORDER)[number];

export function nextLevel(code: LevelCode): LevelCode | null {
  const i = LEVEL_ORDER.indexOf(code);
  return i >= 0 && i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : null;
}

/** Youngstarters' parent-facing spellings (all map through level_aliases). */
export const YS_LEVEL_APPLIED: PerAy<string> = {
  AY2025: [
    ['Youngstarters', 20],
    ['Youngstarters | Junior Stars', 2],
    ['Youngstarters | Little Stars', 1],
    ['Youngstarters | Senior Stars', 1],
  ],
  AY2026: [
    ['Youngstarters | Senior Stars', 9],
    ['YoungStarter Little Star', 6],
    ['Youngstarters | Junior Stars', 5],
    ['Youngstarters', 2],
    ['YoungStarter Senior Star', 1],
  ],
  AY2027: [
    ['YoungStarter Junior Star', 1],
    ['Youngstarters | Senior Stars', 1],
    ['HFSE International Education Programme – Year 1 (equivalent to K2)', 4],
    ['HFSE International Education Programme - Year 1', 1],
  ],
};

/**
 * AY2027's programme-name spellings of an SIS level, en-dash AND hyphen as
 * production has them. Only levels with a level_aliases row (or the digit
 * form normalizeLevelLabel already handles) appear, so every one resolves.
 */
export const AY2027_PROGRAMME_LABELS: Partial<Record<LevelCode, string[]>> = {
  P1: [
    'HFSE International Education Programme – Year 2 (equivalent to Primary One)',
    'HFSE Global Education Programme – Year 2 (equivalent to Primary One)',
  ],
  P3: ['HFSE Global Education Programme - Primary 3', 'Primary 3'],
  P6: ['HFSE Global Education Programme - Primary 6'],
  S1: [
    'HFSE International Education Programme – Year 8',
    'HFSE International Education Programme - Year 8',
    'HFSE Global Education Programme – Year 8',
  ],
  S2: [
    'HFSE International Education Programme – Year 9',
    'HFSE International Education Programme - Year 9',
    'HFSE Global Education Programme – Year 9',
    'HFSE International Education Programme Year 9',
  ],
  S3: ['HFSE International Education Programme – Year 10'],
};

// ── Admissions status-side vocab ──────────────────────────────────────────

export const STP_TYPE: Distribution<string> = [
  ['New Student Pass Application', 15],
  ['Student Pass Transfer Application', 1],
];

export const HOW_DID_YOU_KNOW: Distribution<string> = [
  ['Current / Former HFSE Parent', 25],
  ['Word of Mouth (Friend / Colleague)', 15],
  ['', 15],
  ['Google / Search Engine', 10],
  ['Referral', 5],
  ['Facebook', 5],
  ['Sibling Enrolled at HFSE', 4],
  ['Walk-in / Open House', 1],
  ['Education Fair', 1],
];

export const FEEDBACK_COMMENTS = [
  'The online form was clear and easy to follow.',
  'Took a while to upload all the documents, but manageable.',
  'Very intuitive, completed the whole application in one sitting.',
  'A few questions felt repetitive, otherwise a smooth process.',
  'Wished I could save and resume the form more easily.',
  'Uploading on mobile was slow.',
] as const;

export const LEARNING_NEEDS = [
  'NA',
  'N/A',
  'None',
  'Nil',
  'na',
  '-',
  'Mild speech delay, attended therapy until last year.',
  'Needs extra support in reading comprehension.',
  'Diagnosed with ADHD; on a school support plan previously.',
  'Prefers front-row seating due to eyesight.',
  'Shy in new settings, warms up after a few weeks.',
] as const;
