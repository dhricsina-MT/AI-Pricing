# Portable Design Rules (from ParkerSorter)

A style-guide extracted from `mockup.html`. Copy/adapt the color values for your own brand, but the *rules* — how colors are assigned meaning, not just picked — are the reusable part.

## 1. Palette structure

Define everything as CSS variables off one brand ramp + a couple of fixed accents. Never hardcode hex in components — always reference the variable, so a re-theme is a one-line change.

```css
:root{
  --brand:#5F59FF;                                   /* primary/signature color */
  --r1:#E0DFFF;--r2:#ABA8FF;--r3:#5F59FF;             /* ramp light -> dark, */
  --r4:#4842DF;--r5:#2D23A7;--r6:#07036C;--r7:#02003B;/* same hue, for intensity/heat scales */
  --teal:#09D4CC;   /* accent 1 — "positive / go look / info" */
  --orange:#FF7449; /* accent 2 — "attention / flagged / peak" */
  --bg:#F7F7FF;--surface:#FFFFFF;--line:#EAEAEA;--text:#02003B;--muted:#6b6a8a;
}
body.night{--bg:#0a0a0c;--surface:#161719;--line:#2d2d33;--text:#F5F5FA;--muted:#a6a4bd;}
```

**Rule:** one hue ramp (7 steps, light→dark) does double duty as (a) the brand color at its midpoint and (b) a sequential heatmap scale. You don't need a separate "chart palette" — reuse the ramp.

**Rule:** exactly two accent colors, each with one fixed *meaning*, used everywhere, never swapped:
- **Teal = affirmative / informational / "this is fine, here's more detail."** Used for: insight-panel borders & buttons, "no issues flagged" checkmarks, positive deltas (values going up), reconciliation success messages, info buttons.
- **Orange = attention / outlier / flagged.** Used for: the single highest-value cell in any per-row/per-column heatmap, warning chips, negative deltas, "omitted rows" counts, subscription-overlap flags, the "INTERNAL USE ONLY" chip, standalone bookend nav buttons (Input / final-action tab).

Never use a third "meaning" color. If you need a third state, reuse `--muted` (neutral/zero) rather than inventing a new hue — keeps the palette closed.

## 2. Light/dark mode

Only 5 variables actually flip between themes: `--bg --surface --line --text --muted`. Brand, ramp, and accents (`--brand`, `--r1`–`--r7`, `--teal`, `--orange`) **do not change** between light and dark — they're identity colors, not surface colors. This keeps re-theming to one small block instead of doubling the whole stylesheet.

## 3. Heatmap / intensity convention

For any table where cells represent a magnitude (visits, revenue, minutes):
- 6 ramp shades for normal intensity (light = low, dark = high), 0/blank = transparent (not white/gray — let the page background show through so true zeros don't look like a data point).
- The **single highest cell** in each logical group (per row, per column, or per whole block — whichever axis represents one time slice) gets recolored `--orange` instead of the darkest ramp shade. This is a *peak marker*, separate from the intensity scale itself — it answers "where's the max" at a glance without needing to read numbers.
- Cell text color stays fixed (dark ink) regardless of theme, because it has to read on top of both light ramp cells and the orange peak cell — don't let text color follow the light/dark theme inside data cells.
- Don't add a second "runner-up" highlight color (we tried a teal 2nd-highest once and cut it — one peak color per group, not a top-N gradient of call-out colors).

## 4. "Insight panel" two-column convention

Any auto-generated commentary/insight panel splits into exactly two labeled columns with a fixed emotional register per column — not per-bullet coloring:
- **Left = descriptive** ("Key Call Outs" / facts, what happened) — no color-coding per bullet; plain text list, headline numbers bolded in the brand color.
- **Right = prescriptive** ("Questions & Next Steps" / what to do about it) — same plain-text treatment.

The panel itself (border, toggle button) is teal — signals "supplementary info, safe to ignore," not "warning." Bullets are never individually colored by severity; severity is expressed in wording (thresholds pick a phrase variant: "sharply up" vs "slightly up"), not hue. **Rule: don't color-code sentiment at the bullet level — that's a rules-engine job (word choice), not a CSS job.** Reserve color for structural/positional meaning (which column, which panel), not per-item judgment calls.

## 5. Action-tag convention (checklist items)

Tags/labels that categorize an action type (e.g. Observe / Review / Discuss / Verify / Research) are **monochrome** — same single outline color for every tag, differentiated by text label only, not by a rainbow of tag colors. Reasoning: once you have 5+ categories, distinct colors either wash out (become indistinguishable) or accidentally imply a false severity ranking ("red tag scarier than green tag") that isn't intended. Keep categorical-but-not-severity labels to one color + text.

Contrast this with the **heatmap peak** rule above, where color *does* carry meaning (max value) — the difference is whether the categories have an inherent ordering/urgency. If they don't, don't fake one with color.

## 6. Navigation placement — ask, don't assume

ParkerSorter's current shell uses a **left-hand vertical sidebar** of section links (200px fixed width) — an evolution from an earlier top tab-bar. Structure:
- `.sidebar`: `flex:0 0 200px`, vertical stack, own scroll if the list overflows, `border-right` separating it from content.
- Tabs are grouped by function with thin `<hr class="sidebarSep">` dividers between groups (e.g. a data-load group, an analysis group, an export group) — this is what lets a sidebar scale past a handful of items without turning into an undifferentiated list.
- "Bookend" tabs — the very first (data load-in) and very last (final action) steps in the workflow — get `outline:2px solid var(--orange)` instead of sitting inside a group, so they read as "start" and "end" at a glance, independent of the orange-outline pattern used elsewhere for flagged/attention items.
- Active tab: solid brand-color fill, white text — same treatment as a primary button.

**Rule: at the start of a new project, still ask the user whether they want top nav or left sidebar before building the shell** — don't silently assume sidebar just because that's where ParkerSorter landed. Trade-offs to mention when asking:
- **Top nav:** more vertical room for content below; works well with a modest, fairly flat number of sections; tabs can wrap into a small grid if they don't fit one row.
- **Left sidebar** (current ParkerSorter default): scales better to many sections or grouped navigation via separators; leaves the horizontal header free for global actions (export cluster, night toggle) instead of competing with tabs for space; costs some content width.

Once chosen, apply it consistently everywhere (don't mix — no per-page nav placement), and keep the *other* header-level conventions (global export cluster, orange bookend actions, teal info buttons, night-mode toggle) regardless of which orientation is picked — those attach to "the global chrome," not to whichever side the tabs happen to live on.

## 7. Layout grid convention

- Filter/menu bars: fixed N-column CSS grid (we used 6), labels **above** each control, row-wrapped (first N controls = row 1, rest = row 2). Every "same kind of tab" mirrors shared filters into identical grid slots across tabs — so users learn the layout once. Unique-to-this-tab controls always come *after* the shared ones, never interleaved.
- Exports/downloads live in one global header cluster, never duplicated per-tab-bar.
- One reserved "leftover slot" in the grid (e.g. last column of row 2) is a good home for a per-tab toggle button (like the Insight show/hide) instead of adding a new row.
- Standalone bookend actions (load data in / take action out) get pulled out of the tab grid entirely and rendered as their own outlined nav buttons at the ends of the tab bar, both in the same accent color (orange, in our case) so they visually pair as "start" and "end" of the workflow.

## 8. Button hierarchy

- Primary action: solid brand-color fill, white text.
- Secondary/info action: outline in the accent color that matches its *meaning* (teal outline = "show more info/detail," not a warning).
- Ghost/tertiary (e.g. CSV/XLSX export vs the "real" PDF export): text-only in `--muted`, no border — visually demotes it below the bordered "primary format" button.
- Disabled: opacity 0.4 + `cursor:not-allowed`. Universal, don't special-case.

## 9. App shell — header + sidebar structure

Two chrome regions, always present, identical on every tab:

**Header row** (`<header>`), fixed order left→right, single row, sticky to top:
1. Logo (icon dot + product name), pinned left, never shrinks.
2. `.spacer` (`flex:1`) — pushes everything after it to the right edge. This is the *only* deliberately fluid element in the whole shell; everything else is a fixed size.
3. Warning/status chip if applicable (orange outline, e.g. "INTERNAL USE ONLY").
4. Export cluster (Section 15).
5. Night-mode toggle — always last, always rightmost (Section 16).

**Sidebar** (`.appBody > .sidebar`): fixed 200px width, vertical stack of tab buttons, own scroll if the list overflows, grouped with thin `<hr>` separators, bookend tabs outlined in orange. Full detail in Section 6.

**Rule:** nothing in this shell stretches to fill the browser window except the one `.spacer` div. Sidebar width, header height, and every button/control size are fixed pixel values.

## 10. Sheet title + blurb

Every tab opens with the same two-line header, directly above its filter bar:
```html
<h2>Tab Name</h2>
<p class="sub">One sentence describing what this tab shows / how to read it.</p>
```
```css
h2{margin:0 0 3px;font-size:19px}
.sub{color:var(--muted);margin:0 0 16px;font-size:13px}
```
- `h2` sits tight above `.sub` (3px gap) — they read as one title block, not two separate elements.
- `.sub` is always muted-color, never full text-color — it's a caption, not body copy.
- If the tab needs a trailing action (e.g. "Clear all"), wrap the pair in a flex row (`justify-content:space-between;align-items:center`) with the button on the right — the button never goes inside `.sub` itself.

## 11. Fixed-width sheets — don't stretch to fill the window

The core layout instinct for this whole app: **pick one standard width per tab type and center it with `margin:0 auto`. Never let a tab's content stretch to fill whatever the browser window happens to be.**
- Wide data tabs (dense tables/heatmaps/graphs): a fixed width like `1920px` (or `1340px` for a narrower data tab).
- Reading/setup tabs (Input, Summary, Instructions): narrower fixed widths — `1800px`, `1500px`, `1200px`, `1100px` — depending on how much needs to sit side by side.
- The title block, the filter bar, and the data panel for one tab all share the *same* fixed width, so their left and right edges line up vertically. That alignment is what makes a tab read as one cohesive sheet instead of three stacked things of different sizes.
- If one panel needs to grow past its normal width in some state (e.g. a table "rolled up" wider than usual), let *only that panel* grow (`width:max-content`) while the title and filter bar above it stay pinned to the standard width — the menu should never resize based on the data it's controlling.
- Once a standard width is picked for a tab type, reuse the exact same number for every tab of that kind — same "repetition of layout is a feature" instinct as the filter grid (Section 7), applied to overall sheet width instead of just the menu.

## 12. Dropdowns & selects

**Standard `<select>`:**
```css
select{padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:13px;max-width:200px}
```
200px is the standard cap when a select sits outside a grid. Inside a filter-bar grid cell, drop the cap and let it fill the cell instead (`max-width:none;width:100%;text-align:center`) — the grid column itself is already the fixed, deliberate size, so a second cap on the control is redundant.

**Custom multi-select** (`.msel`, for "pick several of these" filters): a button styled to look exactly like a native `<select>` — centered text, small caret on the right — that opens a floating checkbox panel, rather than a native `<select multiple>` (which looks and behaves badly across browsers). Panel: `min-width:190px`, `max-height:240px` with scroll, same floating-card chrome as `.ddmenu` below.

**Custom floating menus** (`.ddmenu` — used for both a "jump to sheet" nav dropdown and the header Download menu): styled as a small floating card, not a native menu:
```css
.ddmenu{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:6px;
  box-shadow:0 8px 24px rgba(2,0,59,.18);min-width:150px} /* 150-190px depending on content */
.ddItem{text-align:left;background:none;border:none;font:inherit;font-size:14px;font-weight:600;
  padding:8px 12px;border-radius:7px;cursor:pointer}
.ddItem:hover{background:var(--bg)}
.ddItem.active{background:var(--brand);color:#fff}
```
One consistent menu chrome for every dropdown-like popover in the app, whether it's navigation or export — don't invent a second floating-menu style.

## 13. Filter/menu bar container

The bar holding a tab's filter controls (`.bar`) is its own card, not bare inline controls floating on the page background:
```css
.bar{display:flex;flex-wrap:wrap;gap:12px;background:var(--surface);border:1px solid var(--line);
  border-radius:12px;padding:12px 14px;margin-bottom:14px;align-items:flex-end}
```
Each control (`.ctl`) is a small vertical stack — uppercase muted label above, control below:
```css
.ctl{display:flex;flex-direction:column;gap:4px}
.ctl label{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}
```
`align-items:flex-end` on `.bar` keeps every control's bottom edge aligned even when labels wrap to different heights.

## 14. Drop-zone (file upload)

A fixed 150×150 square, not a full-width dropzone banner:
```css
.drop{width:150px;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  border:2px dashed var(--brand);border-radius:14px;background:var(--surface);text-align:center;cursor:pointer}
.drop.over{background:var(--r1)}                /* drag-hover tint = lightest ramp shade */
.drop .ar{font-size:26px;color:var(--brand)}    /* arrow/icon */
.drop h3{margin:6px 0 2px;font-size:13px}       /* short label, e.g. file name */
.drop .state{font-size:11px;color:var(--muted)} /* status text under the label */
```
- Disabled/placeholder variant (a file slot that isn't relevant yet): border and text drop from brand/muted down to `--line`/`--muted`, `cursor:default`, whole card dimmed (`opacity:.6`) — same "disabled" instinct as buttons, applied to a drop target.
- Standard file-row pattern: description text on the left (`flex:1`, muted, with an inline link to where to get the source file) + the fixed drop square on the right, then a full-width status bar underneath once a file loads. Reuse this exact card shape for every file slot in the app rather than inventing a new upload widget per file type.

## 15. Header export cluster

Fixed order, always the rightmost group before the night toggle:
1. **Download** — ghost button (`border:1px solid var(--line)`) with a down-arrow glyph + label + caret, opening a `.ddmenu` with plain export-format items: **CSV, XLSX, PDF**. That's the reusable set — don't fold unrelated items (e.g. a feedback/contact link) into this menu; if you need one, give it its own separate header element instead.
2. **Information** — teal-outline ghost button, opens the contextual help drawer. Teal because it's "more info," not an action with consequences (Section 1).

Exports live in exactly this one header cluster — never duplicated inside individual tab filter bars (Section 7).

## 16. Night-mode toggle

Always the last element in the header, right-aligned:
```html
<div class="toggle"><span>Night</span><span class="switch"></span></div>
```
```css
.toggle{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px;cursor:pointer}
.switch{width:42px;height:24px;border-radius:12px;background:var(--line);position:relative;transition:.2s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;
  background:#fff;transition:.2s}
body.night .switch{background:var(--brand)}
body.night .switch::after{left:21px}
```
A label word ("Night") to the left of a standard iOS-style pill switch — not an icon-only sun/moon toggle. Clicking it toggles one class (`body.night`) on `<body>`; per Section 2, that class only needs to redefine the 5 surface variables — the switch's own colors don't need a separate dark-mode override beyond the two rules above.

## 17. Google Apps Script (Sheets) project conventions

**Single-file HTML.** When building a UI for a Google Sheet (sidebar, dialog, or web app), bundle CSS and JS inline in the one `.html` file — `<style>` and `<script>` blocks live directly alongside the markup — rather than splitting into separate files (`index.html` / `styles.html` / `script.html`) stitched together with `HtmlService` includes. One file is easier to find, diff, and update, and Apps Script's HTML service gains nothing from splitting it apart.

**Scoped file access.** When writing or editing `Code.gs` (or any other file) for a specific spreadsheet's Apps Script project, only read/reference files that belong to *that* project/spreadsheet — never enumerate or open other Google Sheets the user owns just because they're reachable via the Drive/Sheets API. Treat each Sheet's script project as its own sandbox.

## 18. General principles worth carrying forward

1. **Closed palette, open meaning.** Pick very few colors (brand + ramp + 2 accents + neutrals) and assign each a fixed semantic role used consistently everywhere, rather than picking a new color per feature.
2. **Color encodes structure/position or magnitude — not manually-judged severity.** Severity/tone differences belong in copy (word choice, phrase-picker thresholds), not in hue choice.
3. **Reuse one ramp for both brand identity and sequential data (heat) scales** instead of maintaining a separate chart palette.
4. **Only surface colors (bg/surface/line/text/muted) should flip for dark mode** — identity colors (brand/ramp/accents) stay constant across themes so the product still "looks like itself" at night.
5. **Repetition of layout is a feature, not a limitation** — mirroring the same grid slots/menu structure across every similar screen is what makes a multi-tab tool feel like one coherent app instead of N separate ones.
6. **Some choices are the user's, not the designer's — ask instead of defaulting.** Nav placement (top vs. left) is the clearest example; don't assume a prior project's answer carries over.
7. **Fixed sizes over fluid stretch.** Pick one standard width or size per component type — sheet width, dropdown width, drop-zone size, sidebar width — and reuse that exact number everywhere the component appears, rather than letting it stretch to fill available space. The only deliberately fluid element in the entire shell is the header's `.spacer`; everything else, from the sidebar to a single `<select>`, is a fixed pixel value.
