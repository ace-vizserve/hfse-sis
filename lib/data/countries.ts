import { Country } from 'country-state-city';

// Canonical country-name list for the nationality field (student + all 3
// parent slots). Only `name` is used — this app has no need for the
// package's iso codes, phone codes, or geo data. Deduplicated because a
// couple of territories in the upstream dataset share a display name.
const rawNames = Country.getAllCountries().map((c) => c.name);

export const COUNTRY_NAMES: readonly string[] = Array.from(
  new Set(rawNames)
).sort((a, b) => a.localeCompare(b));

export const COUNTRY_NAME_SET: ReadonlySet<string> = new Set(COUNTRY_NAMES);
