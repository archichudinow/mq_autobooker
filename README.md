# mq_autobooker

Book your Mapiq desk for **every available day in one shot**, instead of
clicking through the calendar day by day.

Reverse-engineered from a HAR capture of app.mapiq.com. Booking a desk is a
single API call per day:

```
POST https://app.mapiq.com/api/v2/me/workspace-reservations
authorization: Bearer <your token>
x-api-version: 2.0
content-type: application/json

{ "localStart": "2026-06-09T00:00:00",
  "localEnd":   "2026-06-09T23:59:00",
  "nodeId":     "<desk id>",
  "invitations": [],
  "workdayId":  "yLbAMW2qkbn2" }
```

So the whole tool is just: loop over dates → fire this POST with your desk id.

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
   - `WEEKS_AHEAD`, `SKIP_WEEKENDS`, `DRY_RUN` as you like.
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
- **`workdayId`.** The captured payload included a per-day `workdayId`. It's
  unclear whether the server actually requires it. Both tools try to
  auto-discover the date→workdayId map from the calendar API; if that fails
  they book with just date + desk id and show you the exact server response
  per day. If it turns out to be required, you'll see the error immediately —
  capture the calendar request and we can wire the real endpoint in (or fill
  `WORKDAY_OVERRIDES` manually).

## Notes

- Bookings are sent sequentially with a small delay to be gentle on the API.
- Days already booked / unavailable just show a failure row; the rest still go
  through.
- Only books your own desk for yourself (`invitations: []`).
