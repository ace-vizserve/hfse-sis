// A non-exam masterfile cell is a letter; the report card derives the letter
// from a numeric (numericToLetter: A>=90, B>=85, C>=80, IP<80). Store a mid-band
// integer so the derived letter matches. The numeric itself is never displayed.
const BAND: Record<string, number> = { A: 95, B: 87, C: 82, IP: 70 };

export function letterToRepresentative(letter: string): number | null {
  return BAND[letter.trim().toUpperCase()] ?? null;
}
