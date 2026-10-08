// Invented names for the LOCAL seeder. Pools ported from the deleted
// test-environment seeder (`git show 56d00da9^:lib/sis/seeder/names.ts`).
// No real person's name is ever generated on purpose; any match is chance.

import { hashString, mulberry32 } from './random';

export const FIRST_NAMES = [
  'Aaliyah',
  'Aarav',
  'Abigail',
  'Arjun',
  'Bianca',
  'Caleb',
  'Chloe',
  'Daniel',
  'Diya',
  'Eliana',
  'Ethan',
  'Faith',
  'Gabriel',
  'Hazel',
  'Ibrahim',
  'Isla',
  'Jacob',
  'Jia',
  'Kabir',
  'Lila',
  'Mateo',
  'Noah',
  'Olivia',
  'Priya',
  'Rania',
  'Rohan',
  'Sofia',
  'Theo',
  'Uma',
  'Yusuf',
] as const;

export const LAST_NAMES = [
  'Anand',
  'Bautista',
  'Chen',
  'Dela Cruz',
  'Evangelista',
  'Fernandes',
  'Garcia',
  'Hernandez',
  'Ibrahim',
  'Jimenez',
  'Kapoor',
  'Lim',
  'Mendoza',
  'Navarro',
  'Ong',
  'Patel',
  'Quinto',
  'Reyes',
  'Santos',
  'Tan',
  'Uy',
  'Velasco',
  'Wong',
  'Xu',
  'Yamada',
] as const;

// ── Wider pools for the `people` phase ────────────────────────────────────
// ~340 children plus ~150 applicants who never enrol need far more distinct
// (last, first) pairs than the 30 × 25 above, and production's children mostly
// carry a two-part first name ("Maria Sofia"). All invented.

export const MORE_FIRST_NAMES = [
  'Adrian',
  'Alessia',
  'Amara',
  'Andrea',
  'Angelo',
  'Bea',
  'Brandon',
  'Carmela',
  'Cedric',
  'Clarisse',
  'Dante',
  'Denise',
  'Elijah',
  'Elise',
  'Enzo',
  'Francesca',
  'Gian',
  'Gwen',
  'Hanna',
  'Ian',
  'Ivy',
  'Jasmine',
  'Joaquin',
  'Kaela',
  'Kyle',
  'Lance',
  'Leah',
  'Liam',
  'Lucas',
  'Maia',
  'Marco',
  'Mika',
  'Nadia',
  'Nathan',
  'Nina',
  'Paolo',
  'Patricia',
  'Rafael',
  'Reina',
  'Sam',
  'Sean',
  'Selena',
  'Tala',
  'Tristan',
  'Vince',
  'Zara',
] as const;

/** Second half of a compound first name ("Maria" + " " + "Sofia"). */
export const SECOND_FIRST_NAMES = [
  'Grace',
  'Joy',
  'Marie',
  'Rose',
  'Sofia',
  'Angel',
  'James',
  'Miguel',
  'Luis',
  'Gabriel',
  'Faith',
  'Claire',
  'Louise',
  'Mae',
  'Andrei',
  'Rafael',
  'Kate',
  'Jude',
  'Paul',
  'Elle',
] as const;

export const MORE_LAST_NAMES = [
  'Abad',
  'Agustin',
  'Alcantara',
  'Aquino',
  'Balagtas',
  'Castillo',
  'Cordero',
  'Dimaculangan',
  'Domingo',
  'Espiritu',
  'Francisco',
  'Gonzaga',
  'Ilagan',
  'Lacson',
  'Lagman',
  'Macaraeg',
  'Manalo',
  'Marquez',
  'Medina',
  'Morales',
  'Natividad',
  'Ocampo',
  'Pascual',
  'Perez',
  'Ramos',
  'Rivera',
  'Salazar',
  'Sison',
  'Tolentino',
  'Torres',
  'Valdez',
  'Villanueva',
  'Yap',
  'Zamora',
  'Rahman',
  'Hossain',
  'Nguyen',
  'Tran',
  'Sharma',
  'Iyer',
] as const;

export const ADULT_MALE_NAMES = [
  'Albert',
  'Arnel',
  'Benjamin',
  'Carlo',
  'Dennis',
  'Edgar',
  'Ferdinand',
  'Gerald',
  'Henry',
  'Jerome',
  'Joel',
  'Jonathan',
  'Kenneth',
  'Leonard',
  'Mark',
  'Michael',
  'Nestor',
  'Oliver',
  'Patrick',
  'Ramon',
  'Ricardo',
  'Rodel',
  'Ronald',
  'Samuel',
  'Vincent',
  'Wilfredo',
] as const;

export const ADULT_FEMALE_NAMES = [
  'Aileen',
  'Analyn',
  'Bernadette',
  'Catherine',
  'Cristina',
  'Diana',
  'Elaine',
  'Evelyn',
  'Frances',
  'Geraldine',
  'Irene',
  'Jennifer',
  'Joanna',
  'Karen',
  'Lorna',
  'Marites',
  'Melissa',
  'Michelle',
  'Nora',
  'Princess',
  'Rachelle',
  'Rowena',
  'Sheila',
  'Teresa',
  'Vanessa',
  'Wendy',
] as const;

/** Every child first-name stem, old pool and new. */
export const CHILD_FIRST_NAMES: readonly string[] = [
  ...FIRST_NAMES,
  ...MORE_FIRST_NAMES,
];
/** Every family name, old pool and new. */
export const FAMILY_NAMES: readonly string[] = [
  ...LAST_NAMES,
  ...MORE_LAST_NAMES,
];

function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type SeedName = { first_name: string; last_name: string };

/**
 * `count` deterministic names keyed on a seed string. Past the pool size the
 * pairs keep varying (first and last cycle at different lengths, 30 × 25), so
 * a duplicate full name only appears after 150 picks — and the seeder adds
 * its deliberate duplicate-name pairs on purpose, not by accident.
 */
export function pickNames(seedKey: string, count: number): SeedName[] {
  const h = hashString(seedKey);
  const firsts = shuffled(FIRST_NAMES, h);
  const lasts = shuffled(LAST_NAMES, h ^ 0x9e3779b9);
  const out: SeedName[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      first_name: firsts[i % firsts.length],
      last_name: lasts[i % lasts.length],
    });
  }
  return out;
}
