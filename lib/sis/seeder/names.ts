// Name pools + deterministic shuffler for the test-environment seeder.
// Only used when the current AY code matches ^AY9 and the user flips to
// Test via /sis/admin/settings. Generated names are paired with student
// numbers of the form `TEST-AY9999-...` so teardown is a one-line DELETE.

const SEED_FIRST_NAMES = [
  'Aaliyah', 'Aarav', 'Abigail', 'Arjun', 'Bianca',
  'Caleb', 'Chloe', 'Daniel', 'Diya', 'Eliana',
  'Ethan', 'Faith', 'Gabriel', 'Hazel', 'Ibrahim',
  'Isla', 'Jacob', 'Jia', 'Kabir', 'Lila',
  'Mateo', 'Noah', 'Olivia', 'Priya', 'Rania',
  'Rohan', 'Sofia', 'Theo', 'Uma', 'Yusuf',
];

const SEED_LAST_NAMES = [
  'Anand', 'Bautista', 'Chen', 'Dela Cruz', 'Evangelista',
  'Fernandes', 'Garcia', 'Hernandez', 'Ibrahim', 'Jimenez',
  'Kapoor', 'Lim', 'Mendoza', 'Navarro', 'Ong',
  'Patel', 'Quinto', 'Reyes', 'Santos', 'Tan',
  'Uy', 'Velasco', 'Wong', 'Xu', 'Yamada',
];

// Mulberry32 — small deterministic PRNG. Good enough for shuffling seed
// names; never reach for this in security contexts.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

// Pick `count` deterministic names keyed on the seed string (use
// `ayCode + sectionId` so every section gets a stable roster on re-runs).
// If `count` exceeds the pool, names cycle through the shuffle — tolerable
// for UAT; real collisions fall within a single section only.
export function pickNames(seedKey: string, count: number): SeedName[] {
  const h = hashString(seedKey);
  const firsts = shuffled(SEED_FIRST_NAMES, h);
  const lasts = shuffled(SEED_LAST_NAMES, h ^ 0x9e3779b9);
  const out: SeedName[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      first_name: firsts[i % firsts.length],
      last_name: lasts[i % lasts.length],
    });
  }
  return out;
}
