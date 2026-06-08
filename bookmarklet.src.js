/* =========================================================================
 * Mapiq desk auto-booker — BOOKMARKLET source (colleague-friendly)
 * =========================================================================
 * Self-contained. Runs from a bookmark while on app.mapiq.com:
 *   - auto-reads your token (no paste)
 *   - auto-detects your desk from your most recent booking (no GUID needed)
 *   - books every available day in your window
 *   - shows a live overlay on the page (no DevTools needed)
 *
 * This readable file is the SOURCE. The actual bookmarklet is generated from
 * it by build-bookmarklet.mjs and embedded into bookmarklet.html.
 * ========================================================================= */

(async () => {
  "use strict";
  const API = "https://app.mapiq.com/api/v2";

  // ---- on-page overlay (so colleagues don't need the console) ----
  if (location.host !== "app.mapiq.com") {
    alert("Open app.mapiq.com (and log in) first, then click this bookmark.");
    return;
  }
  document.getElementById("mqab")?.remove();
  const box = document.createElement("div");
  box.id = "mqab";
  box.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;max-height:80vh;overflow:auto;background:#14161a;color:#eef;font:13px/1.5 system-ui,Segoe UI,sans-serif;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.45);padding:0";
  box.innerHTML =
    "<div style='display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#1d2026;border-radius:12px 12px 0 0'>" +
    "<b>Mapiq auto-booker</b><span id='mqab-x' style='cursor:pointer;opacity:.6;font-size:18px'>×</span></div>" +
    "<div id='mqab-body' style='padding:12px 14px'></div>";
  document.body.appendChild(box);
  box.querySelector("#mqab-x").onclick = () => box.remove();
  const body = box.querySelector("#mqab-body");
  const say = (html, color) => { const p = document.createElement("div"); p.style.cssText = "margin:3px 0" + (color ? ";color:" + color : ""); p.innerHTML = html; body.appendChild(p); box.scrollTop = box.scrollHeight; return p; };
  const fail = msg => { say("⚠️ " + msg, "#ff8a8a"); };

  // ---- token (scan local + session storage for the MSAL access token) ----
  function findToken() {
    let best = null, exp = 0;
    for (const store of [localStorage, sessionStorage])
      for (let i = 0; i < store.length; i++) {
        const v = store.getItem(store.key(i)); if (!v) continue;
        let s = null;
        try { const o = JSON.parse(v); if (o && o.credentialType === "AccessToken" && o.secret) s = o.secret; } catch {}
        if (!s) continue;
        try { const c = JSON.parse(atob(s.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); if (c.exp > exp) { best = s; exp = c.exp; } } catch { best = best || s; }
      }
    return best;
  }
  const token = findToken();
  if (!token) { fail("Couldn't find your login. Make sure you're logged in to app.mapiq.com, then reload and try again."); return; }
  let email = "you";
  try { email = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || "you"; } catch {}

  const headers = { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json, text/plain, */*", "x-api-version": "2.0" };
  const api = (m, p, b) => fetch(API + p, { method: m, headers, credentials: "include", cache: "no-store", body: b === undefined ? undefined : JSON.stringify(b) });
  const isActive = v => !/cancel|declin|delet|expir|reject/i.test(v.status || "");
  const pad = n => String(n).padStart(2, "0");
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tryParse = t => { try { return JSON.parse(t); } catch { return t; } };
  const DOW = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

  say("Signed in as <b>" + email + "</b>", "#9fd");

  // ---- account limits + building ----
  let buildingId = null, daysAhead = 14, regDays = [1, 2, 3, 4, 5];
  try {
    const r = await api("POST", "/shifts/me/login", {});
    if (r.ok) { const me = await r.json(); buildingId = me.defaultBuildingId; const ap = me.effectiveAccessProfile || me.accessProfile; if (ap) { if (ap.daysAhead) daysAhead = ap.daysAhead; if (ap.registrationDays?.length) regDays = ap.registrationDays.map(n => DOW[n]).filter(n => n !== undefined); } }
  } catch {}

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(today.getDate() + daysAhead);
  // Query only the forward window — the workdays endpoint 400s on wide/past ranges.
  const q = `startDate=${fmt(today)}T00:00&endDate=${fmt(end)}T00:00`;

  // ---- existing workdays + reservations ----
  const workdayByDate = {}, reservedByDate = {}, closed = new Set();
  let allRes = [];
  try { const r = await api("GET", `/me/workdays?${q}`); if (r.ok) for (const w of await r.json()) { if (!buildingId && w.buildingId) buildingId = w.buildingId; workdayByDate[String(w.localStart).slice(0, 10)] = w.id; } } catch {}
  try { const r = await api("GET", `/me/workspace-reservations?${q}`); if (r.ok) { allRes = (await r.json()).filter(isActive); for (const v of allRes) { const ds = String(v.localStart).slice(0, 10); if (ds >= fmt(today)) reservedByDate[ds] = { deskId: v.workspace?.nodeId, deskName: v.workspace?.deskName }; } } } catch {}
  try { const r = await api("GET", `/shifts/me/openingdayexceptions?from=${fmt(today)}&to=${fmt(end)}`); if (r.ok) for (const x of await r.json()) { const ds = String(x.date || x.localStart || x.day || "").slice(0, 10); if (ds) closed.add(ds); } } catch {}

  // ---- figure out which desk to book ----
  let deskId = localStorage.getItem("mqab_desk") || "";
  let deskName = localStorage.getItem("mqab_deskName") || "";
  if (!deskId) {
    const desks = allRes.filter(v => v.workspace?.nodeType === "Desk" && v.workspace?.nodeId);
    if (desks.length) { desks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); deskId = desks[0].workspace.nodeId; deskName = desks[0].workspace.deskName; }
  }
  if (!deskId) {
    deskId = (prompt("Couldn't detect your desk. Book one day manually in Mapiq first, then click again — or paste your desk id here:") || "").trim();
    if (!deskId) { fail("No desk selected — nothing to do."); return; }
    deskName = "your desk";
  }
  localStorage.setItem("mqab_desk", deskId);
  if (deskName) localStorage.setItem("mqab_deskName", deskName);

  // ---- target days ----
  const days = [];
  for (let i = 0; i <= daysAhead; i++) { const d = new Date(today); d.setDate(today.getDate() + i); if (!regDays.includes(d.getDay())) continue; if (closed.has(fmt(d))) continue; days.push(d); }

  if (!confirm(`Book ${deskName || "your desk"} for all available days (${fmt(today)} … ${fmt(end)})?\n\nAlready-booked days are skipped.`)) { say("Cancelled.", "#ffb"); return; }
  say(`Booking <b>${deskName || deskId}</b> for ${days.length} day(s)…`);

  // ---- ensure office day + book desk, per day ----
  let booked = 0, skipped = 0, failed = 0;
  for (const d of days) {
    const ds = fmt(d), localStart = ds + "T00:00:00", localEnd = ds + "T23:59:00";
    const ex = reservedByDate[ds];
    if (ex) { skipped++; say(`${ds} — already booked (${ex.deskName || "desk"})`, "#aaa"); continue; }
    let workdayId = workdayByDate[ds];
    try {
      if (!workdayId) {
        if (!buildingId) { failed++; fail(`${ds} — no building`); continue; }
        const r = await api("POST", "/me/workdays", { localStart, localEnd, buildingId, status: "OfficeDay" });
        const data = tryParse(await r.text());
        if (!r.ok) { failed++; fail(`${ds} — office-day failed (${r.status})`); continue; }
        workdayId = data?.id; await sleep(300);
      }
      const r = await api("POST", "/me/workspace-reservations", { localStart, localEnd, nodeId: deskId, invitations: [], ...(workdayId ? { workdayId } : {}) });
      if (r.ok) { booked++; say(`${ds} — booked ✅`, "#9f9"); }
      else { failed++; const t = await r.text(); fail(`${ds} — failed (${r.status}) ${String(t).slice(0, 80)}`); }
    } catch (e) { failed++; fail(`${ds} — error`); }
    await sleep(300);
  }
  say(`<b>Done — booked ${booked}, skipped ${skipped}, failed ${failed}.</b>`, "#9fd");
})(); void 0;
