/**
 * Logic test for the shared localStorage-based dispatch pattern used
 * across manager/index.html, line-display/index.html, and
 * report-panel/index.html. This does NOT render the pages (no real
 * browser here) — it simulates the localStorage read/write contract
 * each page relies on, to confirm the data shape is consistent before
 * visually testing in an actual browser.
 */

// --- Minimal localStorage polyfill for Node ---
const store = {};
global.localStorage = {
  setItem: (k, v) => { store[k] = String(v); },
  getItem: (k) => (k in store ? store[k] : null),
};

// --- Simulate: manager approves "Plan C — Balanced Resilience" ---
function managerApprove(planLabel) {
  localStorage.setItem("powerproof_active_plan", planLabel);
  localStorage.setItem("powerproof_dispatch_time", new Date().toISOString());
}

// --- Simulate: line-display polls and reacts ---
function lineDisplayPoll(lastSeenPlan) {
  const activePlan = localStorage.getItem("powerproof_active_plan");
  if (activePlan && activePlan !== lastSeenPlan) {
    return { changed: true, newPlan: activePlan };
  }
  return { changed: false };
}

// --- Simulate: worker confirms understanding on a line ---
function workerConfirm(lineId) {
  const key = `powerproof_confirmed_${lineId}`;
  localStorage.setItem(key, JSON.stringify({
    confirmed: true,
    timestamp: new Date().toISOString(),
  }));
}

// --- Simulate: report-panel sends an issue report ---
function reportIssue(lineId, issueType, label) {
  const report = { line_id: lineId, issue_type: issueType, label, reported_at: new Date().toISOString() };
  localStorage.setItem("powerproof_latest_report", JSON.stringify(report));
  return report;
}

// ---------------------------------------------------------------------
// Test sequence
// ---------------------------------------------------------------------
let failures = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// 1. Before approval, line-display should see no change
let poll1 = lineDisplayPoll(null);
assert(poll1.changed === false, "line-display sees no change before manager approves anything");

// 2. Manager approves Plan C
managerApprove("Plan C — Balanced Resilience");

// 3. Line-display should now detect the change
let poll2 = lineDisplayPoll(null);
assert(poll2.changed === true, "line-display detects dispatch after manager approval");
assert(poll2.newPlan === "Plan C — Balanced Resilience", "line-display receives the exact plan label manager approved");

// 4. Polling again with the same lastSeenPlan should NOT re-trigger
let poll3 = lineDisplayPoll(poll2.newPlan);
assert(poll3.changed === false, "line-display does not re-trigger on unchanged plan (avoids resetting worker confirmations repeatedly)");

// 5. Worker confirms on Line_A
workerConfirm("Line_A");
const confirmedRaw = localStorage.getItem("powerproof_confirmed_Line_A");
const confirmedData = JSON.parse(confirmedRaw);
assert(confirmedData.confirmed === true, "worker confirmation is recorded and readable");

// 6. Worker on Line_B reports "no material"
const report = reportIssue("Line_B", "no_material", "No material");
assert(report.line_id === "Line_B", "issue report carries correct line_id");
assert(report.issue_type === "no_material", "issue report carries correct issue_type");

const latestReportRaw = localStorage.getItem("powerproof_latest_report");
const latestReport = JSON.parse(latestReportRaw);
assert(latestReport.issue_type === "no_material", "manager-side poll would read the correct latest report from storage");

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
