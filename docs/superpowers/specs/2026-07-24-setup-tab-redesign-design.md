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

> **Correction (post-mockup-review with user):** an earlier draft of this
> spec described "each band is its own rate card, grouped by sharing an
> identical window." That's wrong. The mockup's real structure is: **one
> card is one time-of-day *section*** (e.g. "Day" 6am-4pm, "Evening"
> 4pm-6am, "Weekend" all-day flat) — Name, Start/End window, Days — and each
> section holds its **own nested, dynamically-growable list of duration
> bands** (`+ Add Next Rate`), each with its own Rate and a Max
> Length/"Up to" cutoff. There is no cross-card band-group concept; a card
> is self-contained. Confirmed with user: "A Rate Band is the length of stay
> based on the time of day. Each special time of day needs its own
> section... Weekend may not have different [bands] and be all one all-day
> rate band." Each band has its own Rate field (confirmed) — the mockup's
> single top "RATE" box was just Band 1's rate drawn inline, not a
> card-wide flat price.

Each card represents **one time-of-day section**, containing 1+ duration
bands:

- **Row 1:** `Name` (text) | a **"Delete"** button, top-right, orange
  outline (`.btnDanger`) — absent on the first/default section card (there
  must always be at least one, so it's not removable); present on any
  section added afterward via "+ Add Rate Card." This is section-level
  delete, distinct from the per-band delete below.
- **Row 2:** `Start Time` label, then Hour/Min/AM-PM selects laid out
  left-to-right (fixing the vertical-stack bug — these need a horizontal
  flex row, not the column-flex `.ctl` wrapper used for label+single-input
  pairs).
- **Row 3:** `End Time` label, then Hour/Min/AM-PM selects, same column
  widths as Row 2 so Start and End visually align.
  - A read-only **"Next Day"** indicator appears next to End Time whenever
    `endMin < startMin` (i.e. the window crosses midnight) — auto-computed
    from the two times, not a separate field a user sets manually.
- **Row 4:** Day-of-week checkboxes (Mon-Sun) + the existing preset buttons
  (`All days`, `Weekday (Mon-Fri)`, `Weekend (Sat-Sun)`) — unchanged from
  today, kept as-is.
- **Band rows** (one per entry in `card.bands`, always at least 1): each row
  has a `Rate ($)` input and an `Up to (minutes)` input.
  - Band 1 has no remove button (there must always be at least one band).
  - Every band after the first gets a "Remove Rate" (X) button, same
    `.btnDanger` styling as the section Delete button.
  - An "Add Next Rate +" button (`.btnGhost`) below the last band row
    appends a new band - the card grows dynamically, no fixed cap.
  - `Up to (minutes)` defaults to `15` on a freshly-added band (same number
    "grace" used to default to, per the already-resolved decision to drop
    the separate grace-period concept - this is just an ordinary editable
    field, not special first-band behavior). There is **no separate Grace
    Period field anywhere** - see Global Settings above.
- `newRateCard()` seeds `state.rateCards` with one default section card
  (containing one default band) on page load - no more empty list requiring
  a click before any input is visible.

### Matching logic (day-boundary crossing + nested band selection)

Given an entry timestamp:

1. Find the **one** rate card (section) whose `(days, startMin, endMin)`
   window contains the entry time. This check must be **day-boundary
   aware**: for a card with `endMin < startMin` (overnight), an entry
   falling in the pre-dawn portion (`minutes < endMin`) matches if
   `card.days[previous day]` is true - not `card.days[today]`, since the
   window was tagged to the *previous* calendar day. An entry falling in
   the evening portion (`minutes >= startMin`) still matches on
   `card.days[today]` as before. If more than one card's window covers the
   same moment (a real authoring mistake, flagged red in the coverage
   grid), first-match-wins by array order - same precedent as today's code.
2. Within that card's `bands` array, sort by `upToMin` ascending.
3. A visit matches a given band if:
   `duration >= previousBand.upToMin (or 0, for the first band)` **and**
   `duration < thisBand.upToMin`. Every duration `>= 0` always lands in some
   band - there's no separate "too short, excluded" gap. A section that
   wants an initial free period just gives its first band `rate: 0` and the
   appropriate `upToMin`, same as any other band; nothing special-cased.
4. The band with the highest `upToMin` is open-ended - it also catches any
   duration `>= its lower bound`, even beyond its own `upToMin` value. This
   is how a single-band section (e.g. "Weekend" flat rate, one band, one
   high `upToMin` like 1440) covers an entire stay regardless of exact
   length.

No overlap-blocking validation is implemented in this pass (explicitly
descoped - flagging via the coverage grid's red cells is enough for now).

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

- `card.ladder` (array of `{thresholdMin, price}`) is replaced by
  `card.bands` (array of `{rate, upToMin}`, always length >= 1). `card.rate`
  is NOT a card-level field — rate lives per-band.
- `card.graceMin` and any grace-period concept is removed entirely — no
  replacement global setting. The first band in `card.bands` implicitly
  starts at duration `0`.
- `RateEngine.lookupLadderPrice` is replaced by `RateEngine.selectBand`
  (exact naming decided at plan time), which sorts one card's `bands` by
  `upToMin` and picks the covering band per the matching-logic steps above —
  operating on a single card's nested band list, not a cross-card set.
- `RateEngine.findMatchingRateCard` stays **singular** (returns one card,
  not a group) but gains day-boundary-aware matching: checks the previous
  day's flag for entries in an overnight card's pre-dawn spillover portion.
- A new coverage/conflict-detection helper computes, per day+hour, how many
  *distinct cards* (by id) cover that cell — 0 → blank, 1 → green, 2+ → red
  — and a list of which named cards conflict where. No band-group dedup
  logic is needed since bands no longer span cards.
- `RateEngine.aggregateByBracket`, `computeDeltaPercents`, and `renderCompare`
  are unchanged — they already group by `bracketName` (the matched card's
  `name`), which is the section name shared by all its bands.

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
