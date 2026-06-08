# mq_autobooker

Book your Mapiq desk for **every available day in one click**, instead of
clicking through the calendar day by day.

> **Educational / hobby demo — use at your own risk.** Not affiliated with,
> endorsed by, or supported by Mapiq. Use it in line with your organisation's
> policies and Mapiq's terms. It runs entirely in your browser, talks only to
> `app.mapiq.com`, and stores nothing.

## Quick start (bookmarklet)

`index.html` is a self-contained **install page**. Open it (or host it on
GitHub Pages and share the link), then:

1. Drag the **“Mapiq: book all days”** button to your bookmarks bar.
2. Open <https://app.mapiq.com> and log in.
3. Click the bookmark. A small panel books each available day and reports
   **Done**.

No DevTools, no desk id to look up — it books the **same desk as your most
recent booking** and skips days you've already booked, so it's safe to re-run
weekly as the window rolls forward.

## How it works (verified against the live API)

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

- A **"workday" = a day you've marked as an office day.** `GET /me/workdays`
  returns them, and each one's `id` is exactly the `workdayId` a desk booking
  needs. A reservation must be tied to a workday, so booking a brand-new day is
  two steps: create the office day, then book the desk — the tool does both.
- Your booking window comes from `shifts/me/login` (`effectiveAccessProfile`):
  typically `daysAhead: 14`, `registrationDays: Mon–Fri`. The tool respects it
  and skips weekends and building-closed days.
- **Desk selection** follows your *most recent* desk reservation (looked up over
  the last ~30 days, including just-cancelled ones, so it survives deleting all
  upcoming bookings). Book a different desk once and the next run follows it.
- **Cancelled reservations** are ignored (Mapiq keeps them ~30 days with a
  cancelled status), so a day you deleted re-books cleanly.

## Privacy & security

- **Stores nothing** — no token, no desk id written to disk.
- Reads the Mapiq session token already in your logged-in tab and uses it only
  to call Mapiq's own API. **No third-party requests, no tracking.**
- The install page loads no external fonts/scripts — fully self-contained.

## Power-user alternative: console script

`autobook.console.js` does the same thing from the DevTools console (auto-reads
the token, configurable `DESK_NODE_ID` / `DAYS_AHEAD` / `DRY_RUN`, prints a
live table). Handy for debugging or one-off runs without touching a bookmark.
Paste it into the console on app.mapiq.com; set `DRY_RUN = true` first to
preview.

## Developing

- `bookmarklet.src.js` — readable source for the bookmarklet.
- `build-bookmarklet.mjs` — run `node build-bookmarklet.mjs` to regenerate
  `index.html` (it minifies the source and embeds it as the bookmark URL).
- Edit the source, rebuild, commit `index.html`.

## Notes

- Bookings go out sequentially with a small delay to be gentle on the API.
- Already-booked days are skipped; unavailable days show a failure row.
- `GET /me/workdays` 400s on wide/past date ranges, so it's only ever queried
  for the forward window.
