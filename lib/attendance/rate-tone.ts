// Rate → semantic health band. Drives text color everywhere an attendance
// rate renders (the lookup dialog's hero, the term sheet summary table).
// Thresholds match the rest of this module family — don't invent a second
// set of bands elsewhere.
export function rateTone(rate: number): {
  text: string;
  stroke: string;
  label: string;
} {
  if (rate >= 95)
    return {
      text: 'text-brand-mint',
      stroke: 'stroke-brand-mint',
      label: 'Excellent',
    };
  if (rate >= 85)
    return {
      text: 'text-brand-amber',
      stroke: 'stroke-brand-amber',
      label: 'Watch',
    };
  return {
    text: 'text-destructive',
    stroke: 'stroke-destructive',
    label: 'At risk',
  };
}
