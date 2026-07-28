# Compare Tab Band Report — Design Spec

Date: 2026-07-28

This redesigns the Compare tab's detail view to match the reporting format the
user already uses in `Lev_AI_Review.xlsx` (see `Output Example.png` for the
mockup this is based on). It replaces the current bracket/day-list view;
the 4 summary bubbles (Traditional Rate Revenue, AI Revenue, Variance,
Percent) added in the prior revision are unaffected and stay at the top.

## Why

The existing Compare tab groups visits by rate-card bracket and shows a
day-of-week breakdown per bracket, but doesn't break totals down by duration
band, and its `Traditional/AI $` totals are per-bracket, not per-band. The
user's actual reporting need (and the reference spreadsheet they already
rely on) is a band-by-band, day-by-day breakdown showing Count, Traditional
PARCs revenue, and AI Pricing revenue for each rate band within each rate
card section.

## Scope decisions

- **Replaces** the current per-bracket expandable list (`renderCompare`'s
  bracket loop, the Unroll/Roll-up buttons, and the "Ignore Validations"
  toggle). Validation-aware splitting (Normal vs Validation) is explicitly
  deferred — it gets reintroduced in a later pass once this band-level
  structure is confirmed correct. Removing the toggle now avoids a dead
  control that does nothing.
- The summary bubbles and their underlying `aggregateByBracket`/
  `computeDeltaPercents` totals are **unchanged** — they're a separate
  at-a-glance figure, computed the same way as today.

## Report structure

Sections stack vertically, top to bottom, in this order:
1. **Early Bird** — only if `state.earlyBird.enabled` is true. Has no
   duration bands (it's a single flat price), so it renders as exactly one
   row per table.
2. **Each rate card**, in `state.rateCards` array order (i.e., the order
   the user created them in the Setup tab — Day, Evening, Weekend, or
   whatever names/order they used).

Each section is its own labeled block containing **3 stacked tables**,
matching the reference spreadsheet:

1. **Count** — number of qualifying visits
2. **Traditional PARCs ($)** — summed static/traditional price
3. **AI Pricing ($)** — summed actual/AI price

**Rows** within each table = that card's duration bands, sorted by
`upToMin` ascending (Early Bird's section has exactly one row). Each row
shows:

- **Time Window** — the card's Start Time–End Time (e.g. "6:00 AM–4:00 PM");
  for Early Bird, its entry window.
- **Up to (minutes)** — the band's `upToMin` value (Early Bird shows "—",
  since it has no duration band).
- **Rate ($)** — the band's `rate` (Early Bird shows its flat price).
- **Day columns** — one column per day the card is actually configured for
  (`card.days`), Monday-first order. A card can only ever produce visits on
  its own configured days, so restricting columns to those days
  automatically satisfies "don't show days with no data" without needing
  fragile zero-count column-hiding logic. (For Early Bird, use
  `earlyBird.days` the same way.)

The **Count**, **Traditional PARCs**, and **AI Pricing** tables for a given
section all share the same rows and day columns — only the numbers in each
cell differ (count vs. summed static price vs. summed actual price).

## Matching rules for what counts in a cell

A visit counts toward band row *B*, day column *D* in a given section if
**all** of the following hold:

1. The visit's matched rate card is this section's card (by `bracketName`
   equality — same mechanism `aggregateByBracket` already uses), or, for
   the Early Bird section, `bracketName === 'Early Bird'`.
2. The visit's matched band is band *B* — this requires `processVisit` to
   additionally expose *which* band it matched (e.g. `bandUpToMin`), not
   just the resulting price, so the report can group by band without
   recomputing `selectBand` itself.
3. The visit's `entryDate.getDay()` equals day *D*.
4. **`GPV Amt > 0`** — this is a qualifying gate, not a summed value. A
   visit with `GPV Amt` of exactly 0 (or blank/unparseable, i.e. parses to
   0) is silently excluded from every cell of this report. This is separate
   from the existing `special_event` / `over_cutoff` / `no_matching_rate_card`
   exclusion buckets, which still apply first (a visit excluded there never
   reaches this report at all). The **dollar amounts summed** in the
   Traditional/AI tables are the existing `staticPrice`/`actualPrice`
   fields (from the rate table / `Price Amt` column) — GPV is only the
   gate, not the summed quantity.

No new "excluded because GPV was 0" bucket is added in this pass — those
visits are simply not shown in this report (they still count toward the
existing overall totals bubbles and excluded-visit summaries at the bottom,
unchanged).

## Bug fix: ":59 means inclusive" end-time matching

Discovered while defining the matching rule above: a rate card whose End
Time's minute component is **:59** (e.g. "11:59 PM", "4:59 PM") is meant to
represent "through the end of that final minute," but the current
`RateEngine.findMatchingRateCard` always uses a strict `<` comparison
against `endMin`. This means a visit entering at *exactly* 11:59 PM
(`minutes === endMin === 1439`) currently fails to match a card ending at
11:59 PM at all (`1439 < 1439` is false) — an existing accuracy bug, not
specific to this report. This is a **core engine fix**, since it affects
real pricing/matching everywhere `findMatchingRateCard` is used, not just
this new report:

> When a card's `endMin % 60 === 59`, the upper-bound comparison becomes
> `minutes <= endMin` instead of `minutes < endMin`. All other end times
> (not ending in :59) keep the existing exclusive `<` comparison. This
> applies only to `findMatchingRateCard`'s own inline comparisons (it does
> not call the shared `RateEngine.withinRange` helper), so Early Bird's
> entry/exit window checks are unaffected — this fix is scoped to rate-card
> time-window matching only.

## Visual styling

No new visual language — this reuses the existing design system exactly as
established for Setup:

- Section tables render inside `.card` (same border/radius/padding/surface
  color as every other card in the app, including dark mode).
- Section headers use the existing `.sub`-style muted caption convention.
- Any `<select>` elements reuse the global `select{...}` styling already
  added for Setup's time pickers.
- Zebra striping on band rows reuses the existing `.dayRow.even`/`.odd`
  pattern (alternating `var(--surface)`/`var(--bg)`) already built for the
  prior Compare-tab-polish revision.
- Colors stay within the existing closed palette (`--brand`, `--teal`,
  `--orange`, `--muted`, `--text`) — no new hues introduced.

## Engine changes

- `RateEngine.processVisit` gains a `bandUpToMin` field on its returned
  object for successfully-priced, non-excluded, non-Early-Bird visits
  (`null` for Early Bird visits, since they have no band).
- A new pure function (exact name decided at plan time, e.g.
  `RateEngine.buildRateReport(processedVisits, rateCards, earlyBird)`)
  builds the section/row/day-cell structure described above from already-
  processed visits — no new CSV parsing or duration/price computation,
  just grouping and summing what `processVisit` already produces.
- `RateEngine.findMatchingRateCard` gets the :59-inclusive fix described
  above.

## What's unchanged

- CSV parsing, Reconciliation Cutoff, "Load to Compare" button.
- The 4 summary bubbles and their `aggregateByBracket`/
  `computeDeltaPercents` totals.
- Excluded-visit summary counts (special event / over cutoff / no matching
  rate card) at the bottom of the Compare tab.
- Setup tab, coverage grid, Early Bird UI — untouched by this revision.

## Reference materials used

- `Output Example.png` — user-provided screenshot of the target report
  layout (Day/Evening/Weekend sections, each with Count / Traditional
  PARCs / AI Pricing tables, band rows, Mon–Fri or Sat–Sun day columns).
  Confirmed with the user that the "only show days with data" rule is
  satisfied by restricting columns to the card's configured days, and that
  the 3-table-per-section structure (not just a single count + single $
  table) is the intended layout.
