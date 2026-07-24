# Parking Rate Comparison Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Google Apps Script Web App (`Code.gs` + `index.html`) that lets a user define a static parking rate table, drop in a visit-history export, and compare actual AI-priced charges against what the static table would have charged.

**Architecture:** Two files only. `Code.gs` serves `index.html` via `doGet()`. All logic (TSV/UTF-16LE parsing, rate engine, UI, an embedded self-test harness) lives inline in `index.html` as vanilla JS/CSS — no build step, no server-side data processing, no third file.

**Tech Stack:** Google Apps Script (`HtmlService`), vanilla JS/CSS/HTML. No frameworks, no Node/npm dependency (none is available in this dev environment — see Testing Strategy below).

**Spec:** `docs/superpowers/specs/2026-07-23-parking-rate-comparison-design.md`

---

## Testing Strategy

This dev environment has no Node.js or Python, so classic `pytest`/`jest` runs aren't
available. Instead, `index.html` embeds a small self-test harness, active only when
opened with `?test=1` in the URL:

- A global `window.__engineTestCases` array. Each task's test step pushes a function
  into it.
- `window.__runEngineTests()` runs every pushed case, using a plain `assertEqual`
  helper, and renders PASS/FAIL results into a `#test-results` div (and logs a
  summary to the console).
- **Verification method (revised during execution — claude-in-chrome is not actually
  available in this environment):** use headless Chrome's `--dump-dom` flag, e.g.
  `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu
  --dump-dom "file:///C:/Users/DHricsina/AI Pricing/index.html?test=1"` — this
  renders the page (including running all JS) and prints the final DOM to stdout,
  where the `#test-results` div's PASS/FAIL text can be grepped. This is the "run
  the test" step in every Engine task below, replacing `pytest`/`npm test`. For UI
  tasks (9-14), the self-test harness pattern extends to simulate interactions
  (e.g. `document.getElementById('addCardBtn').click()`) and assert on resulting
  `state` values or rendered DOM — added as additional `__engineTestCases` entries
  — since dump-dom only captures a single post-load snapshot, not live interaction.
- The harness code itself never ships active in normal use — it only runs when
  `?test=1` is present, so it has zero effect on the real Apps Script deployment.

## File Structure

- `Code.gs` — ~10 lines, `doGet()` only.
- `index.html` — everything else: CSS (ParkerSorter palette/conventions), page
  markup (top nav: Setup / Compare), the Rate Engine (`window.RateEngine`
  namespace, pure functions, no DOM dependency), UI glue code (`state` object +
  render functions), and the `?test=1` self-test harness.
- `docs/superpowers/specs/2026-07-23-parking-rate-comparison-design.md` — approved
  spec (already written).
- `docs/superpowers/plans/2026-07-23-parking-rate-comparison-plan.md` — this file.
- `.gitignore` — excludes the large sample files (`VD (Visits) (29).csv`,
  `Lev_AI_Review.xlsx`, `rate example.png`) from version control; they're
  reference material, not project source.

## Data Model (used consistently across all tasks)

```js
// One rate card
{
  id: 'rc1',                 // string, unique
  name: 'Weekday Day',       // string, freeform label
  days: [false,true,true,true,true,true,false], // index = JS Date.getDay() (0=Sun..6=Sat)
  startMin: 240,             // minutes since midnight, inclusive
  endMin: 960,               // minutes since midnight, exclusive (endMin<=startMin means overnight wrap)
  graceMin: 15,
  ladder: [ { thresholdMin: 60, price: 5 }, { thresholdMin: 120, price: 10 } ] // sorted ascending by thresholdMin
}

// Early Bird rule (single instance, may be disabled)
{
  enabled: false,
  days: [false,false,false,false,false,false,false], // same 0=Sun..6=Sat indexing
  entryStartMin: 360,
  entryEndMin: 540,
  exitCondition: 'after',    // 'before' | 'after'
  exitMin: 960,
  price: 5
}

// App state (in-memory only, not persisted server-side)
state = {
  rateCards: [],
  earlyBird: { enabled:false, days:[false,false,false,false,false,false,false], entryStartMin:0, entryEndMin:0, exitCondition:'after', exitMin:0, price:0 },
  cutoffHours: 24,
  ignoreValidations: false,
  visits: [],           // raw parsed rows from the uploaded file
  compareResult: null,  // output of RateEngine.aggregateByBracket
  unrolledBrackets: new Set() // bracket names currently expanded in the Compare tab
}
```

`RateEngine` function signatures (all pure, no DOM access):

```js
RateEngine.parseMoney(str) -> number
RateEngine.parseVisitTimestamp(dateStr, timeStr) -> Date
RateEngine.computeDurationMinutes(entryDate, exitDate) -> number
RateEngine.decodeVisitFileBuffer(arrayBuffer) -> string
RateEngine.parseVisitFile(arrayBuffer) -> Array<Object>  // header-keyed row objects
RateEngine.withinRange(minutes, startMin, endMin) -> boolean
RateEngine.findMatchingRateCard(rateCards, entryDate) -> card|null
RateEngine.lookupLadderPrice(card, durationMin) -> number
RateEngine.checkEarlyBird(earlyBird, entryDate, exitDate) -> number|null
RateEngine.processVisit(row, rateCards, earlyBird, cutoffHours) -> processedVisit
RateEngine.aggregateByBracket(processedVisits) -> { brackets: [...], totals: {...}, excluded: {...} }
RateEngine.timeStringToMinutes(hhmm) -> number   // "16:00" -> 960
RateEngine.minutesToTimeString(min) -> string    // 960 -> "16:00"
```

`processedVisit` shape:
```js
// excluded case
{ excluded: 'special_event'|'over_cutoff'|'no_matching_rate_card', actualPrice, entryDate, exitDate }
// normal case
{ excluded: null, bracketName, durationMin, staticPrice, actualPrice, validationAmt, gpv, coverageType, isValidated }
```

---

### Task 1: Project scaffold

**Files:**
- Create: `Code.gs`
- Create: `index.html`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git and gitignore**

```bash
cd "/c/Users/DHricsina/AI Pricing"
git init
```

Create `.gitignore`:
```
VD (Visits) (29).csv
Lev_AI_Review.xlsx
rate example.png
```

- [ ] **Step 2: Create `Code.gs`**

```js
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Parking Rate Comparison')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

- [ ] **Step 3: Create `index.html` shell**

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Parking Rate Comparison</title>
<style>
:root{
  --brand:#5F59FF;
  --r1:#E0DFFF;--r2:#ABA8FF;--r3:#5F59FF;--r4:#4842DF;--r5:#2D23A7;--r6:#07036C;--r7:#02003B;
  --teal:#09D4CC;--orange:#FF7449;
  --bg:#F7F7FF;--surface:#FFFFFF;--line:#EAEAEA;--text:#02003B;--muted:#6b6a8a;
}
body.night{--bg:#0a0a0c;--surface:#161719;--line:#2d2d33;--text:#F5F5FA;--muted:#a6a4bd;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
header{display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0}
.logo{font-weight:700;color:var(--brand)}
.spacer{flex:1}
nav{display:flex;gap:4px}
nav button{padding:8px 16px;border:none;background:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;color:var(--text)}
nav button.active{background:var(--brand);color:#fff}
.page{max-width:1200px;margin:0 auto;padding:20px;display:none}
.page.active{display:block}
.toggle{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px;cursor:pointer}
.switch{width:42px;height:24px;border-radius:12px;background:var(--line);position:relative;transition:.2s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s}
body.night .switch{background:var(--brand)}
body.night .switch::after{left:21px}
</style>
</head>
<body>
<header>
  <div class="logo">&#9679; Rate Compare</div>
  <div class="spacer"></div>
  <div class="toggle" id="nightToggle"><span>Night</span><span class="switch"></span></div>
</header>
<nav id="tabNav">
  <button data-tab="setup" class="active">Setup</button>
  <button data-tab="compare">Compare</button>
</nav>
<div id="setupPage" class="page active"><h2>Setup</h2></div>
<div id="comparePage" class="page"><h2>Compare</h2></div>

<script>
document.getElementById('nightToggle').addEventListener('click', function(){
  document.body.classList.toggle('night');
});
document.querySelectorAll('#tabNav button').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#tabNav button').forEach(function(b){b.classList.remove('active')});
    document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + 'Page').classList.add('active');
  });
});
</script>

<script>
window.RateEngine = {};
</script>

<script>
(function(){
  if (location.search.indexOf('test=1') === -1) return;
  var results = [];
  function assertEqual(actual, expected, label) {
    var pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({label: label, pass: pass, actual: actual, expected: expected});
  }
  function utf16leEncode(str) {
    var buf = new ArrayBuffer(2 + str.length * 2);
    var view = new DataView(buf);
    view.setUint8(0, 0xFF); view.setUint8(1, 0xFE);
    for (var i = 0; i < str.length; i++) view.setUint16(2 + i * 2, str.charCodeAt(i), true);
    return buf;
  }
  window.__runEngineTests = function() {
    results = [];
    (window.__engineTestCases || []).forEach(function(fn){ fn({assertEqual: assertEqual, utf16leEncode: utf16leEncode}); });
    render();
  };
  function render(){
    var el = document.getElementById('test-results');
    if (!el) return;
    var passCount = results.filter(function(r){return r.pass}).length;
    el.innerHTML = '<h3>' + passCount + '/' + results.length + ' passed</h3>' + results.map(function(r){
      return '<div style="color:' + (r.pass ? 'green' : 'red') + '">' + (r.pass ? 'PASS' : 'FAIL') + ': ' + r.label +
        (r.pass ? '' : ' (expected ' + JSON.stringify(r.expected) + ', got ' + JSON.stringify(r.actual) + ')') + '</div>';
    }).join('');
    console.log(passCount + '/' + results.length + ' passed');
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.body.insertAdjacentHTML('afterbegin', '<div id="test-results" style="padding:12px;font-family:monospace"></div>');
    window.__runEngineTests();
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 4: Verify shell loads**

Use `claude-in-chrome` to open `file:///C:/Users/DHricsina/AI Pricing/index.html`.
Expected: header with "Rate Compare" logo and Night toggle, "Setup"/"Compare" tabs,
clicking "Compare" switches the visible page. No `#test-results` div appears (no
`?test=1`).

Then open `file:///C:/Users/DHricsina/AI Pricing/index.html?test=1`.
Expected: a `#test-results` div reading "0/0 passed" (no test cases registered yet).

- [ ] **Step 5: Commit**

```bash
git add Code.gs index.html .gitignore
git commit -m "Scaffold Apps Script project: shell, nav, self-test harness"
```

---

### Task 2: Engine — money, timestamp, duration helpers

**Files:**
- Modify: `index.html` (the `window.RateEngine = {};` block from Task 1)

- [ ] **Step 1: Write failing tests**

Add a new `<script>` block right after the `RateEngine` namespace block:

```html
<script>
window.__engineTestCases = window.__engineTestCases || [];
window.__engineTestCases.push(function(t){
  t.assertEqual(RateEngine.parseMoney('$13.78'), 13.78, 'parseMoney: dollar sign + decimal');
  t.assertEqual(RateEngine.parseMoney('$1,234.50'), 1234.50, 'parseMoney: comma thousands');
  t.assertEqual(RateEngine.parseMoney(''), 0, 'parseMoney: empty string is 0');
  t.assertEqual(RateEngine.parseMoney(undefined), 0, 'parseMoney: undefined is 0');

  var entry = RateEngine.parseVisitTimestamp('6/30/2026', '11:40:48 PM');
  t.assertEqual([entry.getFullYear(), entry.getMonth(), entry.getDate(), entry.getHours(), entry.getMinutes(), entry.getSeconds()],
    [2026, 5, 30, 23, 40, 48], 'parseVisitTimestamp: PM rollover to 23:40:48');
  var midnight = RateEngine.parseVisitTimestamp('7/1/2026', '12:00:00 AM');
  t.assertEqual([midnight.getHours(), midnight.getMinutes()], [0, 0], 'parseVisitTimestamp: 12:00 AM is hour 0');
  var noon = RateEngine.parseVisitTimestamp('7/1/2026', '12:00:00 PM');
  t.assertEqual([noon.getHours(), noon.getMinutes()], [12, 0], 'parseVisitTimestamp: 12:00 PM is hour 12');

  var d1 = RateEngine.parseVisitTimestamp('6/30/2026', '11:40:48 PM');
  var d2 = RateEngine.parseVisitTimestamp('7/1/2026', '08:40:56 AM');
  t.assertEqual(RateEngine.computeDurationMinutes(d1, d2), 540, 'computeDurationMinutes: crosses midnight, 540 min');

  t.assertEqual(RateEngine.timeStringToMinutes('16:00'), 960, 'timeStringToMinutes: 16:00 -> 960');
  t.assertEqual(RateEngine.minutesToTimeString(960), '16:00', 'minutesToTimeString: 960 -> 16:00');
  t.assertEqual(RateEngine.minutesToTimeString(65), '01:05', 'minutesToTimeString: pads single digits');
});
</script>
```

- [ ] **Step 2: Verify tests fail**

Use `claude-in-chrome` to open `file:///C:/Users/DHricsina/AI Pricing/index.html?test=1`.
Expected: `#test-results` shows failures (e.g. "RateEngine.parseMoney is not a function")
since `RateEngine` is still empty.

- [ ] **Step 3: Implement the functions**

Replace the `window.RateEngine = {};` block from Task 1 with:

```html
<script>
window.RateEngine = {};

RateEngine.parseMoney = function(str) {
  if (!str) return 0;
  var n = Number(String(str).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
};

RateEngine.parseVisitTimestamp = function(dateStr, timeStr) {
  var dateParts = dateStr.split('/').map(Number);
  var month = dateParts[0], day = dateParts[1], year = dateParts[2];
  var match = timeStr.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  var hh = Number(match[1]), mm = Number(match[2]), ss = Number(match[3]);
  var ap = match[4].toUpperCase();
  if (ap === 'PM' && hh !== 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  return new Date(year, month - 1, day, hh, mm, ss);
};

RateEngine.computeDurationMinutes = function(entryDate, exitDate) {
  return Math.round((exitDate.getTime() - entryDate.getTime()) / 60000);
};

RateEngine.timeStringToMinutes = function(hhmm) {
  var parts = hhmm.split(':').map(Number);
  return parts[0] * 60 + parts[1];
};

RateEngine.minutesToTimeString = function(min) {
  var h = Math.floor(min / 60), m = min % 60;
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return pad(h) + ':' + pad(m);
};
</script>
```

- [ ] **Step 4: Verify tests pass**

Reload `file:///C:/Users/DHricsina/AI Pricing/index.html?test=1` via `claude-in-chrome`.
Expected: `#test-results` shows all cases from this task passing (e.g. "11/11 passed" —
exact count depends on cumulative cases so far).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine money/timestamp/duration/time-string helpers"
```

---

### Task 3: Engine — file decoding and TSV/CSV parsing

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

Add a new test-case block:

```html
<script>
window.__engineTestCases.push(function(t){
  var header = "Sort by\tTransaction Id\tPrice Amt\n";
  var totalsRow = "Grand Total\tTotal\t$100.00\n";
  var dataRow1 = "1\t290956872\t$13.78\n";
  var dataRow2 = "2\t290953654\t$5.74";
  var utf16Buf = t.utf16leEncode(header + totalsRow + dataRow1 + dataRow2);

  var decoded = RateEngine.decodeVisitFileBuffer(utf16Buf);
  t.assertEqual(decoded.indexOf('Transaction Id') > -1, true, 'decodeVisitFileBuffer: UTF-16LE BOM decodes correctly');

  var rows = RateEngine.parseVisitFile(utf16Buf);
  t.assertEqual(rows.length, 2, 'parseVisitFile: skips header and Grand Total row, keeps 2 data rows');
  t.assertEqual(rows[0]['Transaction Id'], '290956872', 'parseVisitFile: maps columns by trimmed header name');
  t.assertEqual(rows[0]['Price Amt'], '$13.78', 'parseVisitFile: preserves raw cell text');
  t.assertEqual(rows[1]['Sort by'], '2', 'parseVisitFile: second data row present');

  // UTF-8 comma-delimited fallback
  var csvText = "A,B\n1,2\n3,4";
  var csvBuf = new TextEncoder().encode(csvText).buffer;
  var csvRows = RateEngine.parseVisitFile(csvBuf);
  t.assertEqual(csvRows.length, 2, 'parseVisitFile: falls back to comma-delimited UTF-8');
  t.assertEqual(csvRows[0]['A'], '1', 'parseVisitFile: comma fallback maps columns');
});
</script>
```

- [ ] **Step 2: Verify tests fail**

Open `file:///C:/Users/DHricsina/AI Pricing/index.html?test=1` via `claude-in-chrome`.
Expected: failures — `RateEngine.decodeVisitFileBuffer`/`parseVisitFile` undefined.

- [ ] **Step 3: Implement the functions**

Add to the same `<script>` block as Task 2 (after `RateEngine.minutesToTimeString`):

```js
RateEngine.decodeVisitFileBuffer = function(arrayBuffer) {
  var bytes = new Uint8Array(arrayBuffer);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(arrayBuffer.slice(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(arrayBuffer.slice(3));
  }
  return new TextDecoder('utf-8').decode(arrayBuffer);
};

RateEngine.parseVisitFile = function(arrayBuffer) {
  var text = RateEngine.decodeVisitFileBuffer(arrayBuffer);
  var delimiter = text.indexOf('\t') !== -1 ? '\t' : ',';
  var lines = text.split(/\r\n|\n/).filter(function(l){ return l.length > 0; });
  var header = lines[0].split(delimiter).map(function(h){ return h.trim(); });
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var cols = lines[i].split(delimiter);
    if (!/^\d+$/.test((cols[0] || '').trim())) continue; // skip "Grand Total" summary row
    var row = {};
    header.forEach(function(h, idx){ row[h] = (cols[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
};
```

- [ ] **Step 4: Verify tests pass**

Reload with `claude-in-chrome`. Expected: all cases pass, cumulative count increases.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine file decoding and TSV/CSV parsing"
```

---

### Task 4: Engine — rate card day/time matching

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

```html
<script>
window.__engineTestCases.push(function(t){
  t.assertEqual(RateEngine.withinRange(500, 240, 960), true, 'withinRange: normal range, inside');
  t.assertEqual(RateEngine.withinRange(100, 240, 960), false, 'withinRange: normal range, outside');
  t.assertEqual(RateEngine.withinRange(959, 240, 960), true, 'withinRange: end is exclusive, just under');
  t.assertEqual(RateEngine.withinRange(960, 240, 960), false, 'withinRange: end is exclusive, at boundary');
  t.assertEqual(RateEngine.withinRange(23 * 60, 960, 240), true, 'withinRange: overnight wrap, in evening part');
  t.assertEqual(RateEngine.withinRange(2 * 60, 960, 240), true, 'withinRange: overnight wrap, in early-morning part');
  t.assertEqual(RateEngine.withinRange(500, 960, 240), false, 'withinRange: overnight wrap, outside both parts');

  var cards = [
    { id: 'weekday_day', days: [false,true,true,true,true,true,false], startMin: 240, endMin: 960, graceMin: 15, ladder: [] },
    { id: 'weekend_all', days: [true,false,false,false,false,false,true], startMin: 0, endMin: 1440, graceMin: 15, ladder: [] }
  ];
  // Wed 2026-07-01 is a Wednesday, 10:00 AM -> minutes 600, day index 3
  var wed10am = new Date(2026, 6, 1, 10, 0, 0);
  var match = RateEngine.findMatchingRateCard(cards, wed10am);
  t.assertEqual(match && match.id, 'weekday_day', 'findMatchingRateCard: matches weekday day card');

  // Sat 2026-07-04, 11:00 PM
  var sat11pm = new Date(2026, 6, 4, 23, 0, 0);
  var match2 = RateEngine.findMatchingRateCard(cards, sat11pm);
  t.assertEqual(match2 && match2.id, 'weekend_all', 'findMatchingRateCard: matches weekend all-day card');

  // Wed 2026-07-01, 2:00 AM -> no card covers this
  var wed2am = new Date(2026, 6, 1, 2, 0, 0);
  var match3 = RateEngine.findMatchingRateCard(cards, wed2am);
  t.assertEqual(match3, null, 'findMatchingRateCard: returns null when no card covers the time');
});
</script>
```

- [ ] **Step 2: Verify tests fail**

Open with `claude-in-chrome`. Expected: `withinRange`/`findMatchingRateCard` undefined
failures.

- [ ] **Step 3: Implement the functions**

Add to the engine `<script>` block:

```js
RateEngine.withinRange = function(minutes, startMin, endMin) {
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
};

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

- [ ] **Step 4: Verify tests pass**

Reload with `claude-in-chrome`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine day/time bracket matching"
```

---

### Task 5: Engine — duration ladder lookup

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

```html
<script>
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
</script>
```

- [ ] **Step 2: Verify tests fail**

Open with `claude-in-chrome`. Expected: `lookupLadderPrice` undefined failures.

- [ ] **Step 3: Implement the function**

```js
RateEngine.lookupLadderPrice = function(card, durationMin) {
  if (durationMin <= card.graceMin) return 0;
  var sorted = card.ladder.slice().sort(function(a, b){ return a.thresholdMin - b.thresholdMin; });
  for (var i = 0; i < sorted.length; i++) {
    if (durationMin <= sorted[i].thresholdMin) return sorted[i].price;
  }
  return sorted.length ? sorted[sorted.length - 1].price : 0;
};
```

- [ ] **Step 4: Verify tests pass**

Reload with `claude-in-chrome`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine duration ladder lookup"
```

---

### Task 6: Engine — Early Bird eligibility

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

```html
<script>
window.__engineTestCases.push(function(t){
  var eb = {
    enabled: true,
    days: [true,true,true,true,true,true,true],
    entryStartMin: 360, entryEndMin: 540, // 6:00-9:00 AM
    exitCondition: 'after',
    exitMin: 960, // 4:00 PM
    price: 5
  };
  // Enters 7am, exits 5pm same day -> qualifies
  var entry1 = new Date(2026, 6, 1, 7, 0, 0);
  var exit1 = new Date(2026, 6, 1, 17, 0, 0);
  t.assertEqual(RateEngine.checkEarlyBird(eb, entry1, exit1), 5, 'checkEarlyBird: entry in window + exit after qualifies');

  // Enters 7am, exits 11am (before 4pm) -> does not qualify
  var exit2 = new Date(2026, 6, 1, 11, 0, 0);
  t.assertEqual(RateEngine.checkEarlyBird(eb, entry1, exit2), null, 'checkEarlyBird: exit condition not met returns null');

  // Enters 10am (outside entry window) -> does not qualify
  var entry3 = new Date(2026, 6, 1, 10, 0, 0);
  t.assertEqual(RateEngine.checkEarlyBird(eb, entry3, exit1), null, 'checkEarlyBird: entry outside window returns null');

  // Disabled rule
  var ebOff = Object.assign({}, eb, { enabled: false });
  t.assertEqual(RateEngine.checkEarlyBird(ebOff, entry1, exit1), null, 'checkEarlyBird: disabled rule always returns null');

  // Day not valid for EB
  var ebWeekdayOnly = Object.assign({}, eb, { days: [false,true,true,true,true,true,false] });
  var sat = new Date(2026, 6, 4, 7, 0, 0); // Saturday
  var satExit = new Date(2026, 6, 4, 17, 0, 0);
  t.assertEqual(RateEngine.checkEarlyBird(ebWeekdayOnly, sat, satExit), null, 'checkEarlyBird: day not valid returns null');

  // exit "before" condition
  var ebBefore = Object.assign({}, eb, { exitCondition: 'before', exitMin: 540 });
  var earlyExit = new Date(2026, 6, 1, 8, 30, 0);
  t.assertEqual(RateEngine.checkEarlyBird(ebBefore, entry1, earlyExit), 5, 'checkEarlyBird: exit before condition qualifies');
});
</script>
```

- [ ] **Step 2: Verify tests fail**

Open with `claude-in-chrome`. Expected: `checkEarlyBird` undefined failures.

- [ ] **Step 3: Implement the function**

```js
RateEngine.checkEarlyBird = function(earlyBird, entryDate, exitDate) {
  if (!earlyBird || !earlyBird.enabled) return null;
  var entryDay = entryDate.getDay();
  if (!earlyBird.days[entryDay]) return null;
  var entryMin = entryDate.getHours() * 60 + entryDate.getMinutes();
  if (!RateEngine.withinRange(entryMin, earlyBird.entryStartMin, earlyBird.entryEndMin)) return null;
  var exitMin = exitDate.getHours() * 60 + exitDate.getMinutes();
  var exitOk = earlyBird.exitCondition === 'before' ? exitMin <= earlyBird.exitMin : exitMin >= earlyBird.exitMin;
  if (!exitOk) return null;
  return earlyBird.price;
};
```

- [ ] **Step 4: Verify tests pass**

Reload with `claude-in-chrome`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine Early Bird eligibility check"
```

---

### Task 7: Engine — per-visit processing pipeline

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

```html
<script>
window.__engineTestCases.push(function(t){
  var rateCards = [
    { id: 'day', name: 'Weekday Day', days: [false,true,true,true,true,true,false], startMin: 240, endMin: 960, graceMin: 15,
      ladder: [{thresholdMin:60,price:5},{thresholdMin:120,price:10},{thresholdMin:180,price:15},{thresholdMin:720,price:20},{thresholdMin:1440,price:25}] }
  ];
  var noEb = { enabled: false, days:[false,false,false,false,false,false,false], entryStartMin:0, entryEndMin:0, exitCondition:'after', exitMin:0, price:0 };

  function row(overrides) {
    return Object.assign({
      'Visit Start Date': '7/1/2026', 'Visit Start At': '10:00:00 AM',
      'Visit Exit  Event Date': '7/1/2026', 'Visit Exit  Event At': '11:30:00 AM',
      'Is Special Event Rate': 'False',
      'Price Amt': '$13.78', 'Validation Amt': '', 'GPV Amt': '$13.78',
      'Visit Coverage Type': 'Transient (No Coverage)'
    }, overrides);
  }

  // Wed 10:00-11:30am, 90 min duration -> tier "120" -> $10
  var v1 = RateEngine.processVisit(row({}), rateCards, noEb, 24);
  t.assertEqual(v1.excluded, null, 'processVisit: normal visit not excluded');
  t.assertEqual(v1.staticPrice, 10, 'processVisit: static price from duration ladder');
  t.assertEqual(v1.actualPrice, 13.78, 'processVisit: actual price from Price Amt');
  t.assertEqual(v1.bracketName, 'Weekday Day', 'processVisit: bracket name from matched card');
  t.assertEqual(v1.isValidated, false, 'processVisit: Transient is not validated');

  // Special event excluded
  var v2 = RateEngine.processVisit(row({'Is Special Event Rate': 'True'}), rateCards, noEb, 24);
  t.assertEqual(v2.excluded, 'special_event', 'processVisit: special event visit excluded');

  // Over cutoff (24h) - exit 2 days later
  var v3 = RateEngine.processVisit(row({'Visit Exit  Event Date': '7/3/2026', 'Visit Exit  Event At': '11:30:00 AM'}), rateCards, noEb, 24);
  t.assertEqual(v3.excluded, 'over_cutoff', 'processVisit: duration beyond cutoff excluded');

  // No matching rate card (Wednesday 2am, no card covers it)
  var v4 = RateEngine.processVisit(row({'Visit Start At': '02:00:00 AM', 'Visit Exit  Event At': '02:30:00 AM'}), rateCards, noEb, 24);
  t.assertEqual(v4.excluded, 'no_matching_rate_card', 'processVisit: no matching card excluded');

  // Validated visit
  var v5 = RateEngine.processVisit(row({'Visit Coverage Type': 'Validation (Partially Covered)', 'Validation Amt': '$5.00', 'GPV Amt': '$8.78'}), rateCards, noEb, 24);
  t.assertEqual(v5.isValidated, true, 'processVisit: Partially Covered counts as validated');
  t.assertEqual(v5.validationAmt, 5, 'processVisit: validation amount parsed');
  t.assertEqual(v5.gpv, 8.78, 'processVisit: GPV parsed');

  // Early Bird override
  var eb = { enabled: true, days:[false,true,true,true,true,true,false], entryStartMin:360, entryEndMin:540, exitCondition:'after', exitMin:960, price: 3 };
  var v6 = RateEngine.processVisit(row({'Visit Start At': '07:00:00 AM', 'Visit Exit  Event At': '05:00:00 PM'}), rateCards, eb, 24);
  t.assertEqual(v6.staticPrice, 3, 'processVisit: Early Bird overrides duration ladder');
  t.assertEqual(v6.bracketName, 'Early Bird', 'processVisit: Early Bird sets its own bracket name');
});
</script>
```

- [ ] **Step 2: Verify tests fail**

Open with `claude-in-chrome`. Expected: `processVisit` undefined failures.

- [ ] **Step 3: Implement the function**

```js
RateEngine.processVisit = function(row, rateCards, earlyBird, cutoffHours) {
  var entryDate = RateEngine.parseVisitTimestamp(row['Visit Start Date'], row['Visit Start At']);
  var exitDate = RateEngine.parseVisitTimestamp(row['Visit Exit  Event Date'], row['Visit Exit  Event At']);
  var durationMin = RateEngine.computeDurationMinutes(entryDate, exitDate);
  var actualPrice = RateEngine.parseMoney(row['Price Amt']);
  var isSpecialEvent = String(row['Is Special Event Rate']).toLowerCase() === 'true';

  if (isSpecialEvent) return { excluded: 'special_event', actualPrice: actualPrice, entryDate: entryDate, exitDate: exitDate };
  if (durationMin > cutoffHours * 60) return { excluded: 'over_cutoff', actualPrice: actualPrice, entryDate: entryDate, exitDate: exitDate };

  var ebPrice = RateEngine.checkEarlyBird(earlyBird, entryDate, exitDate);
  var staticPrice, bracketName;
  if (ebPrice !== null) {
    staticPrice = ebPrice;
    bracketName = 'Early Bird';
  } else {
    var card = RateEngine.findMatchingRateCard(rateCards, entryDate);
    if (!card) return { excluded: 'no_matching_rate_card', actualPrice: actualPrice, entryDate: entryDate, exitDate: exitDate };
    staticPrice = RateEngine.lookupLadderPrice(card, durationMin);
    bracketName = card.name || 'Unnamed';
  }

  var coverageType = row['Visit Coverage Type'];
  return {
    excluded: null,
    bracketName: bracketName,
    durationMin: durationMin,
    staticPrice: staticPrice,
    actualPrice: actualPrice,
    validationAmt: RateEngine.parseMoney(row['Validation Amt']),
    gpv: RateEngine.parseMoney(row['GPV Amt']),
    coverageType: coverageType,
    isValidated: coverageType !== 'Transient (No Coverage)'
  };
};
```

- [ ] **Step 4: Verify tests pass**

Reload with `claude-in-chrome`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine per-visit processing pipeline"
```

---

### Task 8: Engine — bracket aggregation

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

```html
<script>
window.__engineTestCases.push(function(t){
  var visits = [
    { excluded: null, bracketName: 'Day', staticPrice: 10, actualPrice: 12, validationAmt: 0, isValidated: false },
    { excluded: null, bracketName: 'Day', staticPrice: 10, actualPrice: 11, validationAmt: 5, isValidated: true },
    { excluded: null, bracketName: 'Night', staticPrice: 5, actualPrice: 6, validationAmt: 0, isValidated: false },
    { excluded: 'special_event', actualPrice: 20 },
    { excluded: 'over_cutoff', actualPrice: 50 },
    { excluded: 'no_matching_rate_card', actualPrice: 7 }
  ];
  var result = RateEngine.aggregateByBracket(visits);

  var day = result.brackets.find(function(b){ return b.name === 'Day'; });
  t.assertEqual(day.count, 2, 'aggregateByBracket: Day bracket has 2 visits');
  t.assertEqual(day.staticTotal, 20, 'aggregateByBracket: Day static total');
  t.assertEqual(day.actualTotal, 23, 'aggregateByBracket: Day actual total');
  t.assertEqual(day.delta, 3, 'aggregateByBracket: Day delta = actual - static');
  t.assertEqual(day.normal.count, 1, 'aggregateByBracket: Day normal sub-count');
  t.assertEqual(day.validation.count, 1, 'aggregateByBracket: Day validation sub-count');
  t.assertEqual(day.validation.validationTotal, 5, 'aggregateByBracket: Day validation sub-total');

  var night = result.brackets.find(function(b){ return b.name === 'Night'; });
  t.assertEqual(night.count, 1, 'aggregateByBracket: Night bracket has 1 visit');

  t.assertEqual(result.totals.staticTotal, 25, 'aggregateByBracket: overall static total excludes excluded visits');
  t.assertEqual(result.totals.actualTotal, 29, 'aggregateByBracket: overall actual total excludes excluded visits');

  t.assertEqual(result.excluded.special_event.count, 1, 'aggregateByBracket: special_event excluded count');
  t.assertEqual(result.excluded.special_event.actualTotal, 20, 'aggregateByBracket: special_event excluded actual total');
  t.assertEqual(result.excluded.over_cutoff.count, 1, 'aggregateByBracket: over_cutoff excluded count');
  t.assertEqual(result.excluded.no_matching_rate_card.count, 1, 'aggregateByBracket: no_matching_rate_card excluded count');
});
</script>
```

- [ ] **Step 2: Verify tests fail**

Open with `claude-in-chrome`. Expected: `aggregateByBracket` undefined failures.

- [ ] **Step 3: Implement the function**

```js
RateEngine.aggregateByBracket = function(processedVisits) {
  var brackets = {};
  var excluded = {
    special_event: { count: 0, actualTotal: 0 },
    over_cutoff: { count: 0, actualTotal: 0 },
    no_matching_rate_card: { count: 0, actualTotal: 0 }
  };

  processedVisits.forEach(function(v){
    if (v.excluded) {
      excluded[v.excluded].count++;
      excluded[v.excluded].actualTotal += v.actualPrice;
      return;
    }
    if (!brackets[v.bracketName]) {
      brackets[v.bracketName] = {
        name: v.bracketName, count: 0, staticTotal: 0, actualTotal: 0, validationTotal: 0,
        normal: { count: 0, staticTotal: 0, actualTotal: 0 },
        validation: { count: 0, staticTotal: 0, actualTotal: 0, validationTotal: 0 }
      };
    }
    var b = brackets[v.bracketName];
    b.count++;
    b.staticTotal += v.staticPrice;
    b.actualTotal += v.actualPrice;
    b.validationTotal += v.validationAmt;
    var sub = v.isValidated ? b.validation : b.normal;
    sub.count++;
    sub.staticTotal += v.staticPrice;
    sub.actualTotal += v.actualPrice;
    if (v.isValidated) sub.validationTotal += v.validationAmt;
  });

  var bracketList = Object.keys(brackets).map(function(name){
    var b = brackets[name];
    b.delta = b.actualTotal - b.staticTotal;
    return b;
  });

  var totals = bracketList.reduce(function(acc, b){
    return { staticTotal: acc.staticTotal + b.staticTotal, actualTotal: acc.actualTotal + b.actualTotal };
  }, { staticTotal: 0, actualTotal: 0 });
  totals.delta = totals.actualTotal - totals.staticTotal;

  return { brackets: bracketList, totals: totals, excluded: excluded };
};
```

- [ ] **Step 4: Verify tests pass**

Reload with `claude-in-chrome`. Expected: all pass, and this completes the Engine —
note the final cumulative pass count for reference in later manual verification.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add RateEngine bracket aggregation — engine complete"
```

---

### Task 9: Rate Card Builder UI

**Files:**
- Modify: `index.html` (the `#setupPage` div and its styles)

- [ ] **Step 1: Add markup, styles, and state**

Replace `<div id="setupPage" class="page active"><h2>Setup</h2></div>` with:

```html
<div id="setupPage" class="page active">
  <h2>Setup</h2>
  <p class="sub">Build your static rate table, then drop in a visit export below.</p>
  <div id="rateCardList"></div>
  <button id="addCardBtn" class="btnPrimary">+ Add Rate Card</button>
</div>
```

Add supporting CSS:

```css
.sub{color:var(--muted);margin:0 0 16px;font-size:13px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.card .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}
.ctl{display:flex;flex-direction:column;gap:4px}
.ctl label{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}
.ctl input[type=text],.ctl input[type=number],.ctl input[type=time]{padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:13px}
.dayBoxes{display:flex;gap:6px}
.dayBoxes label{display:flex;flex-direction:column;align-items:center;font-size:10px;color:var(--muted)}
.ladderTable{display:flex;gap:8px;flex-wrap:wrap}
.ladderCol{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--bg)}
.btnPrimary{background:var(--brand);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:600}
.btnGhost{background:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer;color:var(--muted);font-size:12px}
.btnDanger{background:none;border:1px solid var(--orange);color:var(--orange);border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px}
</style>
```

Add state and rendering JS in a new `<script>` block, placed after the RateEngine
script blocks and before the self-test harness block:

```html
<script>
var state = {
  rateCards: [],
  earlyBird: { enabled:false, days:[false,false,false,false,false,false,false], entryStartMin:0, entryEndMin:0, exitCondition:'after', exitMin:0, price:0 },
  cutoffHours: 24,
  ignoreValidations: false,
  visits: [],
  compareResult: null,
  unrolledBrackets: new Set()
};
var nextCardId = 1;
var DAY_ORDER = [1,2,3,4,5,6,0]; // Mon..Sun display order, values index into card.days (0=Sun..6=Sat)
var DAY_LABELS = { 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat', 0:'Sun' };

function newRateCard() {
  return { id: 'rc' + (nextCardId++), name: '', days: [false,false,false,false,false,false,false], startMin: 0, endMin: 1440, graceMin: 15, ladder: [] };
}

function renderRateCards() {
  var list = document.getElementById('rateCardList');
  list.innerHTML = '';
  state.rateCards.forEach(function(card){
    list.appendChild(renderRateCard(card));
  });
}

function renderRateCard(card) {
  var div = document.createElement('div');
  div.className = 'card';

  var nameRow = document.createElement('div');
  nameRow.className = 'row';
  nameRow.innerHTML =
    '<div class="ctl"><label>Name</label><input type="text" value="' + card.name + '" data-field="name"></div>' +
    '<div class="ctl"><label>Start</label><input type="time" value="' + RateEngine.minutesToTimeString(card.startMin) + '" data-field="startMin"></div>' +
    '<div class="ctl"><label>End</label><input type="time" value="' + RateEngine.minutesToTimeString(card.endMin) + '" data-field="endMin"></div>' +
    '<div class="ctl"><label>Grace (min)</label><input type="number" value="' + card.graceMin + '" data-field="graceMin"></div>' +
    '<button class="btnDanger" data-action="delete">Delete</button>';
  div.appendChild(nameRow);

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
  ['All days', 'Weekday (Mon-Fri)', 'Weekend (Sat-Sun)'].forEach(function(preset){
    var btn = document.createElement('button');
    btn.className = 'btnGhost';
    btn.textContent = preset;
    btn.dataset.preset = preset;
    dayRow.appendChild(btn);
  });
  div.appendChild(dayRow);

  var ladderRow = document.createElement('div');
  ladderRow.className = 'row';
  var ladderTable = document.createElement('div');
  ladderTable.className = 'ladderTable';
  card.ladder.forEach(function(tier, idx){
    var col = document.createElement('div');
    col.className = 'ladderCol';
    col.innerHTML =
      '<label>Threshold (min)</label><input type="number" value="' + tier.thresholdMin + '" data-ladder-idx="' + idx + '" data-ladder-field="thresholdMin">' +
      '<label>Price</label><input type="number" value="' + tier.price + '" data-ladder-idx="' + idx + '" data-ladder-field="price">' +
      '<button class="btnDanger" data-ladder-remove="' + idx + '">x</button>';
    ladderTable.appendChild(col);
  });
  ladderRow.appendChild(ladderTable);
  var addLadderBtn = document.createElement('button');
  addLadderBtn.className = 'btnGhost';
  addLadderBtn.textContent = '+ Add Tier';
  addLadderBtn.dataset.action = 'addTier';
  ladderRow.appendChild(addLadderBtn);
  div.appendChild(ladderRow);

  div.addEventListener('input', function(e){
    var field = e.target.dataset.field;
    if (field === 'startMin' || field === 'endMin') {
      card[field] = RateEngine.timeStringToMinutes(e.target.value);
    } else if (field === 'graceMin') {
      card[field] = Number(e.target.value);
    } else if (field) {
      card[field] = e.target.value;
    }
    if (e.target.dataset.day !== undefined) {
      card.days[Number(e.target.dataset.day)] = e.target.checked;
    }
    if (e.target.dataset.ladderIdx !== undefined) {
      var idx = Number(e.target.dataset.ladderIdx);
      var lf = e.target.dataset.ladderField;
      card.ladder[idx][lf] = Number(e.target.value);
    }
  });

  div.addEventListener('click', function(e){
    if (e.target.dataset.action === 'delete') {
      state.rateCards = state.rateCards.filter(function(c){ return c.id !== card.id; });
      renderRateCards();
    } else if (e.target.dataset.action === 'addTier') {
      card.ladder.push({ thresholdMin: 60, price: 0 });
      renderRateCards();
    } else if (e.target.dataset.ladderRemove !== undefined) {
      card.ladder.splice(Number(e.target.dataset.ladderRemove), 1);
      renderRateCards();
    } else if (e.target.dataset.preset) {
      if (e.target.dataset.preset === 'All days') card.days = [true,true,true,true,true,true,true];
      if (e.target.dataset.preset === 'Weekday (Mon-Fri)') card.days = [false,true,true,true,true,true,false];
      if (e.target.dataset.preset === 'Weekend (Sat-Sun)') card.days = [true,false,false,false,false,false,true];
      renderRateCards();
    }
  });

  return div;
}

document.getElementById('addCardBtn').addEventListener('click', function(){
  state.rateCards.push(newRateCard());
  renderRateCards();
});
</script>
```

- [ ] **Step 2: Verify via browser**

Use `claude-in-chrome` to open `file:///C:/Users/DHricsina/AI Pricing/index.html`,
click "+ Add Rate Card" twice (2 cards appear), on the first card: type a name, check
"Wed" and "Thu", click "Weekend (Sat-Sun)" (verify it replaces the selection with
Sat+Sun only), set Start=04:00 and End=16:00, click "+ Add Tier" twice and set
threshold/price values, then click "Delete" on the second card (only one card should
remain). Confirm via screenshot that all edits are reflected and no console errors
appear.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add rate card builder UI"
```

---

### Task 10: Copy rate card to other days

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add markup and behavior**

In `renderRateCard`, add a copy control to `nameRow`, right after the Delete button:

```js
nameRow.innerHTML += '<div class="ctl"><label>Copy to other days</label><button class="btnGhost" data-action="openCopy">Choose days...</button></div>';
```

Add a hidden copy panel appended to the card div (after `ladderRow`):

```js
var copyPanel = document.createElement('div');
copyPanel.className = 'row';
copyPanel.style.display = 'none';
copyPanel.dataset.role = 'copyPanel';
var copyBoxes = document.createElement('div');
copyBoxes.className = 'dayBoxes';
DAY_ORDER.forEach(function(dayIdx){
  var lbl = document.createElement('label');
  lbl.innerHTML = '<input type="checkbox" data-copy-day="' + dayIdx + '">' + DAY_LABELS[dayIdx];
  copyBoxes.appendChild(lbl);
});
copyPanel.appendChild(copyBoxes);
var applyCopyBtn = document.createElement('button');
applyCopyBtn.className = 'btnPrimary';
applyCopyBtn.textContent = 'Create copy';
applyCopyBtn.dataset.action = 'applyCopy';
copyPanel.appendChild(applyCopyBtn);
div.appendChild(copyPanel);
```

Extend the existing click handler on `div` (inside the same `div.addEventListener('click', ...)` from Task 9) with two more branches:

```js
} else if (e.target.dataset.action === 'openCopy') {
  var panel = div.querySelector('[data-role=copyPanel]');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
} else if (e.target.dataset.action === 'applyCopy') {
  var panel = div.querySelector('[data-role=copyPanel]');
  var targetDays = [false,false,false,false,false,false,false];
  panel.querySelectorAll('[data-copy-day]').forEach(function(cb){
    if (cb.checked) targetDays[Number(cb.dataset.copyDay)] = true;
  });
  var copy = JSON.parse(JSON.stringify(card));
  copy.id = 'rc' + (nextCardId++);
  copy.name = card.name + ' (copy)';
  copy.days = targetDays;
  state.rateCards.push(copy);
  renderRateCards();
}
```

- [ ] **Step 2: Verify via browser**

Use `claude-in-chrome`: add a rate card, name it "Monday", check only "Mon", set a
ladder tier. Click "Choose days...", check "Tue", "Wed", "Thu", "Fri", click "Create
copy". Confirm a new card named "Monday (copy)" appears with Tue-Fri checked (not
Mon), the same times/grace/ladder values as the original, and the original "Monday"
card is unchanged (still only Mon checked).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add copy-rate-card-to-other-days feature"
```

---

### Task 11: Early Bird rule UI

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add markup and behavior**

Add after the `#rateCardList` / `#addCardBtn` block in `#setupPage`:

```html
<div class="card">
  <div class="row">
    <div class="ctl"><label>Early Bird</label>
      <label><input type="checkbox" id="ebEnabled"> Enabled</label>
    </div>
    <div class="ctl"><label>Entry window start</label><input type="time" id="ebEntryStart"></div>
    <div class="ctl"><label>Entry window end</label><input type="time" id="ebEntryEnd"></div>
    <div class="ctl"><label>Exit condition</label>
      <select id="ebExitCondition"><option value="before">Exit Before</option><option value="after">Exit After</option></select>
    </div>
    <div class="ctl"><label>Exit time</label><input type="time" id="ebExitTime"></div>
    <div class="ctl"><label>Price</label><input type="number" id="ebPrice"></div>
  </div>
  <div class="row"><div class="dayBoxes" id="ebDayBoxes"></div></div>
</div>
```

```html
<script>
function renderEarlyBird() {
  document.getElementById('ebEnabled').checked = state.earlyBird.enabled;
  document.getElementById('ebEntryStart').value = RateEngine.minutesToTimeString(state.earlyBird.entryStartMin);
  document.getElementById('ebEntryEnd').value = RateEngine.minutesToTimeString(state.earlyBird.entryEndMin);
  document.getElementById('ebExitCondition').value = state.earlyBird.exitCondition;
  document.getElementById('ebExitTime').value = RateEngine.minutesToTimeString(state.earlyBird.exitMin);
  document.getElementById('ebPrice').value = state.earlyBird.price;
  var dayBoxes = document.getElementById('ebDayBoxes');
  dayBoxes.innerHTML = '';
  DAY_ORDER.forEach(function(dayIdx){
    var lbl = document.createElement('label');
    lbl.innerHTML = '<input type="checkbox" data-eb-day="' + dayIdx + '" ' + (state.earlyBird.days[dayIdx] ? 'checked' : '') + '>' + DAY_LABELS[dayIdx];
    dayBoxes.appendChild(lbl);
  });
}
document.getElementById('ebEnabled').addEventListener('change', function(e){ state.earlyBird.enabled = e.target.checked; });
document.getElementById('ebEntryStart').addEventListener('input', function(e){ state.earlyBird.entryStartMin = RateEngine.timeStringToMinutes(e.target.value); });
document.getElementById('ebEntryEnd').addEventListener('input', function(e){ state.earlyBird.entryEndMin = RateEngine.timeStringToMinutes(e.target.value); });
document.getElementById('ebExitCondition').addEventListener('change', function(e){ state.earlyBird.exitCondition = e.target.value; });
document.getElementById('ebExitTime').addEventListener('input', function(e){ state.earlyBird.exitMin = RateEngine.timeStringToMinutes(e.target.value); });
document.getElementById('ebPrice').addEventListener('input', function(e){ state.earlyBird.price = Number(e.target.value); });
document.getElementById('ebDayBoxes').addEventListener('change', function(e){
  if (e.target.dataset.ebDay !== undefined) state.earlyBird.days[Number(e.target.dataset.ebDay)] = e.target.checked;
});
renderEarlyBird();
</script>
```

- [ ] **Step 2: Verify via browser**

Use `claude-in-chrome`: check "Enabled", set entry window 06:00-09:00, exit condition
"Exit After", exit time 16:00, price 5, check Mon-Fri. Reload the page (state resets,
expected — no persistence yet) to confirm no console errors on initial render.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add Early Bird rule UI"
```

---

### Task 12: Reconciliation cutoff + CSV drop zone

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add markup and behavior**

Add after the Early Bird card in `#setupPage`:

```html
<div class="card">
  <div class="row">
    <div class="ctl"><label>Reconciliation cutoff (hours)</label><input type="number" id="cutoffHours" value="24"></div>
  </div>
  <div class="row">
    <div id="dropZone" style="width:150px;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed var(--brand);border-radius:14px;background:var(--surface);text-align:center;cursor:pointer">
      <div style="font-size:26px;color:var(--brand)">&#8681;</div>
      <h3 style="margin:6px 0 2px;font-size:13px">Drop visit CSV</h3>
      <div class="state" id="dropState" style="font-size:11px;color:var(--muted)">No file loaded</div>
    </div>
    <input type="file" id="fileInput" style="display:none" accept=".csv">
  </div>
</div>
```

```html
<script>
document.getElementById('cutoffHours').addEventListener('input', function(e){
  state.cutoffHours = Number(e.target.value);
});

var dropZone = document.getElementById('dropZone');
var fileInput = document.getElementById('fileInput');
dropZone.addEventListener('click', function(){ fileInput.click(); });
dropZone.addEventListener('dragover', function(e){ e.preventDefault(); dropZone.style.background = 'var(--r1)'; });
dropZone.addEventListener('dragleave', function(){ dropZone.style.background = 'var(--surface)'; });
dropZone.addEventListener('drop', function(e){
  e.preventDefault();
  dropZone.style.background = 'var(--surface)';
  handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', function(e){ handleFile(e.target.files[0]); });

function handleFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    state.visits = RateEngine.parseVisitFile(e.target.result);
    document.getElementById('dropState').textContent = file.name + ' (' + state.visits.length + ' visits)';
    runComparison();
  };
  reader.readAsArrayBuffer(file);
}
</script>
```

- [ ] **Step 2: Verify via browser**

Use `claude-in-chrome` to open the page, change cutoff to 12, then use the file
input (click the drop zone, since drag-and-drop from the OS isn't automatable) to
select `C:\Users\DHricsina\AI Pricing\VD (Visits) (29).csv`. Expected: the status
text updates to show the filename and a visit count around 17,064 (may take a few
seconds to parse the 11MB file — wait for it before checking). No console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add reconciliation cutoff input and CSV drop zone"
```

---

### Task 13: Wire comparison run + Compare tab rendering

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `runComparison` and Compare tab markup**

Replace `<div id="comparePage" class="page"><h2>Compare</h2></div>` with:

```html
<div id="comparePage" class="page">
  <h2>Compare</h2>
  <p class="sub">Actual (AI-priced) charges vs. what the static rate table above would have charged.</p>
  <div class="row">
    <label class="toggle"><input type="checkbox" id="ignoreValidationsToggle"><span>Ignore Validations</span></label>
  </div>
  <div id="totalsSummary"></div>
  <div id="bracketList"></div>
  <div id="excludedSummary"></div>
</div>
```

```html
<script>
function runComparison() {
  if (!state.visits.length) return;
  var processed = state.visits.map(function(row){
    return RateEngine.processVisit(row, state.rateCards, state.earlyBird, state.cutoffHours);
  });
  state.compareResult = RateEngine.aggregateByBracket(processed);
  renderCompare();
}

function fmtMoney(n) { return '$' + n.toFixed(2); }

function renderCompare() {
  var result = state.compareResult;
  var totalsEl = document.getElementById('totalsSummary');
  var bracketListEl = document.getElementById('bracketList');
  var excludedEl = document.getElementById('excludedSummary');
  if (!result) { totalsEl.innerHTML = ''; bracketListEl.innerHTML = ''; excludedEl.innerHTML = ''; return; }

  totalsEl.innerHTML =
    '<div class="card"><strong>Overall</strong><br>' +
    'Static: ' + fmtMoney(result.totals.staticTotal) + ' &nbsp; ' +
    'Actual: ' + fmtMoney(result.totals.actualTotal) + ' &nbsp; ' +
    'Delta: ' + fmtMoney(result.totals.delta) + '</div>';

  bracketListEl.innerHTML = '';
  result.brackets.forEach(function(b){
    var isUnrolled = state.unrolledBrackets.has(b.name);
    var div = document.createElement('div');
    div.className = 'card';
    var unrollDisabled = state.ignoreValidations;
    var html =
      '<strong>' + b.name + '</strong> (Visits: ' + b.count + ')<br>' +
      'Static: ' + fmtMoney(b.staticTotal) + ' &nbsp; Actual: ' + fmtMoney(b.actualTotal) +
      ' &nbsp; Validation: ' + fmtMoney(b.validationTotal) + ' &nbsp; Delta: ' + fmtMoney(b.delta);
    if (!state.ignoreValidations) {
      html += ' &nbsp; <button class="btnGhost" data-bracket="' + b.name + '"' + (unrollDisabled ? ' disabled style="opacity:.4;cursor:not-allowed"' : '') + '>' + (isUnrolled ? 'Roll up \u25b2' : 'Unroll \u25be') + '</button>';
      if (isUnrolled) {
        html += '<div style="margin-top:8px;padding-left:12px;border-left:2px solid var(--line)">' +
          'Normal (' + b.normal.count + '): Static ' + fmtMoney(b.normal.staticTotal) + ', Actual ' + fmtMoney(b.normal.actualTotal) + '<br>' +
          'Validation (' + b.validation.count + '): Static ' + fmtMoney(b.validation.staticTotal) + ', Actual ' + fmtMoney(b.validation.actualTotal) + ', Validation ' + fmtMoney(b.validation.validationTotal) +
          '</div>';
      }
    }
    div.innerHTML = html;
    bracketListEl.appendChild(div);
  });

  excludedEl.innerHTML =
    '<div class="card">' +
    'Excluded — Special Event: ' + result.excluded.special_event.count + ' visits, ' + fmtMoney(result.excluded.special_event.actualTotal) + '<br>' +
    'Excluded — Over cutoff: ' + result.excluded.over_cutoff.count + ' visits, ' + fmtMoney(result.excluded.over_cutoff.actualTotal) + '<br>' +
    'Excluded — No matching rate card: ' + result.excluded.no_matching_rate_card.count + ' visits, ' + fmtMoney(result.excluded.no_matching_rate_card.actualTotal) +
    '</div>';
}

bracketListEl_delegate: (function(){
  document.getElementById('bracketList').addEventListener('click', function(e){
    if (e.target.dataset.bracket) {
      var name = e.target.dataset.bracket;
      if (state.unrolledBrackets.has(name)) state.unrolledBrackets.delete(name);
      else state.unrolledBrackets.add(name);
      renderCompare();
    }
  });
})();

document.getElementById('ignoreValidationsToggle').addEventListener('change', function(e){
  state.ignoreValidations = e.target.checked;
  renderCompare();
});
</script>
```

Note: the `bracketList` click-delegation IIFE above uses a throwaway label
(`bracketList_delegate:`) purely to scope the immediately-invoked function
expression as a labelled statement — remove the label and just call the IIFE
directly if the linter/editor complains; it has no functional effect.

- [ ] **Step 2: Fix the delegate IIFE (simplify)**

Replace the labelled IIFE from Step 1 with a plain statement (cleaner, same
behavior):

```js
document.getElementById('bracketList').addEventListener('click', function(e){
  if (e.target.dataset.bracket) {
    var name = e.target.dataset.bracket;
    if (state.unrolledBrackets.has(name)) state.unrolledBrackets.delete(name);
    else state.unrolledBrackets.add(name);
    renderCompare();
  }
});
```

- [ ] **Step 3: Verify via browser**

Use `claude-in-chrome`: with the CSV loaded from Task 12 and at least one rate card
covering all days/times (e.g. one card: all days, 00:00-24:00, grace 15, ladder
1hr=$5/2hr=$10/3hr=$15/12hr=$20/1day=$25), switch to the "Compare" tab. Expected: an
Overall totals card, one or more bracket cards, and an Excluded summary card, all
with non-garbage numbers (no `NaN`, no `$undefined`). Click "Unroll" on a bracket —
confirm it expands to show Normal/Validation sub-rows and the button label changes
to "Roll up". Check "Ignore Validations" — confirm sub-rows disappear and the Unroll
buttons become disabled/grayed out.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Wire comparison engine to Compare tab rendering"
```

---

### Task 14: Persistence — export/import rate table JSON

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add markup and behavior**

Add to the header, before the night toggle:

```html
<button class="btnGhost" id="saveRatesBtn">Save Rate Table</button>
<button class="btnGhost" id="loadRatesBtn">Load Rate Table</button>
<input type="file" id="loadRatesInput" style="display:none" accept=".json">
```

```html
<script>
document.getElementById('saveRatesBtn').addEventListener('click', function(){
  var payload = { rateCards: state.rateCards, earlyBird: state.earlyBird, cutoffHours: state.cutoffHours };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'rate-table.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('loadRatesBtn').addEventListener('click', function(){
  document.getElementById('loadRatesInput').click();
});
document.getElementById('loadRatesInput').addEventListener('change', function(e){
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(evt){
    var payload = JSON.parse(evt.target.result);
    state.rateCards = payload.rateCards || [];
    state.earlyBird = payload.earlyBird || state.earlyBird;
    state.cutoffHours = payload.cutoffHours || 24;
    nextCardId = state.rateCards.reduce(function(max, c){
      var n = Number(String(c.id).replace('rc', ''));
      return n > max ? n : max;
    }, 0) + 1;
    document.getElementById('cutoffHours').value = state.cutoffHours;
    renderRateCards();
    renderEarlyBird();
  };
  reader.readAsText(file);
});
</script>
```

- [ ] **Step 2: Verify via browser**

Use `claude-in-chrome`: build 2 rate cards and enable Early Bird with some values,
click "Save Rate Table" (confirm a `rate-table.json` download occurs). Reload the
page (state resets to empty), click "Load Rate Table", select the just-downloaded
file. Expected: the 2 rate cards and Early Bird settings reappear exactly as
configured before.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add rate table export/import persistence"
```

---

### Task 15: End-to-end verification with real sample data

**Files:**
- None (verification only)

- [ ] **Step 1: Build a realistic rate table matching the Excel reference**

Use `claude-in-chrome` to open `index.html` fresh and build the rate table from
`Lev_AI_Review.xlsx` Sheet1 (already decoded during design):
- Card "Weekday Early Morning": Mon-Fri, 00:00-04:00, grace 15, ladder
  2hr=$5/3hr=$8/12hr=$12/1day=$12.
- Card "Weekday Day": Mon-Fri, 04:00-16:00, grace 15, ladder
  1hr=$5/2hr=$10/3hr=$15/12hr=$20/1day=$25.
- Card "Weekday Evening": Mon-Fri, 16:00-00:00, grace 15, ladder
  2hr=$5/3hr=$8/12hr=$12/1day=$12.
- Card "Weekend": Sat-Sun, 00:00-24:00, grace 15, ladder
  2hr=$5/3hr=$8/12hr=$12/1day=$12.
- Leave Early Bird disabled, cutoff at the default 24 hours.

- [ ] **Step 2: Load the real visit export and inspect results**

Drop in `VD (Visits) (29).csv` via the file input. Once loaded (~17,064 visits),
switch to the Compare tab. Confirm:
- Excluded — Special Event count is close to 1,139 (the known count of
  `Is Special Event Rate = True` rows).
- Excluded — Over cutoff + No matching rate card accounts for the remainder not
  shown in the bracket totals.
- Each bracket's Actual total is a plausible dollar figure (matches the rough scale
  of the CSV's own Price Amt column, which sums to roughly $284,480 across all
  17,064 visits per the file's embedded Grand Total row).
- Toggling "Ignore Validations" and unrolling a bracket both behave as designed.

Note any numeric surprises for the user to sanity-check against their own Excel
reconciliation — the design confirmed the *structure* is correct, not that these
exact totals were pre-validated by the user.

- [ ] **Step 2: No commit** (verification-only task, nothing to commit)

---

### Task 16: Manual Apps Script deployment (user-performed, not automated)

**Files:**
- None (deployment instructions only)

This step requires the user's own Google account and cannot be automated by an
agent in this environment (no Google OAuth/credentials available here).

- [ ] Go to script.google.com, create a new project.
- [ ] Replace the default `Code.gs` content with this project's `Code.gs`.
- [ ] Add an HTML file named `index`, paste in this project's `index.html` content.
- [ ] Deploy > New deployment > select type "Web app" > Execute as "Me" > Who has
      access "Only myself" (or as appropriate) > Deploy.
- [ ] Open the resulting `/exec` URL to confirm the app loads and functions the
      same as the local `file://` version tested throughout this plan.

---

## Plan Self-Review Notes

- **Spec coverage:** every spec section maps to a task — rate cards (9), copy-to-
  days (10), Early Bird (11), cutoff + CSV parsing (3, 12), calculation engine (2,
  4-8), Compare tab incl. Ignore Validations/Unroll (13), persistence (14),
  visual system (1, 9-14 CSS), deployment (16).
- **Type consistency:** `RateEngine.*` function names and the `state`/`card`/
  `earlyBird` shapes defined in the Data Model section are used identically across
  every task (checked: `processVisit`, `aggregateByBracket`, `lookupLadderPrice`,
  `findMatchingRateCard`, `checkEarlyBird` signatures match their call sites in
  later tasks).
- **Fixed:** Task 13's Step 1 originally used an awkward labelled IIFE for event
  delegation; Step 2 replaces it with a plain statement before verification.
