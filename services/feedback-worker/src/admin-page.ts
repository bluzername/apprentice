import { PRODUCT_NAME } from "@apprentice/schemas";

/**
 * Static dashboard. Inline CSS and script only, no external assets, no links.
 * The token lives in sessionStorage and travels only in the Authorization header.
 */
export const renderAdminPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${PRODUCT_NAME} feedback summary</title>
<style>
:root { color-scheme: light dark; --ink: #1c1c1e; --muted: #6e6e73; --line: #d9d9de; --accent: #2f5fb3; --bg: #fafafa; }
@media (prefers-color-scheme: dark) { :root { --ink: #ededf0; --muted: #a1a1a8; --line: #3a3a40; --accent: #7aa2ff; --bg: #151517; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: var(--ink); background: var(--bg); }
h1 { font-size: 20px; margin: 0 0 16px; }
h2 { font-size: 15px; margin: 24px 0 8px; }
form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
input { padding: 6px 8px; font: inherit; border: 1px solid var(--line); border-radius: 6px; min-width: 280px; background: transparent; color: inherit; }
button { padding: 6px 12px; font: inherit; border: 1px solid var(--accent); color: var(--accent); background: transparent; border-radius: 6px; cursor: pointer; }
table { border-collapse: collapse; width: 100%; max-width: 900px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; max-width: 900px; }
.tile { border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.tile .k { color: var(--muted); font-size: 12px; }
.tile .v { font-size: 22px; font-variant-numeric: tabular-nums; }
.status { color: var(--muted); margin: 8px 0; }
.err { color: #b3261e; }
</style>
</head>
<body>
<h1>${PRODUCT_NAME} feedback summary</h1>
<form id="auth">
  <label for="token">Admin token</label>
  <input id="token" type="password" autocomplete="off" spellcheck="false">
  <button type="submit">Load</button>
  <button type="button" id="forget">Forget token</button>
</form>
<p class="status" id="status">Enter the admin token to load the summary. It is kept in this tab's sessionStorage only.</p>
<div id="out" hidden>
  <div class="grid" id="tiles"></div>
  <h2>Funnel (events by name)</h2><table id="funnel"></table>
  <h2>Candidates</h2><table id="candidates"></table>
  <h2>Delegation intent</h2><table id="delegation"></table>
  <h2>Run outcome</h2><table id="runs"></table>
  <h2>Failure categories</h2><table id="failures"></table>
  <h2>Retention by test day</h2><table id="retention"></table>
  <h2>Latest comments</h2><table id="comments"></table>
</div>
<script>
(function () {
  "use strict";
  var KEY = "apprentice-admin-token";
  var $ = function (id) { return document.getElementById(id); };
  var status = $("status");
  var tokenInput = $("token");

  function readToken() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function writeToken(t) { try { if (t) { sessionStorage.setItem(KEY, t); } else { sessionStorage.removeItem(KEY); } } catch (e) { /* ignore */ } }

  function td(text, num) { var c = document.createElement("td"); c.textContent = text; if (num) { c.className = "num"; } return c; }
  function fillTable(id, header, rows) {
    var table = $(id);
    table.textContent = "";
    var thead = document.createElement("thead"); var hr = document.createElement("tr");
    header.forEach(function (h) { var th = document.createElement("th"); th.textContent = h; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement("tbody");
    if (rows.length === 0) { var r = document.createElement("tr"); r.appendChild(td("none", false)); tbody.appendChild(r); }
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      row.forEach(function (cell, i) { tr.appendChild(td(String(cell), i > 0 && typeof cell === "number")); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }
  function recordRows(rec) { return Object.keys(rec).sort().map(function (k) { return [k, rec[k]]; }); }
  function fmt(n, digits) { return n === null || n === undefined ? "n/a" : Number(n).toFixed(digits); }
  function tile(k, v) { var d = document.createElement("div"); d.className = "tile"; var a = document.createElement("div"); a.className = "k"; a.textContent = k; var b = document.createElement("div"); b.className = "v"; b.textContent = v; d.appendChild(a); d.appendChild(b); return d; }

  function render(s) {
    var tiles = $("tiles"); tiles.textContent = "";
    tiles.appendChild(tile("Submissions", String(s.totals.submissions)));
    tiles.appendChild(tile("Installations", String(s.totals.installations)));
    tiles.appendChild(tile("Feedback items", String(s.totals.feedbackItems)));
    tiles.appendChild(tile("Events", String(s.totals.events)));
    tiles.appendChild(tile("Mean trust (1-5)", fmt(s.meanTrustRating, 2)));
    tiles.appendChild(tile("Median time saved (min)", fmt(s.medianTimeSavedMinutes, 1)));
    fillTable("funnel", ["Event", "Count"], recordRows(s.funnel));
    fillTable("candidates", ["Metric", "Value"], [["Candidate feedback items", s.candidateFeedbackCount], ["Relevance rate", s.candidateRelevanceRate === null ? "n/a" : (s.candidateRelevanceRate * 100).toFixed(1) + "%"]]);
    fillTable("delegation", ["Would delegate", "Count"], recordRows(s.delegationIntent));
    fillTable("runs", ["Outcome achieved", "Count"], recordRows(s.runOutcome));
    fillTable("failures", ["Failure category", "Count"], recordRows(s.failureCategories));
    fillTable("retention", ["Day", "Installations active (of " + s.retention.cohort + ")"], recordRows(s.retention.byDay));
    fillTable("comments", ["Context", "Created", "Comment"], s.comments.map(function (c) { return [c.contextType, new Date(c.createdAt).toISOString(), c.comment]; }));
    $("out").hidden = false;
    status.textContent = "Generated " + new Date(s.generatedAt).toISOString();
    status.className = "status";
  }

  function load(token) {
    status.textContent = "Loading"; status.className = "status";
    fetch("/v1/admin/summary", { method: "GET", headers: { authorization: "Bearer " + token }, cache: "no-store", credentials: "omit" })
      .then(function (res) {
        if (res.status === 401) { writeToken(""); throw new Error("Token rejected (401)."); }
        if (!res.ok) { throw new Error("Request failed with status " + res.status + "."); }
        return res.json();
      })
      .then(render)
      .catch(function (err) { status.textContent = err && err.message ? err.message : "Failed to load summary."; status.className = "status err"; $("out").hidden = true; });
  }

  $("auth").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = tokenInput.value.trim();
    if (!t) { status.textContent = "Token is required."; status.className = "status err"; return; }
    writeToken(t); tokenInput.value = ""; load(t);
  });
  $("forget").addEventListener("click", function () { writeToken(""); $("out").hidden = true; status.textContent = "Token forgotten."; status.className = "status"; });

  var saved = readToken();
  if (saved) { load(saved); }
})();
</script>
</body>
</html>
`;
