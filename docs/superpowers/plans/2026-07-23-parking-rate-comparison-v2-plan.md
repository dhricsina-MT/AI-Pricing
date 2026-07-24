# Parking Rate Comparison v2 Implementation Plan

> Executed directly by the same agent that wrote it (no subagent dispatch, per
> explicit user instruction). Written for continuous direct execution, not for
> briefing a fresh context-free engineer — still concrete (exact code, exact
> locations), just without the "explain everything from scratch" padding a
> handoff plan needs.

**Goal:** Fix real bugs found while using v1 (hidden price field, stale
Compare results, non-functional EB toggle) and add the requested UX/output
changes (dropdown time pickers, coverage grid, Load to Compare, day-of-week
breakdown with percentage deltas).

**Verification throughout:** headless Chrome dump-dom against `?test=1`, same
as v1. No claude-in-chrome available.
```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --dump-dom "file:///C:/Users/DHricsina/AI Pricing/index.html?test=1" 2>/dev/null | grep -o '<h3>[0-9]*/[0-9]* passed'
```
Baseline right now: **120/120 passing** on commit `45fa366`.

---

### Task 1: Time dropdown helpers (shared)

Add near `escapeHtml` (index.html:591, inside the rate-card-builder script
block) — these are shared by both rate cards and Early Bird:

```js
function partsFromMinutes(min) {
  var h24 = Math.floor(min / 60), m = min % 60;
  var ampm = h24 < 12 ? 'AM' : 'PM';
  var h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return { hour: h12, minute: m, ampm: ampm };
}
function minutesFromParts(hour12, minute, ampm) {
  var h = Number(hour12) % 12;
  if (ampm === 'PM') h += 12;
  return h * 60 + Number(minute);
}
function timeDropdownsHtml(min, fieldName) {
  var p = partsFromMinutes(min);
  var hourOpts = '';
  for (var h = 1; h <= 12; h++) hourOpts += '<option value="' + h + '"' + (h === p.hour ? ' selected' : '') + '>' + h + '</option>';
  var minOpts = [0, 15, 30, 45].map(function(mv){
    return '<option value="' + mv + '"' + (mv === p.minute ? ' selected' : '') + '>' + (mv < 10 ? '0' + mv : mv) + '</option>';
  }).join('');
  var ampmOpts = ['AM', 'PM'].map(function(a){ return '<option value="' + a + '"' + (a === p.ampm ? ' selected' : '') + '>' + a + '</option>'; }).join('');
  return '<select data-timefield="' + fieldName + '" data-timepart="hour">' + hourOpts + '</select>' +
         '<select data-timefield="' + fieldName + '" data-timepart="minute">' + minOpts + '</select>' +
         '<select data-timefield="' + fieldName + '" data-timepart="ampm">' + ampmOpts + '</select>';
}
function readTimeDropdowns(containerEl, fieldName) {
  var hourSel = containerEl.querySelector('select[data-timefield="' + fieldName + '"][data-timepart="hour"]');
  var minSel = containerEl.querySelector('select[data-timefield="' + fieldName + '"][data-timepart="minute"]');
  var ampmSel = containerEl.querySelector('select[data-timefield="' + fieldName + '"][data-timepart="ampm"]');
  return minutesFromParts(hourSel.value, minSel.value, ampmSel.value);
}
```

Add a test case (new `<script>` block, anywhere before the harness marker):
```js
window.__engineTestCases.push(function(t){
  t.assertEqual(partsFromMinutes(0), { hour: 12, minute: 0, ampm: 'AM' }, 'partsFromMinutes: midnight is 12:00 AM');
  t.assertEqual(partsFromMinutes(720), { hour: 12, minute: 0, ampm: 'PM' }, 'partsFromMinutes: noon is 12:00 PM');
  t.assertEqual(partsFromMinutes(960), { hour: 4, minute: 0, ampm: 'PM' }, 'partsFromMinutes: 960 is 4:00 PM');
  t.assertEqual(minutesFromParts(12, 0, 'AM'), 0, 'minutesFromParts: 12:00 AM is midnight');
  t.assertEqual(minutesFromParts(4, 0, 'PM'), 960, 'minutesFromParts: 4:00 PM is 960');
  t.assertEqual(minutesFromParts(12, 30, 'PM'), 750, 'minutesFromParts: 12:30 PM is 750');
});
```
Verify, commit: `git commit -m "Add time dropdown conversion helpers"`.

### Task 2: Apply dropdowns to rate cards + remove Copy-to-other-days

In `renderRateCard` (index.html:603-735):
- Replace the Start/End `<input type="time">` markup (lines 611-612) with
  `timeDropdownsHtml(card.startMin, 'startMin')` / `timeDropdownsHtml(card.endMin, 'endMin')`,
  each still wrapped in its `<div class="ctl"><label>...</label>...</div>`.
- **Delete** the "Copy to other days" button from `nameRow`'s innerHTML (line 615).
- **Delete** the entire `copyPanel` construction block (lines 663-680).
- **Delete** the `openCopy`/`applyCopy` branches from the click handler (lines 716-731).
- In the `input` event handler, add a branch:
  ```js
  if (e.target.dataset.timefield) {
    card[e.target.dataset.timefield] = readTimeDropdowns(div, e.target.dataset.timefield);
  }
  ```

Remove the now-obsolete Copy-to-other-days test block entirely (index.html:811-847,
the `<script>` block with `state.rateCards.length, 2, 'copy: applyCopy...'` etc.).

Update the existing rate-card UI test block (index.html:743-809) — it currently
sets `.value = '04:00'` on a `<input type="time">` and dispatches `input`; change
those two assertions (name unaffected) to use the dropdown selects instead:
```js
var startGroup = cardDiv(0); // dropdowns are still inside the card div
var hourSel = startGroup.querySelector('select[data-timefield="startMin"][data-timepart="hour"]');
hourSel.value = '4'; hourSel.dispatchEvent(new Event('input', {bubbles:true}));
var minSel = startGroup.querySelector('select[data-timefield="startMin"][data-timepart="minute"]');
minSel.value = '0'; minSel.dispatchEvent(new Event('input', {bubbles:true}));
var ampmSel = startGroup.querySelector('select[data-timefield="startMin"][data-timepart="ampm"]');
ampmSel.value = 'AM'; ampmSel.dispatchEvent(new Event('input', {bubbles:true}));
t.assertEqual(state.rateCards[0].startMin, 240, 'UI: start time dropdowns update state in minutes');
```
(Replaces the old `startInput.value = '04:00'` assertion at the same spot.)

Verify, commit: `git commit -m "Replace rate card time inputs with dropdowns; remove Copy to other days"`.

### Task 3: Apply dropdowns to Early Bird + conditional visibility

Replace the 4 EB time `<input type="time">` markups (index.html:66,67,71) with
empty group containers:
```html
<div class="ctl"><label>Entry window start</label><div id="ebEntryStartGroup"></div></div>
<div class="ctl"><label>Entry window end</label><div id="ebEntryEndGroup"></div></div>
...
<div class="ctl"><label>Exit time</label><div id="ebExitTimeGroup"></div></div>
```
Wrap the whole EB `.card` block (index.html:61-75) with `id="ebCard"` on the
outer div, and wrap everything except the Enabled checkbox's `.ctl` in a new
`<div id="ebFields">...</div>` so it can be hidden as one unit:
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
(`display:contents` on `#ebFields` keeps its children participating in the
parent's flex row layout when visible; toggling it to `display:none` hides
them as one unit. `#ebDayRow` gets the same visibility toggle.)

In `renderEarlyBird()` (index.html:850-864), replace the 4 direct `.value =`
lines for the time fields with:
```js
document.getElementById('ebEntryStartGroup').innerHTML = timeDropdownsHtml(state.earlyBird.entryStartMin, 'entryStartMin');
document.getElementById('ebEntryEndGroup').innerHTML = timeDropdownsHtml(state.earlyBird.entryEndMin, 'entryEndMin');
document.getElementById('ebExitTimeGroup').innerHTML = timeDropdownsHtml(state.earlyBird.exitMin, 'exitMin');
```
and add at the end of the function:
```js
var showFields = state.earlyBird.enabled;
document.getElementById('ebFields').style.display = showFields ? 'contents' : 'none';
document.getElementById('ebDayRow').style.display = showFields ? '' : 'none';
```

Change the `ebEnabled` change listener (index.html:865) to re-render instead
of just setting state:
```js
document.getElementById('ebEnabled').addEventListener('change', function(e){
  state.earlyBird.enabled = e.target.checked;
  renderEarlyBird();
});
```

Add a delegated `input` listener on `#ebCard` for the new dropdown groups
(placed right after the existing named listeners, index.html:865-873):
```js
document.getElementById('ebCard').addEventListener('input', function(e){
  if (e.target.dataset.timefield) {
    state.earlyBird[e.target.dataset.timefield] = readTimeDropdowns(e.target.parentElement, e.target.dataset.timefield);
  }
});
```

Update the existing EB UI test block (index.html:877-926) — replace the 3
direct `.value = 'HH:MM'` + `input` dispatch pairs for entryStart/entryEnd/exitTime
with dropdown-based sets (same 3-select pattern as Task 2's rate-card test
update), reading back via `state.earlyBird.entryStartMin` etc. Also add:
```js
t.assertEqual(document.getElementById('ebFields').style.display, 'contents', 'EB UI: fields visible when enabled');
document.getElementById('ebEnabled').checked = false;
document.getElementById('ebEnabled').dispatchEvent(new Event('change', {bubbles:true}));
t.assertEqual(document.getElementById('ebFields').style.display, 'none', 'EB UI: fields hidden when disabled');
t.assertEqual(state.earlyBird.entryStartMin, 360, 'EB UI: state preserved while fields are hidden');
document.getElementById('ebEnabled').checked = true;
document.getElementById('ebEnabled').dispatchEvent(new Event('change', {bubbles:true}));
```
(Restores `enabled: true` for any later test relying on it — check Task 6's
compare-tab test doesn't depend on EB state left over from this block; it
builds its own `noEb`/`state.earlyBird` explicitly, so it's fine either way.)

Verify, commit: `git commit -m "Apply time dropdowns to Early Bird; hide fields until Enabled"`.

### Task 4: Rate ladder default tier + relabeling

In `newRateCard()` (index.html:584-589), change `ladder: []` to
`ladder: [{ thresholdMin: 60, price: 0 }]` and update its comment.

In `renderRateCard`'s ladder button (index.html:656-660), change
`addLadderBtn.textContent = '+ Add Tier'` to `'+ Add Price Tier'`.

In the ladder column markup (index.html:650-651), change the label
`'<label>Price</label>'` to `'<label>Price ($)</label>'`.

This shifts existing test expectations that assume a fresh card's ladder
starts empty (`state.rateCards[0].ladder.length, 1` after one click of
Add Tier — now it'll be `2` after one click, since a card starts with 1).
Fix the Task-9-era UI test's `addTierBtn` assertions (index.html:775-777) to
expect `2` instead of `1`, and its "removing a ladder tier" assertion
(index.html:793-795) to expect `1` remaining instead of `0` (since the
sequence adds a tier via click, edits it, then removes ONE of the now-two
tiers). Also fix `newRateCard()`'s own regression test (index.html:797-800,
the one asserting `freshCard.endMin`) by adding one more line:
```js
t.assertEqual(freshCard.ladder.length, 1, 'newRateCard: starts with one visible price tier, not an empty ladder');
```

Verify, commit: `git commit -m "Default rate cards to one visible price tier; relabel Price field"`.

### Task 5: Coverage grid

Add markup at the very top of `#setupPage`, before `<h2>Setup</h2>`
(index.html:56-57):
```html
<div class="card">
  <div class="sub">Rate coverage (green = a rate card covers that hour; blank = no rate assigned \u2014 gaps are often intentional, e.g. closed hours)</div>
  <div id="coverageGrid"></div>
</div>
```

Add CSS (append inside `<style>`, near `.dayBoxes`):
```css
.coverageRow{display:flex;align-items:center;gap:4px;margin-bottom:2px}
.coverageRow .dayLabel{width:36px;font-size:11px;color:var(--muted);flex-shrink:0}
.coverageCell{width:16px;height:16px;border:1px solid var(--line);border-radius:2px}
.coverageCell.covered{background:var(--teal);border-color:var(--teal)}
```

Add a render function (new `<script>` block, placed right after
`renderRateCards`'s definition so it can be called from it):
```js
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
Call `renderCoverageGrid();` at the end of `renderRateCards()` (index.html:595-601)
so it recomputes live on every card add/edit/delete. Also call it once at
startup, right after the initial page load wiring (e.g. right after
`document.getElementById('addCardBtn').addEventListener(...)` at index.html:737-740,
add `renderCoverageGrid();` on its own line).

Add a test:
```js
window.__engineTestCases.push(function(t){
  state.rateCards = [{ id:'c1', name:'Day', days:[false,true,false,false,false,false,false], startMin:240, endMin:960, graceMin:15, ladder:[{thresholdMin:60,price:5}] }];
  renderRateCards();
  t.assertEqual(isHourCovered(state.rateCards, 1, 5), true, 'coverage: hour 5am on Monday is covered (4am-4pm card)');
  t.assertEqual(isHourCovered(state.rateCards, 1, 20), false, 'coverage: hour 8pm on Monday is not covered');
  t.assertEqual(isHourCovered(state.rateCards, 2, 5), false, 'coverage: Tuesday is not covered by a Monday-only card');
  var mondayRow = document.querySelectorAll('#coverageGrid .coverageRow')[0];
  var coveredCells = mondayRow.querySelectorAll('.coverageCell.covered');
  t.assertEqual(coveredCells.length, 12, 'coverage: Monday row shows 12 covered hours (4am-4pm)');
});
```

Verify, commit: `git commit -m "Add rate coverage grid to Setup tab"`.

### Task 6: "Load to Compare" button

Add markup after the drop-zone `.card` block in `#setupPage` (after index.html:88):
```html
<button id="loadToCompareBtn" class="btnPrimary">Load to Compare</button>
```
Add a click handler near the other drop-zone wiring:
```js
document.getElementById('loadToCompareBtn').addEventListener('click', function(){ runComparison(); });
```
(No new test strictly required — this is a one-line delegate to
`runComparison`, already covered by the Compare-tab tests in Task 7. Still,
add one assertion for the button's presence and click-wiring for completeness:)
```js
window.__engineTestCases.push(function(t){
  var btn = document.getElementById('loadToCompareBtn');
  t.assertEqual(!!btn, true, 'Load to Compare button exists');
  state.compareResult = null;
  btn.click();
  t.assertEqual(state.compareResult !== null, state.visits.length > 0, 'Load to Compare triggers runComparison');
});
```

Verify, commit: `git commit -m "Add Load to Compare button"`.

### Task 7: Compare tab — day-of-week breakdown + percentages

This is the one Engine-level change. Modify `RateEngine.aggregateByBracket`
(index.html:266-318) to add a `days` sub-object per bracket, keyed by
`Date.getDay()` index (0-6, same convention as everywhere else), and add
percentage fields at every level.

```js
RateEngine.computeDeltaPercents = function(staticTotal, actualTotal) {
  var delta = actualTotal - staticTotal;
  return {
    delta: delta,
    percentOfStatic: staticTotal !== 0 ? (delta / staticTotal) * 100 : null,
    percentOfActual: actualTotal !== 0 ? (delta / actualTotal) * 100 : null
  };
};

RateEngine.aggregateByBracket = function(processedVisits) {
  var brackets = Object.create(null);
  var excluded = {
    special_event: { count: 0, actualTotal: 0 },
    over_cutoff: { count: 0, actualTotal: 0 },
    no_matching_rate_card: { count: 0, actualTotal: 0 }
  };

  processedVisits.forEach(function(v){
    if (v.excluded) {
      if (!excluded[v.excluded]) excluded[v.excluded] = { count: 0, actualTotal: 0 };
      excluded[v.excluded].count++;
      excluded[v.excluded].actualTotal += v.actualPrice;
      return;
    }
    if (!brackets[v.bracketName]) {
      brackets[v.bracketName] = {
        name: v.bracketName, count: 0, staticTotal: 0, actualTotal: 0, validationTotal: 0,
        normal: { count: 0, staticTotal: 0, actualTotal: 0 },
        validation: { count: 0, staticTotal: 0, actualTotal: 0, validationTotal: 0 },
        days: {} // keyed by 0-6 (Date.getDay()), built lazily below
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

    var dayIdx = v.entryDate.getDay();
    if (!b.days[dayIdx]) {
      b.days[dayIdx] = {
        count: 0, staticTotal: 0, actualTotal: 0, validationTotal: 0,
        normal: { count: 0, staticTotal: 0, actualTotal: 0 },
        validation: { count: 0, staticTotal: 0, actualTotal: 0, validationTotal: 0 }
      };
    }
    var d = b.days[dayIdx];
    d.count++;
    d.staticTotal += v.staticPrice;
    d.actualTotal += v.actualPrice;
    d.validationTotal += v.validationAmt;
    var dsub = v.isValidated ? d.validation : d.normal;
    dsub.count++;
    dsub.staticTotal += v.staticPrice;
    dsub.actualTotal += v.actualPrice;
    if (v.isValidated) dsub.validationTotal += v.validationAmt;
  });

  var bracketList = Object.keys(brackets).map(function(name){
    var b = brackets[name];
    var pct = RateEngine.computeDeltaPercents(b.staticTotal, b.actualTotal);
    b.delta = pct.delta; b.percentOfStatic = pct.percentOfStatic; b.percentOfActual = pct.percentOfActual;
    b.dayList = Object.keys(b.days).map(function(dayIdx){
      var d = b.days[dayIdx];
      var dpct = RateEngine.computeDeltaPercents(d.staticTotal, d.actualTotal);
      d.dayIndex = Number(dayIdx);
      d.delta = dpct.delta; d.percentOfStatic = dpct.percentOfStatic; d.percentOfActual = dpct.percentOfActual;
      return d;
    }).sort(function(a, b2){ return a.dayIndex - b2.dayIndex; });
    return b;
  });

  var totals = bracketList.reduce(function(acc, b){
    return { staticTotal: acc.staticTotal + b.staticTotal, actualTotal: acc.actualTotal + b.actualTotal };
  }, { staticTotal: 0, actualTotal: 0 });
  var totalsPct = RateEngine.computeDeltaPercents(totals.staticTotal, totals.actualTotal);
  totals.delta = totalsPct.delta; totals.percentOfStatic = totalsPct.percentOfStatic; totals.percentOfActual = totalsPct.percentOfActual;

  return { brackets: bracketList, totals: totals, excluded: excluded };
};
```

Note `processVisit`'s excluded-visit return objects already include
`entryDate`/`exitDate` (index.html:232-233), and its non-excluded return does
NOT currently include `entryDate` — check index.html:250-263 and add
`entryDate: entryDate` to that returned object (needed for the `v.entryDate.getDay()`
call above). This is a small addition to `processVisit`'s return shape, not a
behavior change to any exclusion/pricing logic.

Update `renderCompare()` (index.html:982-1025) to render the new `dayList`
per bracket, with the two percentages everywhere a delta appears. `fmtMoney`
stays as-is; add:
```js
function fmtPercent(p) { return p === null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
function fmtDelta(staticTotal, actualTotal, delta, pctStatic, pctActual) {
  return fmtMoney(delta) + '  (' + fmtPercent(pctStatic) + ' of static / ' + fmtPercent(pctActual) + ' of actual)';
}
```
Overall totals line becomes:
```js
totalsEl.innerHTML =
  '<div class="card"><strong>Overall</strong><br>' +
  'Static: ' + fmtMoney(result.totals.staticTotal) + ' &nbsp; ' +
  'Actual: ' + fmtMoney(result.totals.actualTotal) + ' &nbsp; ' +
  'Delta: ' + fmtDelta(result.totals.staticTotal, result.totals.actualTotal, result.totals.delta, result.totals.percentOfStatic, result.totals.percentOfActual) +
  '</div>';
```
Per-bracket loop: change the bracket's own Delta line to use `fmtDelta(...)`
the same way, and after the bracket-level line (still inside the same `div`,
before the closing of the bracket's html string), add the day rows —
`unrolledBrackets` now needs a compound key (bracket name + day index) so
Unroll is scoped per day-row, not per bracket:
```js
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
```
Remove the OLD bracket-level Unroll button/Normal-Validation block from
`renderCompare` (index.html:1004-1014) entirely — that responsibility moves
to the per-day rows above; the bracket-level line now only shows its own
totals (no unroll control at that level).

The `bracketList` click listener (index.html:1027-1034) already works
unchanged, since it just toggles whatever string key is in `data-bracket` —
no code change needed there, just note `state.unrolledBrackets` now holds
compound `"BracketName|dayIndex"` keys instead of plain bracket names.

Update the existing Compare-tab test (index.html:1042-1072) to match the new
shape:
```js
window.__engineTestCases.push(function(t){
  state.rateCards = [{ id:'day', name:'Day', days:[true,true,true,true,true,true,true], startMin:0, endMin:1439, graceMin:15,
    ladder:[{thresholdMin:120,price:10}] }];
  state.earlyBird = { enabled:false, days:[false,false,false,false,false,false,false], entryStartMin:0, entryEndMin:0, exitCondition:'after', exitMin:0, price:0 };
  state.cutoffHours = 24;
  state.ignoreValidations = false;
  state.unrolledBrackets = new Set();

  // 7/1/2026 is a Wednesday (dayIndex 3)
  var header = "Sort by\tVisit Start Date\tVisit Start At\tVisit Exit  Event Date\tVisit Exit  Event At\tIs Special Event Rate\tPrice Amt\tValidation Amt\tGPV Amt\tVisit Coverage Type\n";
  var row1 = "1\t7/1/2026\t10:00:00 AM\t7/1/2026\t11:30:00 AM\tFalse\t$12.00\t\t$12.00\tTransient (No Coverage)";
  applyVisitFileBuffer(t.utf16leEncode(header + row1), 'test.csv');

  var bracket = state.compareResult.brackets[0];
  t.assertEqual(bracket.dayList.length, 1, 'runComparison: bracket has one day-of-week entry for the one test visit');
  t.assertEqual(bracket.dayList[0].dayIndex, 3, 'runComparison: day entry keyed to Wednesday (dayIndex 3)');
  t.assertEqual(bracket.dayList[0].count, 1, 'runComparison: Wednesday day-row has the one visit');
  t.assertEqual(Math.round(bracket.percentOfStatic), 20, 'runComparison: bracket percentOfStatic = (12-10)/10*100 = 20%');
  t.assertEqual(Math.round(bracket.percentOfActual * 10) / 10, 16.7, 'runComparison: bracket percentOfActual = (12-10)/12*100 ~= 16.7%');

  var dayUnrollBtn = document.querySelector('#bracketList button[data-bracket="Day|3"]');
  t.assertEqual(!!dayUnrollBtn, true, 'renderCompare: day-row unroll button uses compound bracket|dayIndex key');
  dayUnrollBtn.click();
  t.assertEqual(state.unrolledBrackets.has('Day|3'), true, 'unroll: day-row toggle uses compound key');
  t.assertEqual(document.querySelectorAll('#bracketList').length > 0 && document.getElementById('bracketList').textContent.indexOf('Normal') > -1, true, 'unroll: expanded day-row shows Normal/Validation split');

  var ignoreToggle = document.getElementById('ignoreValidationsToggle');
  ignoreToggle.checked = true;
  ignoreToggle.dispatchEvent(new Event('change', {bubbles:true}));
  t.assertEqual(!!document.querySelector('#bracketList button[disabled]'), true, 'ignoreValidations: day-row Unroll button disabled when validations ignored');
  ignoreToggle.checked = false;
  ignoreToggle.dispatchEvent(new Event('change', {bubbles:true}));
});
```
This replaces the old test block that asserted `state.unrolledBrackets.has('Day')`
(plain bracket name) — delete that old block (index.html:1042-1072) and
replace with the above.

Also add a divide-by-zero guard test:
```js
window.__engineTestCases.push(function(t){
  var pct = RateEngine.computeDeltaPercents(0, 5);
  t.assertEqual(pct.percentOfStatic, null, 'computeDeltaPercents: null percentOfStatic when static total is 0');
  t.assertEqual(pct.percentOfActual, 100, 'computeDeltaPercents: percentOfActual still computes when static is 0 but actual is not');
  var pct2 = RateEngine.computeDeltaPercents(0, 0);
  t.assertEqual(pct2.percentOfStatic, null, 'computeDeltaPercents: null when both totals are 0 (static)');
  t.assertEqual(pct2.percentOfActual, null, 'computeDeltaPercents: null when both totals are 0 (actual)');
});
```

Verify, commit: `git commit -m "Add day-of-week breakdown and delta percentages to Compare tab"`.

---

## Self-Review

**Spec coverage:** every v2 spec section maps to a task — Copy-to-days removal
(2), dropdowns (1,2,3), ladder default+relabel (4), EB conditional visibility
(3), coverage grid (5), Load to Compare (6), day-of-week + percentages (7).

**Type consistency:** `timeDropdownsHtml`/`readTimeDropdowns`/`partsFromMinutes`/
`minutesFromParts` signatures are defined once in Task 1 and reused identically
in Tasks 2 and 3. `RateEngine.computeDeltaPercents` is defined once in Task 7
and used for both bracket-level and day-level percentages plus the overall
total — no duplicate percent-math logic.

**Ordering note:** Task 7 depends on `processVisit` gaining `entryDate` on its
non-excluded return — do this as the first edit within Task 7, before touching
`aggregateByBracket`, so the engine test suite for `processVisit` (already
passing) isn't broken by an incomplete change mid-task.
