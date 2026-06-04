# HFSE SIS — Design Patterns (09a)

> Split out of [`09-design-system.md`](./09-design-system.md) for length. Contains §7 Craft standard, §8 Canonical patterns, and §9 Semantic color discipline.
>
> **Section numbers are preserved** — code comments that cite e.g. `09-design-system.md §7.6` keep resolving here by section number, not by file name. When in doubt, grep for `§N.M` across both files.

---

## 7. Craft standard

Every page must hit these seven. If it misses one, that's the next fix — not "add another card".

1. **Four voices of typography.** Eyebrow (mono uppercase) / Serif headline / Sans body / Mono micro-copy. If the page feels monotone, it's collapsed 2–3 voices into one.
2. **Primary CTA has depth.** Use the default `Button` — do not override its gradient + `shadow-button`. On hero CTAs, nothing extra needed; the default carries hover/active automatically.
3. **Cards use hairline borders + graduated shadows.** `shadow-xs` at rest; interactive cards promote to `shadow-md` on hover with a subtle `-translate-y-0.5` (see §8 card pattern).
4. **Icon tiles are crafted, not flat.** `bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile`. Placed in `CardAction` on cards so the grid auto-positions them top-right.
5. **Vertical rhythm: 16 / 24 / 32 / 48.** Don't cram. `space-y-5` between related stacks; `gap-4` inside grids; 48 between major regions.
6. **Empty states are never blank.** A `Card` with a centered muted icon, one-line serif title, a sentence of guidance, and an optional primary CTA. Anything less reads as broken.
7. **Mono trust strip at page bottom** (optional but encouraged on hub pages). `font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground` showing AY / audit-log / security context.

---

## 8. Canonical patterns

Copy-paste starting points. Every one of these is live in the codebase — file references included.

### Hero header (`app/(dashboard)/page.tsx`)

```tsx
<header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
  <div className="space-y-4">
    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {eyebrow}
    </p>
    <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
      {title}.
    </h1>
    <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
      {description}
    </p>
  </div>
  <div className="flex flex-wrap items-center gap-2">
    {/* optional badges / primary action / quick actions */}
  </div>
</header>
```

### Stat card grid (dashboard-01 `SectionCards` pattern)

```tsx
<div className="@container/main">
  <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  </div>
</div>
```

### Interactive quick-link card

```tsx
<Card className="@container/card group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
  <CardHeader>
    <CardDescription>{eyebrow}</CardDescription>
    <CardTitle className="font-serif text-xl">{title}</CardTitle>
    <CardAction>{/* gradient icon tile */}</CardAction>
  </CardHeader>
  <CardFooter className="flex-col items-start gap-4 text-sm">
    <p className="leading-relaxed text-muted-foreground">{description}</p>
    <Button asChild size="sm">
      <Link href={href}>
        {cta}
        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </Link>
    </Button>
  </CardFooter>
</Card>
```

### Data table with toolbar (`app/(dashboard)/grading/grading-data-table.tsx`)

Built on `@tanstack/react-table`. Canonical toolbar layout:

```tsx
<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
  <div className="flex flex-1 flex-wrap items-center gap-2">
    {/* Search input with icon */}
    {/* DropdownMenu with DropdownMenuCheckboxItem for facet filters */}
    {/* DropdownMenu for column visibility */}
    {/* Clear-all ghost button (conditional) */}
  </div>
  <Tabs value={status}>
    <TabsList>
      {/* status tabs with count badges */}
    </TabsList>
  </Tabs>
</div>

<Card className="overflow-hidden p-0">
  <Table>
    <TableHeader>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        {/* Sortable headers using a SortableHeader helper */}
      </TableRow>
    </TableHeader>
    <TableBody>{/* rows */}</TableBody>
  </Table>
</Card>

{/* Pagination bar */}
```

### Form wizard (`app/(dashboard)/grading/new/new-sheet-form.tsx`)

- One `Card` per logical step with `CardDescription="Step N · Title"` + `CardTitle`
- `FieldGroup` inside `CardContent` holding `Field` rows
- Summary card at the bottom with `CardFooter` holding the submit `Button`
- Never split one form across multiple pages when a single form with grouped cards works

### Sheet for secondary forms (`app/(dashboard)/admin/sections/[id]/manual-add.tsx`)

- Primary action button (default gradient) lives in the hero actions row
- Clicking opens `Sheet` from the right side
- `SheetHeader` (serif title + description) / scrollable `FieldGroup` body / `SheetFooter` with border-top holding Cancel (`SheetClose`) + Submit
- Auto-focus the first field on open; reset state on close

### Tabs with URL-driven navigation

```tsx
<Tabs value={selectedId}>
  <TabsList>
    {items.map((item) => (
      <TabsTrigger key={item.id} value={item.id} asChild>
        <Link href={`?term_id=${item.id}`}>{item.label}</Link>
      </TabsTrigger>
    ))}
  </TabsList>
</Tabs>
```

Use this pattern when the tab needs to be deep-linkable. Pure client-state tabs (no URL) can use the standard `TabsTrigger` without `asChild`.

### Level / group container card (`app/(dashboard)/admin/sections/page.tsx`)

When you need to group items (e.g. sections by level) and make the grouping _visually distinct_ from surrounding stat cards:

```tsx
<Card className="@container/card gap-0 py-0">
  <CardHeader className="border-b border-border py-5">
    <CardDescription>{groupKind}</CardDescription>
    <CardTitle className="font-serif text-[22px]">{groupLabel}</CardTitle>
    <CardAction>{/* icon tile */}</CardAction>
  </CardHeader>
  <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border bg-muted/30 px-6 py-3">
    {/* MetaBlock strip: small stats */}
  </div>
  <ul className="divide-y divide-border">{/* row per item */}</ul>
</Card>
```

The `gap-0 py-0` lets children render edge-to-edge; the muted meta strip and divided list visually separate a "group container" from a "stat card".

---

## 9. Semantic color discipline

This is a corporate trust product — **color is how users read state, action, and severity at a glance**. Every button, badge, and status panel must be colored by _purpose_, never by aesthetic preference. If two elements with different meanings look the same, the page has failed.

### 9.1 The semantic palette

| Role                     | Token                                                               | When to use                                                                          | Reads as                             |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| **Primary**              | `bg-primary` / `text-primary` / `from-brand-indigo`                 | The one CTA per view, active nav, focus rings, brand tiles, primary metric headlines | "Do this. This is the path forward." |
| **Destructive**          | `bg-destructive` / `text-destructive` / `border-destructive/*`      | Actions that are hard to undo, commit state, delete, lock, block                     | "Careful — this is final."           |
| **Mint (success/open)**  | `bg-brand-mint/30` / `border-brand-mint` / `text-ink`               | Healthy status (Open, Active, Available, Published)                                  | "All clear."                         |
| **Accent (info/config)** | `bg-accent` / `text-brand-indigo-deep` / `border-brand-indigo-soft` | Informational panels, configuration actions, approval-required states                | "Heads up — here's context."         |
| **Muted**                | `bg-muted` / `text-muted-foreground`                                | Neutral surfaces, table headers, secondary text, withdrawn/archived rows             | "Background. Deprioritized."         |

### 9.2 Buttons — colored by purpose, not by aesthetic

| Variant                     | Intent                      | Use for                                                                       |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `default` (indigo gradient) | **Primary path forward**    | Save, Submit, Create, the one CTA per view, Unlock (restoring the happy path) |
| `destructive` (solid red)   | **Commit / hard-to-undo**   | Lock sheet, Delete, Withdraw, Purge                                           |
| `outline` (indigo wash)     | **Configuration / editing** | Edit totals & slots, column toggles, secondary navigation triggers            |
| `ghost`                     | **Tertiary / inline**       | Clear filters, close icons, "change" inline triggers                          |
| `link`                      | **Inline navigation**       | "View audit log →", breadcrumbs                                               |

**Rules:**

- Exactly **one `default` button** per view. Two primary CTAs = no primary CTA.
- **Never** use `outline` for a destructive action. **Never** use `default` for a destructive action. Lock and Delete must be `destructive`, always.
- Don't override `variant` colors with per-instance `className` to express semantics — if the treatment is reusable, promote it to the variant in `components/ui/button.tsx`.

### 9.3 Status badges — one palette, three tones

All status indicators use `Badge variant="outline"` with one of three color recipes:

```tsx
// HEALTHY / OPEN / ACTIVE
<Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
  <Icon className="h-3 w-3" /> Open
</Badge>

// LOCKED / BLOCKED / ERROR
<Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive">
  <Icon className="h-3 w-3" /> Locked
</Badge>

// INFORMATIONAL / NEUTRAL / COUNT
<Badge variant="secondary" className="h-6">{count}</Badge>
```

`Badge variant="default"` and `variant="secondary"` alone (without the recipes above) are **not acceptable** for state badges — they don't carry enough color to differentiate severity at a glance.

### 9.4 Status panels (locked alerts, warnings, approval banners)

Don't use the default `<Alert>` for high-visibility status. Build a bordered status panel instead:

```tsx
<div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
    <Lock className="size-4" />
  </div>
  <div className="flex-1 space-y-1.5">
    <p className="font-serif text-base font-semibold text-foreground">
      Title states the condition
    </p>
    <p className="text-sm text-muted-foreground">
      Body explains what the user can do.
    </p>
  </div>
</div>
```

Swap the color family (`destructive` / `accent` + `brand-indigo-soft` / `brand-mint`) to match severity. Reference implementation: `app/(dashboard)/grading/[id]/page.tsx`.

### 9.5 Review checklist per page

- [ ] Exactly one `default` `Button` above the fold?
- [ ] Every button's variant matches its purpose (destructive for commit/delete, outline for config, default for primary path)?
- [ ] Every status badge uses the §9.3 recipes — mint for healthy, destructive for blocked — not plain `variant="default"`/`"secondary"`?
- [ ] Any locked / approval / error panel uses the §9.4 pattern, not a plain `<Alert>`?
- [ ] Key metrics read as headlines (serif, tabular-nums)?
- [ ] Color carries meaning, never decoration?

If every answer is yes, the page is on brand and legible. If any answer is no, fix that before shipping.

---

## 10. Legends

A legend is a **key**. Its visual must match the thing it documents — pixel-identical paint. If the legend chip is a gradient pill but the thing it labels is a solid wash, the key is broken; the user has to mentally translate, and color stops carrying meaning.

### 10.1 Two legend shapes — pick by what you're documenting

| What you're documenting                                                                                    | Use                                                            | Component                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recharts series, donut slice, stacked bar segment                                                          | **Gradient pill**                                              | `ChartLegendChip` (or `chartLegendContent(palette)` factory for recharts `<Legend content={…}>`)                                                                                                                       |
| **Cells / column headers in a table or grid** — including dense data-entry grids with native form controls | **Gradient pill, rendered both in the cell AND in the legend** | `ChartLegendChip` in the legend; for cells either render `ChartLegendChip` directly (calendar pattern) or apply the same gradient classes inline so the cell wash matches the chip pixel-for-pixel (wide-grid pattern) |
| Last resort — when the surface genuinely cannot render gradient pills                                      | **Tinted swatch** matching the cell wash exactly               | Bespoke `*LegendItem` helper that pulls its tint from the **same map** the cells use                                                                                                                                   |

**Default to the gradient-pill pattern.** It's the brand voice (matches the rest of `ChartLegendChip` usage across the SIS) and it elevates the legend from "a flat colored square" to a real chip. The flat-swatch fallback exists only because some surfaces (e.g. printed report cards, screenshot exports) can't render gradients reliably. Don't reach for it on a normal screen.

Never mix the two for one visualization. A wash-tinted column header documented by a gradient pill is the most common bug; a gradient series documented by a solid swatch is the inverse. Both break the key.

Reference implementations:

- **Calendar pattern** (gradient pill IN the cell + IN the legend): `components/attendance/calendar/calendar-cell.tsx` + `components/attendance/calendar/legend.tsx` — cell chips use `ChartLegendChip` directly, the legend strip uses the same `ChartLegendChip`, both keyed on the same `DAY_TYPE_LEGEND_COLOR` map
- **Wide-grid pattern** (gradient classes inline in the cell + `ChartLegendChip` in the legend): `components/attendance/wide-grid.tsx` — cells apply `STATUS_CHIP_GRADIENT[status]` directly to the wrapping div (so the native `<select>` stays interactive), column headers render a small `ChartLegendChip`, legend uses `ChartLegendChip` keyed on the same `STATUS_CHIP_COLOR` and `DAY_TYPE_CHIP_COLOR` maps

### 10.2 Single source of truth for the tint

The cells own the color map. The legend reads from it.

```tsx
// ✅ Single source — cell tint and legend swatch can't drift apart
const DAY_TYPE_HEADER_BG: Record<DayType, string> = {
  school_day: 'bg-muted/60 text-foreground',
  public_holiday: 'bg-destructive/10 text-destructive',
  // …
};

function DayTypeLegendItem({ dayType }: { dayType: DayType }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={
          'inline-flex size-7 rounded-md shadow-input ' +
          DAY_TYPE_HEADER_BG[dayType]
        }
        aria-hidden
      />
      <span className="text-[12px] font-medium text-foreground">
        {DAY_TYPE_LABELS[dayType]}
      </span>
    </span>
  );
}
```

```tsx
// ❌ Two sources — drift inevitable
<ChartLegendChip color="chart-4" label="School day" />   // teal gradient pill
// …elsewhere in the same file…
school_day: 'bg-muted/60 text-foreground',               // gray wash on the actual cell
```

If the cell's color map is exported, the legend imports it. If it's not, hoist it to module scope before the legend exists. **Never hand-pick a chip color that "looks similar" to the cell tint.**

### 10.3 Reuse `ChartLegendChipColor` for chart legends

When using gradient pills for a recharts visualization, the palette mapping (data key → `ChartLegendChipColor`) is per-chart and lives next to the chart. Don't sprinkle ad-hoc string colors:

```tsx
<Legend
  content={chartLegendContent({
    applied: 'chart-1',
    interviewed: 'chart-2',
    offered: 'chart-3',
    enrolled: 'fresh',
  })}
/>
```

### 10.4 Where legends live

- **Inside the chart card** — preferred for most charts. Place under the chart, not above. Use `chartLegendContent()` for recharts.
- **Standalone strip above a table/grid** — when one legend documents multiple visuals (e.g. a status row + a calendar-tint row in `wide-grid.tsx`), wrap in a `Card` with two labelled rows; mono-uppercase eyebrow per row.

### 10.5 Review checklist per legend

- [ ] Does each legend swatch have **identical paint** (color + finish — gradient vs wash) to the thing it documents?
- [ ] Is the swatch color pulled from the **same map** the cells / chart series use? (Not a "looks similar" hand-pick.)
- [ ] If the legend is for chart series, does it use `ChartLegendChip` / `chartLegendContent(palette)`?
- [ ] If the legend is for table or grid cell tints, does it use a bespoke `*LegendItem` swatch helper that reads from the cell's color map?
- [ ] Are no two distinct states using the same swatch color? (Duplicate `chart-4` for "School day" + "No class" was the bug that prompted this rule.)

If every answer is yes, the legend is a true key. If any answer is no, the user has to translate — fix it before shipping.

---
