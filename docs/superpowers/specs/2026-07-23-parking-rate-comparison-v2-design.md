# Parking Rate Comparison Tool — v2 Design Spec (Setup UX + Compare Redesign)

Date: 2026-07-23

This is a revision to `2026-07-23-parking-rate-comparison-design.md` (the v1 spec,
already built — Tasks 1-13 of the original plan). v1 shipped a working Engine and a
functional but rough Setup/Compare UI; using it surfaced real gaps described below.
This spec covers fixing those gaps, not re-deriving the calculation engine (which
is correct and unchanged — see `## What's Unchanged` at the end).

## Why This Revision

Building and using v1 surfaced two categories of problem:

1. **Genuine bugs, not user error:**
   - The rate ladder's Price field only appears after clicking "+ Add Tier" —
     a new rate card has an empty ladder and no visible way to enter a dollar
     amount until that extra click happens. This is the single most important
     field in the whole tool and it was effectively hidden.
   - `runComparison()` only fires automatically when a CSV is dropped. Editing
     rate cards or the Early Bird rule afterward never re-runs it, so the
     Compare tab silently shows stale (or, if rates weren't finished yet when
     the file was dropped, near-empty) results with no indication anything is
     out of date.
   - The Early Bird "Enabled" checkbox updates state correctly, but nothing
     hides its sub-fields when unchecked — the whole block always looks fully
     configured and "on," which reads as a broken toggle even though the
     underlying logic works.

2. **UX/output-shape gaps found by comparing against the user's own manual
   Excel reconciliation** (`Lev_AI_Review.xlsx`, "Sheet2"): the user's own
   working model breaks results out by individual day-of-week and expresses
   the delta as a percentage, not just a raw dollar amount — richer than what
   v1's Compare tab showed.

## Setup Tab Changes

### Remove "Copy to other days"

The per-card multi-day checkboxes (Days Valid) already let a user select
Mon-Fri or any combination directly on one card — the separate "Copy to other
days" panel (duplicate-card-to-new-days feature) turned out to be redundant
once the day checkboxes were actually used in practice. Remove the feature
entirely: the "Choose days..." button, its hidden panel, and the
`openCopy`/`applyCopy` click-handler branches.

### Time inputs become dropdowns

Every time-of-day field (rate card Start/End, Early Bird's Entry window
start/end and Exit time) changes from a single `<input type="time">` to three
adjacent `<select>` elements: **Hour** (1-12), **Minute** (00/15/30/45),
**AM/PM** (AM/PM). This is a pure input-widget change — internally, these
three values still combine into the same minutes-since-midnight integer the
Engine already expects (`RateEngine.timeStringToMinutes`/`minutesToTimeString`
stay as the internal representation; the dropdown trio just needs its own
small helper to convert to/from that same integer, replacing the browser's
native time-string parsing).

### Rate ladder defaults to one visible tier

`newRateCard()` now initializes `ladder` with one default entry (e.g.
`{thresholdMin: 60, price: 0}`) instead of an empty array, so every new card
immediately shows a Price field — no extra click required to discover where
to enter a dollar amount. The "+ Add Tier" button is relabeled "+ Add Price
Tier," and the ladder column's "Price" label becomes "Price ($)" for clarity.

### Early Bird fields hidden until Enabled

The Early Bird `.card` block now shows **only** the "Enabled" checkbox by
default. Checking it reveals the rest of the block (entry window, exit
condition, exit time, price, days) in place; unchecking hides them again
(the underlying `state.earlyBird` values are preserved while hidden — hiding
is a display change only, not a reset). This makes checking the box visibly
*do* something, instead of a checkbox next to an always-visible, always-
looking-configured block.

## Coverage Grid (New)

A new panel at the very top of the Setup tab, above the rate card list and
above the (now-collapsible) Early Bird block:

- **7 rows**, labeled Monday through Sunday.
- **24 columns per row**, one per hour, left to right, midnight → midnight
  (i.e. column 1 = 12am-1am, column 24 = 11pm-12am).
- A cell is **green** if any rate card's Days Valid + Times Valid covers that
  day + hour; otherwise it's left **blank/white**.
- Recomputed live as rate cards are added, edited, or deleted — no manual
  refresh needed for the grid itself (unlike the Compare tab, which needs the
  explicit "Load to Compare" button below).
- **Reflects rate-card coverage only** — Early Bird is a supplementary
  override, not a base rate, so it does not count toward "covered." This
  matches exactly what the grid is meant to catch: gaps that would produce a
  `no_matching_rate_card` exclusion in the Compare tab.
- **Purely informational, never a warning or validation gate.** Many
  properties intentionally close for part of the day; a blank cell just means
  "no rate card covers this hour," which is often correct. No error styling,
  no blocking behavior.
- A cell's granularity is one hour; a rate card covering only part of an hour
  (e.g. a card ending at 4:30am) still marks that whole hour cell green — this
  is a coarser view than the Engine's actual minute-level matching, which is
  fine since the grid's job is "did I roughly forget a chunk of time," not
  minute-perfect validation.

## "Load to Compare" Button

A new button on the Setup tab, placed directly below the CSV drop zone.
Clicking it calls the same `runComparison()` the file-drop already triggers
automatically, so results can be refreshed anytime after editing rates
without re-dropping the file. Both triggers coexist:

- Dropping/selecting a file still auto-runs the comparison once immediately
  (unchanged from v1 — this is a convenience for the common case of building
  rates first, then loading the file last).
- "Load to Compare" lets the user re-run it on demand afterward, as many
  times as needed, after any further rate/Early Bird/cutoff edits.

If no file has been loaded yet, clicking "Load to Compare" is a no-op (same
guard `runComparison()` already has: `if (!state.visits.length) return;`).

## Compare Tab Redesign

### Day-of-week breakdown

Each bracket now breaks its numbers out by the **individual day-of-week** of
each visit's entry, rather than reporting one blended total per bracket. A
bracket that covers Mon-Fri (as most do) shows 5 day-of-week sub-rows under
its bracket-level totals; a bracket that only covers one day shows one.

This adds a grouping dimension to `RateEngine.aggregateByBracket`'s output:
within each bracket, visits are additionally grouped by
`entryDate.getDay()` (0=Sun..6=Sat, the same convention used everywhere else
in the Engine) into up to 7 day-rows, each carrying its own
count/staticTotal/actualTotal/delta/validationTotal, and — when unrolled —
its own Normal/Validation sub-split (identical shape to the bracket-level
Normal/Validation split from v1, just now computed per day instead of only
per bracket).

### Delta shown as dollars and both percentages

Every place a dollar delta is shown (overall totals, per-bracket totals, and
now per-day-of-week rows) also shows two percentages side by side:

- **delta ÷ static** — "the AI charged X% more/less than the static rate
  would have." (e.g. $1.52 uplift on a $10.00 static price = +15.2%)
- **delta ÷ actual** — "the uplift is Y% of what was actually charged."
  (e.g. $1.52 uplift on an $11.52 actual charge = +13.2%)

Both are computed and displayed together; neither replaces the other. Guard
against divide-by-zero: if the denominator (static or actual, respectively)
is exactly 0 for a given row, show that percentage as "—" rather than `NaN`
or `Infinity`.

### Updated output shape

```
Overall                                        (totals across all included brackets)
  Static: $8,500.00  Actual: $9,795.00  Delta: +$1,295.00  (+15.2% of static / +13.2% of actual)

Weekday Day (4am-4pm)                          Visits: 850
  Static: $8,500.00  Actual: $9,795.00  Delta: +$1,295.00  (+15.2% / +13.2%)
  Mon   Visits:180  Static:$1,800.00  Actual:$2,070.00  Delta:+$270.00  (+15.0% / +13.0%)
    [Unroll ▾] → Normal / Validation split for Monday specifically
  Tue   Visits:165  Static:$1,650.00  Actual:$1,890.00  Delta:+$240.00  (+14.5% / +12.7%)
    [Unroll ▾] → ...
  ... (Wed-Fri)

Weekend (All Day)                              Visits: 320
  Static: $3,200.00  Actual: $3,050.00  Delta: -$150.00  (-4.7% / -4.9%)
  Sat   Visits:160  ...
  Sun   Visits:160  ...
```

The existing v1 mechanics carry over unchanged onto this new shape:
- **Global "Ignore Validations" switch**: when ON, day-of-week rows show one
  blended number each (no Normal/Validation split computed/available); when
  OFF, each day-of-week row gets its own `[Unroll ▾]` control.
- **Per-row Unroll ▾ / Roll up ▲** is disabled (grayed out) whenever Ignore
  Validations is ON — same visual treatment as v1, just now attached to each
  day-of-week row instead of only the bracket row.
- **Excluded — Special Event / Over cutoff / No matching rate card** summary
  lines are unchanged from v1.
- "Load to Compare" and the auto-run-on-drop both call the same
  `runComparison()` → `renderCompare()` pipeline; the redesigned output shape
  above is just what `renderCompare()` now produces.

## What's Unchanged

The Calculation Engine's core logic from v1 is correct and stays as-is:
- Bracket selection by entry-time day/time matching (`findMatchingRateCard`,
  `withinRange`).
- Duration ladder lookup (`lookupLadderPrice`), grace period handling.
- Early Bird eligibility (`checkEarlyBird`), including its documented
  same-calendar-day exit-check scope limitation.
- Exclusion categories (special event, over cutoff, no matching rate card)
  and their triggering conditions.
- `isValidated` allowlist check (`coverageType.indexOf('Validation') === 0`).
- CSV parsing (TSV/UTF-16LE detection, Grand Total row filtering).

Only the **aggregation output shape** (`aggregateByBracket`) gains the new
day-of-week grouping level and the percentage calculations — the underlying
per-visit `staticPrice`/`actualPrice`/`isValidated` values it aggregates are
unchanged.

Persistence (Save/Load Rate Table JSON) and the header/nav visual layout are
out of scope for this revision — v1 shipped without persistence (cut for
time), and the header/nav layout was already fixed separately.

## Reference Materials Used (This Revision)

- `Lev_AI_Review.xlsx`, "Sheet2" (the user's own manual AI-pricing
  reconciliation, using `COUNTIFS`/`SUMIFS` against the raw visits sheet) —
  confirmed a three-way **Count / Sum (static) / AI Pricing** breakdown
  structured with **individual days of the week as columns** and time/duration
  buckets as rows, which is what motivated the day-of-week breakdown above.
