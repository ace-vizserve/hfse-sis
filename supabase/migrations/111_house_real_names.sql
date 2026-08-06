-- 111_house_real_names.sql
--
-- Replaces migration 110's four placeholder house rows with HFSE's real ones,
-- and splits a house's colour from its title so neither has to stand in for the
-- other.
--
-- WHY. 110 shipped `House 1`–`House 4` because nobody had confirmed what the
-- houses were called. Chandana confirmed on 2026-08-06.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THE SPLIT
--
-- Her picture is headed "House Colours, Names & Meanings" and gives three
-- distinct things per house:
--
--     colour   Orange House
--     name     The Flame
--     meaning  Courage · Energy · Drive · Leadership
--
-- Asked whether the screen should read "Orange House" or "Orange House – The
-- Flame", she answered "for now, the house name would do" — which is genuinely
-- ambiguous, because by her own picture's vocabulary "the name" is *The Flame*,
-- while in ordinary use a house's name is *Orange House*. Cramming both into
-- one `name` column forces a guess, and forces another migration whenever the
-- guess turns out wrong.
--
-- So they are separate columns and nothing has to be guessed: `name` stays the
-- colour ("Orange House") and remains the only thing rendered today, which
-- satisfies the cautious reading of her answer. `title` and `core_values` are
-- stored and displayed nowhere. They exist because the school gave us the data
-- and it would otherwise be lost to a screenshot — and because the logos Mr
-- Lloyd designed are due "next year", at which point the title is what sits
-- beside one.
--
-- ⚠ `name` therefore does NOT mean what her picture's "Names" column means.
-- That mismatch is deliberate: renaming `name` -> `colour_name` would churn the
-- chip, the tile, the picker, the audit humanizer and the students-list facet
-- to fix a vocabulary clash that this comment fixes for free.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THE COLOUR TOKENS ARE UNTOUCHED
--
-- 110's placeholders happened to be seeded in a colour order matching what she
-- confirmed, so every `colour_token` is already correct and no design token
-- changes: `house-1` is orange, `-2` blue, `-3` green, `-4` yellow (verified in
-- app/globals.css). Only `name` and `sort_order` move.
--
-- ⚠ WHY `code` IS NOT RENAMED, THOUGH IT IS TEMPTING
--
-- `H1`–`H4` are opaque and nothing reads them — `lib/sis/houses.ts` carries
-- `code` through and no component uses it. Renaming them to ORANGE/GREEN/BLUE/
-- YELLOW would read better and is safe today.
--
-- It is a trap tomorrow. Migration 110 seeds with `on conflict (code) do nothing`
-- and its header says it is safe to re-run. If the codes changed here, a re-run
-- of 110 would find no conflict on `H1`–`H4` and INSERT FOUR FRESH PLACEHOLDER
-- ROWS — leaving eight houses, four named "House 1"–"House 4", with no error.
-- `code` is 110's idempotency key and it belongs to 110. The house import keys
-- on it for the same reason: a code cannot drift, a name just did.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SORT ORDER
--
-- Chandana's picture lists them Orange, Green, Blue, Yellow, and that is the
-- order used here — the artefact she designed, rather than the order she
-- happened to type in a chat message (Blue, Green, Yellow, Orange). This drives
-- the house picker on the permanent record and the facet on the students list.
--
-- Idempotent: additive columns, and every update is keyed on `code`.

alter table public.houses
  add column if not exists title       text,
  add column if not exists core_values text[];

comment on column public.houses.title is
  'The house''s symbol name — "The Flame", "The Leaf", "The Ocean", "The Sun". What her picture calls the Name. Deliberately NOT rendered anywhere yet: the school asked for the colour name alone for now, and this is what will sit beside Mr Lloyd''s logo when that lands.';

comment on column public.houses.core_values is
  'The four values each house stands for. Not rendered anywhere. Stored so the school''s own words survive somewhere other than a screenshot.';

update public.houses set
  name        = 'Orange House',
  title       = 'The Flame',
  core_values = array['Courage', 'Energy', 'Drive', 'Leadership'],
  sort_order  = 1
where code = 'H1';

update public.houses set
  name        = 'Green House',
  title       = 'The Leaf',
  core_values = array['Growth', 'Balance', 'Endurance', 'Renewal'],
  sort_order  = 2
where code = 'H3';

update public.houses set
  name        = 'Blue House',
  title       = 'The Ocean',
  core_values = array['Wisdom', 'Integrity', 'Stability', 'Excellence'],
  sort_order  = 3
where code = 'H2';

update public.houses set
  name        = 'Yellow House',
  title       = 'The Sun',
  core_values = array['Optimism', 'Creativity', 'Brilliance', 'Innovation'],
  sort_order  = 4
where code = 'H4';

comment on table public.houses is
  'HFSE''s four houses, confirmed by Chandana 2026-08-06 (migration 111); 110''s placeholder names are gone. A house has a COLOUR name (`name`, e.g. "Orange House") and a TITLE (`title`, e.g. "The Flame") — her own picture separates the two, and only `name` is rendered today. `code` is 110''s idempotency key: never rename it.';
