# mq_autobooker

Book your Mapiq desk for **every available day in one shot**, instead of
clicking through the calendar day by day.

Reverse-engineered from HAR captures of app.mapiq.com. The tool replays the
app's real flow:

```
1. POST /api/v2/shifts/me/login               -> your limits + default building
2. GET  /api/v2/me/workdays?startDate&endDate -> your office days; each has the
                                                 `id` used as workdayId + dates
3. GET  /api/v2/me/workspace-reservations?…   -> what you've already booked
4. POST /api/v2/me/workdays                    -> register an office day for a
   (only when a date has none yet)               date you haven't planned
5. POST /api/v2/me/workspace-reservations      -> book the desk:
   { "localStart":"2026-06-09T00:00:00", "localEnd":"2026-06-09T23:59:00",
     "nodeId":"<desk id>", "invitations":[], "workdayId":"yLbAMW2qkbn2" }
```

### How the dates / workdayId work (the part that confused us at first)

- A **"workday" = a day you've marked as an office day.** `GET /me/workdays`
  returns them, and each one's `id` is exactly the `workdayId` the desk booking
  needs. So the workday list *is* your set of bookable days, with the precise
  `localStart`/`localEnd` and id.
- A desk reservation must be tied to a workday for that date, so booking a
  brand-new day is two steps: create the office day, then book the desk. The
  tool does both.
- Your booking window comes from `POST /shifts/me/login`
  (`effectiveAccessProfile`): typically `daysAhead: 14`, `registrationDays:
  Mon–Fri`. The tool reads these and only targets days you're actually allowed
  to book, skipping weekends and building-closed days.

## Which version to use

| | `autobook.console.js` (recommended) | `index.html` (static page) |
|---|---|---|
| Where it runs | DevTools console on app.mapiq.com | any browser / open the file directly |
| Token | **auto-read** from your login (MSAL localStorage) | you **paste it** (snippet provided) |
| CORS / CSP | none — same origin, console is CSP-exempt | relies on the API's `access-control-allow-origin: *`; may hit a preflight from `file://` |
| Best for | just works, re-run with one click | a friendlier UI, or sharing with non-devs |

Both do the same thing and share the same logic. **Start with the console
script** — it sidesteps every blocker.

## Usage — console script (recommended)

1. Log in to <https://app.mapiq.com>.
2. Open DevTools (**F12**) → **Console**.
3. Edit the top of `autobook.console.js`:
   - `DESK_NODE_ID` — your desk id (the `nodeId` in the booking call, e.g.
     `27a000d2-…`).
   - `DAYS_AHEAD` (`null` = use your account limit), `INCLUDE_WEEKENDS`,
     `CREATE_MISSING_WORKDAYS`, `DRY_RUN` as you like.
4. Paste the whole file into the console, press **Enter**.
5. Read the printed table. Set `DRY_RUN = true` first if you want to preview.

Save it as a DevTools **Snippet** (Sources → Snippets → New) to re-run with a
single click next time.

## Usage — static page

1. Open `index.html` (double-click it, or host it anywhere).
2. Follow the expandable "How to get your token" box — it gives you a one-line
   console snippet that copies your token to the clipboard.
3. Paste token + desk id, set the range, click **Book all available days**.

Inputs are remembered in the page's own localStorage.

## Finding your desk id

In the booking request the desk is `nodeId`. To grab yours: book one day
manually with DevTools → Network open, click the
`me/workspace-reservations` POST, and copy `nodeId` from the payload (or
`workspace.deskId` from the response). It's a GUID like
`27a000d2-a0fd-4da8-8c6c-69ad2e5453b4`.

## Blockers & how they're handled

- **Auth is a Bearer token, not just your cookie.** It's an Azure AD B2C /
  MSAL access token (~1 hour lifetime) kept in `localStorage`. The console
  script reads it automatically; the static page asks you to paste it.
- **CSP `script-src 'self'`** on the app blocks bookmarklets — but **not** the
  DevTools console, which is why the console version is the reliable path.
- **`workdayId` (solved).** It's `workday.id` from `GET /me/workdays` — the
  tools fetch it, no guessing.
- **Creating office days.** The one endpoint not directly seen in a capture is
  the *create* call. The tools POST to `/me/workdays` with
  `{ localStart, localEnd, buildingId, status:"OfficeDay" }`, inferred from the
  GET response shape. If your org disables booking-ahead or this 4xx's, you'll
  see it in the per-day result; set `CREATE_MISSING_WORKDAYS = false` to only
  book days you've already marked as office days. (Want it nailed down exactly?
  Capture the network while you mark a new office day in the UI and we'll lock
  the payload.)

## Notes

- Bookings are sent sequentially with a small delay to be gentle on the API.
- Already-booked days are skipped; unavailable days show a failure row; the
  rest still go through.
- Respects your account's booking window (`daysAhead`, `registrationDays`) and
  skips building-closed days.
- Only books your own desk for yourself (`invitations: []`).
- **Run with `DRY_RUN` first** to preview exactly what it will create/book.
