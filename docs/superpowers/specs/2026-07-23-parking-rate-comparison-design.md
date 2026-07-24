# Parking Rate Comparison Tool — Design Spec

Date: 2026-07-23

## Purpose

A tool that lets a user build a static parking rate table (matching the property's
real rate-card structure), upload a visit-history export from the management
dashboard, and compare what was **actually charged** (by the AI dynamic-pricing
engine) against what the **static rate table** would have charged for the same
visits. This isolates the revenue impact of the AI pricing engine from a fixed-rate
baseline.

## Hosting & Files

Google Apps Script Web App, kept to the minimum file count:

- **`Code.gs`** (~10 lines): `doGet()` returns the HTML page via
  `HtmlService.createHtmlOutputFromFile`. No spreadsheet reads/writes — the app is
  entirely client-side.
- **`index.html`**: single self-contained file — inline `<style>` and `<script>`,
  no build step, no external dependencies. Deployed as a Web App; opened via its
  `/exec` URL directly in a browser tab.
- `appsscript.json`: auto-managed manifest, not hand-edited.

## Page Structure

Top nav (per ParkerSorter design rules, adapted for this tool's small size — two
tabs, no sidebar needed), one shared header (logo, spacer, Download, Info, Night
toggle):

1. **Setup** — rate card builder, Early Bird rule, and the CSV drop zone /
   reconciliation cutoff, all on one tab.
2. **Compare** — the bracket-grouped comparison summary, once a file is loaded.

## Rate Table Builder (Setup tab)

### Rate Cards

A repeatable card list (mirrors the property's real rate-card UI). Each card has:

- **Name** — freeform text label (e.g. "Weekday Day," "Weekend"). Optional, for
  readability only; not used in calculation.
- **Days Valid** — 7 individual toggle checkboxes (Mon–Sun), any combination.
  Quick-select buttons ("All days," "Weekday Mon–Fri," "Weekend Sat–Sun") just
  check/uncheck the boxes as a shortcut.
- **Times Valid** — start time + end time. Supports overnight spans (e.g.
  4:00 PM – 4:00 AM). Start is inclusive, end is exclusive (entering at exactly
  the end time belongs to the *next* card).
- **Free minutes** — grace period (e.g. 15) during which the visit is free
  regardless of duration.
- **Duration ladder** — add/remove columns freely. Each column is a duration
  threshold (numeric value + unit: minutes / hours / days) and a price. Internally
  every threshold normalizes to minutes for comparison (matching the property's
  own rate-card model, which stores an hours row and a minutes row in parallel).
- **Copy to other days** — an action on each card that lets the user pick
  additional days to apply this card's full configuration (days get added, times/
  ladder are copied as-is) to, so a Monday setup can be extended to Tue–Fri in one
  action instead of rebuilding each card.
- Add / delete card controls (pencil/trash icons).

**Duration lookup**: if the visit's duration is within the free-minutes grace
period, static price = $0. Otherwise, static price = the price of the smallest
ladder column whose threshold is ≥ the visit's **full** duration (not duration
minus grace — grace only determines the $0 cutoff itself, it is not subtracted
before the ladder lookup). If the duration exceeds every defined column, the last
column's price is used as a flat ceiling (no error, no extrapolation) — this only
matters for visits within the reconciliation cutoff, since anything past the
cutoff is excluded outright (see below).

**Bracket selection**: whichever rate card's Days Valid + Times Valid covers the
visit's **entry** timestamp governs the *entire* stay. Duration is computed as
total elapsed time from entry to exit (this can cross midnight/day boundaries
without resetting — e.g. entering 11 PM under an evening card and staying 4 hours
into the next calendar day is still just "4 hours" against that evening card's
ladder).

### Early Bird Rule

One optional rule, toggled on/off (off = not used; a property may not have one):

- **Days Valid** — same 7-checkbox pattern as rate cards.
- **Entry window** — start/end time; the guest must have entered within this
  window to qualify.
- **Exit condition** — "Exit Before" or "Exit After" + a time.
- **Price** — flat dollar amount.

A visit qualifies for Early Bird only if **all three** hold: its day is in the
rule's Days Valid, its entry falls within the entry window, and its exit satisfies
the exit condition. If it qualifies, static price = the EB flat price, overriding
the duration ladder entirely for that visit. Otherwise, the visit falls through to
normal rate-card calculation.

### Reconciliation Cutoff

A numeric hours field (default **24**) on the Setup tab. Any visit whose duration
exceeds this cutoff is excluded from the comparison entirely (see Excluded buckets
below) rather than run through the duration ladder.

## CSV Upload & Parsing (Setup tab)

- Fixed 150×150 drop-zone (per design rules), accepting the management dashboard's
  visit export.
- **Format handling**: the real export is **tab-separated, UTF-16LE with a BOM**
  despite the `.csv` extension (confirmed against a real sample file). The parser
  reads the file as an `ArrayBuffer`, detects the UTF-16LE BOM (`FF FE`) and
  decodes accordingly, falling back to UTF-8 + comma-detection if a differently
  formatted file is dropped.
- **Columns used**:
  - `Visit Start Date` + `Visit Start At` → entry timestamp
  - `Visit Exit Event Date` + `Visit Exit Event At` → exit timestamp (used over
    "Visit End," which lands a few seconds later — Exit Event is the authoritative
    camera/gate event)
  - `Zone` → displayed for context (tool assumes one zone per upload)
  - `Is Special Event Rate` → drives the Special Event exclusion
  - `Visit Coverage Type` → drives the Normal / Partially Covered / Fully Covered
    bucketing
  - `Price Amt`, `Validation Amt`, `GPV Amt` → actual charged figures, carried
    through unchanged

## Calculation Engine

For each visit row:

1. Parse entry/exit timestamps; compute elapsed duration.
2. **Exclude** (tracked separately, never blended into the compare) if:
   - `Is Special Event Rate = True`, or
   - duration exceeds the reconciliation cutoff.
3. For everything else:
   - Check Early Bird eligibility first; if it qualifies, static price = EB flat
     price.
   - Otherwise, find the matching rate card by entry day + time, and look up the
     static price from its duration ladder.
4. Keep actual columns as-is: `Price Amt`, `Validation Amt`, `GPV Amt`,
   `Visit Coverage Type`. Static price calculation does **not** depend on
   validation status — the duration ladder is validation-agnostic by design; a
   visit's static price is the same whether or not it received a validation.
   Validation is purely a reporting dimension, applied on top.

## Compare Tab — Output

Grouped by rate card/bracket:

```
Bracket: Weekday Day (4am-4pm)                          Visits: 10
  Static $:     $120.00   (time-based lookup, validation-agnostic)
  Actual $:     $138.50   (sum of Price Amt)
  Validation $: $9.75     (sum of Validation Amt)
  Delta (Actual - Static): +$18.50

  [Unroll v]  -> expands this bracket into:
      Normal (8 visits):      Static $..  Actual $..  Delta ..
      Validation (2 visits):  Static $..  Actual $..  Validation $..  Delta ..
```

- **Top-line summary**: total static $, total actual $, total delta across all
  included brackets.
- **Excluded — Special Event**: count + actual $ only (not run through the rate
  table).
- **Excluded — Over cutoff**: count + actual $ only.
- **Global "Ignore Validations" switch** (Compare tab header):
  - **ON**: validation status is disregarded entirely — each bracket shows one
    blended line, no split tracked or available.
  - **OFF** (default): the Normal / Validation split is computed and available
    per bracket via the per-bracket Unroll control.
- **Per-bracket Unroll ▾ / Roll up ▲**: only meaningful when Ignore Validations is
  OFF. Starts rolled up (one blended line per bracket); click to expand that
  specific bracket into its Normal vs Validation sub-rows. **Disabled (grayed out,
  `opacity:0.4`, `cursor:not-allowed`) whenever the global Ignore Validations
  switch is ON**, since there is nothing to unroll in that state.
- No per-transaction CSV export — the user already has the raw file.

## Persistence

- **Export**: "Save Rate Table" downloads a JSON file containing all rate cards
  and the Early Bird rule.
- **Import**: "Load Rate Table" re-imports a previously saved JSON file.
- Nothing is auto-saved server-side or to browser storage; the explicit
  export/import pair is the only persistence mechanism, so configs can be backed
  up, versioned, or moved between machines.

## Visual Design

Reuses the ParkerSorter design system directly (see `DESIGN_RULES.md`) — no new
visual patterns invented:

- CSS variables for the full palette (brand `#5F59FF`, 7-step ramp, teal/orange
  fixed-meaning accents), 5 surface variables flipping for night mode.
- Top nav (chosen fresh for this project's smaller scope — two tabs don't warrant
  a sidebar).
- `.bar` filter-bar container styling for the rate-card grid controls.
- Fixed 150×150 drop-zone for the CSV.
- Standard button hierarchy (solid brand primary, teal-outline info, ghost/muted
  tertiary).
- Standard disabled treatment (`opacity:0.4`, `cursor:not-allowed`) applied to the
  per-bracket Unroll control when validations are ignored.
- Header export cluster (Download menu: CSV/XLSX/PDF; Info button) and night-mode
  toggle, both in their standard fixed positions.

## Reference Materials Used

- `rate example.png` — screenshot of the property's real rate-card UI (Tabular
  type, Free Minutes grace period, Period/Price duration ladder, Days Valid /
  Times Valid), used to validate the rate card data model.
- `Lev_AI_Review.xlsx` (Sheet1) — the user's own manual rate-table reconciliation
  model, confirming: two day-groups (Monday-Friday, Sat-Sun) each with independent
  time bands and independent duration ladders (Grace + hour/day-denominated
  thresholds, extensible to 7+ days with a catch-all beyond that), validating the
  bracket + duration-ladder structure above. Confirms the reconciliation was
  historically capped at the 24-hour mark, hence the default cutoff.
- `VD (Visits) (29).csv` — sample visit export confirming the TSV/UTF-16LE file
  format and the exact column set, and confirming `GPV Amt = Price Amt -
  Validation Amt`.
