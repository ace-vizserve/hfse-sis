// Read-only: is migration 182 (four more P-Files school-form slots) applied to
// production? Selects the eight new columns from every AY documents table.
// Writes nothing.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-migration-182.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

const COLUMNS = [
  'letterOfOffer',
  'letterOfOfferStatus',
  'mediaConsent',
  'mediaConsentStatus',
  'whatsappConsent',
  'whatsappConsentStatus',
  'orientationChecklist',
  'orientationChecklistStatus',
].join(', ');

async function main() {
  const { data: ays, error } = await sb
    .from('academic_years')
    .select('ay_code')
    .order('ay_code');
  if (error) throw error;

  let allPresent = true;
  for (const { ay_code } of ays ?? []) {
    const table = `ay${String(ay_code).slice(2)}_enrolment_documents`;
    const { error: colErr } = await sb.from(table).select(COLUMNS).limit(1);
    if (colErr) {
      allPresent = false;
      console.log(`${table}: MISSING —`, colErr.message);
    } else {
      console.log(`${table}: all 8 columns present`);
    }
  }
  console.log('182 applied everywhere:', allPresent);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
