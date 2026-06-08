// Generates bookmarklet.html (the shareable install page) from bookmarklet.src.js.
// Usage: node build-bookmarklet.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("./bookmarklet.src.js", import.meta.url), "utf8");

// Strip /* block */ and // line comments, collapse whitespace — conservative,
// the source avoids regex/strings that would break this.
const min = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n")
  .replace(/\s+/g, " ").trim();

const href = "javascript:" + encodeURIComponent(min);

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mapiq one-click auto-booker</title>
<style>
 :root{color-scheme:light dark}
 body{font:16px/1.6 system-ui,Segoe UI,sans-serif;max-width:680px;margin:2.5rem auto;padding:0 1.1rem}
 h1{font-size:1.5rem} h2{font-size:1.1rem;margin-top:2rem}
 .btn{display:inline-block;background:#2d6cdf;color:#fff;text-decoration:none;font-weight:700;
      padding:.7rem 1.2rem;border-radius:10px;margin:.4rem 0}
 ol{padding-left:1.2rem} li{margin:.4rem 0}
 .tip{background:#8881;border-radius:10px;padding:.8rem 1rem;margin:1rem 0}
 code{background:#8882;padding:.1rem .35rem;border-radius:5px}
 kbd{background:#8883;border-radius:4px;padding:0 .3rem}
</style></head><body>

<h1>📅 Mapiq one-click auto-booker</h1>
<p>Books your desk for <b>every available day</b> in your booking window — instead of
clicking through the calendar day by day.</p>

<h2>Install (once)</h2>
<ol>
 <li>Make your <b>Bookmarks bar</b> visible (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>).</li>
 <li>Drag this button onto it:&nbsp; <a class="btn" href="${href}">Mapiq: book all days</a></li>
</ol>
<p class="tip">Can't drag? Right-click your bookmarks bar → <b>Add page / New bookmark</b>,
put any name, and paste the button's link as the URL.</p>

<h2>Use (any time)</h2>
<ol>
 <li>Open <a href="https://app.mapiq.com" target="_blank">app.mapiq.com</a> and log in.</li>
 <li>Click the <b>“Mapiq: book all days”</b> bookmark.</li>
 <li>Confirm the popup. Watch the little panel book each day, then say <b>Done</b>.</li>
</ol>

<h2>Good to know</h2>
<ul>
 <li><b>It follows your “same desk” pattern.</b> No desk setup needed — it books the
     <b>same desk as your most recent booking</b>. So book your preferred desk once (any
     day) and the bookmark repeats it across every available day.</li>
 <li><b>First time / no bookings yet?</b> Book one day manually first, then click the
     bookmark — it’ll copy that desk to the rest.</li>
 <li><b>To switch desks:</b> just book the new desk manually once, then click the bookmark —
     it always follows your latest booking.</li>
 <li><b>Safe to click again</b> — already-booked days are skipped, so re-run it weekly as
     new days open up (you can book ~2 weeks ahead).</li>
 <li>It only books <b>your own</b> desk for <b>you</b>; nothing is sent anywhere except Mapiq.</li>
</ul>
</body></html>
`;

writeFileSync(new URL("./bookmarklet.html", import.meta.url), html);
console.log(`bookmarklet.html written — bookmarklet is ${href.length} chars.`);
