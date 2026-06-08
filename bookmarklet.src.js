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
 * it by build-bookmarklet.mjs and embedded into index.html (the install page).
 * ========================================================================= */

(async () => {
  "use strict";
  const API = "https://app.mapiq.com/api/v2";

  // ---- on-page overlay (so colleagues don't need the console) ----
  if (location.host !== "app.mapiq.com") {
    alert("Open app.mapiq.com (and log in) first, then click this bookmark.");
    return;
  }
  const dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  const C = dark
    ? { bg: "#1a1916", fg: "#ecebe4", mut: "#9c9a90", line: "#2b2a26", head: "#100f0d" }
    : { bg: "#ffffff", fg: "#16150f", mut: "#8a8880", line: "#e4e2da", head: "#f7f6f2" };
  const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
  const SANS = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  document.getElementById("mqab")?.remove();
  const box = document.createElement("div");
  box.id = "mqab";
  box.style.cssText = `position:fixed;top:18px;right:18px;z-index:2147483647;width:300px;max-height:80vh;display:flex;flex-direction:column;background:${C.bg};color:${C.fg};font-family:${SANS};font-size:13px;line-height:1.55;border:1px solid ${C.line};border-radius:8px;box-shadow:0 14px 44px rgba(0,0,0,.20);overflow:hidden`;
  box.innerHTML =
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 15px;background:${C.head};border-bottom:1px solid ${C.line}">` +
    `<span style="font-family:${SERIF};font-weight:500;font-size:15px">Mapiq auto-booker</span>` +
    `<span id="mqab-x" style="cursor:pointer;color:${C.mut};font-size:18px;line-height:1">&times;</span></div>` +
    `<div id="mqab-body" style="padding:11px 15px;overflow:auto"></div>`;
  document.body.appendChild(box);
  box.querySelector("#mqab-x").onclick = () => box.remove();
  const body = box.querySelector("#mqab-body");
  const STYLE = {
    info: `color:${C.fg}`,
    muted: `color:${C.mut}`,
    ok: `color:${C.fg};font-weight:600`,
    bad: `color:${C.fg};font-weight:600;text-decoration:underline`,
    done: `color:${C.fg};font-weight:600;border-top:1px solid ${C.line};margin-top:9px;padding-top:9px`,
  };
  const say = (html, kind) => { const p = document.createElement("div"); p.style.cssText = "margin:3px 0;" + (STYLE[kind] || STYLE.info); p.innerHTML = html; body.appendChild(p); body.scrollTop = body.scrollHeight; return p; };
  const fail = msg => say("&times; " + msg, "bad");

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

  say("Signed in as <b>" + email + "</b>", "muted");

  // ---- account limits + building ----
  let buildingId = null, daysAhead = 14, regDays = [1, 2, 3, 4, 5];
  try {
    const r = await api("POST", "/shifts/me/login", {});
    if (r.ok) { const me = await r.json(); buildingId = me.defaultBuildingId; const ap = me.effectiveAccessProfile || me.accessProfile; if (ap) { if (ap.daysAhead) daysAhead = ap.daysAhead; if (ap.registrationDays?.length) regDays = ap.registrationDays.map(n => DOW[n]).filter(n => n !== undefined); } }
  } catch {}

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(today.getDate() + daysAhead);
  const look = new Date(today); look.setDate(today.getDate() - 30);
  // Workdays endpoint 400s on wide/past ranges -> forward only. Reservations
  // tolerates a lookback, which we use to detect your most-recent desk.
  const q = `startDate=${fmt(today)}T00:00&endDate=${fmt(end)}T00:00`;
  const qRes = `startDate=${fmt(look)}T00:00&endDate=${fmt(end)}T00:00`;

  // ---- existing workdays + reservations ----
  const workdayByDate = {}, reservedByDate = {}, closed = new Set();
  let rawRes = [];
  try { const r = await api("GET", `/me/workdays?${q}`); if (r.ok) for (const w of await r.json()) { if (!buildingId && w.buildingId) buildingId = w.buildingId; workdayByDate[String(w.localStart).slice(0, 10)] = w.id; } } catch {}
  try { const r = await api("GET", `/me/workspace-reservations?${qRes}`); if (r.ok) rawRes = await r.json(); } catch {}
  for (const v of rawRes) { const ds = String(v.localStart).slice(0, 10); if (isActive(v) && ds >= fmt(today)) reservedByDate[ds] = { deskId: v.workspace?.nodeId, deskName: v.workspace?.deskName }; }
  try { const r = await api("GET", `/shifts/me/openingdayexceptions?from=${fmt(today)}&to=${fmt(end)}`); if (r.ok) for (const x of await r.json()) { const ds = String(x.date || x.localStart || x.day || "").slice(0, 10); if (ds) closed.add(ds); } } catch {}

  // ---- which desk to book: follow your MOST RECENT desk booking ----
  // Uses recent reservations (incl. just-cancelled), so it tracks the desk you
  // last chose and survives deleting all upcoming bookings.
  // Privacy: we deliberately store NOTHING (no token, no desk) on the device.
  let deskId = "", deskName = "";
  const deskRes = rawRes.filter(v => v.workspace?.nodeType === "Desk" && v.workspace?.nodeId);
  if (deskRes.length) {
    deskRes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); // newest first
    deskId = deskRes[0].workspace.nodeId; deskName = deskRes[0].workspace.deskName;
  }
  if (!deskId) {
    deskId = (prompt("Couldn't detect your desk. Book one day manually in Mapiq first, then click again — or paste your desk id here:") || "").trim();
    if (!deskId) { fail("No desk selected — nothing to do."); return; }
    deskName = "your desk";
  }

  // ---- target days ----
  const days = [];
  for (let i = 0; i <= daysAhead; i++) { const d = new Date(today); d.setDate(today.getDate() + i); if (!regDays.includes(d.getDay())) continue; if (closed.has(fmt(d))) continue; days.push(d); }

  if (!confirm(`Book ${deskName || "your desk"} for all available days (${fmt(today)} … ${fmt(end)})?\n\nAlready-booked days are skipped.`)) { say("Cancelled.", "muted"); return; }
  say(`Booking <b>${deskName || deskId}</b> for ${days.length} day(s)…`);

  // ---- ensure office day + book desk, per day ----
  let booked = 0, skipped = 0, failed = 0;
  for (const d of days) {
    const ds = fmt(d), localStart = ds + "T00:00:00", localEnd = ds + "T23:59:00";
    const ex = reservedByDate[ds];
    if (ex) { skipped++; say(`${ds} — already booked (${ex.deskName || "desk"})`, "muted"); continue; }
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
      if (r.ok) { booked++; say(`${ds} — booked ✓`, "ok"); }
      else { failed++; const t = await r.text(); fail(`${ds} — failed (${r.status}) ${String(t).slice(0, 80)}`); }
    } catch (e) { failed++; fail(`${ds} — error`); }
    await sleep(300);
  }
  say(`Done — booked ${booked}, skipped ${skipped}, failed ${failed}.`, "done");
})(); void 0;
