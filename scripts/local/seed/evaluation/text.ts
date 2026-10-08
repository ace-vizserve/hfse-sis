// Generated form-adviser write-ups (FCA comments). Never copied from
// production — sentences are assembled from the pools below, with the child's
// first name, pronouns and the term's virtue theme.
//
// Length (characters), production per term: p10 142–215 · p50 246–335 ·
// p90 419–612 · max 616–954 (AY2025 longer than AY2026). A target length is
// drawn per child × term around the year's median and sentences are added
// until it is reached; each child also has a lasting "how much the adviser
// writes about them" factor, so lengths vary by child and not only by draw.

import { hashString, rng, type Rng } from '../lib/random';
import { normal } from '../markbook/model';

type Pronouns = {
  he: string;
  him: string;
  his: string;
  He: string;
  His: string;
};
const SHE: Pronouns = {
  he: 'she',
  him: 'her',
  his: 'her',
  He: 'She',
  His: 'Her',
};
const HE: Pronouns = { he: 'he', him: 'him', his: 'his', He: 'He', His: 'His' };

type Ctx = {
  n: string;
  p: Pronouns;
  virtue: string;
  subject: string;
  subject2: string;
};
type Line = (c: Ctx) => string;

const SUBJECTS = [
  'English',
  'Mathematics',
  'Science',
  'Filipino',
  'Mandarin',
  'Araling Panlipunan',
  'Music',
  'Art',
  'Physical Education',
  'ICT',
];

const OPENERS: Line[] = [
  (c) => `${c.n} has had a steady and productive term.`,
  (c) => `${c.n} continues to grow in confidence in class.`,
  (c) => `It has been a pleasure to have ${c.n} in class this term.`,
  (c) => `${c.n} settled well into the routines of the term.`,
  (c) => `${c.n} showed good effort in most areas this term.`,
  (c) => `${c.n} came to school ready to learn on most days.`,
  (c) => `This term ${c.n} worked consistently and with a positive attitude.`,
  (c) => `${c.n} is a cheerful and friendly member of the class.`,
  (c) => `${c.n} had a term of real progress.`,
  (c) => `${c.n} has been attentive and cooperative during lessons.`,
];
const ACADEMIC: Line[] = [
  (c) =>
    `${c.p.He} did especially well in ${c.subject}, where ${c.p.his} answers were careful and complete.`,
  (c) =>
    `In ${c.subject}, ${c.p.he} is quick to grasp new ideas and willing to explain them to classmates.`,
  (c) =>
    `${c.p.His} written work in ${c.subject} has become neater and better organised.`,
  (c) =>
    `${c.p.He} enjoys ${c.subject} and often asks questions that move the discussion forward.`,
  (c) =>
    `${c.p.He} completed ${c.p.his} performance tasks on time and with care.`,
  (c) =>
    `${c.p.His} results in ${c.subject} and ${c.subject2} show steady improvement since the start of the year.`,
  (c) =>
    `${c.p.He} reads more fluently now and is beginning to enjoy longer books.`,
  (c) =>
    `${c.p.He} participates actively in group work and shares ideas readily.`,
  (c) =>
    `${c.p.He} handled the quarterly assessment well and prepared for it responsibly.`,
  (c) => `${c.p.His} projects show creativity and attention to detail.`,
  (c) =>
    `${c.p.He} listens well to instructions and checks ${c.p.his} work before submitting it.`,
];
const CHARACTER: Line[] = [
  (c) =>
    `${c.p.He} showed the values of ${c.virtue} in the way ${c.p.he} treated classmates.`,
  (c) =>
    `Our virtues this term were ${c.virtue}, and ${c.n} lived them out in small, everyday ways.`,
  (c) => `${c.p.He} is kind to others and is often the first to offer help.`,
  (c) =>
    `${c.p.He} takes responsibility for ${c.p.his} belongings and classroom duties.`,
  (c) =>
    `${c.p.He} is respectful to teachers and gets along well with classmates.`,
  (c) =>
    `${c.p.He} has shown honesty and good judgement when things did not go as planned.`,
  (c) =>
    `${c.p.He} welcomed new classmates warmly and helped them find their way around.`,
  (c) => `${c.p.He} follows class rules and is a good example to others.`,
  (c) =>
    `${c.p.He} carried out ${c.p.his} role as class officer with commitment.`,
];
const GROWTH: Line[] = [
  (c) =>
    `${c.p.He} is encouraged to speak up more often during class discussions.`,
  (c) => `${c.p.He} should work on finishing tasks within the time given.`,
  (c) =>
    `More practice at home in ${c.subject2} will help ${c.p.him} gain confidence.`,
  (c) => `${c.p.He} needs to be more careful with spelling and handwriting.`,
  (c) =>
    `${c.p.He} can improve by reviewing ${c.p.his} notes regularly instead of before tests only.`,
  (c) =>
    `At times ${c.p.he} is easily distracted, and a little more focus will go a long way.`,
  (c) =>
    `${c.p.He} is encouraged to read every day to build ${c.p.his} vocabulary.`,
  (c) => `${c.p.He} should remember to bring complete materials to class.`,
  (c) =>
    `Learning to manage ${c.p.his} time well will help ${c.p.him} with longer assignments.`,
  (c) => `${c.p.He} may ask for help sooner when a topic is difficult.`,
];
const CLOSERS: Line[] = [
  (c) => `Keep up the good work, ${c.n}!`,
  (c) => `I look forward to seeing ${c.p.him} grow even more next term.`,
  (c) => `Well done, ${c.n}, and keep it up.`,
  (c) => `With continued effort, ${c.p.he} will do even better.`,
  (c) => `Thank you for a good term, ${c.n}.`,
  (c) => `We are proud of ${c.p.his} progress.`,
];

/** The child's lasting verbosity factor (adviser writes more/less about them). */
function childFactor(studentNumber: string): number {
  const r = rng(`evaluation:child:${studentNumber}`);
  return Math.exp(0.22 * normal(r));
}

function take(r: Rng, pool: Line[], used: Set<Line>): Line {
  const free = pool.filter((l) => !used.has(l));
  const l = r.pick(free.length ? free : pool);
  used.add(l);
  return l;
}

/**
 * One plain-text write-up. `median` is the year's p50 target (AY2025 ~320,
 * AY2026 ~255).
 */
export function writeup(args: {
  key: string;
  studentNumber: string;
  firstName: string;
  gender: string | null;
  virtue: string;
  median: number;
}): string {
  const r = rng(`evaluation:text:${args.key}`);
  const target = Math.min(
    870,
    Math.max(
      90,
      args.median * childFactor(args.studentNumber) * Math.exp(0.33 * normal(r))
    )
  );
  const p =
    args.gender === 'Female'
      ? SHE
      : args.gender === 'Male'
        ? HE
        : hashString(args.studentNumber) % 2
          ? SHE
          : HE;
  const subject = r.pick(SUBJECTS);
  const c: Ctx = {
    n: args.firstName.split(' ')[0],
    p,
    virtue: args.virtue.replace(/,([^,]*)$/, ' and$1').toLowerCase(),
    subject,
    subject2: r.pick(SUBJECTS.filter((s) => s !== subject)),
  };
  const used = new Set<Line>();
  const parts = [take(r, OPENERS, used)(c)];
  const middle: Line[][] = [
    ACADEMIC,
    CHARACTER,
    ACADEMIC,
    GROWTH,
    CHARACTER,
    ACADEMIC,
    GROWTH,
  ];
  let i = 0;
  const closer = take(r, CLOSERS, used)(c);
  while (
    parts.join(' ').length + closer.length + 1 < target &&
    i < middle.length * 2
  ) {
    const next = take(r, middle[i % middle.length], used)(c);
    if (parts.join(' ').length + next.length + closer.length + 2 > target + 60)
      break;
    parts.push(next);
    i++;
  }
  // Long ones: a second paragraph of the same, as advisers do.
  if (target > 620 && r.chance(0.6))
    parts.splice(Math.ceil(parts.length / 2), 0, '\n');
  return [...parts, closer].join(' ').replace(/ \n /g, '\n\n');
}

/** A short in-app comment (production's two AY2026 T3 rows: 11–17 chars). */
const SHORT = [
  'Well done!',
  'Good effort.',
  'Keep it up!',
  'Great progress.',
  'Very good term.',
  'Good job, keep going.',
];
export function shortWriteup(key: string): string {
  return rng(`evaluation:short:${key}`).pick(SHORT);
}
