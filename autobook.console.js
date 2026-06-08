/* =========================================================================
 * Mapiq desk auto-booker  —  DevTools console version  (RECOMMENDED)
 * =========================================================================
 *
 * Books ONE desk for every available office day in your booking window,
 * in one go. Built from the real API flow the app uses:
 *
 *   1. POST /api/v2/shifts/me/login        -> your limits + default building
 *   2. GET  /api/v2/me/workdays            -> your office days (each has the
 *                                             `id` used as `workdayId`)
 *   3. GET  /api/v2/me/workspace-reservations  -> what you've already booked
 *   4. (per day, if no office day yet) POST /api/v2/me/workdays  -> register it
 *   5. POST /api/v2/me/workspace-reservations  -> book the desk
 *
 * WHY THE CONSOLE: same-origin (no CORS), CSP-exempt (bookmarklets are
 * blocked), and it reads your Bearer token straight from MSAL localStorage,
 * so there's nothing to paste and no token-expiry hassle.
 *
 * HOW TO USE:
 *   1. Log in to https://app.mapiq.com.
 *   2. DevTools (F12) -> Console.
 *   3. Set DESK_NODE_ID below to your desk id.
 *   4. Paste this whole file, press Enter. Read the printed table.
 *   Tip: save as a DevTools Snippet (Sources -> Snippets) for one-click reruns.
 * ========================================================================= */

(async () => {
  // ============================ CONFIG ============================
  const DESK_NODE_ID = "27a000d2-a0fd-4da8-8c6c-69ad2e5453b4"; // <-- your desk id
  const DAYS_AHEAD   = null;   // null = use your account limit (e.g. 14). Or set a number.
  const INCLUDE_WEEKENDS = false;       // weekdays only by default
  const CREATE_MISSING_WORKDAYS = true; // register an office day if none exists for a date
  const DRY_RUN      = false;  // true = show the plan, send nothing
  const DELAY_MS     = 350;    // pause between calls
  // ===============================================================

  const API = "https://app.mapiq.com/api/v2";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pad = n => String(n).padStart(2, "0");
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const tryParse = t => { try { return JSON.parse(t); } catch { return t; } };
  const DOW = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };

  // ---- 1. Bearer token from MSAL localStorage ----
  function findToken() {
    let best = null, bestExp = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), v = localStorage.getItem(k);
      if (!v) continue;
      let secret = null;
      try { const o = JSON.parse(v); if (o && o.credentialType === "AccessToken" && o.secret) secret = o.secret; } catch {}
      if (!secret && /accesstoken/i.test(k || "") && v.split(".").length === 3) secret = v;
      if (!secret) continue;
      try {
        const c = JSON.parse(atob(secret.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (c.exp && c.exp > bestExp) { best = secret; bestExp = c.exp; }
      } catch { if (!best) best = secret; }
    }
    return best;
  }
  let token = findToken();
  if (!token) token = prompt("Couldn't auto-find token. Paste it (Network tab -> any /api/v2 call -> authorization):");
  if (!token) { console.error("[mapiq] No token — aborting."); return; }
  token = token.replace(/^Bearer\s+/i, "").trim();
  try {
    const c = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const mins = c.exp ? Math.round((c.exp * 1000 - Date.now()) / 60000) : "?";
    console.log(`[mapiq] Token for ${c.email || c.name || "user"} — expires in ${mins} min.`);
    if (mins !== "?" && mins <= 0) console.warn("[mapiq] Token looks EXPIRED — reload app.mapiq.com and retry.");
  } catch {}

  const headers = {
    "authorization": "Bearer " + token,
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "x-api-version": "2.0",
  };
  const api = (method, path, body) => fetch(API + path, {
    method, headers, credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // ---- 2. Who am I / limits / default building ----
  let buildingId = null, daysAhead = DAYS_AHEAD ?? 14, regDays = [1, 2, 3, 4, 5];
  try {
    const r = await api("POST", "/shifts/me/login", {});
    if (r.ok) {
      const me = await r.json();
      buildingId = me.defaultBuildingId || buildingId;
      const ap = me.effectiveAccessProfile || me.accessProfile;
      if (ap) {
        if (DAYS_AHEAD == null && ap.daysAhead) daysAhead = ap.daysAhead;
        if (Array.isArray(ap.registrationDays) && ap.registrationDays.length)
          regDays = ap.registrationDays.map(n => DOW[n]).filter(n => n !== undefined);
      }
      console.log(`[mapiq] ${me.firstName || ""} ${me.lastName || ""} — building ${buildingId}, ` +
                  `${daysAhead} days ahead, days [${ap?.registrationDays?.join(", ")}].`);
    }
  } catch (e) { console.warn("[mapiq] login lookup failed, using defaults:", e); }

  // ---- 3. Date range + existing data ----
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + daysAhead);
  const q = `startDate=${fmt(start)}T00:00&endDate=${fmt(end)}T00:00`;

  const workdayByDate = {};       // date -> workdayId
  const reservedByDate = {};      // date -> {deskId, deskName}
  const closedDates = new Set();  // building closed days
  try {
    const r = await api("GET", `/me/workdays?${q}`);
    if (r.ok) for (const w of await r.json()) {
      if (!buildingId && w.buildingId) buildingId = w.buildingId;
      workdayByDate[String(w.localStart).slice(0, 10)] = w.id;
    }
  } catch {}
  try {
    const r = await api("GET", `/me/workspace-reservations?${q}`);
    if (r.ok) for (const v of await r.json()) {
      if (!buildingId && v.workspace?.buildingId) buildingId = v.workspace.buildingId;
      reservedByDate[String(v.localStart).slice(0, 10)] =
        { deskId: v.workspace?.nodeId, deskName: v.workspace?.deskName };
    }
  } catch {}
  try {
    const r = await api("GET", `/shifts/me/openingdayexceptions?from=${fmt(start)}&to=${fmt(end)}`);
    if (r.ok) for (const x of await r.json()) {
      const ds = String(x.date || x.localStart || x.day || "").slice(0, 10);
      if (ds && (x.isClosed ?? x.closed ?? true)) closedDates.add(ds);
    }
  } catch {}

  // ---- 4. Target days ----
  const days = [];
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const dow = d.getDay();
    if (!INCLUDE_WEEKENDS && !regDays.includes(dow)) continue;
    if (closedDates.has(fmt(d))) continue;
    days.push(d);
  }
  console.log(`[mapiq] ${DRY_RUN ? "DRY RUN — " : ""}target desk ${DESK_NODE_ID} for ${days.length} day(s): ` +
              `${fmt(start)} … ${fmt(end)}`);

  // ---- 5. Ensure workday + book desk, per day ----
  const results = [];
  for (const d of days) {
    const ds = fmt(d);
    const localStart = ds + "T00:00:00", localEnd = ds + "T23:59:00";

    // already have a reservation that day?
    const existing = reservedByDate[ds];
    if (existing) {
      const same = existing.deskId === DESK_NODE_ID;
      results.push({ date: ds, status: same ? "already booked (this desk)" : `already booked (${existing.deskName})`, detail: "skipped" });
      continue;
    }

    // ensure an office day (workday) exists
    let workdayId = workdayByDate[ds];
    if (!workdayId) {
      if (!CREATE_MISSING_WORKDAYS) { results.push({ date: ds, status: "no office day", detail: "set CREATE_MISSING_WORKDAYS=true" }); continue; }
      if (DRY_RUN) { results.push({ date: ds, status: "would create office day + book", detail: "" }); continue; }
      if (!buildingId) { results.push({ date: ds, status: "skip", detail: "no buildingId resolved" }); continue; }
      try {
        // Inferred from the GET /me/workdays shape — verify if it ever 4xx's.
        const r = await api("POST", "/me/workdays", { localStart, localEnd, buildingId, status: "OfficeDay" });
        const data = tryParse(await r.text());
        if (!r.ok) { results.push({ date: ds, status: `workday FAIL ${r.status}`, detail: typeof data === "string" ? data : JSON.stringify(data) }); continue; }
        workdayId = data?.id;
        await sleep(DELAY_MS);
      } catch (e) { results.push({ date: ds, status: "workday ERROR", detail: String(e) }); continue; }
    } else if (DRY_RUN) {
      results.push({ date: ds, status: "would book (office day exists)", detail: "" }); continue;
    }

    // book the desk
    try {
      const body = { localStart, localEnd, nodeId: DESK_NODE_ID, invitations: [] };
      if (workdayId) body.workdayId = workdayId;
      const r = await api("POST", "/me/workspace-reservations", body);
      const data = tryParse(await r.text());
      results.push({
        date: ds,
        status: r.ok ? "BOOKED ✅" : `FAIL ${r.status}`,
        detail: r.ok ? (data?.workspace?.deskName ?? "") : (typeof data === "string" ? data : JSON.stringify(data)),
      });
    } catch (e) { results.push({ date: ds, status: "ERROR", detail: String(e) }); }
    await sleep(DELAY_MS);
  }

  console.table(results);
  const booked = results.filter(r => /BOOKED|would/.test(r.status)).length;
  console.log(`[mapiq] Done — ${booked}/${results.length} ${DRY_RUN ? "planned" : "booked"}. Full detail:`, results);
})();
