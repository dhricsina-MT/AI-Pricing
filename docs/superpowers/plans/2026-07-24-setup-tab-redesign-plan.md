# Setup Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Setup tab's rate-card model (nested duration bands per time-of-day section), the coverage grid (full-width, conflict-aware), and Compare tab visual polish, per `docs/superpowers/specs/2026-07-24-setup-tab-redesign-design.md`.

**Architecture:** Everything lives in one file, `index.html` (Google Apps Script single-file convention, see `DESIGN_RULES.md` §17) — no new files. `RateEngine` (pure functions, no DOM) gets new/changed functions; UI state/render code in the later `<script>` blocks is rewritten to match. Self-test harness (`?test=1`) is the only test runner — there is no Node/CI test command in this repo.

**Tech Stack:** Vanilla JS (no framework), single HTML file, in-browser assertion harness (`window.__engineTestCases`).

**How to run tests (use for every "run tests" step in this plan):** Open `index.html` directly in a browser with `?test=1` appended, e.g. from PowerShell:
```powershell
Start-Process "index.html?test=1"
```
Read the on-page "N/N passed" summary and any red FAIL lines (also logged to the browser console). All FAIL lines must be gone before moving to the next step.

**Key model correction (already applied to the spec doc, carried into this plan):** a rate card is **one time-of-day section** (e.g. "Day" 6am–4pm, "Evening" 4pm–6am, "Weekend" all-day). Each section holds a **nested, dynamically-growable list of duration bands** (`card.bands`, each `{rate, upToMin}`), not a cross-card "band group." Confirmed with user: bands are per-section, and every band (including the first) has its own `rate` field.

---

## Task Sequencing Note

Tasks 1–4 are pure `RateEngine` functions with self-contained test fixtures (literal objects, no DOM rendering) — safe to land independently. **Task 5 is deliberately large**: `renderRateCard()` directly dereferences `card.ladder`/`card.graceMin` today, so the moment those fields are removed from the data model, rendering breaks immediately unless the UI rewrite lands in the same commit. Splitting the data-model change from the UI rewrite would leave the app broken in between, so they're one task. Tasks 6–10 are smaller UI-only follow-ons.

---

### Task 1: Engine — day-boundary-aware `findMatchingRateCard`

**Files:**
- Modify: `index.html` (RateEngine section, function starting `RateEngine.findMatchingRateCard = function`, currently around line 196)
- Modify: `index.html` (its test block, the `window.__engineTestCases.push` call containing the `withinRange` and `findMatchingRateCard` assertions, currently around lines 429–455)

- [ ] **Step 1: Replace the `findMatchingRateCard` test fixture and add overnight/day-boundary cases**

Find this block (keep the `withinRange` assertions above it untouched — only replace from the `var cards = [...]` line down to the end of that test function):

```javascript
  var cards = [
    { id: 'weekday_day', days: [false,true,true,true,true,true,false], startMin: 240, endMin: 960, graceMin: 15, ladder: [] },
    { id: 'weekend_all', days: [true,false,false,false,false,false,true], startMin: 0, endMin: 1440, graceMin: 15, ladder: [] }
  ];
  var wed10am = new Date(2026, 6, 1, 10, 0, 0);
  var match = RateEngine.findMatchingRateCard(cards, wed10am);
  t.assertEqual(match && match.id, 'weekday_day', 'findMatchingRateCard: matches weekday day card');

  var sat11pm = new Date(2026, 6, 4, 23, 0, 0);
  var match2 = RateEngine.findMatchingRateCard(cards, sat11pm);
  t.assertEqual(match2 && match2.id, 'weekend_all', 'findMatchingRateCard: matches weekend all-day card');

  var wed2am = new Date(2026, 6, 1, 2, 0, 0);
  var match3 = RateEngine.findMatchingRateCard(cards, wed2am);
  t.assertEqual(match3, null, 'findMatchingRateCard: returns null when no card covers the time');
```

Replace with:

```javascript
  var cards = [
    { id: 'weekday_day', days: [false,true,true,true,true,true,false], startMin: 240, endMin: 960 },
    { id: 'weekend_all', days: [true,false,false,false,false,false,true], startMin: 0, endMin: 1440 }
  ];
  var wed10am = new Date(2026, 6, 1, 10, 0, 0);
  var match = RateEngine.findMatchingRateCard(cards, wed10am);
  t.assertEqual(match && match.id, 'weekday_day', 'findMatchingRateCard: matches weekday day card');

  var sat11pm = new Date(2026, 6, 4, 23, 0, 0);
  var match2 = RateEngine.findMatchingRateCard(cards, sat11pm);
  t.assertEqual(match2 && match2.id, 'weekend_all', 'findMatchingRateCard: matches weekend all-day card');

  var wed2am = new Date(2026, 6, 1, 2, 0, 0);
  var match3 = RateEngine.findMatchingRateCard(cards, wed2am);
  t.assertEqual(match3, null, 'findMatchingRateCard: returns null when no card covers the time');

  // Overnight card: 6pm (1080 min) Monday through 1am (60 min) the next day, tagged to Monday (day index 1).
  var overnightCard = [
    { id: 'evening', days: [false,true,false,false,false,false,false], startMin: 1080, endMin: 60 }
  ];
  var monEvening = new Date(2026, 6, 6, 19, 0, 0); // 2026-07-06 is a Monday, 7pm
  var eveningMatch = RateEngine.findMatchingRateCard(overnightCard, monEvening);
  t.assertEqual(eveningMatch && eveningMatch.id, 'evening', 'findMatchingRateCard: overnight card matches its evening portion, tagged to entry day');

  var tuePreDawn = new Date(2026, 6, 7, 0, 30, 0); // Tuesday 12:30am — the Monday-night spillover
  var spilloverMatch = RateEngine.findMatchingRateCard(overnightCard, tuePreDawn);
  t.assertEqual(spilloverMatch && spilloverMatch.id, 'evening', 'findMatchingRateCard: overnight pre-dawn spillover matches via the PREVIOUS day flag, not the current day');

  var tue1am = new Date(2026, 6, 7, 1, 30, 0); // Tuesday 1:30am — past the spillover window
  var pastSpillover = RateEngine.findMatchingRateCard(overnightCard, tue1am);
  t.assertEqual(pastSpillover, null, 'findMatchingRateCard: past the overnight spillover end no longer matches');

  // The spillover must NOT match if the PREVIOUS day isn't flagged (e.g. card only tagged to Wednesday, not Tuesday).
  var wedOnlyOvernight = [
    { id: 'wed_evening', days: [false,false,false,true,false,false,false], startMin: 1080, endMin: 60 }
  ];
  var thuPreDawnUnflagged = new Date(2026, 6, 9, 0, 30, 0); // 2026-07-09 is a Thursday
  t.assertEqual(RateEngine.findMatchingRateCard(wedOnlyOvernight, thuPreDawnUnflagged), null, 'findMatchingRateCard: spillover does not match when the previous day is not flagged');
```

- [ ] **Step 2: Run tests, confirm the new assertions fail**

`Start-Process "index.html?test=1"` — expect FAILs referencing `findMatchingRateCard: overnight card matches...` etc. (the function doesn't yet handle overnight day-boundary logic).

- [ ] **Step 3: Implement day-boundary-aware matching**

Replace:

```javascript
// First matching card wins by array order; the UI does not currently prevent
// users from creating overlapping rate cards, so insertion order is precedence.
RateEngine.findMatchingRateCard = function(rateCards, entryDate) {
  var day = entryDate.getDay();
  var minutes = entryDate.getHours() * 60 + entryDate.getMinutes();
  for (var i = 0; i < rateCards.length; i++) {
    var card = rateCards[i];
    if (card.days[day] && RateEngine.withinRange(minutes, card.startMin, card.endMin)) return card;
  }
  return null;
};
```

with:

```javascript
// First matching card wins by array order; the UI does not currently prevent
// users from creating overlapping rate cards, so insertion order is precedence.
RateEngine.findMatchingRateCard = function(rateCards, entryDate) {
  var day = entryDate.getDay();
  var prevDay = (day + 6) % 7;
  var minutes = entryDate.getHours() * 60 + entryDate.getMinutes();
  for (var i = 0; i < rateCards.length; i++) {
    var card = rateCards[i];
    if (card.startMin < card.endMin) {
      if (card.days[day] && minutes >= card.startMin && minutes < card.endMin) return card;
    } else {
      // Overnight window (endMin < startMin): the evening portion is tagged
      // to today's day flag; the pre-dawn spillover (before endMin) is
      // tagged to YESTERDAY's day flag, since the window started the
      // previous calendar day.
      if (minutes >= card.startMin && card.days[day]) return card;
      if (minutes < card.endMin && card.days[prevDay]) return card;
    }
  }
  return null;
};
```

- [ ] **Step 4: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Make findMatchingRateCard day-boundary aware for overnight windows"
```

---

### Task 2: Engine — `selectBand` (nested band lookup, replaces `lookupLadderPrice`)

**Files:**
- Modify: `index.html` (delete `RateEngine.lookupLadderPrice`, currently around line 206; add `RateEngine.selectBand` in its place)
- Modify: `index.html` (delete/replace the `lookupLadderPrice` test block, currently around lines 457–480)

- [ ] **Step 1: Replace the `lookupLadderPrice` test block**

Delete this whole `window.__engineTestCases.push(...)` block:

```javascript
window.__engineTestCases.push(function(t){
  var card = {
    graceMin: 15,
    ladder: [
      { thresholdMin: 60, price: 5 },
      { thresholdMin: 120, price: 10 },
      { thresholdMin: 180, price: 15 },
      { thresholdMin: 720, price: 20 },
      { thresholdMin: 1440, price: 25 }
    ]
  };
  t.assertEqual(RateEngine.lookupLadderPrice(card, 10), 0, 'lookupLadderPrice: within grace is free');
  t.assertEqual(RateEngine.lookupLadderPrice(card, 15), 0, 'lookupLadderPrice: exactly at grace is free');
  t.assertEqual(RateEngine.lookupLadderPrice(card, 16), 5, 'lookupLadderPrice: just past grace uses first tier');
  t.assertEqual(RateEngine.lookupLadderPrice(card, 60), 5, 'lookupLadderPrice: exactly at first tier threshold');
  t.assertEqual(RateEngine.lookupLadderPrice(card, 90), 10, 'lookupLadderPrice: between tiers rounds up to next tier');
  t.assertEqual(RateEngine.lookupLadderPrice(card, 1440), 25, 'lookupLadderPrice: exactly at last tier');
  t.assertEqual(RateEngine.lookupLadderPrice(card, 3000), 25, 'lookupLadderPrice: beyond last tier uses ceiling price');

  var emptyLadderCard = { graceMin: 15, ladder: [] };
  t.assertEqual(RateEngine.lookupLadderPrice(emptyLadderCard, 100), 0, 'lookupLadderPrice: empty ladder returns 0');
});
```

Replace with:

```javascript
window.__engineTestCases.push(function(t){
  // Mirrors the real reference example (Lev_AI_Review.xlsx): a free/low first
  // band up to 15 min, then 15-60, 60-120, and an open-ended 120-1440 band.
  var bands = [
    { rate: 0, upToMin: 15 },
    { rate: 5, upToMin: 60 },
    { rate: 10, upToMin: 120 },
    { rate: 15, upToMin: 1440 }
  ];
  t.assertEqual(RateEngine.selectBand(bands, 10).rate, 0, 'selectBand: within first band (0-15) is free');
  t.assertEqual(RateEngine.selectBand(bands, 15).rate, 5, 'selectBand: exactly at a boundary lands in the next band (half-open upper bound)');
  t.assertEqual(RateEngine.selectBand(bands, 45).rate, 5, 'selectBand: mid-band (15-60) uses that band\'s rate');
  t.assertEqual(RateEngine.selectBand(bands, 90).rate, 10, 'selectBand: mid-band (60-120) uses that band\'s rate');
  t.assertEqual(RateEngine.selectBand(bands, 1440).rate, 15, 'selectBand: exactly at the last band\'s upToMin still matches (open-ended catch-all)');
  t.assertEqual(RateEngine.selectBand(bands, 5000).rate, 15, 'selectBand: far beyond the last upToMin still uses the open-ended last band');

  var singleBand = [{ rate: 8, upToMin: 1440 }];
  t.assertEqual(RateEngine.selectBand(singleBand, 5).rate, 8, 'selectBand: single-band section (e.g. Weekend flat rate) covers any duration from 0');
  t.assertEqual(RateEngine.selectBand(singleBand, 3000).rate, 8, 'selectBand: single-band section is open-ended for very long stays too');

  t.assertEqual(RateEngine.selectBand([], 100), null, 'selectBand: empty bands array returns null');

  var unsorted = [{ rate: 15, upToMin: 1440 }, { rate: 0, upToMin: 15 }, { rate: 10, upToMin: 120 }, { rate: 5, upToMin: 60 }];
  t.assertEqual(RateEngine.selectBand(unsorted, 90).rate, 10, 'selectBand: sorts bands by upToMin internally regardless of input order');
});
```

- [ ] **Step 2: Run tests, confirm failures**

`Start-Process "index.html?test=1"` — expect FAILs / a thrown error since `RateEngine.selectBand` doesn't exist yet.

- [ ] **Step 3: Implement `selectBand`, remove `lookupLadderPrice`**

Replace:

```javascript
RateEngine.lookupLadderPrice = function(card, durationMin) {
  if (durationMin <= card.graceMin) return 0;
  var sorted = card.ladder.slice().sort(function(a, b){ return a.thresholdMin - b.thresholdMin; });
  for (var i = 0; i < sorted.length; i++) {
    if (durationMin <= sorted[i].thresholdMin) return sorted[i].price;
  }
  return sorted.length ? sorted[sorted.length - 1].price : 0;
};
```

with:

```javascript
RateEngine.selectBand = function(bands, durationMin) {
  var sorted = bands.slice().sort(function(a, b){ return a.upToMin - b.upToMin; });
  var lower = 0;
  for (var i = 0; i < sorted.length; i++) {
    var isLast = i === sorted.length - 1;
    if (durationMin >= lower && (durationMin < sorted[i].upToMin || isLast)) return sorted[i];
    lower = sorted[i].upToMin;
  }
  return null;
};
```

- [ ] **Step 4: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Replace lookupLadderPrice with selectBand for nested duration bands"
```

---

### Task 3: Engine — rewire `processVisit` onto `selectBand`

**Files:**
- Modify: `index.html` (`RateEngine.processVisit`, currently around line 236)
- Modify: `index.html` (processVisit test fixture, currently around lines 522–526)
- Modify: `index.html` (drop-zone/day-of-week test fixture that sets `state.rateCards`, currently around line 1148)

- [ ] **Step 1: Update the processVisit test fixture to bands**

Replace:

```javascript
  var rateCards = [
    { id: 'day', name: 'Weekday Day', days: [false,true,true,true,true,true,false], startMin: 240, endMin: 960, graceMin: 15,
      ladder: [{thresholdMin:60,price:5},{thresholdMin:120,price:10},{thresholdMin:180,price:15},{thresholdMin:720,price:20},{thresholdMin:1440,price:25}] }
  ];
```

with:

```javascript
  var rateCards = [
    { id: 'day', name: 'Weekday Day', days: [false,true,true,true,true,true,false], startMin: 240, endMin: 960,
      bands: [{rate:0,upToMin:15},{rate:5,upToMin:60},{rate:10,upToMin:120},{rate:15,upToMin:180},{rate:20,upToMin:720},{rate:25,upToMin:1440}] }
  ];
```

Then update this assertion's label only (the expected value `10` is unchanged — a 90-minute visit still falls in the `[60,120)` band, rate 10):

```javascript
  t.assertEqual(v1.staticPrice, 10, 'processVisit: static price from duration ladder');
```

becomes:

```javascript
  t.assertEqual(v1.staticPrice, 10, 'processVisit: static price from duration band');
```

And this one (Early Bird override test) similarly just needs its label updated:

```javascript
  t.assertEqual(v6.staticPrice, 3, 'processVisit: Early Bird overrides duration ladder');
```

becomes:

```javascript
  t.assertEqual(v6.staticPrice, 3, 'processVisit: Early Bird overrides duration band pricing');
```

- [ ] **Step 2: Update the drop-zone test's `state.rateCards` fixture**

Replace:

```javascript
  state.rateCards = [{ id:'day', name:'Day', days:[true,true,true,true,true,true,true], startMin:0, endMin:1439, graceMin:15,
    ladder:[{thresholdMin:120,price:10}] }];
```

with:

```javascript
  state.rateCards = [{ id:'day', name:'Day', days:[true,true,true,true,true,true,true], startMin:0, endMin:1439,
    bands:[{rate:10,upToMin:1440}] }];
```

(A single open-ended band, rate 10, matches the old ladder's effective behavior for the 90-minute test visit used later in that block.)

- [ ] **Step 3: Run tests, confirm failures**

`Start-Process "index.html?test=1"` — expect a thrown error in `processVisit` (`card.ladder` is undefined) since the implementation hasn't changed yet.

- [ ] **Step 4: Rewire `processVisit`**

Replace:

```javascript
    var card = RateEngine.findMatchingRateCard(rateCards, entryDate);
    if (!card) return { excluded: 'no_matching_rate_card', actualPrice: actualPrice, entryDate: entryDate, exitDate: exitDate };
    staticPrice = RateEngine.lookupLadderPrice(card, durationMin);
    bracketName = card.name || 'Unnamed';
```

with:

```javascript
    var card = RateEngine.findMatchingRateCard(rateCards, entryDate);
    if (!card) return { excluded: 'no_matching_rate_card', actualPrice: actualPrice, entryDate: entryDate, exitDate: exitDate };
    staticPrice = RateEngine.selectBand(card.bands, durationMin).rate;
    bracketName = card.name || 'Unnamed';
```

- [ ] **Step 5: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Rewire processVisit onto selectBand and nested-band rate cards"
```

---

### Task 4: Engine — `computeCoverageGrid` (conflict detection)

**Files:**
- Modify: `index.html` (add `RateEngine.computeCoverageGrid` after `RateEngine.aggregateByBracket`, currently ending around line 368)
- Modify: `index.html` (add a new test block after the `aggregateByBracket` test block, currently ending around line 618)

- [ ] **Step 1: Write the failing test**

Add a new `<script>` block right after the existing `aggregateByBracket` test block (after the closing `</script>` around line 618, before the `<script>\nvar state = {` block):

```html
<script>
window.__engineTestCases.push(function(t){
  var cards = [
    { id:'day', name:'Weekday Day', days:[false,true,true,true,true,true,false], startMin:240, endMin:960 },
    { id:'weekend', name:'Weekend', days:[true,false,false,false,false,false,true], startMin:0, endMin:1440 }
  ];
  var grid = RateEngine.computeCoverageGrid(cards);
  t.assertEqual(grid.length, 7, 'computeCoverageGrid: one row per day (0-6, Date.getDay indexing)');
  t.assertEqual(grid[0].length, 24, 'computeCoverageGrid: 24 hourly cells per day');
  t.assertEqual(grid[1][5].count, 1, 'computeCoverageGrid: Monday 5am covered by one card (Weekday Day)');
  t.assertEqual(grid[1][5].names, ['Weekday Day'], 'computeCoverageGrid: names list identifies the covering card');
  t.assertEqual(grid[1][20].count, 0, 'computeCoverageGrid: Monday 8pm is blank (no card covers it)');
  t.assertEqual(grid[0][12].count, 1, 'computeCoverageGrid: Sunday noon covered by the Weekend card');

  var overlapping = [
    { id:'a', name:'Card A', days:[false,true,false,false,false,false,false], startMin:0, endMin:1439 },
    { id:'b', name:'Card B', days:[false,true,false,false,false,false,false], startMin:600, endMin:720 }
  ];
  var conflictGrid = RateEngine.computeCoverageGrid(overlapping);
  t.assertEqual(conflictGrid[1][10].count, 2, 'computeCoverageGrid: two overlapping cards produce a conflict count of 2');
  t.assertEqual(conflictGrid[1][10].names, ['Card A', 'Card B'], 'computeCoverageGrid: conflict cell lists both card names');

  var overnight = [{ id:'ev', name:'Evening', days:[false,true,false,false,false,false,false], startMin:1080, endMin:60 }];
  var overnightGrid = RateEngine.computeCoverageGrid(overnight);
  t.assertEqual(overnightGrid[1][19].count, 1, 'computeCoverageGrid: overnight card covers 7pm on its tagged Monday');
  t.assertEqual(overnightGrid[2][0].count, 1, 'computeCoverageGrid: overnight spillover covers the midnight hour on the NEXT day (Tuesday), day-boundary aware');
  t.assertEqual(overnightGrid[2][2].count, 0, 'computeCoverageGrid: overnight spillover ends at endMin, the hour past it is blank');
});
</script>
```

- [ ] **Step 2: Run tests, confirm failure**

`Start-Process "index.html?test=1"` — expect a thrown error since `RateEngine.computeCoverageGrid` doesn't exist.

- [ ] **Step 3: Implement `computeCoverageGrid`**

Add this function directly after `RateEngine.aggregateByBracket` (before the closing `</script>` of the RateEngine block, around line 368):

```javascript
RateEngine.computeCoverageGrid = function(rateCards) {
  var grid = [];
  for (var day = 0; day < 7; day++) {
    var prevDay = (day + 6) % 7;
    var row = [];
    for (var hour = 0; hour < 24; hour++) {
      var minute = hour * 60;
      var covering = rateCards.filter(function(card){
        if (card.startMin < card.endMin) {
          return card.days[day] && minute >= card.startMin && minute < card.endMin;
        }
        return (minute >= card.startMin && card.days[day]) || (minute < card.endMin && card.days[prevDay]);
      });
      row.push({ count: covering.length, names: covering.map(function(c){ return c.name || 'Unnamed'; }) });
    }
    grid.push(row);
  }
  return grid;
};
```

- [ ] **Step 4: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine.computeCoverageGrid for coverage/conflict detection"
```

---

### Task 5: Data model cutover + rate card UI redesign (nested bands)

This is the big one — see the sequencing note at the top. It replaces `card.ladder`/`card.graceMin` with `card.bands`, seeds a default card on load, and rewrites `renderRateCard()` to the new mockup layout (Name + section Delete, horizontal Start/End time rows, Next Day indicator, days, nested band rows with per-band Rate/Up-to/Remove, Add Next Rate).

**Files:**
- Modify: `index.html` (CSS block, lines 6–47)
- Modify: `index.html` (`newRateCard`, currently around line 634)
- Modify: `index.html` (`timeDropdownsHtml`, currently around line 656)
- Modify: `index.html` (`renderRateCards`/`renderRateCard`, currently around lines 675–812)
- Modify: `index.html` (test fixtures at lines ~828, ~842–909 that reference `ladder`/`graceMin` or exercise the old ladder-tier UI)

- [ ] **Step 1: Add CSS for the new layout**

In the `<style>` block, replace:

```css
.ladderTable{display:flex;gap:8px;flex-wrap:wrap}
.ladderCol{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--bg)}
```

with:

```css
select{padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:13px;max-width:200px}
.timeRow{display:flex;gap:6px;flex-direction:row}
.cardHeaderRow{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}
.nextDayTag{font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;align-self:flex-end;padding-bottom:8px}
.bandRow{display:flex;gap:12px;align-items:flex-end;margin-bottom:6px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
```

(This also fixes the "no CSS for `<select>`" bug called out in the spec — the bare `select{...}` rule now styles every dropdown in the app, including Exit Condition and the time-part selects.)

- [ ] **Step 2: Update the coverage-test fixture (unaffected by rendering, but shares `state.rateCards`)**

Replace (currently around line 828):

```javascript
  state.rateCards = [{ id:'c1', name:'Day', days:[false,true,false,false,false,false,false], startMin:240, endMin:960, graceMin:15, ladder:[{thresholdMin:60,price:5}] }];
```

with:

```javascript
  state.rateCards = [{ id:'c1', name:'Day', days:[false,true,false,false,false,false,false], startMin:240, endMin:960, bands:[{rate:5,upToMin:60}] }];
```

- [ ] **Step 3: Rewrite the "Add Rate Card" UI test block for the new band UI**

Replace the whole test block from `document.getElementById('addCardBtn').click();` through the end of that `window.__engineTestCases.push(function(t){...})` (currently lines ~845–909), keeping the name/time/day-checkbox/preset assertions (still valid — those fields are unchanged) but swapping the ladder-tier assertions for band-row assertions, and swapping the delete-button assertion for the first-card-has-no-delete rule:

```javascript
  document.getElementById('addCardBtn').click();
  document.getElementById('addCardBtn').click();
  t.assertEqual(state.rateCards.length, 3, 'UI: Add Rate Card button adds a card each click (1 seeded on load + 2 clicks)');

  function cardDiv(idx) { return document.querySelectorAll('#rateCardList .card')[idx]; }
  function findBtn(div, matchFn) { return Array.prototype.slice.call(div.querySelectorAll('button')).find(matchFn); }

  var nameInput = cardDiv(0).querySelector('input[data-field="name"]');
  nameInput.value = 'Test Card';
  nameInput.dispatchEvent(new Event('input', {bubbles:true}));
  t.assertEqual(state.rateCards[0].name, 'Test Card', 'UI: editing name input updates state');

  var startCard = cardDiv(0);
  var hourSel = startCard.querySelector('select[data-timefield="startMin"][data-timepart="hour"]');
  hourSel.value = '4'; hourSel.dispatchEvent(new Event('input', {bubbles:true}));
  var minSel = startCard.querySelector('select[data-timefield="startMin"][data-timepart="minute"]');
  minSel.value = '0'; minSel.dispatchEvent(new Event('input', {bubbles:true}));
  var ampmSel = startCard.querySelector('select[data-timefield="startMin"][data-timepart="ampm"]');
  ampmSel.value = 'AM'; ampmSel.dispatchEvent(new Event('input', {bubbles:true}));
  t.assertEqual(state.rateCards[0].startMin, 240, 'UI: start time dropdowns update state in minutes');

  var wedCheckbox = cardDiv(0).querySelector('input[data-day="3"]');
  wedCheckbox.checked = true;
  wedCheckbox.dispatchEvent(new Event('input', {bubbles:true}));
  t.assertEqual(state.rateCards[0].days[3], true, 'UI: checking a day checkbox updates state');

  var weekendBtn = findBtn(cardDiv(0), function(b){ return b.dataset.preset === 'weekend'; });
  weekendBtn.click();
  t.assertEqual(state.rateCards[0].days, [true,false,false,false,false,false,true], 'UI: Weekend preset sets only Sat/Sun');

  t.assertEqual(state.rateCards[0].bands.length, 1, 'newRateCard: starts with exactly one band');
  var addBandBtn = findBtn(cardDiv(0), function(b){ return b.dataset.action === 'addBand'; });
  addBandBtn.click();
  t.assertEqual(state.rateCards[0].bands.length, 2, 'UI: Add Next Rate adds a band');

  var rateInput = cardDiv(0).querySelector('input[data-band-field="rate"]');
  rateInput.value = '7.5';
  rateInput.dispatchEvent(new Event('input', {bubbles:true}));
  t.assertEqual(state.rateCards[0].bands[0].rate, 7.5, 'UI: editing a band\'s rate updates state');

  var upToInput = cardDiv(0).querySelector('input[data-band-field="upToMin"]');
  upToInput.value = '90';
  upToInput.dispatchEvent(new Event('input', {bubbles:true}));
  t.assertEqual(state.rateCards[0].bands[0].upToMin, 90, 'UI: editing a band\'s Up to (minutes) updates state');

  t.assertEqual(!!findBtn(cardDiv(0), function(b){ return b.dataset.bandRemove === '0'; }), false, 'UI: the first band never has a remove button');
  var removeBandBtn = findBtn(cardDiv(0), function(b){ return b.dataset.bandRemove === '1'; });
  removeBandBtn.click();
  t.assertEqual(state.rateCards[0].bands.length, 1, 'UI: Remove Rate removes a band');

  t.assertEqual(!!findBtn(cardDiv(0), function(b){ return b.dataset.action === 'delete'; }), false, 'UI: the first/default rate card has no section Delete button');
  var deleteBtn = findBtn(cardDiv(1), function(b){ return b.dataset.action === 'delete'; });
  t.assertEqual(!!deleteBtn, true, 'UI: a card added via + Add Rate Card DOES have a section Delete button');
  deleteBtn.click();
  t.assertEqual(state.rateCards.length, 2, 'UI: Delete removes a section card');

  var freshCard = newRateCard();
  t.assertEqual(freshCard.endMin, 1439, 'newRateCard: defaults to 23:59 (1439 min), not invalid 24:00');
  t.assertEqual(RateEngine.minutesToTimeString(freshCard.endMin), '23:59', 'newRateCard: default end time renders as a valid time input value');
  t.assertEqual(freshCard.bands.length, 1, 'newRateCard: starts with one visible band, not an empty list');
  t.assertEqual(freshCard.bands[0].upToMin, 15, 'newRateCard: default band Up to (minutes) is 15');

  // Regression: a rate card name containing HTML must not break the rendered markup or execute.
  state.rateCards = [Object.assign(newRateCard(), { name: '"><img src=x>' })];
  renderRateCards();
  var nameInputAfterRender = cardDiv(0).querySelector('input[data-field="name"]');
  t.assertEqual(nameInputAfterRender.value, '"><img src=x>', 'renderRateCard: HTML-bearing name escapes safely and round-trips through the input value');
  t.assertEqual(document.querySelectorAll('#rateCardList img').length, 0, 'renderRateCard: HTML-bearing name does not inject a live element');
});
```

(Note the seeded-card count change: `state.rateCards.length` is now `3` after two clicks, since Step 6 below seeds one card automatically on load — that seed happens once at script-init time, and this test block does not reset `state.rateCards` to `[]` first, matching the existing pattern already used by other blocks that rely on carry-over state.)

- [ ] **Step 4: Run tests, confirm failures**

`Start-Process "index.html?test=1"` — expect thrown errors (`card.bands` undefined inside `renderRateCard`, since it's not implemented yet) and assertion failures.

- [ ] **Step 5: Rewrite `newRateCard()`**

Replace:

```javascript
function newRateCard() {
  // endMin: 1439 (23:59), not 1440 — <input type="time"> can't represent "24:00"
  // (it would render blank), and the reference rate model (Lev_AI_Review.xlsx)
  // itself encodes "end of day" as 23:59:xx rather than exact midnight.
  return { id: 'rc' + (nextCardId++), name: '', days: [false,false,false,false,false,false,false], startMin: 0, endMin: 1439, graceMin: 15, ladder: [{ thresholdMin: 60, price: 0 }] };
}
```

with:

```javascript
function newBand() {
  return { rate: 0, upToMin: 15 };
}
function newRateCard() {
  // endMin: 1439 (23:59), not 1440 — <input type="time"> can't represent "24:00"
  // (it would render blank), and the reference rate model (Lev_AI_Review.xlsx)
  // itself encodes "end of day" as 23:59:xx rather than exact midnight.
  return { id: 'rc' + (nextCardId++), name: '', days: [false,false,false,false,false,false,false], startMin: 0, endMin: 1439, bands: [newBand()] };
}
```

- [ ] **Step 6: Wrap `timeDropdownsHtml`'s selects in `.timeRow` (fixes the vertical-stack bug)**

Replace:

```javascript
  return '<select data-timefield="' + fieldName + '" data-timepart="hour">' + hourOpts + '</select>' +
         '<select data-timefield="' + fieldName + '" data-timepart="minute">' + minOpts + '</select>' +
         '<select data-timefield="' + fieldName + '" data-timepart="ampm">' + ampmOpts + '</select>';
```

with:

```javascript
  return '<div class="timeRow">' +
         '<select data-timefield="' + fieldName + '" data-timepart="hour">' + hourOpts + '</select>' +
         '<select data-timefield="' + fieldName + '" data-timepart="minute">' + minOpts + '</select>' +
         '<select data-timefield="' + fieldName + '" data-timepart="ampm">' + ampmOpts + '</select>' +
         '</div>';
```

- [ ] **Step 7: Rewrite `renderRateCards`/`renderRateCard` for the nested-band layout**

Replace the whole `renderRateCards`/`renderRateCard` pair plus the `addCardBtn` wiring and trailing init call (currently lines 675–682 and 707–811, i.e. everything from `function renderRateCards() {` through `renderCoverageGrid();` at the very end of that script block) with:

```javascript
function renderRateCards() {
  var list = document.getElementById('rateCardList');
  list.innerHTML = '';
  state.rateCards.forEach(function(card, index){
    list.appendChild(renderRateCard(card, index));
  });
  renderCoverageGrid();
}

function renderRateCard(card, index) {
  var div = document.createElement('div');
  div.className = 'card';

  var headerRow = document.createElement('div');
  headerRow.className = 'cardHeaderRow';
  headerRow.innerHTML =
    '<div class="ctl" style="flex:1"><label>Name</label><input type="text" value="' + escapeHtml(card.name) + '" data-field="name"></div>' +
    (index > 0 ? '<button class="btnDanger" data-action="delete">Delete</button>' : '');
  div.appendChild(headerRow);

  var startRow = document.createElement('div');
  startRow.className = 'row';
  startRow.innerHTML = '<div class="ctl"><label>Start Time</label>' + timeDropdownsHtml(card.startMin, 'startMin') + '</div>';
  div.appendChild(startRow);

  var endRow = document.createElement('div');
  endRow.className = 'row';
  var isOvernight = card.endMin < card.startMin;
  endRow.innerHTML = '<div class="ctl"><label>End Time</label>' + timeDropdownsHtml(card.endMin, 'endMin') + '</div>' +
    (isOvernight ? '<div class="nextDayTag">Next Day</div>' : '');
  div.appendChild(endRow);

  var dayRow = document.createElement('div');
  dayRow.className = 'row';
  var dayBoxes = document.createElement('div');
  dayBoxes.className = 'dayBoxes';
  DAY_ORDER.forEach(function(dayIdx){
    var lbl = document.createElement('label');
    lbl.innerHTML = '<input type="checkbox" data-day="' + dayIdx + '" ' + (card.days[dayIdx] ? 'checked' : '') + '>' + DAY_LABELS[dayIdx];
    dayBoxes.appendChild(lbl);
  });
  dayRow.appendChild(dayBoxes);
  var DAY_PRESETS = [
    { key: 'all', label: 'All days' },
    { key: 'weekday', label: 'Weekday (Mon-Fri)' },
    { key: 'weekend', label: 'Weekend (Sat-Sun)' }
  ];
  DAY_PRESETS.forEach(function(preset){
    var btn = document.createElement('button');
    btn.className = 'btnGhost';
    btn.textContent = preset.label;
    btn.dataset.preset = preset.key;
    dayRow.appendChild(btn);
  });
  div.appendChild(dayRow);

  var bandsWrap = document.createElement('div');
  card.bands.forEach(function(band, bandIdx){
    var row = document.createElement('div');
    row.className = 'bandRow';
    row.innerHTML =
      '<div class="ctl"><label>Rate ($)</label><input type="number" value="' + band.rate + '" data-band-idx="' + bandIdx + '" data-band-field="rate"></div>' +
      '<div class="ctl"><label>Up to (minutes)</label><input type="number" value="' + band.upToMin + '" data-band-idx="' + bandIdx + '" data-band-field="upToMin"></div>' +
      (bandIdx > 0 ? '<button class="btnDanger" data-band-remove="' + bandIdx + '">Remove Rate</button>' : '');
    bandsWrap.appendChild(row);
  });
  div.appendChild(bandsWrap);

  var addBandBtn = document.createElement('button');
  addBandBtn.className = 'btnGhost';
  addBandBtn.textContent = '+ Add Next Rate';
  addBandBtn.dataset.action = 'addBand';
  div.appendChild(addBandBtn);

  div.addEventListener('input', function(e){
    var field = e.target.dataset.field;
    if (field) card[field] = e.target.value;
    if (e.target.dataset.timefield) {
      card[e.target.dataset.timefield] = readTimeDropdowns(div, e.target.dataset.timefield);
      renderRateCards();
    }
    if (e.target.dataset.day !== undefined) {
      card.days[Number(e.target.dataset.day)] = e.target.checked;
    }
    if (e.target.dataset.bandIdx !== undefined) {
      var bandIdx = Number(e.target.dataset.bandIdx);
      var bandField = e.target.dataset.bandField;
      card.bands[bandIdx][bandField] = Number(e.target.value);
    }
  });

  div.addEventListener('click', function(e){
    if (e.target.dataset.action === 'delete') {
      state.rateCards = state.rateCards.filter(function(c){ return c.id !== card.id; });
      renderRateCards();
    } else if (e.target.dataset.action === 'addBand') {
      card.bands.push(newBand());
      renderRateCards();
    } else if (e.target.dataset.bandRemove !== undefined) {
      card.bands.splice(Number(e.target.dataset.bandRemove), 1);
      renderRateCards();
    } else if (e.target.dataset.preset) {
      if (e.target.dataset.preset === 'all') card.days = [true,true,true,true,true,true,true];
      if (e.target.dataset.preset === 'weekday') card.days = [false,true,true,true,true,true,false];
      if (e.target.dataset.preset === 'weekend') card.days = [true,false,false,false,false,false,true];
      renderRateCards();
    }
  });

  return div;
}

document.getElementById('addCardBtn').addEventListener('click', function(){
  state.rateCards.push(newRateCard());
  renderRateCards();
});
state.rateCards.push(newRateCard());
renderRateCards();
```

Notes on this rewrite:
- `index` (not the old bare `card` closure) now decides whether the section Delete button renders, per spec ("absent on the first/default rate card... present on any card added afterward").
- The `input` handler re-renders (`renderRateCards()`) after a time-dropdown change so the `Next Day` tag recomputes live when Start/End cross midnight — none of the other fields need a full re-render on every keystroke, matching the prior behavior for name/day/band edits (they mutate `card` in place without forcing a redraw, exactly like the old code did for `name`/`graceMin`/day checkboxes).
- `renderCoverageGrid()` is still called at the end of `renderRateCards()` (unchanged from before) — Task 6 will change what that function itself does internally.

- [ ] **Step 8: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs. If the "Add Rate Card button adds a card each click" or similar count-based assertions are off, double check the seed-on-load line (`state.rateCards.push(newRateCard()); renderRateCards();`) only runs once at script-init time, not once per test run (it does — it's plain top-level script code, evaluated once when the page loads, before `?test=1`'s harness runs `__runEngineTests()`).

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Redesign rate cards as time-of-day sections with nested duration bands"
```

---

### Task 6: Coverage grid rendering (hour headers, full-width cells, blank/green/red states)

**Files:**
- Modify: `index.html` (setup page markup, coverage `.card`, currently lines 61–64)
- Modify: `index.html` (CSS block)
- Modify: `index.html` (`renderCoverageGrid`, `isHourCovered`, currently around lines 684–705)
- Modify: `index.html` (coverage test block, currently around lines 826–837)

- [ ] **Step 1: Update the coverage-grid test to use `computeCoverageGrid` and expect a conflict-summary element**

Replace (currently lines 826–837):

```javascript
window.__engineTestCases.push(function(t){
  state.rateCards = [{ id:'c1', name:'Day', days:[false,true,false,false,false,false,false], startMin:240, endMin:960, bands:[{rate:5,upToMin:60}] }];
  renderRateCards();
  t.assertEqual(isHourCovered(state.rateCards, 1, 5), true, 'coverage: hour 5am on Monday is covered (4am-4pm card)');
  t.assertEqual(isHourCovered(state.rateCards, 1, 20), false, 'coverage: hour 8pm on Monday is not covered');
  t.assertEqual(isHourCovered(state.rateCards, 2, 5), false, 'coverage: Tuesday is not covered by a Monday-only card');
  var mondayRow = document.querySelectorAll('#coverageGrid .coverageRow')[0];
  var coveredCells = mondayRow.querySelectorAll('.coverageCell.covered');
  t.assertEqual(coveredCells.length, 12, 'coverage: Monday row shows 12 covered hours (4am-4pm)');
});
```

with:

```javascript
window.__engineTestCases.push(function(t){
  state.rateCards = [{ id:'c1', name:'Day', days:[false,true,false,false,false,false,false], startMin:240, endMin:960, bands:[{rate:5,upToMin:60}] }];
  renderRateCards();
  var grid = RateEngine.computeCoverageGrid(state.rateCards);
  t.assertEqual(grid[1][5].count, 1, 'coverage: hour 5am on Monday is covered (4am-4pm card)');
  t.assertEqual(grid[1][20].count, 0, 'coverage: hour 8pm on Monday is not covered');
  t.assertEqual(grid[2][5].count, 0, 'coverage: Tuesday is not covered by a Monday-only card');

  var mondayRow = document.querySelectorAll('#coverageGrid .coverageRow')[1];
  var coveredCells = mondayRow.querySelectorAll('.coverageCell.covered');
  t.assertEqual(coveredCells.length, 12, 'coverage: Monday row shows 12 green (single-coverage) hours (4am-4pm)');

  var headerCells = document.querySelectorAll('#coverageGrid .coverageHeaderCell');
  t.assertEqual(headerCells.length, 24, 'coverage: 24 hour-label header cells rendered above the grid');
  t.assertEqual(headerCells[0].textContent, '12a', 'coverage: header hour 0 is labeled 12a');
  t.assertEqual(headerCells[13].textContent, '1p', 'coverage: header hour 13 is labeled 1p');

  state.rateCards = [
    { id:'a', name:'Card A', days:[false,true,false,false,false,false,false], startMin:0, endMin:1439, bands:[{rate:1,upToMin:1440}] },
    { id:'b', name:'Card B', days:[false,true,false,false,false,false,false], startMin:600, endMin:720, bands:[{rate:1,upToMin:1440}] }
  ];
  renderRateCards();
  var mondayRowConflict = document.querySelectorAll('#coverageGrid .coverageRow')[1];
  var conflictCells = mondayRowConflict.querySelectorAll('.coverageCell.conflict');
  t.assertEqual(conflictCells.length, 2, 'coverage: the 2 overlapping hours (10am-12pm) render as conflict (red) cells');
});
```

- [ ] **Step 2: Run tests, confirm failures**

`Start-Process "index.html?test=1"` — expect FAILs (no `.coverageHeaderCell` elements yet, no `.conflict` class yet, `RateEngine.computeCoverageGrid` calls will already pass from Task 4 but the DOM assertions will fail).

- [ ] **Step 3: Update the markup — add the header row / Add Early Bird checkbox / conflicts line**

Replace (currently lines 60–64):

```html
<div id="setupPage" class="page active">
  <div class="card">
    <div class="sub">Rate coverage (green = a rate card covers that hour; blank = no rate assigned &mdash; gaps are often intentional, e.g. closed hours)</div>
    <div id="coverageGrid"></div>
  </div>
```

with:

```html
<div id="setupPage" class="page active">
  <div class="card">
    <div class="cardHeaderRow">
      <div class="sub" style="margin:0">Rate coverage (green = one rate card covers that hour; red = two or more conflict; blank = no rate assigned &mdash; gaps are often intentional, e.g. closed hours)</div>
      <label class="toggle" style="cursor:pointer"><input type="checkbox" id="ebEnabled"> Add Early Bird</label>
    </div>
    <div id="coverageGrid"></div>
    <div id="coverageConflicts" class="sub" style="margin:8px 0 0"></div>
  </div>
```

(The `#ebEnabled` checkbox moves here from `#ebCard` — Task 8 removes its old location and updates `renderEarlyBird()`'s visibility logic. Leave `#ebCard` where it currently is for now; Task 8 relocates it. Its markup still references an `#ebEnabled` checkbox by ID, and IDs must be unique in the DOM — Task 8 must remove the OLD checkbox markup from `#ebCard` in the same pass it adds this new one, so do Task 6 and Task 8 in order without deploying/testing the page in between with both present. Running the self-test harness within Task 6 is unaffected because `document.getElementById` simply returns the first match; the harness doesn't care about a temporarily-duplicated ID between commits as long as both instances have working listeners, but avoid leaving two `id="ebEnabled"` elements in the codebase for more than one task's duration.)

- [ ] **Step 4: Add coverage-grid CSS (header row, full-width flex cells, conflict state)**

Replace:

```css
.coverageRow{display:flex;align-items:center;gap:4px;margin-bottom:2px}
.coverageRow .dayLabel{width:36px;font-size:11px;color:var(--muted);flex-shrink:0}
.coverageCell{width:16px;height:16px;border:1px solid var(--line);border-radius:2px}
.coverageCell.covered{background:var(--teal);border-color:var(--teal)}
```

with:

```css
.coverageHeaderRow{display:flex;gap:4px;margin-bottom:4px}
.coverageHeaderRow .dayLabel{width:36px;flex-shrink:0}
.coverageHeaderCell{flex:1;font-size:10px;color:var(--muted);text-align:center}
.coverageRow{display:flex;align-items:center;gap:4px;margin-bottom:2px}
.coverageRow .dayLabel{width:36px;font-size:11px;color:var(--muted);flex-shrink:0}
.coverageCell{flex:1;height:16px;border:1px solid var(--line);border-radius:2px}
.coverageCell.covered{background:var(--teal);border-color:var(--teal)}
.coverageCell.conflict{background:var(--orange);border-color:var(--orange)}
```

- [ ] **Step 5: Rewrite `renderCoverageGrid`, remove `isHourCovered`**

Replace (currently lines 684–705):

```javascript
function isHourCovered(rateCards, dayIdx, hour) {
  var minute = hour * 60;
  for (var i = 0; i < rateCards.length; i++) {
    var card = rateCards[i];
    if (card.days[dayIdx] && RateEngine.withinRange(minute, card.startMin, card.endMin)) return true;
  }
  return false;
}
function renderCoverageGrid() {
  var el = document.getElementById('coverageGrid');
  el.innerHTML = '';
  DAY_ORDER.forEach(function(dayIdx){
    var row = document.createElement('div');
    row.className = 'coverageRow';
    row.innerHTML = '<div class="dayLabel">' + DAY_LABELS[dayIdx] + '</div>';
    for (var hour = 0; hour < 24; hour++) {
      var covered = isHourCovered(state.rateCards, dayIdx, hour);
      row.innerHTML += '<div class="coverageCell' + (covered ? ' covered' : '') + '"></div>';
    }
    el.appendChild(row);
  });
}
```

with:

```javascript
function hourLabel(hour) {
  var h = hour % 24;
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + (h < 12 ? 'a' : 'p');
}
function renderCoverageGrid() {
  var el = document.getElementById('coverageGrid');
  el.innerHTML = '';

  var headerRow = document.createElement('div');
  headerRow.className = 'coverageHeaderRow';
  headerRow.innerHTML = '<div class="dayLabel"></div>';
  for (var hour = 0; hour < 24; hour++) {
    headerRow.innerHTML += '<div class="coverageHeaderCell">' + hourLabel(hour) + '</div>';
  }
  el.appendChild(headerRow);

  var grid = RateEngine.computeCoverageGrid(state.rateCards);
  DAY_ORDER.forEach(function(dayIdx){
    var row = document.createElement('div');
    row.className = 'coverageRow';
    row.innerHTML = '<div class="dayLabel">' + DAY_LABELS[dayIdx] + '</div>';
    grid[dayIdx].forEach(function(cell){
      var cls = 'coverageCell' + (cell.count === 1 ? ' covered' : cell.count >= 2 ? ' conflict' : '');
      row.innerHTML += '<div class="' + cls + '"></div>';
    });
    el.appendChild(row);
  });
}
```

- [ ] **Step 6: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Rewrite coverage grid: hour headers, full-width cells, green/red conflict states"
```

---

### Task 7: Coverage grid — conflict summary text line

**Files:**
- Modify: `index.html` (add `summarizeConflicts`/`joinNames` helpers near `renderCoverageGrid`)
- Modify: `index.html` (`renderCoverageGrid`, wire in the summary text)
- Modify: `index.html` (add a test case to the coverage test block from Task 6)

- [ ] **Step 1: Extend the coverage test with a conflict-summary assertion**

In the same test block updated in Task 6, after the `conflictCells` assertion, add:

```javascript
  var conflictText = document.getElementById('coverageConflicts').textContent;
  t.assertEqual(conflictText.indexOf('Card A') > -1 && conflictText.indexOf('Card B') > -1, true, 'coverage: conflict summary line names both overlapping cards');
  t.assertEqual(conflictText.indexOf('Mon') > -1, true, 'coverage: conflict summary line names the day');
```

- [ ] **Step 2: Run tests, confirm failure**

`Start-Process "index.html?test=1"` — expect FAIL (`#coverageConflicts` is empty).

- [ ] **Step 3: Implement `summarizeConflicts`/`joinNames` and wire into `renderCoverageGrid`**

Add these two helpers directly above `function renderCoverageGrid() {`:

```javascript
function joinNames(names) {
  var unique = names.filter(function(n, i){ return names.indexOf(n) === i; });
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return unique[0] + ' and ' + unique[1];
  return unique.slice(0, -1).join(', ') + ' and ' + unique[unique.length - 1];
}
function summarizeConflicts(grid) {
  var lines = [];
  DAY_ORDER.forEach(function(dayIdx){
    var row = grid[dayIdx];
    var runStart = null, runKey = null, runNames = null;
    for (var hour = 0; hour <= 24; hour++) {
      var cell = hour < 24 ? row[hour] : null;
      var key = cell && cell.count >= 2 ? cell.names.slice().sort().join('|') : null;
      if (key !== runKey) {
        if (runKey !== null) {
          var unique = runNames.filter(function(n, i){ return runNames.indexOf(n) === i; });
          var verb = unique.length > 2 ? ' all cover ' : ' both cover ';
          lines.push(joinNames(runNames) + verb + DAY_LABELS[dayIdx] + ' ' + hourLabel(runStart) + 'm-' + hourLabel(hour) + 'm');
        }
        runStart = hour; runKey = key; runNames = cell ? cell.names : null;
      }
    }
  });
  return lines;
}
```

Then update `renderCoverageGrid` to render the summary — replace:

```javascript
  var grid = RateEngine.computeCoverageGrid(state.rateCards);
  DAY_ORDER.forEach(function(dayIdx){
    var row = document.createElement('div');
    row.className = 'coverageRow';
    row.innerHTML = '<div class="dayLabel">' + DAY_LABELS[dayIdx] + '</div>';
    grid[dayIdx].forEach(function(cell){
      var cls = 'coverageCell' + (cell.count === 1 ? ' covered' : cell.count >= 2 ? ' conflict' : '');
      row.innerHTML += '<div class="' + cls + '"></div>';
    });
    el.appendChild(row);
  });
}
```

with:

```javascript
  var grid = RateEngine.computeCoverageGrid(state.rateCards);
  DAY_ORDER.forEach(function(dayIdx){
    var row = document.createElement('div');
    row.className = 'coverageRow';
    row.innerHTML = '<div class="dayLabel">' + DAY_LABELS[dayIdx] + '</div>';
    grid[dayIdx].forEach(function(cell){
      var cls = 'coverageCell' + (cell.count === 1 ? ' covered' : cell.count >= 2 ? ' conflict' : '');
      row.innerHTML += '<div class="' + cls + '"></div>';
    });
    el.appendChild(row);
  });

  var conflictLines = summarizeConflicts(grid);
  document.getElementById('coverageConflicts').innerHTML = conflictLines.map(function(l){ return '<div>' + escapeHtml(l) + '</div>'; }).join('');
}
```

- [ ] **Step 4: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add conflict summary text line below the coverage grid"
```

---

### Task 8: Relocate Early Bird card below the coverage grid

**Files:**
- Modify: `index.html` (`#ebCard` markup, currently around lines 69–85)
- Modify: `index.html` (`renderEarlyBird`, currently around lines 913–930)
- Modify: `index.html` (Early Bird test block, currently around lines 949–1013)

- [ ] **Step 1: Update the Early Bird test's visibility assertions**

In the test block, replace every occurrence of:

```javascript
  t.assertEqual(document.getElementById('ebFields').style.display, 'none', 'EB UI: fields hidden when disabled');
```

with:

```javascript
  t.assertEqual(document.getElementById('ebCard').style.display, 'none', 'EB UI: card hidden when disabled');
```

and every occurrence of:

```javascript
  t.assertEqual(document.getElementById('ebFields').style.display, 'contents', 'EB UI: fields visible when enabled');
```

with:

```javascript
  t.assertEqual(document.getElementById('ebCard').style.display, 'block', 'EB UI: card visible when enabled');
```

and:

```javascript
  t.assertEqual(document.getElementById('ebFields').style.display, 'none', 'EB UI: fields hidden when disabled again');
```

with:

```javascript
  t.assertEqual(document.getElementById('ebCard').style.display, 'none', 'EB UI: card hidden when disabled again');
```

(There are two occurrences of the "hidden when disabled" pattern in that test block — around the start and near the end — update both the same way.)

- [ ] **Step 2: Run tests, confirm failure**

`Start-Process "index.html?test=1"` — expect FAILs (there is no `#ebFields`-driven `'none'`/`'block'` toggle on `#ebCard` yet; the checkbox is also still duplicated from Task 6's markup change).

- [ ] **Step 3: Move and simplify the `#ebCard` markup**

Replace the entire existing `#ebCard` block (currently around lines 69–85):

```html
  <div class="card" id="ebCard">
    <div class="row">
      <div class="ctl"><label>Early Bird</label>
        <label><input type="checkbox" id="ebEnabled"> Enabled</label>
      </div>
      <div id="ebFields" style="display:contents">
        <div class="ctl"><label>Entry window start</label><div id="ebEntryStartGroup"></div></div>
        <div class="ctl"><label>Entry window end</label><div id="ebEntryEndGroup"></div></div>
        <div class="ctl"><label>Exit condition</label>
          <select id="ebExitCondition"><option value="before">Exit Before</option><option value="after">Exit After</option></select>
        </div>
        <div class="ctl"><label>Exit time</label><div id="ebExitTimeGroup"></div></div>
        <div class="ctl"><label>Price</label><input type="number" id="ebPrice"></div>
      </div>
    </div>
    <div class="row" id="ebDayRow"><div class="dayBoxes" id="ebDayBoxes"></div></div>
  </div>
```

Move it to sit directly after the coverage `.card` (right after its closing `</div>`, before `<h2>Setup</h2>`), with the checkbox removed (it now lives in the coverage card's header row, added in Task 6) and `#ebFields` demoted from a wrapper `<div>` to a plain CSS class marker (the whole card now shows/hides as one unit, so `display:contents` juggling on an inner wrapper is no longer needed):

```html
  <div class="card" id="ebCard" style="display:none">
    <div class="row">
      <div class="ctl"><label>Entry window start</label><div id="ebEntryStartGroup"></div></div>
      <div class="ctl"><label>Entry window end</label><div id="ebEntryEndGroup"></div></div>
      <div class="ctl"><label>Exit condition</label>
        <select id="ebExitCondition"><option value="before">Exit Before</option><option value="after">Exit After</option></select>
      </div>
      <div class="ctl"><label>Exit time</label><div id="ebExitTimeGroup"></div></div>
      <div class="ctl"><label>Price</label><input type="number" id="ebPrice"></div>
    </div>
    <div class="row" id="ebDayRow"><div class="dayBoxes" id="ebDayBoxes"></div></div>
  </div>
```

- [ ] **Step 4: Simplify `renderEarlyBird`'s visibility logic**

Replace:

```javascript
function renderEarlyBird() {
  document.getElementById('ebEnabled').checked = state.earlyBird.enabled;
  document.getElementById('ebEntryStartGroup').innerHTML = timeDropdownsHtml(state.earlyBird.entryStartMin, 'entryStartMin');
  document.getElementById('ebEntryEndGroup').innerHTML = timeDropdownsHtml(state.earlyBird.entryEndMin, 'entryEndMin');
  document.getElementById('ebExitCondition').value = state.earlyBird.exitCondition;
  document.getElementById('ebExitTimeGroup').innerHTML = timeDropdownsHtml(state.earlyBird.exitMin, 'exitMin');
  document.getElementById('ebPrice').value = state.earlyBird.price;
  var dayBoxes = document.getElementById('ebDayBoxes');
  dayBoxes.innerHTML = '';
  DAY_ORDER.forEach(function(dayIdx){
    var lbl = document.createElement('label');
    lbl.innerHTML = '<input type="checkbox" data-eb-day="' + dayIdx + '" ' + (state.earlyBird.days[dayIdx] ? 'checked' : '') + '>' + DAY_LABELS[dayIdx];
    dayBoxes.appendChild(lbl);
  });
  var showFields = state.earlyBird.enabled;
  document.getElementById('ebFields').style.display = showFields ? 'contents' : 'none';
  document.getElementById('ebDayRow').style.display = showFields ? '' : 'none';
}
```

with:

```javascript
function renderEarlyBird() {
  document.getElementById('ebEnabled').checked = state.earlyBird.enabled;
  document.getElementById('ebEntryStartGroup').innerHTML = timeDropdownsHtml(state.earlyBird.entryStartMin, 'entryStartMin');
  document.getElementById('ebEntryEndGroup').innerHTML = timeDropdownsHtml(state.earlyBird.entryEndMin, 'entryEndMin');
  document.getElementById('ebExitCondition').value = state.earlyBird.exitCondition;
  document.getElementById('ebExitTimeGroup').innerHTML = timeDropdownsHtml(state.earlyBird.exitMin, 'exitMin');
  document.getElementById('ebPrice').value = state.earlyBird.price;
  var dayBoxes = document.getElementById('ebDayBoxes');
  dayBoxes.innerHTML = '';
  DAY_ORDER.forEach(function(dayIdx){
    var lbl = document.createElement('label');
    lbl.innerHTML = '<input type="checkbox" data-eb-day="' + dayIdx + '" ' + (state.earlyBird.days[dayIdx] ? 'checked' : '') + '>' + DAY_LABELS[dayIdx];
    dayBoxes.appendChild(lbl);
  });
  document.getElementById('ebCard').style.display = state.earlyBird.enabled ? 'block' : 'none';
}
```

Note the `#ebCard`/`#ebEnabled` event-listener wiring below `renderEarlyBird()` (the `document.getElementById('ebEnabled').addEventListener('change', ...)` and `document.getElementById('ebCard').addEventListener('input', ...)` blocks) reference elements by ID only, so they keep working unchanged after the markup move — no JS wiring changes needed there.

- [ ] **Step 5: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs. Also open the page normally (no `?test=1`) and confirm: unchecking/checking "Add Early Bird" in the coverage card's header shows/hides the whole Early Bird card below the grid, with no duplicate checkboxes anywhere on the page.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Relocate Early Bird card below coverage grid; checkbox moves to grid header"
```

---

### Task 9: Compare tab — summary bubbles

**Files:**
- Modify: `index.html` (CSS block)
- Modify: `index.html` (`renderCompare`, `totalsEl.innerHTML` assignment, currently around lines 1081–1086)
- Modify: `index.html` (add assertions to the existing day-of-week Compare test block, currently around lines 1146–1179)

- [ ] **Step 1: Add bubble assertions to the existing Compare test**

In the test block that calls `applyVisitFileBuffer` and checks `state.compareResult` (currently around line 1158 onward), add right after the `percentOfActual` assertion:

```javascript
  var statCards = document.querySelectorAll('#totalsSummary .statCard');
  t.assertEqual(statCards.length, 4, 'renderCompare: 4 summary bubbles rendered (Traditional Rate Revenue, AI Revenue, Variance, Percent)');
  t.assertEqual(statCards[0].textContent.indexOf('Traditional Rate Revenue') > -1, true, 'renderCompare: first bubble labeled Traditional Rate Revenue');
  t.assertEqual(statCards[0].textContent.indexOf('$10.00') > -1, true, 'renderCompare: first bubble shows the static total');
  t.assertEqual(statCards[1].textContent.indexOf('$12.00') > -1, true, 'renderCompare: AI Revenue bubble shows the actual total');
```

- [ ] **Step 2: Run tests, confirm failure**

`Start-Process "index.html?test=1"` — expect FAIL (no `.statCard` elements exist yet).

- [ ] **Step 3: Add bubble CSS**

Append to the `<style>` block:

```css
.statRow{display:flex;gap:12px;margin-bottom:14px}
.statCard{flex:1 1 0;text-align:center}
.statCard .statLabel{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;margin-bottom:4px}
.statCard .statValue{font-size:20px;font-weight:700}
```

- [ ] **Step 4: Replace the totals summary markup**

Replace:

```javascript
  totalsEl.innerHTML =
    '<div class="card"><strong>Overall</strong><br>' +
    'Static: ' + fmtMoney(result.totals.staticTotal) + ' &nbsp; ' +
    'Actual: ' + fmtMoney(result.totals.actualTotal) + ' &nbsp; ' +
    'Delta: ' + fmtDelta(result.totals.staticTotal, result.totals.actualTotal, result.totals.delta, result.totals.percentOfStatic, result.totals.percentOfActual) +
    '</div>';
```

with:

```javascript
  totalsEl.innerHTML =
    '<div class="statRow">' +
    '<div class="card statCard"><div class="statLabel">Traditional Rate Revenue</div><div class="statValue">' + fmtMoney(result.totals.staticTotal) + '</div></div>' +
    '<div class="card statCard"><div class="statLabel">AI Revenue</div><div class="statValue">' + fmtMoney(result.totals.actualTotal) + '</div></div>' +
    '<div class="card statCard"><div class="statLabel">Variance</div><div class="statValue">' + fmtMoney(result.totals.delta) + '</div></div>' +
    '<div class="card statCard"><div class="statLabel">Percent</div><div class="statValue">' + fmtPercent(result.totals.percentOfStatic) + '</div></div>' +
    '</div>';
```

- [ ] **Step 5: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add Compare tab summary bubbles (Traditional/AI Revenue, Variance, Percent)"
```

---

### Task 10: Compare tab — typography cleanup + zebra striping

**Files:**
- Modify: `index.html` (CSS block)
- Modify: `index.html` (`renderCompare`, bracket/day-row loop, currently around lines 1088–1121)
- Modify: `index.html` (Compare test block, add zebra-striping assertions)

- [ ] **Step 1: Add a zebra-striping assertion to the Compare test**

The existing fixture only produces one day row per bracket, which isn't enough to see alternation. Add a second data row (a different day of the week) to the CSV text built in the test block. Replace:

```javascript
  var row1 = "1\t7/1/2026\t10:00:00 AM\t7/1/2026\t11:30:00 AM\tFalse\t$12.00\t\t$12.00\tTransient (No Coverage)";
  applyVisitFileBuffer(t.utf16leEncode(header + row1), 'test.csv');
```

with:

```javascript
  var row1 = "1\t7/1/2026\t10:00:00 AM\t7/1/2026\t11:30:00 AM\tFalse\t$12.00\t\t$12.00\tTransient (No Coverage)";
  var row2 = "2\t7/2/2026\t10:00:00 AM\t7/2/2026\t11:30:00 AM\tFalse\t$12.00\t\t$12.00\tTransient (No Coverage)"; // 7/2/2026 is a Thursday
  applyVisitFileBuffer(t.utf16leEncode(header + row1 + "\n" + row2), 'test.csv');
```

Then add, after the existing bracket/day assertions in that same block:

```javascript
  t.assertEqual(bracket.dayList.length, 2, 'runComparison: bracket now has two day-of-week entries');
  var dayRows = document.querySelectorAll('#bracketList .dayRow');
  t.assertEqual(dayRows.length, 2, 'renderCompare: one .dayRow element per day-of-week entry');
  t.assertEqual(dayRows[0].classList.contains('even'), true, 'renderCompare: first day row is zebra-striped even');
  t.assertEqual(dayRows[1].classList.contains('odd'), true, 'renderCompare: second day row is zebra-striped odd');
```

- [ ] **Step 2: Run tests, confirm failure**

`Start-Process "index.html?test=1"` — expect FAIL (no `.dayRow` class exists yet; also re-check the earlier day-index assertions in this block still pass with 2 rows — e.g. `bracket.dayList[0].dayIndex` was asserted as `3` (Wednesday) in the original test and stays valid since `dayList` is sorted ascending by `dayIndex` and Wednesday(3) still sorts before Thursday(4)).

- [ ] **Step 3: Add typography/zebra CSS**

Append to the `<style>` block:

```css
.bracketName{font-size:15px;font-weight:700}
.bracketMeta{color:var(--muted);font-size:13px;margin-top:2px}
.dayRow{font-size:13px;padding:6px 8px;border-radius:6px;margin-top:6px}
.dayRow.even{background:var(--surface)}
.dayRow.odd{background:var(--bg)}
.dayRowDetail{margin-top:4px;padding-left:12px;border-left:2px solid var(--line);font-size:12px;color:var(--muted)}
```

- [ ] **Step 4: Rewrite the bracket/day-row rendering loop**

Replace:

```javascript
  bracketListEl.innerHTML = '';
  result.brackets.forEach(function(b){
    var div = document.createElement('div');
    div.className = 'card';
    var html =
      '<strong>' + escapeHtml(b.name) + '</strong> (Visits: ' + b.count + ')<br>' +
      'Static: ' + fmtMoney(b.staticTotal) + ' &nbsp; Actual: ' + fmtMoney(b.actualTotal) +
      ' &nbsp; Validation: ' + fmtMoney(b.validationTotal) + ' &nbsp; Delta: ' + fmtDelta(b.staticTotal, b.actualTotal, b.delta, b.percentOfStatic, b.percentOfActual);

    b.dayList.forEach(function(d){
      var dayKey = b.name + '|' + d.dayIndex;
      var dayName = DAY_LABELS[d.dayIndex];
      var dayUnrolled = state.unrolledBrackets.has(dayKey);
      html += '<div style="margin-top:6px;padding-left:8px">' +
        '<strong>' + dayName + '</strong> Visits: ' + d.count + ' &nbsp; ' +
        'Static: ' + fmtMoney(d.staticTotal) + ' &nbsp; Actual: ' + fmtMoney(d.actualTotal) + ' &nbsp; ' +
        'Delta: ' + fmtDelta(d.staticTotal, d.actualTotal, d.delta, d.percentOfStatic, d.percentOfActual);
      if (!state.ignoreValidations) {
        html += ' &nbsp; <button class="btnGhost" data-bracket="' + escapeHtml(dayKey) + '">' + (dayUnrolled ? 'Roll up ▲' : 'Unroll ▾') + '</button>';
        if (dayUnrolled) {
          html += '<div style="margin-top:4px;padding-left:12px;border-left:2px solid var(--line)">' +
            'Normal (' + d.normal.count + '): Static ' + fmtMoney(d.normal.staticTotal) + ', Actual ' + fmtMoney(d.normal.actualTotal) + '<br>' +
            'Validation (' + d.validation.count + '): Static ' + fmtMoney(d.validation.staticTotal) + ', Actual ' + fmtMoney(d.validation.actualTotal) + ', Validation ' + fmtMoney(d.validation.validationTotal) +
            '</div>';
        }
      } else {
        html += ' &nbsp; <button class="btnGhost" disabled style="opacity:.4;cursor:not-allowed">Unroll ▾</button>';
      }
      html += '</div>';
    });

    div.innerHTML = html;
    bracketListEl.appendChild(div);
  });
```

with:

```javascript
  bracketListEl.innerHTML = '';
  result.brackets.forEach(function(b){
    var div = document.createElement('div');
    div.className = 'card';
    var html =
      '<div class="bracketName">' + escapeHtml(b.name) + '</div>' +
      '<div class="bracketMeta">Visits: ' + b.count + ' &nbsp; Static: ' + fmtMoney(b.staticTotal) + ' &nbsp; Actual: ' + fmtMoney(b.actualTotal) +
      ' &nbsp; Validation: ' + fmtMoney(b.validationTotal) + ' &nbsp; Delta: ' + fmtDelta(b.staticTotal, b.actualTotal, b.delta, b.percentOfStatic, b.percentOfActual) + '</div>';

    b.dayList.forEach(function(d, idx){
      var dayKey = b.name + '|' + d.dayIndex;
      var dayName = DAY_LABELS[d.dayIndex];
      var dayUnrolled = state.unrolledBrackets.has(dayKey);
      html += '<div class="dayRow ' + (idx % 2 === 0 ? 'even' : 'odd') + '">' +
        '<strong>' + dayName + '</strong> Visits: ' + d.count + ' &nbsp; ' +
        'Static: ' + fmtMoney(d.staticTotal) + ' &nbsp; Actual: ' + fmtMoney(d.actualTotal) + ' &nbsp; ' +
        'Delta: ' + fmtDelta(d.staticTotal, d.actualTotal, d.delta, d.percentOfStatic, d.percentOfActual);
      if (!state.ignoreValidations) {
        html += ' &nbsp; <button class="btnGhost" data-bracket="' + escapeHtml(dayKey) + '">' + (dayUnrolled ? 'Roll up ▲' : 'Unroll ▾') + '</button>';
        if (dayUnrolled) {
          html += '<div class="dayRowDetail">' +
            'Normal (' + d.normal.count + '): Static ' + fmtMoney(d.normal.staticTotal) + ', Actual ' + fmtMoney(d.normal.actualTotal) + '<br>' +
            'Validation (' + d.validation.count + '): Static ' + fmtMoney(d.validation.staticTotal) + ', Actual ' + fmtMoney(d.validation.actualTotal) + ', Validation ' + fmtMoney(d.validation.validationTotal) +
            '</div>';
        }
      } else {
        html += ' &nbsp; <button class="btnGhost" disabled style="opacity:.4;cursor:not-allowed">Unroll ▾</button>';
      }
      html += '</div>';
    });

    div.innerHTML = html;
    bracketListEl.appendChild(div);
  });
```

- [ ] **Step 5: Run tests, confirm all pass**

`Start-Process "index.html?test=1"` — expect 0 FAILs.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add Compare tab typography classes and zebra striping on day rows"
```

---

## Final Verification

- [ ] Run the full self-test suite one more time: `Start-Process "index.html?test=1"` — confirm "N/N passed" with zero FAILs.
- [ ] Open `index.html` normally (no `?test=1`): confirm one default rate card is visible on load with one band, the coverage grid shows hour headers and full-width cells, checking "Add Early Bird" in the grid's header row expands the Early Bird card below the grid, adding a second rate card shows a Delete button (the first still doesn't), adding a second band via "+ Add Next Rate" shows a "Remove Rate" button (the first band still doesn't), and dropping a visit CSV populates the Compare tab's 4 summary bubbles plus zebra-striped day rows.
- [ ] Compare the rendered Setup tab side-by-side against `TOP Interface.png` and `Rate Table Section.png` for layout fidelity (accounting for the confirmed corrections: no Grace Period field, per-band Rate field, nested bands within one section card).
