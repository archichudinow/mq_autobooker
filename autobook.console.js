/* =========================================================================
 * Mapiq desk auto-booker  —  DevTools console version  (RECOMMENDED)
 * =========================================================================
 *
 * Books ONE desk for every (week)day in a date range, in one go.
 *
 * WHY THE CONSOLE:
 *   - Same-origin as the API  -> no CORS preflight headaches.
 *   - Not blocked by the app's CSP (`script-src 'self'`) — the console is
 *     exempt; a bookmarklet would be blocked.
 *   - It can read your Bearer token straight from MSAL localStorage, so you
 *     never copy/paste a token and never fight the ~1h expiry.
 *
 * HOW TO USE:
 *   1. Log in to https://app.mapiq.com in your browser.
 *   2. Open DevTools (F12) -> Console tab.
 *   3. Set DESK_NODE_ID below to your desk id.
 *   4. Paste this whole file into the console and press Enter.
 *   5. Read the printed table. Re-run any time.
 *
 *   Tip: save it as a DevTools "Snippet" (Sources -> Snippets) to re-run
 *   with one click later.
 * ========================================================================= */

(async () => {
  // ============================ CONFIG ============================
  const DESK_NODE_ID = "27a000d2-a0fd-4da8-8c6c-69ad2e5453b4"; // <-- your desk id
  const WEEKS_AHEAD  = 4;      // how far forward to book
  const START_DATE   = null;   // null = today, or "2026-06-09"
  const SKIP_WEEKENDS = true;  // don't try Sat/Sun
  const DRY_RUN      = false;  // true = show what WOULD be booked, send nothing
  const DELAY_MS     = 350;    // pause between bookings (be polite to the API)
  // ===============================================================

  const API = "https://app.mapiq.com/api/v2";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pad = n => String(n).padStart(2, "0");
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const tryParse = t => { try { return JSON.parse(t); } catch { return t; } };

  // ---- 1. Find the Bearer token (MSAL cache in localStorage) ----
  function findToken() {
    let best = null, bestExp = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      if (!v) continue;
      let secret = null;
      try {
        const o = JSON.parse(v);
        if (o && o.credentialType === "AccessToken" && o.secret) secret = o.secret;
      } catch { /* not json */ }
      if (!secret && /accesstoken/i.test(k || "") && (v.split(".").length === 3)) secret = v;
      if (!secret) continue;
      // prefer the token with the latest expiry that targets the mapiq API
      try {
        const claims = JSON.parse(atob(secret.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (claims.exp && claims.exp > bestExp) { best = secret; bestExp = claims.exp; }
      } catch { if (!best) best = secret; }
    }
    return best;
  }

  let token = findToken();
  if (!token) {
    token = prompt(
      "Couldn't auto-find your token in localStorage.\n" +
      "Open Network tab, click any /api/v2 request, copy the value after " +
      "'authorization: Bearer ' and paste it here:"
    );
  }
  if (!token) { console.error("[mapiq] No token — aborting."); return; }
  token = token.replace(/^Bearer\s+/i, "").trim();

  // expiry sanity check
  try {
    const c = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (c.exp) {
      const mins = Math.round((c.exp * 1000 - Date.now()) / 60000);
      console.log(`[mapiq] Token for ${c.email || c.name || "user"} — expires in ${mins} min.`);
      if (mins <= 0) console.warn("[mapiq] Token looks EXPIRED — reload app.mapiq.com and retry.");
    }
  } catch { /* ignore */ }

  const headers = {
    "authorization": "Bearer " + token,
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "x-api-version": "2.0",
  };

  // ---- 2. Best-effort: map each date -> workdayId from the calendar API ----
  // The booking payload carried a "workdayId". We don't know for sure it's
  // required, so we try to discover it; if we can't, we book without it and
  // let the server tell us. Fill WORKDAY_OVERRIDES manually if discovery fails.
  const WORKDAY_OVERRIDES = {
    // "2026-06-09": "yLbAMW2qkbn2",
  };

  async function discoverWorkdays(fromD, toD) {
    const from = fmt(fromD), to = fmt(toD);
    const candidates = [
      `${API}/me/workdays?startDate=${from}T00:00:00&endDate=${to}T23:59:00`,
      `${API}/me/workdays?from=${from}&to=${to}`,
      `${API}/me/workdays`,
      `${API}/me/calendar?startDate=${from}T00:00:00&endDate=${to}T23:59:00`,
      `${API}/shifts/me/workdays?startDate=${from}T00:00:00&endDate=${to}T23:59:00`,
    ];
    const map = {};
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers, credentials: "include" });
        if (!r.ok) continue;
        const data = await r.json();
        // walk the JSON for objects that look like { date..., id/workdayId... }
        const stack = [data];
        while (stack.length) {
          const node = stack.pop();
          if (Array.isArray(node)) { stack.push(...node); continue; }
          if (node && typeof node === "object") {
            const id = node.workdayId || node.id;
            const dateStr = node.date || node.localStart || node.day || node.start;
            if (id && typeof id === "string" && dateStr && /^\d{4}-\d{2}-\d{2}/.test(String(dateStr))) {
              map[String(dateStr).slice(0, 10)] = id;
            }
            for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
          }
        }
        if (Object.keys(map).length) {
          console.log(`[mapiq] Discovered ${Object.keys(map).length} workdayIds via ${url.split("?")[0]}`);
          return map;
        }
      } catch { /* try next candidate */ }
    }
    console.warn("[mapiq] Could not auto-discover workdayIds — booking without them " +
                 "(if the server requires them you'll see it in the results).");
    return {};
  }

  // ---- 3. Build the list of target days ----
  const start = START_DATE ? new Date(START_DATE + "T00:00:00") : new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + WEEKS_AHEAD * 7 - 1);

  const days = [];
  for (let i = 0; i < WEEKS_AHEAD * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const dow = d.getDay();
    if (SKIP_WEEKENDS && (dow === 0 || dow === 6)) continue;
    days.push(d);
  }

  const workdayMap = { ...(await discoverWorkdays(start, end)), ...WORKDAY_OVERRIDES };

  console.log(`[mapiq] ${DRY_RUN ? "DRY RUN — " : ""}booking desk ${DESK_NODE_ID} ` +
              `for ${days.length} day(s): ${fmt(start)} … ${fmt(end)}`);

  // ---- 4. Book each day ----
  const results = [];
  for (const d of days) {
    const ds = fmt(d);
    const body = {
      localStart: ds + "T00:00:00",
      localEnd:   ds + "T23:59:00",
      nodeId:     DESK_NODE_ID,
      invitations: [],
    };
    if (workdayMap[ds]) body.workdayId = workdayMap[ds];

    if (DRY_RUN) { results.push({ date: ds, status: "DRY_RUN", desk: "-", info: JSON.stringify(body) }); continue; }

    try {
      const r = await fetch(`${API}/me/workspace-reservations`, {
        method: "POST", headers, credentials: "include", body: JSON.stringify(body),
      });
      const data = tryParse(await r.text());
      results.push({
        date: ds,
        status: r.ok ? "BOOKED ✅" : `FAIL ${r.status}`,
        desk: r.ok ? (data?.workspace?.deskName ?? "?") : "-",
        info: r.ok ? (data?.status ?? "") : (typeof data === "string" ? data : JSON.stringify(data)),
      });
    } catch (e) {
      results.push({ date: ds, status: "ERROR", desk: "-", info: String(e) });
    }
    await sleep(DELAY_MS);
  }

  console.table(results);
  const ok = results.filter(r => /BOOKED|DRY_RUN/.test(r.status)).length;
  console.log(`[mapiq] Done — ${ok}/${results.length} ${DRY_RUN ? "would book" : "booked"}. Full detail:`, results);
})();
