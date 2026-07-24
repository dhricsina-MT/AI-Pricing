# Setup Tab Redesign — Design Spec (Band-Based Rates + Coverage Grid Overhaul)

Date: 2026-07-24

This is a revision to `2026-07-23-parking-rate-comparison-v2-design.md` (v2,
already built). Using v2 surfaced that its Setup tab layout was broken
(unstyled `<select>` elements, vertically-stacked time dropdowns, no default
rate card, a confusing "Threshold" ladder field) and that the pricing model
itself needed to change shape. This spec covers the Setup tab rebuild and the
engine model change it requires. The Compare tab (day-of-week breakdown, dual
delta percentages, Unroll/Ignore Validations) is confirmed working and stays
as-is — it consumes whatever bracket names the new rate cards produce, no
redesign needed there.

## Why This Revision

Two mockups (`TOP Interface.png`, `Rate Table Section.png`) and a walkthrough
of a real example ("3 rate bands from 6am to 4pm: 15-60, 60-120, 120-1440
minutes") revealed the rate model itself was wrong, not just the UI:

- **Rate cards are duration bands, not containers for a duration ladder.**
  Today, one rate card holds a nested table of duration tiers ("Threshold
  (min)" + price, with "+ Add Price Tier"). The real mental model is
  different: **each band is its own rate card** (Name, one flat Rate, a
  Start/End time window, Days, and a single "Up to (minutes)" duration
  cutoff). Multiple cards intentionally share an identical Start/End/Days
  window to form a multi-band group — e.g. three cards all "6am–4pm" with Up
  To 60 / 120 / 1440 — rather than one card owning three nested tiers.
- **No CSS at all for `<select>` elements** caused every dropdown (time
  pickers, Exit Condition) to render in the raw unstyled browser default,
  clashing with the rest of the styled UI — this was the "fonts are all
  wrong" complaint.
- **Time-picker selects were stacked vertically**, not laid out
  left-to-right (Hour → Min → AM/PM) — because they inherited the
  `.ctl{flex-direction:column}` layout meant for a single label+input pair.
- **The rate card list started empty**, requiring a click on "+ Add Rate
  Card" before the single most important field (the price) was even
  reachable.
- **Overnight windows** (e.g. a 6pm–4am evening rate) need to be understood
  as one continuous rule spanning two calendar days, not an error — but nothing
  in the coverage grid or matching logic accounted for the day-boundary
  crossing.

## Global Settings (Coverage Grid card header row)

Per `TOP Interface.png`: the coverage-grid card's title row also holds the
global controls, right-aligned:

- **No Grace Period setting.** Descoped entirely — it was redundant with the
  band system itself. If a lot wants a free initial period, that's just a
  band with `rate: 0` and its own `upToMin` cutoff, same as any other band. A
  duration that isn't covered by any band (nothing in its group's range
  reaches down that low) falls through to the existing `no_matching_rate_card`
  exclusion, matching how the reference spreadsheet handles sub-threshold
  visits (excluded from Count/Sum/AI-Pricing entirely, not counted at $0).
- **Add Early Bird** checkbox — same checkbox that exists today
  (`state.earlyBird.enabled`), relocated into this header row. Checking it
  expands the existing Early Bird fields (entry window, exit condition/time,
  price, days) directly below the coverage grid, using the same
  show/hide-on-toggle behavior already built (Task 3 of the prior revision) —
  just relocated, not re-architected.
- **Reconciliation Cutoff (hours)** is unchanged and stays where it already
  lives, next to the CSV drop zone. Neither mockup touches it.

## Coverage Grid

- Hour header labels (`12a, 1a, 2a, … 11p`) rendered above the grid, one per
  column.
- All 24 hourly cells per row stretch to fill the card's full width equally
  (`flex:1` each) — today's grid uses fixed 16px cells stranded on the left
  with the rest of the card empty.
- **Three cell states**, computed live as rate cards are added/edited/deleted:
  - **Blank** — no rate card covers that day+hour.
  - **Green** — exactly one distinct window covers it.
  - **Red** — two or more *different* windows collide there. Cards that
    intentionally share an identical `(days, startMin, endMin)` triple count
    as **one** window (a band group), not a conflict — only a genuine
    mismatch (different start/end/days that happen to overlap in time)
    produces red.
- **Overnight cards** (where `endMin < startMin`, e.g. 6pm–4am) light up
  *both* halves correctly: the evening portion on the day they're tagged to,
  and the spillover hours (midnight to `endMin`) on the **next** calendar
  day's row. This is display-only bookkeeping in the grid; see the Engine
  section for the matching-logic equivalent.
- A short text line below the grid lists any active conflicts by card name
  (e.g. "Weekday Day and Weekend Rate both cover Tue 10am–12pm"). Nothing is
  blocked — this is informational, same as the grid's existing "gaps are
  often intentional" framing for blank cells.

## Rate Card (redesigned, per `Rate Table Section.png`)

Each card represents **one duration band**:

- **Row 1:** `Name` (text) | `Rate` (number, $) — a single flat price,
  replacing the entire ladder/tier table and its "+ Add Price Tier" button.
- **Row 2:** `Start Time` label, then Hour/Min/AM-PM selects laid out
  left-to-right (fixing the vertical-stack bug — these need a horizontal
  flex row, not the column-flex `.ctl` wrapper used for label+single-input
  pairs).
- **Row 3:** `End Time` label, then Hour/Min/AM-PM selects, same column
  widths as Row 2 so Start and End visually align.
  - A read-only **"Next Day"** indicator appears next to End Time whenever
    `endMin < startMin` (i.e. the window crosses midnight) — auto-computed
    from the two times, not a separate field a user sets manually.
- **Row 4:** Day-of-week checkboxes (Mon–Sun) + the existing preset buttons
  (`All days`, `Weekday (Mon-Fri)`, `Weekend (Sat-Sun)`) — unchanged from
  today, kept as-is.
- **No Grace Period field at all** — removed entirely (see above).
- The "Up to" field is a normal, always-visible numeric input (minutes),
  labeled clearly as "Up to (minutes)" instead of the confusing "Threshold
  (min)." `newRateCard()` pre-fills it with `15` as a starting default (the
  same number grace used to default to), but it's just an ordinary editable
  field the user can change to anything — not a special first-band behavior.
- **Delete button**: absent on the first/default rate card (there must
  always be at least one, so it's not removable); present (orange outline,
  same `.btnDanger` styling) on any card added afterward via "+ Add Rate
  Card."
- `newRateCard()` seeds `state.rateCards` with one default card on page load
  — no more empty list requiring a click before any input is visible.

### Matching logic (band groups + day-boundary crossing)

Given an entry timestamp:

1. Find the set of rate cards whose `(days, startMin, endMin)` window
   contains the entry time. This check must be **day-boundary aware**: for a
   card with `endMin < startMin` (overnight), an entry falling in the
   pre-dawn portion (`minutes < endMin`) matches if `card.days[previous day]`
   is true — not `card.days[today]`, since the window was tagged to the
   *previous* calendar day. An entry falling in the evening portion
   (`minutes >= startMin`) still matches on `card.days[today]` as before.
2. Among the matching cards (a band group — normally sharing an identical
   window), sort by `upToMin` ascending.
3. A visit matches a given band if:
   `duration >= previousBand.upToMin (or 0, for the lowest band in the group)`
   **and** `duration < thisBand.upToMin`. Every duration `>= 0` always lands
   in some band — there's no separate "too short, excluded" gap. A lot that
   wants an initial free period just adds its own `rate: 0` band with the
   appropriate `upToMin`, same as any other band; nothing special-cased.
4. The band with the highest `upToMin` in a group is open-ended — it also
   catches any duration `>= its lower bound`, even beyond its own `upToMin`
   value. This is how a single-card "evening flat rate" (one band, one high
   `upToMin` like 1440) covers an entire overnight stay regardless of exact
   length.

No overlap-blocking validation is implemented in this pass (explicitly
descoped — flagging via the coverage grid's red cells is enough for now).

## Compare Tab — Visual Polish

The structure stays as-is (confirmed above), but its visual styling needs to
actually match the rest of the app and read cleanly at a glance:

- **Quick-view summary bubbles** at the very top of the Compare tab, above
  the existing per-bracket list: four compact stat cards in a horizontal
  row, using the same `.card`/brand styling as the rest of the app —
  - **Traditional Rate Revenue** — `result.totals.staticTotal`
  - **AI Revenue** — `result.totals.actualTotal`
  - **Variance** — `result.totals.delta` (signed, `$` formatted)
  - **Percent** — `result.totals.percentOfStatic` (the headline "AI priced
    X% higher/lower than the static table would have" number; both
    percentages remain available in the detailed per-bracket/per-day rows
    below, this bubble just surfaces the primary one)
  - All four bubbles are the **same fixed size** (equal width/height, not
    proportional to their content), laid out in a row whose total width
    matches the width of the bracket list/data below it — the row does not
    stretch to fill the full page/screen width.
- **Consistent typography** — the per-bracket/per-day list uses the same
  font sizes, weights, and muted/text color variables already defined for
  Setup (no ad hoc inline styling that drifts from the rest of the app).
- **Zebra striping** on the day-of-week rows within each bracket, using the
  existing palette (`var(--bg)` light / `var(--surface)` white alternating),
  for easier scanning down a bracket with several day rows — no new colors
  introduced.

## Engine Changes

- `card.ladder` (array of `{thresholdMin, price}`) is replaced by two flat
  fields: `card.rate` (number) and `card.upToMin` (number).
- `card.graceMin` and any grace-period concept is removed entirely — no
  replacement global setting. The lowest band in a matched group implicitly
  starts at duration `0`.
- `RateEngine.lookupLadderPrice` is replaced by the band-matching logic
  described above (new function, e.g. `RateEngine.priceForBand` or similar —
  exact naming decided at plan time), operating across the *set* of cards
  in a matched window rather than one card's internal ladder array.
- `RateEngine.findMatchingRateCard` gains day-boundary-aware matching
  (checks the previous day for entries in an overnight card's pre-dawn
  spillover), and now needs to return the **matched band group**, not a
  single card, so the duration-based band selection (step 2–4 above) can run
  within it.
- A new coverage/conflict-detection helper computes, per day+hour, how many
  *distinct* windows (not band-group members) cover that cell — 0 → blank,
  1 → green, 2+ → red — and a list of which named cards conflict where.
- `RateEngine.aggregateByBracket`, `computeDeltaPercents`, and `renderCompare`
  are unchanged — they already group by `bracketName` (the matched card's
  `name`), which now naturally reflects band-level names.

## What's Unchanged

- Compare tab: day-of-week breakdown, dual delta percentages (÷static,
  ÷actual with divide-by-zero guards), Ignore Validations / per-day-row
  Unroll, excluded-visit summaries (special event / over cutoff / no
  matching rate card).
- Early Bird's own matching logic (`checkEarlyBird`) and its precedence over
  rate-card pricing when it qualifies.
- CSV parsing (TSV/UTF-16LE detection, Grand Total row filtering),
  Reconciliation Cutoff behavior, "Load to Compare" button.
- `escapeHtml`, `Object.create(null)` bracket-grouping safety, and other
  existing defensive patterns.

## Reference Materials Used (This Revision)

- `TOP Interface.png`, `Rate Table Section.png` — user-provided mockups of
  the exact Setup tab layout (coverage grid header row; rate card fields,
  order, and delete-button placement).
- `Lev_AI_Review.xlsx`, "Sheet2" (re-inspected directly via OOXML unzip this
  round) — confirmed its duration-band price structure (ascending
  thresholds paired with flat rates per band, e.g. 15/60/120/180/720/1440
  minute cutoffs) matches the band-per-card model this spec describes.
  Confirmed by the user that Compare's current expandable-list format is
  fine as-is and does not need to be rebuilt as a grid to match this sheet's
  visual layout.
