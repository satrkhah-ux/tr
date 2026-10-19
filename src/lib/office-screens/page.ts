import { ALERT_LEAD_MS, ALERT_SHOW_MS, core, REF_WIDTH, SCREEN_CORE } from "./core";
import { TICKER_FONT_REF } from "./config";
import type { ScreenState } from "./server";

/**
 * The screen's page: plain HTML with one small ES5 script — no React, no
 * bundle — because it runs all day on a TV's own browser (an old WebView on a
 * weak chip). The first paint is complete without the script: the current ad
 * and the ticker's words are in the HTML. The script then keeps it alive on the
 * SERVER's clock (an offset measured on every poll, so a drifting TV clock does
 * not matter): two image layers that cross-fade, the next ad preloaded a few
 * seconds before its turn (never all of them on office wifi), the ticker drawn
 * every frame, the alert, a reload when a new version is deployed or at 04:00.
 * Errors are swallowed into the picture on screen — never an error page.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(LS, "");

const RUNTIME = String.raw`
(function () {
  var S = window.__S__, N = window.__N__, MONITOR = window.__M__;
  var REF = ${REF_WIDTH}, LEAD = ${ALERT_LEAD_MS}, SHOW = ${ALERT_SHOW_MS}, FONT = ${TICKER_FONT_REF};
  var offset = S.now - Date.now(), bestRtt = 1e9, bestAt = 0, born = Date.now();
  function now() { return Date.now() + offset; }
  function $(id) { return document.getElementById(id); }
  var layers = [$("a0"), $("a1")], front = 0, shown = layers[0].getAttribute("src") || "", pending = "", failed = "", failedAt = 0, preloaded = "";
  var box = $("alert"), boxImg = $("alertImg"), boxText = $("alertText"), shownAlert = "";
  var band = $("band"), text = $("tick"), scale = 1;
  var pre = new Image();

  function measure() {
    var w = document.documentElement.clientWidth || window.innerWidth || REF;
    scale = w / REF;
    if (!S.ticker) { band.style.display = "none"; document.body.className = MONITOR ? "monitor noband" : "noband"; return; }
    band.style.display = "block";
    document.body.className = MONITOR ? "monitor" : "";
    text.style.fontSize = (FONT * scale) + "px";
    var actual = text.offsetWidth / scale;
    if (actual > S.ticker.width) text.style.fontSize = (FONT * scale * S.ticker.width / actual) + "px";
  }

  function srcAt(t) {
    var i = adIndexAt(t, S.slotMs, S.position, S.ads.length);
    return i < 0 ? "" : S.ads[i].src;
  }

  function showLayer(img, src) {
    img.className = "ad on";
    layers[front].className = "ad";
    front = layers[0] === img ? 0 : 1;
    shown = src;
    pending = "";
  }

  function drawAd(t) {
    var want = srcAt(t);
    if (!want || want === shown || want === pending) return;
    if (want === failed && Date.now() - failedAt < 15000) return;
    var back = layers[1 - front];
    pending = want;
    if (back.getAttribute("src") === want && back.complete && back.naturalWidth) { showLayer(back, want); return; }
    back.onload = function () { if (pending === want) showLayer(back, want); };
    back.onerror = function () { if (pending === want) { pending = ""; failed = want; failedAt = Date.now(); } };
    back.setAttribute("src", want);
  }

  function preloadNext(t) {
    var end = (Math.floor(t / S.slotMs) + 1) * S.slotMs;
    if (end - t > 5000) return;
    var next = srcAt(end + 1);
    if (next && next !== preloaded) { preloaded = next; pre.src = next; }
  }

  function drawAlert(t) {
    var i = alertAt(S.events, t, LEAD, SHOW);
    var key = i < 0 ? "" : S.events[i].at + "|" + S.events[i].text;
    if (key === shownAlert) return;
    shownAlert = key;
    if (i < 0) { box.className = ""; return; }
    var e = S.events[i];
    boxText.textContent = e.text;
    if (e.src) { boxImg.setAttribute("src", e.src); boxImg.style.display = "block"; } else boxImg.style.display = "none";
    box.className = "on";
  }

  function drawTicker(t) {
    if (!S.ticker) return;
    var px = tickerLeft(t, S.ticker.speed, S.ticker.width, S.screens, S.position, REF) * scale;
    var v = "translate3d(" + px.toFixed(1) + "px,0,0)";
    text.style.webkitTransform = v;
    text.style.transform = v;
  }

  function frame() {
    try {
      var t = now();
      drawTicker(t);
      drawAd(t);
      preloadNext(t);
      drawAlert(t);
    } catch (e) {}
  }

  function loop() { frame(); (window.requestAnimationFrame || function (f) { setTimeout(f, 40); })(loop); }

  function poll() {
    var x = new XMLHttpRequest(), t0 = Date.now();
    x.open("GET", "/screen/" + N + "?state=1&t=" + t0, true);
    x.timeout = 8000;
    x.onload = function () {
      if (x.status !== 200) return;
      var s;
      try { s = JSON.parse(x.responseText); } catch (e) { return; }
      var t1 = Date.now(), rtt = t1 - t0;
      // the answer with the shortest round trip in the last five minutes is the truest clock
      if (rtt < bestRtt || t1 - bestAt > 300000) { bestRtt = rtt; bestAt = t1; offset = s.now + rtt / 2 - t1; }
      // a new version of this page was deployed, and the server answers: take it
      if (s.build && S.build && s.build !== S.build) { location.reload(); return; }
      var words = S.ticker ? S.ticker.text : "", next = s.ticker ? s.ticker.text : "";
      S = s;
      if (words !== next) { text.textContent = next; measure(); }
    };
    x.send();
  }

  // the nightly fresh start, 04:00 Riyadh, once the page has run an hour
  setInterval(function () {
    if (new Date(now() + 10800000).getUTCHours() === 4 && Date.now() - born > 3600000) location.reload();
  }, 60000);

  function wake() {
    try { if (navigator.wakeLock && !MONITOR) navigator.wakeLock.request("screen").catch(function () {}); } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });

  var fs = $("fs");
  if (fs && !MONITOR) {
    fs.onclick = function () {
      var el = document.documentElement, go = el.requestFullscreen || el.webkitRequestFullscreen;
      try { if (go) go.call(el); } catch (e) {}
      wake();
    };
    var gone = function () { fs.style.display = (document.fullscreenElement || document.webkitFullscreenElement) ? "none" : ""; };
    document.addEventListener("fullscreenchange", gone);
    document.addEventListener("webkitfullscreenchange", gone);
    try { fs.focus(); } catch (e) {}
  }

  window.addEventListener("resize", measure);
  measure();
  wake();
  loop();
  setInterval(poll, 4000);
  poll();
})();
`;

const CSS = `
html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
body{position:relative;height:100vh;height:100dvh;font-family:"Noto Sans Arabic","Noto Kufi Arabic","Segoe UI",Tahoma,Arial,sans-serif}
.ad,#alert{position:absolute;left:0;top:0;width:100%;height:91%}
.noband .ad,.noband #alert{height:100%}
.ad{object-fit:contain;opacity:0;-webkit-transition:opacity .9s;transition:opacity .9s}
.ad.on{opacity:1}
#alert{background:#000;opacity:0;-webkit-transition:opacity .6s;transition:opacity .6s}
#alert.on{opacity:1}
#alertImg{width:100%;height:100%;object-fit:contain;opacity:.4}
#alertText{position:absolute;left:6%;right:6%;top:50%;-webkit-transform:translateY(-50%);transform:translateY(-50%);text-align:center;color:#fff;font-size:5vw;font-weight:800;line-height:1.35;direction:rtl;background:rgba(10,58,51,.88);border:.3vw solid #2aa87a;border-radius:2vw;padding:3vw 2vw}
#band{position:absolute;left:0;right:0;bottom:0;height:9%;background:#0a3a33;border-top:.35vh solid #2aa87a;overflow:hidden}
#tick{position:absolute;left:0;top:50%;margin-top:-.62em;white-space:nowrap;direction:rtl;color:#fff;font-weight:700;line-height:1.24;will-change:transform}
#fs{position:absolute;top:2vh;left:2vh;z-index:5;font:700 2.2vh Tahoma,Arial,sans-serif;color:#fff;background:rgba(10,58,51,.75);border:.25vh solid #2aa87a;border-radius:1.2vh;padding:1.2vh 2.4vh;cursor:pointer}
#fs:focus{outline:.5vh solid #ffd54a;outline-offset:.4vh}
.monitor #fs{display:none}
`;

export function screenPage(n: number, s: ScreenState, monitor: boolean): string {
  const first = core.adIndexAt(s.now, s.slotMs, s.position, s.ads.length);
  const src = first < 0 ? "" : s.ads[first].src;
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>شاشة ${n} — ترافليون</title>
<style>${CSS}</style></head>
<body class="${[monitor ? "monitor" : "", s.ticker ? "" : "noband"].join(" ").trim()}">
<img id="a0" class="ad on" alt=""${src ? ` src="${esc(src)}"` : ""}>
<img id="a1" class="ad" alt="">
<div id="alert"><img id="alertImg" alt=""><div id="alertText"></div></div>
<div id="band"${s.ticker ? "" : ' style="display:none"'}><div id="tick">${esc(s.ticker?.text ?? "")}</div></div>
<button id="fs" type="button" autofocus>ملء الشاشة</button>
<script>window.__S__=${json(s)};window.__N__=${n};window.__M__=${monitor ? "true" : "false"};</script>
<script>${SCREEN_CORE}${RUNTIME}</script>
</body></html>`;
}

export function noScreenPage(n: number): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>ترافليون</title>
<style>html,body{margin:0;height:100%;background:#0a3a33;color:#fff;font-family:Tahoma,Arial,sans-serif;cursor:none}
div{position:absolute;top:50%;left:8%;right:8%;-webkit-transform:translateY(-50%);transform:translateY(-50%);text-align:center;font-size:4vw;font-weight:700}
small{display:block;margin-top:2vw;font-size:2vw;font-weight:400;opacity:.75}</style></head>
<body><div>لا توجد شاشة بهذا الرقم (${n})<small>عدد الشاشات وترتيبها من «الإدارة ← الشاشات»</small></div></body></html>`;
}
