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
  let deskId = "", deskName = "", deskLoc = "", areaId = "";
  const deskRes = rawRes.filter(v => v.workspace?.nodeType === "Desk" && v.workspace?.nodeId);
  if (deskRes.length) {
    deskRes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); // newest first
    const w = deskRes[0].workspace;
    deskId = w.nodeId; deskName = w.deskName || w.nodeName || "your desk";
    deskLoc = [w.areaName, w.floorName, w.buildingName].filter(Boolean).join(" · ");
    areaId = w.areaId || "";
  }
  if (!deskId) {
    deskId = (prompt("Couldn't detect your desk. Book one day manually in Mapiq first, then click again — or paste your desk id here:") || "").trim();
    if (!deskId) { fail("No desk selected — nothing to do."); return; }
    deskName = "your desk";
  }

  // ---- target days ----
  const days = [];
  for (let i = 0; i <= daysAhead; i++) { const d = new Date(today); d.setDate(today.getDate() + i); if (!regDays.includes(d.getDay())) continue; if (closed.has(fmt(d))) continue; days.push(d); }

  say(`Desk: <b>${deskName}</b>`, "info");
  if (deskLoc) say(deskLoc, "muted");

  // A desk taken by someone else isn't an error — show it gently, not red.
  const isTaken = (status, text) => status === 409 ||
    /taken|occup|unavail|not available|already (booked|reserved|taken)|fully booked|no (capacity|availability|space)|capacity|full|in use|reserved by/i.test(text || "");
  // Pre-check: is OUR desk already full that day? Returns true=taken, false=free,
  // null=couldn't tell (then we just try, as before). Skips taken days before
  // creating an office day, so we never leave you "in office" with no desk.
  const deskTaken = async (ds) => {
    if (!areaId) return null;
    try {
      const r = await api("GET", `/workspace-reservations/count?groupUpTo=Desk&nodeId=${areaId}&startDate=${ds}T00:00:00&endDate=${ds}T23:59:00`);
      if (!r.ok) return null;
      const list = await r.json();
      if (!Array.isArray(list)) return null;
      const mine = list.find(x => (x.deskId || x.nodeId) === deskId);
      return mine ? (mine.booked || 0) >= 1 : false; // not listed => free
    } catch { return null; }
  };

  // ---- the booking run, triggered by the in-panel button (no native popup) ----
  const run = async () => {
    let booked = 0, skipped = 0, taken = 0, failed = 0;
    for (const d of days) {
      const ds = fmt(d), localStart = ds + "T00:00:00", localEnd = ds + "T23:59:00";
      const ex = reservedByDate[ds];
      if (ex) { skipped++; say(`${ds} — already booked (${ex.deskName || "desk"})`, "muted"); continue; }
      if (await deskTaken(ds) === true) { taken++; say(`${ds} — taken by someone else`, "muted"); await sleep(150); continue; }
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
        else {
          const j = tryParse(await r.text());
          const reason = j && j.errors ? Object.entries(j.errors).map(([k, v]) => `${k}: ${[].concat(v).join(", ")}`).join("; ")
            : (j && j.title) ? j.title : (typeof j === "string" ? j : JSON.stringify(j));
          if (isTaken(r.status, reason)) { taken++; say(`${ds} — taken by someone else`, "muted"); }
          else { failed++; fail(`${ds} — ${String(reason).slice(0, 140)}`); }
        }
      } catch (e) { failed++; fail(`${ds} — error`); }
      await sleep(300);
    }
    say(`Done — booked ${booked}, taken ${taken}, skipped ${skipped}, failed ${failed}.`, "done");
  };

  // ---- in-panel Book button ----
  if (!days.length) { say("No bookable days in your window.", "muted"); return; }
  const btn = document.createElement("button");
  btn.textContent = `Book ${days.length} day${days.length === 1 ? "" : "s"} (${fmt(today)} … ${fmt(end)})`;
  btn.style.cssText = `display:block;width:100%;margin:12px 0 2px;padding:9px 12px;cursor:pointer;font-family:${SANS};font-size:13px;font-weight:600;color:${C.bg};background:${C.fg};border:1.5px solid ${C.fg};border-radius:4px`;
  btn.onmouseenter = () => { btn.style.background = "transparent"; btn.style.color = C.fg; };
  btn.onmouseleave = () => { btn.style.background = C.fg; btn.style.color = C.bg; };
  btn.onclick = async () => {
    btn.onmouseenter = btn.onmouseleave = null;
    btn.disabled = true; btn.style.cursor = "default"; btn.style.opacity = ".5"; btn.textContent = "Booking…";
    await run();
    btn.remove();
  };
  body.appendChild(btn);
})(); void 0;
