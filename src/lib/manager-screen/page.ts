import type { ManagerScreenFeed } from "./rules";

/**
 * «قناة المدير» — the manager's office TV as a news channel (the owner,
 * 2026-10-19). The same light approach as the office screens
 * (lib/office-screens/page.ts): plain HTML and one ES5 script, no React, the
 * first paint complete from the server, everything that moves derived from the
 * server's clock, errors swallowed into what is on screen.
 *
 *  · the top bar: the logo, a red «مباشر», the Riyadh clock and date, and one
 *    pill — the worst of everything;
 *  · «التقرير الحالي»: the seven panels in turn, 20 s each, tiles in green /
 *    amber / red with their one-line reason;
 *  · «يحتاج تدخلك الآن»: every red item, whichever panel is showing;
 *  · the gold band: the last hours' real events, red ones marked;
 *  · on the hour, 30 s of «ملخص الساعة» — «ملخص اليوم» once the day's summary exists.
 *
 * Internal data, so the route (app/m) serves it only to a dashboard.admin
 * session; the feed itself (api/manager-screen) refuses anyone else.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const LT = new RegExp(String.fromCharCode(60), "g");
const json = (v: unknown) => JSON.stringify(v).replace(LT, `${String.fromCharCode(92)}u003c`).replace(LS, "");

const RUNTIME = String.raw`
(function () {
  var F = window.__F__;
  var offset = F.now - Date.now(), born = Date.now(), lastRender = "", lastPanel = -1, lastTicker = "", lastSummary = "";
  var PANEL_MS = 20000, SPEED = 90;
  var LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
  var DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  var PILL = { green: "كل شيء يسير جيداً", amber: "يحتاج متابعة", red: "يحتاج تدخلك" };
  function now() { return Date.now() + offset; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function two(n) { return n < 10 ? "0" + n : "" + n; }

  function drawClock(t) {
    var d = new Date(t + 10800000);
    $("clock").textContent = two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
    $("date").textContent = DAYS[d.getUTCDay()] + " " + LRI + two(d.getUTCDate()) + "-" + two(d.getUTCMonth() + 1) + "-" + d.getUTCFullYear() + PDI;
  }

  function tile(t) {
    return '<div class="tile s-' + t.status + '"><div class="tl">' + esc(t.label) + '</div><div class="tv">' + esc(t.value) + '</div><div class="tr">' + esc(t.reason) + "</div></div>";
  }

  function drawPanel(t) {
    var n = F.panels.length;
    if (!n) return;
    var i = Math.floor(t / PANEL_MS) % n;
    if (i === lastPanel) return;
    lastPanel = i;
    var p = F.panels[i], tiles = "";
    for (var k = 0; k < p.tiles.length; k++) tiles += tile(p.tiles[k]);
    $("ptitle").innerHTML = '<span class="dot s-' + p.status + '"></span>' + esc(p.title);
    $("tiles").innerHTML = tiles;
    var dots = "";
    for (var j = 0; j < n; j++) dots += '<span class="' + (j === i ? "on" : "") + '"></span>';
    $("dots").innerHTML = dots;
  }

  function drawFixed() {
    var key = F.at + "|" + F.overall + "|" + F.urgent.length;
    if (key === lastRender) return;
    lastRender = key;
    lastPanel = -1;
    var pill = $("pill");
    pill.className = "pill s-" + F.overall;
    pill.textContent = PILL[F.overall] || "";
    var u = "";
    for (var k = 0; k < F.urgent.length; k++) {
      var it = F.urgent[k];
      u += '<li><b>' + esc(it.panelTitle) + " — " + esc(it.label) + ": " + esc(it.value) + "</b><span>" + esc(it.reason) + "</span></li>";
    }
    $("urgent").innerHTML = u || '<li class="calm">لا شيء يحتاج تدخلك الآن</li>';
    $("ucount").textContent = F.urgent.length ? String(F.urgent.length) : "";
    var words = "";
    for (var j = 0; j < F.ticker.length; j++) {
      var e = F.ticker[j];
      words += (j ? '<span class="sep">◆</span>' : "") + '<span class="' + (e.red ? "ti red" : "ti") + '">' + esc(e.text) + "</span>";
    }
    if (words !== lastTicker) { lastTicker = words; $("tick").innerHTML = words || "لا أحداث في الساعات الأخيرة"; }
  }

  // left to right, as an Arabic news ticker; the loop from the clock alone
  function drawTicker(t) {
    var el = $("tick"), w = el.offsetWidth, box = $("rail").offsetWidth;
    if (!w || !box) return;
    var loop = w + box, x = ((t / 1000) * SPEED) % loop - w;
    var v = "translate3d(" + x.toFixed(1) + "px,0,0)";
    el.style.webkitTransform = v;
    el.style.transform = v;
  }

  // on the hour, 30 s: the day's summary once it exists, else the hour's
  function drawSummary(t) {
    var d = new Date(t + 10800000), on = d.getUTCMinutes() === 0 && d.getUTCSeconds() < 30;
    var lines = F.daily && F.daily.length ? F.daily : F.hourly, title = F.daily && F.daily.length ? "ملخص اليوم" : "ملخص الساعة";
    var key = on ? title + "|" + lines.join("|") : "";
    if (key === lastSummary) return;
    lastSummary = key;
    var box = $("summary");
    if (!on) { box.className = ""; return; }
    var h = "";
    for (var k = 0; k < lines.length; k++) h += "<li>" + esc(lines[k]) + "</li>";
    $("stitle").textContent = title;
    $("slines").innerHTML = h;
    box.className = "on";
  }

  function frame() {
    try {
      var t = now();
      drawTicker(t);
      drawPanel(t);
      drawSummary(t);
    } catch (e) {}
  }
  function loop() { frame(); (window.requestAnimationFrame || function (f) { setTimeout(f, 40); })(loop); }

  function poll() {
    var x = new XMLHttpRequest(), t0 = Date.now();
    x.open("GET", "/api/manager-screen?t=" + t0, true);
    x.timeout = 30000;
    x.onload = function () {
      // signed out: load the page again — the sign-in, then back here
      if (x.status === 401 || x.status === 403 || (x.responseURL && x.responseURL.indexOf("/sign-in") >= 0)) {
        if (Date.now() - born > 60000) location.reload();
        return;
      }
      if (x.status !== 200) return;
      var f;
      try { f = JSON.parse(x.responseText); } catch (e) { return; }
      offset = f.now + (Date.now() - t0) / 2 - Date.now();
      F = f;
      drawFixed();
    };
    x.send();
  }

  setInterval(function () { try { drawClock(now()); } catch (e) {} }, 1000);
  setInterval(function () {
    if (new Date(now() + 10800000).getUTCHours() === 4 && Date.now() - born > 3600000) location.reload();
  }, 60000);
  function full() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var el = document.documentElement, go = el.requestFullscreen || el.webkitRequestFullscreen;
    try { var p = go && go.call(el); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(function () {}); } catch (e) {}
  }
  document.addEventListener("keydown", full, true);
  document.addEventListener("click", full, true);
  try { if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(function () {}); } catch (e) {}

  drawClock(now());
  drawFixed();
  loop();
  setInterval(poll, 30000);
})();
`;

const CSS = `
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-Medium.ttf) format("truetype");font-weight:500;font-display:block}
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-Bold.ttf) format("truetype");font-weight:700;font-display:block}
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-ExtraBold.ttf) format("truetype");font-weight:800;font-display:block}
html,body{margin:0;height:100%;overflow:hidden;cursor:none;background:#06201c;color:#eaf4f0}
body{position:relative;height:100vh;height:100dvh;font-family:Tajawal,"Noto Sans Arabic",Tahoma,Arial,sans-serif;font-size:1.05vw}
#top{position:absolute;top:0;left:0;right:0;height:9%;display:flex;align-items:center;gap:1.6vw;padding:0 2vw;background:#0a3a33;border-bottom:.25vh solid #2aa87a}
#logo{height:62%;filter:brightness(0) invert(1)}
#live{display:flex;align-items:center;gap:.5vw;font-weight:800;font-size:1.3vw;color:#fff}
#live i{width:1vw;height:1vw;border-radius:50%;background:#e53950;box-shadow:0 0 1vw #e53950}
#when{margin-inline-start:auto;text-align:left;direction:rtl}
#clock{font-size:2.6vw;font-weight:800;line-height:1}
#date{font-size:1vw;opacity:.8}
.pill{font-weight:800;font-size:1.3vw;padding:.7vw 1.6vw;border-radius:2vw;color:#fff}
.pill.s-green{background:#1f9d6b}.pill.s-amber{background:#d38a12}.pill.s-red{background:#d4314a}
#main{position:absolute;top:9%;bottom:9%;left:0;right:0;display:flex;gap:1.4vw;padding:1.4vw 2vw}
#report{flex:1 1 72%;display:flex;flex-direction:column;min-width:0}
#rhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:1vw}
#rlabel{font-size:1vw;font-weight:700;opacity:.7}
#ptitle{display:flex;align-items:center;gap:.7vw;font-size:2.1vw;font-weight:800}
#dots span{display:inline-block;width:.7vw;height:.7vw;margin:0 .25vw;border-radius:50%;background:rgba(255,255,255,.25)}
#dots span.on{background:#2aa87a}
.dot{width:1.1vw;height:1.1vw;border-radius:50%;display:inline-block}
.dot.s-green{background:#1f9d6b}.dot.s-amber{background:#e6a01c}.dot.s-red{background:#e53950}
#tiles{flex:1;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(0,1fr);gap:1vw;min-height:0}
.tile{border-radius:1vw;padding:1vw 1.2vw;background:rgba(255,255,255,.06);border-inline-start:.5vw solid;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.tile.s-green{border-color:#1f9d6b}.tile.s-amber{border-color:#e6a01c;background:rgba(230,160,28,.1)}.tile.s-red{border-color:#e53950;background:rgba(229,57,80,.14)}
.tl{font-size:1.05vw;font-weight:700;opacity:.8}
.tv{font-size:2.5vw;font-weight:800;line-height:1.15;margin:.3vw 0}
.tr{font-size:.95vw;opacity:.75;line-height:1.35}
#side{flex:0 0 26%;display:flex;flex-direction:column;border-radius:1vw;background:rgba(229,57,80,.08);border:.15vw solid rgba(229,57,80,.45);padding:1vw;min-height:0}
#side h2{margin:0 0 .8vw;font-size:1.5vw;font-weight:800;color:#ff8a9a;display:flex;justify-content:space-between}
#ucount{background:#e53950;color:#fff;border-radius:1vw;padding:0 .7vw;font-size:1.2vw}
#urgent{list-style:none;margin:0;padding:0;overflow:hidden;flex:1}
#urgent li{margin-bottom:.8vw;padding-bottom:.8vw;border-bottom:.1vw solid rgba(255,255,255,.08)}
#urgent li b{display:block;font-size:1.05vw;font-weight:800;color:#fff}
#urgent li span{display:block;font-size:.95vw;opacity:.75;margin-top:.2vw}
#urgent li.calm{color:#7fe0b7;font-weight:800;font-size:1.2vw;border:0}
#band{position:absolute;left:0;right:0;bottom:0;height:9%;display:flex;background:#c9a227;color:#1d1503}
#now{flex:0 0 auto;display:flex;align-items:center;padding:0 1.6vw;background:#8a1c2b;color:#fff;font-weight:800;font-size:1.6vw}
#rail{position:relative;flex:1;overflow:hidden}
#tick{position:absolute;left:0;top:50%;margin-top:-.65em;white-space:nowrap;direction:rtl;font-size:1.55vw;font-weight:800;line-height:1.3;will-change:transform}
.ti.red{color:#8a1c2b}.ti.red:before{content:"● ";color:#c4122f}
.sep{margin:0 1.4vw;opacity:.55}
#summary{position:absolute;inset:0;z-index:5;background:rgba(6,32,28,.97);display:flex;flex-direction:column;justify-content:center;padding:4vw 8vw;opacity:0;pointer-events:none;-webkit-transition:opacity .6s;transition:opacity .6s}
#summary.on{opacity:1}
#stitle{font-size:3.2vw;font-weight:800;color:#c9a227;margin-bottom:2vw}
#slines{margin:0;padding:0 2vw 0 0;font-size:1.9vw;font-weight:700;line-height:1.7}
`;

export function managerPage(feed: ManagerScreenFeed): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>قناة المدير — ترافليون</title>
<link rel="preload" href="/fonts/Tajawal-ExtraBold.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/fonts/Tajawal-Bold.ttf" as="font" type="font/ttf" crossorigin>
<style>${CSS}</style></head>
<body>
<div id="top">
  <img id="logo" src="/traveliun/logo-body.svg" alt="ترافليون">
  <div id="live"><i></i>مباشر</div>
  <div class="pill s-${feed.overall}" id="pill"></div>
  <div id="when"><div id="clock"></div><div id="date"></div></div>
</div>
<div id="main">
  <section id="report">
    <div id="rhead"><div><div id="rlabel">التقرير الحالي</div><div id="ptitle"></div></div><div id="dots"></div></div>
    <div id="tiles"></div>
  </section>
  <aside id="side"><h2>يحتاج تدخلك الآن <span id="ucount"></span></h2><ul id="urgent"></ul></aside>
</div>
<div id="band"><div id="now">الآن</div><div id="rail"><div id="tick"></div></div></div>
<div id="summary"><div id="stitle"></div><ul id="slines"></ul></div>
<script>window.__F__=${json(feed)};</script>
<script>${RUNTIME}</script>
</body></html>`;
}

/** a signed-in account without dashboard.admin */
export function managerDeniedPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ترافليون</title>
<style>html,body{margin:0;height:100%;background:#0a3a33;color:#fff;font-family:Tahoma,Arial,sans-serif}
div{position:absolute;top:50%;left:8%;right:8%;transform:translateY(-50%);text-align:center;font-size:3vw;font-weight:700}
a{color:#9fe0c4;font-size:1.8vw}</style></head>
<body><div>${esc("هذه الشاشة للإدارة فقط")}<br><a href="/sign-in?redirect=/m">${esc("الدخول بحساب الإدارة")}</a></div></body></html>`;
}
