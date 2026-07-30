// Temporary-password generation for bulk staff provisioning.
//
// Pure + dependency-free so it can be unit-tested and imported from a plain
// Node script. Deliberately NO `import 'server-only'` here: that package's
// default export throws outside the react-server condition, so a
// `npx tsx scripts/...` run importing it would crash. Same reason
// lib/sis/backfill/** omits it while lib/markbook/masterfile-export.ts
// (route-only) includes it.
//
// These passwords are typed once, off a printed sheet, at a training
// session — then changed by the holder at /account. There is no
// forced-password-change page in this app (KD #87), so the value here is
// live until the user replaces it themselves.

// Curated charsets excluding visually-confusable glyphs (no 0/O, no 1/l/I),
// lifted from generatePassword() in components/sis/staff-accounts-client.tsx
// so a bulk-provisioned password looks exactly like a UI-provisioned one.
//
// Symbols are limited to `!@#?` on purpose: they are unambiguous when read
// aloud ("exclamation, at, hash, question") and none of them is a shell
// metacharacter, so a password pasted into a terminal can't trip quoting.
// `$`, `&`, `*`, and backtick are excluded for that reason.
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!@#?';
const POOL = UPPER + LOWER + DIGIT + SYMBOL;

// 8 is the floor enforced by InviteUserSchema (lib/schemas/user-admin.ts).
// Short enough to type off a handout, and every character is guaranteed
// readable.
export const TEMP_PASSWORD_LENGTH = 8;

export const TEMP_PASSWORD_CHARSETS = {
  upper: UPPER,
  lower: LOWER,
  digit: DIGIT,
  symbol: SYMBOL,
} as const;

function pick(set: string, random: number): string {
  return set[random % set.length]!;
}

// Crypto-strong 8-char password guaranteed to contain at least one
// uppercase, one lowercase, one digit, and one symbol. The four anchored
// characters are placed first and then the whole string is shuffled, so the
// class layout isn't predictable from position.
export function generateTempPassword(): string {
  const buf = new Uint32Array(TEMP_PASSWORD_LENGTH);
  crypto.getRandomValues(buf);

  const out: string[] = [
    pick(UPPER, buf[0]!),
    pick(LOWER, buf[1]!),
    pick(DIGIT, buf[2]!),
    pick(SYMBOL, buf[3]!),
  ];
  for (let i = out.length; i < TEMP_PASSWORD_LENGTH; i++) {
    out.push(pick(POOL, buf[i]!));
  }

  // Fisher-Yates using fresh crypto randomness (not Math.random) so the
  // shuffle is as strong as the character selection.
  const shuffle = new Uint32Array(out.length);
  crypto.getRandomValues(shuffle);
  for (let i = out.length - 1; i > 0; i--) {
    const j = shuffle[i]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }

  return out.join('');
}

// n distinct passwords. Collisions across an 8-char pool are vanishingly
// unlikely at our scale (a dozen accounts), but two staff sharing a
// temporary password would be a real problem, so we assert rather than
// assume.
export function generateDistinctTempPasswords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`generateDistinctTempPasswords: bad count ${n}`);
  }
  const seen = new Set<string>();
  // Generous ceiling — only reachable if crypto.getRandomValues were
  // broken, in which case failing loudly beats looping forever.
  const maxAttempts = n * 100 + 100;
  let attempts = 0;
  while (seen.size < n) {
    if (attempts++ > maxAttempts) {
      throw new Error(
        `generateDistinctTempPasswords: could not generate ${n} distinct passwords`
      );
    }
    seen.add(generateTempPassword());
  }
  return [...seen];
}
