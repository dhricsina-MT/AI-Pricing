# Historical Rate Inference — Design Spec

Date: 2026-09-16

## Purpose

Let a user drop an *old* visit-history export (from before AI pricing, or from any
period whose static rate table is unknown/half-remembered) and have the app figure
out what that rate table must have been — populating Setup's rate cards
automatically instead of requiring the user to hand-build them first. This is a
separate, one-directional workflow from the existing Compare tab: Compare answers
"how did AI pricing do against a rate table I already know," this answers "I don't
fully know the old rate table, reconstruct it from what was actually charged."

## New Tab: Discover

Nav becomes `Setup → Discover → Compare` (Setup remains the default/active tab on
load, matching current behavior). Discover is a new `<div id="discoverPage"
class="page">`, following the same tab-switch mechanism already in place
(`switchToTab`, `#tabNav button[data-tab]`).

### Contents, top to bottom

1. **Quick Setup card** — new controls, local to this feature:
   - **All-Day Rates** checkbox (checked by default)
   - **Day Rate Start Time** — time-dropdown group (reuses `timeDropdownsHtml`/
     `readTimeDropdowns`, same pattern as rate card Start/End Time)
   - **Evening Rate Start Time** — same pattern
   - The two Start Time controls are disabled whenever All-Day is checked (visual
     `disabled` state, same convention as `.ctl input:disabled` elsewhere)
   - State: `state.discoverSetup = { allDay: true, dayStartMin: 360, eveningStartMin: 1080 }`
     (6:00 AM / 6:00 PM defaults, only meaningful when `allDay` is false)

2. **Early Bird card** — a second rendering of the *same* `ebCard` controls already
   in Setup (toggle, entry start/end, exit condition/time, price, days), bound to
   the same `state.earlyBird` object. Editing either copy updates `state.earlyBird`
   and both copies re-render to match — there is exactly one Early Bird
   configuration in the app, just two places to view/edit it. Implementation:
   generalize the existing `renderEarlyBird()` to update *all* matching
   `[data-eb-role]`-tagged elements (Setup's + Discover's) rather than hardcoded
   single IDs, and wire both copies' event listeners to the same
   read-state/write-state/re-render-both logic.

3. **Historical CSV drop zone** — moved here from Setup (it doesn't belong in
   Setup conceptually; it never touches `state.visits`/the live Compare
   calculation). Same drop-zone visual pattern, `id="historicalDropZone"` /
   `historicalFileInput"` / `"historicalDropState"`, parsed via the existing
   `RateEngine.parseVisitFile`.

4. **"Infer & Apply Rate Bands" button** + `#inferStatus` status line (unchanged
   from the already-shipped version, message text adjusted to reflect the new
   pipeline below).

## Inference Pipeline (`RateEngine.inferRateBands`)

Extends the already-implemented function. New signature:

```
RateEngine.inferRateBands(historicalRows, rateCards, earlyBird, discoverSetup, opts)
```

### Step 1 — Row filtering (unchanged)

Skip a row if `Is Special Event Rate` is `True` (case-insensitive), or if its
timestamps fail to parse, or `durationMin < 0`, or `price < 0`. **No other row
metadata is read** — inference uses exactly five columns: `Visit Start Date`,
`Visit Start At`, `Visit Exit Event Date`, `Visit Exit Event At`, `Price Amt`, plus
`Is Special Event Rate` for the exclusion above. `Visit Coverage Type` is **not**
read by this feature (both of the user's real historical exports are 100%
Transient, and gating a rate-*table* reconstruction on coverage type isn't
meaningful — that dimension belongs to the live Compare report, not to "what did
this duration cost on this day").

### Step 2 — Early Bird (unchanged)

`RateEngine.checkEarlyBird(earlyBird, entryDate, exitDate)` — a match removes the
row from every other bucket and contributes only to `earlyBirdPrice` (modal price
across matches).

### Step 3 — Match existing, already-shaped rate cards (unchanged, already shipped)

`RateEngine.findMatchingRateCard(rateCards, entryDate)` — a match buckets the
visit under that card's name for band-filling, exactly as today. A card only
counts as "already shaped" if it has at least one day checked (an untouched blank
starter card matches nothing, by construction — `findMatchingRateCard` requires
`card.days[day]` to be true).

### Step 4 — Discover-window classification (new)

Anything not claimed by Step 2 or 3 is classified by `discoverSetup`:

- If `discoverSetup.allDay` (or `discoverSetup` is absent): one window,
  `{ name: null, startMin: 0, endMin: 1439 }`.
- Else: two windows, `Day: { startMin: dayStartMin, endMin: eveningStartMin }` and
  `Evening: { startMin: eveningStartMin, endMin: dayStartMin }` — the same
  day-boundary-aware `RateEngine.withinRange` used elsewhere handles the overnight
  wraparound when `eveningStartMin > dayStartMin`.

Each visit is bucketed by `(window, dayOfWeek)`.

### Step 5 — Per-(window, day-of-week) band inference, with bracket smoothing (new)

For each `(window, dayOfWeek)` bucket with data, run the existing
bracket-consolidation (30-min brackets, modal price per bracket) with one
addition: **a bracket needs at least 5 visits of support to count** — brackets
below that are dropped from consideration entirely (treated as a gap), so their
visits get silently absorbed into whichever real, well-supported band ends up
spanning that duration once the gap closes, rather than spawning their own
low-confidence band. (`opts.minBracketSupport`, default 5, overridable for tests.)

### Step 6 — Merge days-of-week with matching ladders (new)

Within each window, group the 7 possible days by their inferred ladder, using a
comparison that **ignores the very last band's exact `upToMin`** (it's a
catch-all regardless of its stated number — two days can agree on every real
price break yet still disagree trivially on the longest stay ever recorded). Once
days are grouped, **re-run Step 5's consolidation against the combined visits of
every day in the group** (not just one day's numbers) — more data, one clean
final ladder per group.

### Step 7 — Card creation (new)

One new card per (window, day-group): `{ name: <auto label>, days: [...],
startMin: window.startMin, endMin: window.endMin, bands: [...] }`.

**Auto-naming:** exact Mon–Fri → `"Weekday"`; exact Sat–Sun → `"Weekend"`; all 7 →
`"All Days"`; anything else → comma-joined Mon-first day abbreviations (e.g. `"Mon,
Wed, Fri"`). If Discover has two windows (Day + Evening, not All-Day), prefix with
the window name (`"Day — Weekday"`); a single All-Day window needs no prefix.

### Step 8 — Apply to Setup (UI)

- Cards from Step 3 get their `bands` overwritten in place (unchanged).
- Cards from Step 7 get appended to `state.rateCards`.
- If `state.rateCards` was exactly one untouched blank starter card (`name ===
  ''`, every `days[i] === false`, one band with `rate === null`) when new cards
  are about to be appended, that starter card is removed first instead of left
  behind as empty clutter.
- `earlyBirdPrice` (if any Early Bird matches occurred) is written to
  `state.earlyBird.price`.
- `#inferStatus` reports: cards filled (Step 3), cards created (Step 7), Early
  Bird visits used, and any rows that failed to parse (should be ~0 in practice —
  day-of-week clustering means every valid visit lands somewhere).

## Out of Scope (explicit non-goals)

- **Auto-detecting a Day/Evening time boundary from the data.** The user's real
  historical export shows zero time-of-day price variation (flat by hour within
  every day-of-week group) — only day-of-week matters for it. Reliably inferring
  *where* a time cutoff falls (vs. picking from 7 discrete day buckets) is a much
  harder, noisier problem with no evidence it's needed. If a property genuinely
  has a Day/Evening split, the user states it via the Quick Setup panel.
- **Duplicate-name collision handling** for auto-created cards — not handled;
  the user can rename/merge manually if it comes up.
- Any change to the live Compare tab calculation — this feature only ever writes
  into `state.rateCards`/`state.earlyBird.price`; it does not touch
  `runComparison`, `processVisit`, or `buildRateReport`.

## Testing

Same in-browser `?test=1` self-test harness as the rest of the app
(`window.__engineTestCases`). New engine-level cases cover: bracket-support
smoothing (a low-count bracket doesn't create its own band), day-of-week merge
tolerance (two days with matching ladders but different trailing catch-all
numbers still merge), Day/Evening window splitting via `discoverSetup`, All-Day
default behavior, and auto-naming for Weekday/Weekend/All Days/arbitrary day sets.
New UI-level cases cover: the Discover tab's Quick Setup controls, the shared
Early Bird sync between Setup and Discover, and the blank-starter-card removal.
