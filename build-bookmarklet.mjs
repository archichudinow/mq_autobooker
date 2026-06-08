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
 :root{
   --bg:#ffffff; --fg:#16150f; --muted:#5c5b54; --line:#e4e2da; --box:#f7f6f2; --accent:#16150f;
   --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,"Times New Roman",serif;
   --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
 }
 @media (prefers-color-scheme:dark){
   :root{--bg:#100f0d; --fg:#ecebe4; --muted:#9c9a90; --line:#2b2a26; --box:#1a1916; --accent:#ecebe4;}
 }
 *{box-sizing:border-box}
 body{background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:17px;line-height:1.7;
      max-width:660px;margin:0 auto;padding:3.5rem 1.3rem 5rem;-webkit-font-smoothing:antialiased}
 h1{font-family:var(--serif);font-weight:500;font-size:2.4rem;line-height:1.15;letter-spacing:-.01em;margin:0 0 .4rem}
 .lead{font-family:var(--serif);font-size:1.18rem;color:var(--muted);margin:0 0 2.2rem;font-style:italic}
 h2{font-family:var(--serif);font-weight:500;font-size:1.35rem;margin:2.6rem 0 .8rem;
    padding-top:1.4rem;border-top:1px solid var(--line)}
 p{margin:.7rem 0}
 ol,ul{padding-left:1.3rem} li{margin:.5rem 0}
 a{color:var(--fg);text-underline-offset:3px}
 .btn{display:inline-block;font-family:var(--sans);font-weight:600;font-size:1rem;
      border:1.5px solid var(--accent);background:var(--accent);color:var(--bg);
      text-decoration:none;padding:.7rem 1.4rem;border-radius:3px;letter-spacing:.01em;
      transition:background .15s,color .15s}
 .btn:hover{background:transparent;color:var(--accent)}
 .box{background:var(--box);border:1px solid var(--line);border-radius:6px;padding:1rem 1.2rem;margin:1.3rem 0}
 .box.warn{border-left:3px solid var(--accent)}
 .box h3{font-family:var(--serif);font-weight:500;margin:.1rem 0 .5rem;font-size:1.05rem}
 .small{font-size:.92rem;color:var(--muted)}
 code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;
      background:var(--box);border:1px solid var(--line);padding:.08rem .35rem;border-radius:4px}
 kbd{font-family:var(--sans);font-size:.82em;border:1px solid var(--line);border-bottom-width:2px;
     border-radius:4px;padding:.05rem .4rem;background:var(--box)}
 footer{margin-top:3rem;padding-top:1.4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
</style></head><body>

<h1>Mapiq one-click auto-booker</h1>
<p class="lead">Book your desk for every available day in your window — in a single click,
instead of clicking through the calendar one day at a time.</p>

<div class="box warn">
 <h3>Educational / hobby demo — use at your own risk</h3>
 <p class="small">Provided as-is, with no warranty of any kind. Not affiliated with, endorsed by,
 or supported by Mapiq. You are responsible for using it in line with your organisation's
 policies and Mapiq's terms of service.</p>
</div>

<h2>Install &middot; once</h2>
<ol>
 <li>Show your <b>Bookmarks bar</b> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>).</li>
 <li>Drag this onto it:&nbsp; <a class="btn" href="${href}">Mapiq: book all days</a></li>
</ol>
<p class="small">Can't drag? Right-click the bookmarks bar &rarr; <b>Add page</b>, give it any name,
and paste the button's link as the URL.</p>

<h2>Use &middot; any time</h2>
<ol>
 <li>Open <a href="https://app.mapiq.com">app.mapiq.com</a> and log in.</li>
 <li>Click the <b>Mapiq: book all days</b> bookmark.</li>
 <li>Confirm the prompt, then watch the small panel book each day until it says <b>Done</b>.</li>
</ol>

<h2>How your desk is chosen</h2>
<ul>
 <li>It books the <b>same desk as your most recent booking</b> — so reserve your preferred desk
     once (any day) and the bookmark repeats it across every available day.</li>
 <li><b>First time / no bookings yet?</b> Book one day manually, then click the bookmark.</li>
 <li><b>To switch desks:</b> book the new desk manually once — it always follows your latest.</li>
 <li><b>Safe to click again:</b> already-booked days are skipped, so re-run it weekly as new days
     open up (you can typically book ~2 weeks ahead).</li>
</ul>

<h2>Privacy &amp; security</h2>
<p>It runs entirely in your browser. It reads the Mapiq session token already present in your
logged-in tab and uses it <b>only</b> to call Mapiq's own API at <code>app.mapiq.com</code>.</p>
<ul>
 <li><b>Stores nothing</b> — no token, no data saved to your device or anywhere else.</li>
 <li><b>No third parties</b> — it makes no requests to any site other than Mapiq, and contains
     no tracking or analytics.</li>
 <li>It only books <b>your own</b> desk for <b>you</b>.</li>
</ul>

<footer>An independent hobby project. Not affiliated with Mapiq.</footer>
</body></html>
`;

writeFileSync(new URL("./bookmarklet.html", import.meta.url), html);
console.log(`bookmarklet.html written — bookmarklet is ${href.length} chars.`);
