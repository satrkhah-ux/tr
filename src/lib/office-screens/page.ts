import { ALERT_LEAD_MS, ALERT_SHOW_MS, core, REF_WIDTH, SCREEN_CORE } from "./core";
import { TICKER_FONT_REF } from "./config";
import type { ScreenState } from "./server";

/**
 * The screen's page: plain HTML with one small ES5 script — no React, no
 * bundle — because it runs all day on a TV's own browser (an old WebView on a
 * weak chip). The first paint is complete without the script: the current ad
 * and the ticker's words are in the HTML. The script then keeps it alive on the
 * SERVER's clock (an offset measured on every poll, so a drifting TV clock does
 * not matter): two image layers that cross-fade, filling the screen, the next ad
 * preloaded a few seconds before its turn (never all of them on office wifi), the
 * band that comes up for its pass, the alert, a reload when a new version is
 * deployed or at 04:00, full screen on the first press of the remote.
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
  var box = $("alert"), boxImg = $("alertImg"), shownAlert = "";
  var activeAlert = null, alertElapsed = 0, alertTick = Date.now(), seen = {};
  var storageKey = "traveliun-screen-completed-v1-" + N + (MONITOR ? "-preview" : "");
  try { seen = JSON.parse(localStorage.getItem(storageKey) || "{}") || {}; } catch (err) {}
  function completed(e, t) {
    seen[e.id] = t;
    for (var id in seen) if (seen[id] < t - 86400000) delete seen[id];
    try { localStorage.setItem(storageKey, JSON.stringify(seen)); } catch (err) {}
  }
  var text = $("tick"), tag = $("alertTag"), scale = 1;
  // the demo (while the TVs are set up): this load, on this screen only, one pass and then a «تجربة» alert
  var demo = S.demo, demoAt = Date.now();
  function passMs() { return 36000; }
  var pre = new Image();
  var alertPre = new Image(), alertPreSrc = "";

  function measure() {
    var w = document.documentElement.clientWidth || window.innerWidth || REF;
    scale = w / REF;
    if (!S.ticker) return;
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
    for (var e = 0; e < S.events.length; e++) {
      if (!seen[S.events[e].id] && S.events[e].at < t + 60000 && S.events[e].src) {
        if (alertPreSrc !== S.events[e].src) { alertPreSrc = S.events[e].src; alertPre.src = alertPreSrc; }
        break;
      }
    }
    var end = (Math.floor(t / S.slotMs) + 1) * S.slotMs;
    if (end - t > 5000) return;
    var next = srcAt(end + 1);
    if (next && next !== preloaded) { preloaded = next; pre.src = next; }
  }

  function drawAlert(t) {
    var tick = Date.now(), delta = Math.max(0, Math.min(1000, tick - alertTick));
    alertTick = tick;
    if (document.hidden) return;
    if (activeAlert) {
      alertElapsed += delta;
      if (alertElapsed >= SHOW) { completed(activeAlert, t); activeAlert = null; }
    }
    if (!activeAlert) {
      var i = nextScreenAlert(S.events, t, seen, LEAD);
      if (i >= 0) { activeAlert = S.events[i]; alertElapsed = 0; }
    }
    var e = activeAlert;
    var d = demo ? Date.now() - demoAt - passMs() - LEAD : -1;
    if (!e && d >= 0 && d < SHOW) e = { at: -1, country: demo.country, line: demo.line, name: demo.name, test: true, src: demo.src };
    $("alertProgress").style.width = (100 * (1 - (activeAlert ? alertElapsed : Math.max(0, d)) / SHOW)) + "%";
    var key = e ? (e.id || "demo") + "|" + e.line : "";
    if (key === shownAlert) return;
    shownAlert = key;
    if (!e) { box.className = ""; return; }
    tag.style.display = e.test ? "block" : "none";
    $("aName").textContent = e.name || "";
    $("aName").style.display = e.name ? "block" : "none";
    $("aDest").textContent = e.line;
    boxImg.style.display = "none";
    boxImg.onload = function () { boxImg.style.display = "block"; };
    boxImg.onerror = function () { boxImg.style.display = "none"; };
    boxImg.setAttribute("src", e.src || "/screen-landmarks/journey.svg");
    if (boxImg.complete && boxImg.naturalWidth) boxImg.style.display = "block";
    // from the start every time: off, a reflow, on — the animations run again
    box.className = "";
    void box.offsetWidth;
    box.className = "on";
  }

  // A single transparent motion layer travels through the numbered screens.
  var spotlightKey = "", countryPhase = "";
  function drawTicker(t) {
    var countries = S.countries || [];
    var elapsed = countryBulletinElapsed(t, N, S.screens);
    var active = countries.length > 0 && elapsed >= 0;
    var panel = $("countries");
    panel.className = active ? (elapsed >= 34800 ? "on departing" : "on") : "";
    if (!active) { spotlightKey = ""; countryPhase = ""; return; }
    var slot = 36000 / countries.length, index = Math.min(countries.length - 1, Math.floor(elapsed / slot));
    var remaining = Math.ceil((36000 - elapsed) / 1000);
    $("countryRank").textContent = "الترتيب " + (index + 1);
    $("countryProgress").style.width = (100 * elapsed / 36000) + "%";
    $("countryNext").textContent = N < S.screens
      ? (remaining <= 6 ? "إلى الشاشة " + (N + 1) + " خلال " + remaining : "التالي · الشاشة " + (N + 1)) + " ←"
      : "نلتقي في الجولة القادمة";
    var key = Math.floor(t / 600000) + "|" + countries.join("|");
    if (key !== spotlightKey) {
      spotlightKey = key;
      var html = "";
      for (var i = 0; i < countries.length; i++) {
        var card = document.createElement("div"); card.className = "country";
        var rank = document.createElement("b"); rank.textContent = (i + 1 < 10 ? "0" : "") + (i + 1);
        var name = document.createElement("span"); name.textContent = countries[i];
        card.appendChild(rank); card.appendChild(name); html += card.outerHTML;
      }
      $("countryList").innerHTML = html;
      var steps = "";
      for (var step = 1; step <= S.screens; step++) steps += '<b class="' + (step === N ? "current" : (step < N ? "passed" : "")) + '">' + step + '</b>';
      $("countryStep").innerHTML = steps;
    }
    var nextPhase = key + "|" + index;
    if (countryPhase !== nextPhase) {
      countryPhase = nextPhase;
      $("countryHero").textContent = countries[index];
      $("countryLabel").textContent = index === 0 ? "الوجهة الأكثر طلبًا" : "ضمن أكثر الوجهات طلبًا";
      var items = $("countryList").children;
      for (var j = 0; j < items.length; j++) items[j].className = j === index ? "country selected" : "country";
      var spot = $("spotlight"); spot.className = ""; void spot.offsetWidth; spot.className = "active";
    }
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
      if (words !== next) { text.textContent = next; }
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
  document.addEventListener("visibilitychange", function () { alertTick = Date.now(); if (!document.hidden) { wake(); poll(); } });

  // full screen always, no button (the owner): a page may only ask after a press, so the first
  // press of any remote key or a click asks, silently
  function full() {
    if (MONITOR || document.fullscreenElement || document.webkitFullscreenElement) return;
    var el = document.documentElement, go = el.requestFullscreen || el.webkitRequestFullscreen;
    try { var p = go && go.call(el); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    wake();
  }
  document.addEventListener("keydown", full, true);
  document.addEventListener("click", full, true);
  document.addEventListener("pointerdown", full, true);

  window.addEventListener("resize", measure);
  measure();
  wake();
  loop();
  // a browser that stops animation frames (a background or throttled page) still turns the ads and shows the alert
  setInterval(frame, 1000);
  setInterval(poll, 4000);
  poll();
})();
`;

// Tajawal, the system's own face (public/fonts), «block» so the first paint never flashes another
const CSS = `
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-Bold.ttf) format("truetype");font-weight:700;font-display:block}
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-ExtraBold.ttf) format("truetype");font-weight:800;font-display:block}
html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
body{position:relative;height:100vh;height:100dvh;font-family:Tajawal,"Noto Sans Arabic",Tahoma,Arial,sans-serif}
.ad,#alert{position:absolute;left:0;top:0;width:100%;height:100%}
.ad{object-fit:cover;opacity:0;-webkit-transition:opacity .9s,height .4s ease;transition:opacity .9s,height .4s ease}
.band .ad{height:91%;object-fit:contain}
.ad.on{opacity:1}
#alert{background:#185766 url(/screen-landmarks/journey.svg) center/cover;opacity:0;visibility:hidden;overflow:hidden;-webkit-transition:opacity .5s,visibility 0s .5s;transition:opacity .5s,visibility 0s .5s}
#alert.on{opacity:1;visibility:visible;-webkit-transition:opacity .5s;transition:opacity .5s}
#alertImg{width:100%;height:100%;object-fit:cover}
#alert.on #alertImg{-webkit-animation:kb 22s linear both;animation:kb 22s linear both}
#shade{position:absolute;left:0;top:0;width:100%;height:100%;background:-webkit-linear-gradient(bottom,rgba(3,23,34,.82) 0%,rgba(3,23,34,.32) 48%,rgba(3,23,34,.04) 100%);background:linear-gradient(to top,rgba(3,23,34,.82) 0%,rgba(3,23,34,.32) 48%,rgba(3,23,34,.04) 100%)}
#flight{position:absolute;left:0;width:100%;top:26%;height:6vw}
#trail{position:absolute;left:0;top:50%;width:100%;height:.35vw;margin-top:-.17vw;background:-webkit-linear-gradient(left,rgba(201,162,39,0),#e3bd3c);background:linear-gradient(to right,rgba(201,162,39,0),#e3bd3c);-webkit-transform-origin:left;transform-origin:left;-webkit-transform:scaleX(0);transform:scaleX(0)}
#alert.on #trail{-webkit-animation:trail 1.7s .2s cubic-bezier(.3,.7,.2,1) both,fade .8s 2.4s both;animation:trail 1.7s .2s cubic-bezier(.3,.7,.2,1) both,fade .8s 2.4s both}
#plane{position:absolute;top:0;left:0;width:6vw;height:6vw;fill:#fff;-webkit-transform:translateX(-8vw) rotate(90deg);transform:translateX(-8vw) rotate(90deg);-webkit-filter:drop-shadow(0 0 1vw rgba(227,189,60,.9));filter:drop-shadow(0 0 1vw rgba(227,189,60,.9))}
#alert.on #plane{-webkit-animation:fly 1.7s .2s cubic-bezier(.3,.7,.2,1) both;animation:fly 1.7s .2s cubic-bezier(.3,.7,.2,1) both}
#msg{position:absolute;left:4%;right:4%;top:49%;text-align:center;direction:rtl}
#kicker{display:inline-block;font-size:2.8vw;font-weight:800;color:#e3bd3c;letter-spacing:.05em;opacity:0}
#kicker i{position:relative;display:inline-block;width:1.3vw;height:1.3vw;margin-left:1vw;border-radius:50%;background:#e53950;vertical-align:middle}
#kicker i:after{content:"";position:absolute;left:0;top:0;width:100%;height:100%;border-radius:50%;background:#e53950}
#alert.on #kicker{-webkit-animation:rise .6s .6s both;animation:rise .6s .6s both}
#alert.on #kicker i:after{-webkit-animation:ping 1.2s 1.1s infinite;animation:ping 1.2s 1.1s infinite}
#aName{font-size:4.6vw;font-weight:800;color:#fff;line-height:1.2;margin-top:.8vw;opacity:0}
#alert.on #aName{-webkit-animation:rise .6s 1s both;animation:rise .6s 1s both}
#aDest{font-size:5.8vw;font-weight:800;color:#fff;line-height:1.15;text-shadow:0 .4vw 2.4vw rgba(0,0,0,.6),0 0 3.5vw rgba(227,189,60,.5);opacity:0}
#alert.on #aDest{-webkit-animation:pop .9s 1.3s cubic-bezier(.2,1.5,.4,1) both;animation:pop .9s 1.3s cubic-bezier(.2,1.5,.4,1) both}
@-webkit-keyframes kb{from{-webkit-transform:scale(1.18)}to{-webkit-transform:scale(1)}}
@keyframes kb{from{transform:scale(1.18)}to{transform:scale(1)}}
@-webkit-keyframes trail{from{-webkit-transform:scaleX(0)}to{-webkit-transform:scaleX(1)}}
@keyframes trail{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@-webkit-keyframes fade{from{opacity:1}to{opacity:0}}
@keyframes fade{from{opacity:1}to{opacity:0}}
@-webkit-keyframes fly{from{-webkit-transform:translateX(-8vw) rotate(90deg)}to{-webkit-transform:translateX(104vw) rotate(90deg)}}
@keyframes fly{from{transform:translateX(-8vw) rotate(90deg)}to{transform:translateX(104vw) rotate(90deg)}}
@-webkit-keyframes rise{from{opacity:0;-webkit-transform:translateY(2vw)}to{opacity:1;-webkit-transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(2vw)}to{opacity:1;transform:none}}
@-webkit-keyframes pop{from{opacity:0;-webkit-transform:scale(.6)}to{opacity:1;-webkit-transform:scale(1)}}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@-webkit-keyframes ping{from{opacity:.8;-webkit-transform:scale(1)}to{opacity:0;-webkit-transform:scale(3)}}
@keyframes ping{from{opacity:.8;transform:scale(1)}to{opacity:0;transform:scale(3)}}
#alertTag{display:none;position:absolute;top:3vh;right:3vh;z-index:2;font-size:1.8vw;font-weight:800;color:#0a3a33;background:#ffd54a;border-radius:1vw;padding:.6vw 1.4vw}
#band{position:absolute;left:0;right:0;bottom:0;height:9%;z-index:3;background:rgba(10,58,51,.92);border-top:.35vh solid #2aa87a;overflow:hidden;-webkit-transform:translateY(105%);transform:translateY(105%);-webkit-transition:-webkit-transform .7s;transition:transform .7s}
#band.up{-webkit-transform:translateY(0);transform:translateY(0)}
#tick{position:absolute;left:0;top:50%;margin-top:-.62em;white-space:nowrap;direction:rtl;color:#fff;font-weight:800;line-height:1.24;will-change:transform}
#band{display:none}
#countries{position:absolute;inset:0;z-index:2;display:none;color:#fff;overflow:hidden;text-align:right;background:linear-gradient(0deg,rgba(2,22,29,.92),rgba(2,22,29,.62) 43%,rgba(2,22,29,.14) 72%,transparent 90%);text-shadow:0 .15vw 1vw #00151b80}
#countries:before{content:"";position:absolute;inset:29vh 4vw 9vh;border-radius:2vw;background:linear-gradient(120deg,rgba(9,47,45,.98),rgba(10,39,43,.94));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid #f3d89c25;box-shadow:0 2vh 6vw #00171966}
#countries.on{display:block;animation:bulletinEnter 1.2s cubic-bezier(.16,1,.3,1) both}
#countries.on.departing{animation:bulletinExit 1.2s ease-in both}
@keyframes bulletinEnter{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes bulletinExit{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}
.motionTitle{position:absolute;right:8vw;top:33vh;display:flex;align-items:center;gap:1vw;font-size:1.8vw;font-weight:800;letter-spacing:.02em}
.motionTitle i{width:.6vw;height:.6vw;background:#f5d995;border-radius:50%;box-shadow:0 0 1.3vw #f5d995}
.motionTitle small{font-size:1vw;opacity:.65;font-weight:700;border-right:1px solid #ffffff40;padding-right:1vw}
#spotlight{position:absolute;left:8vw;right:8vw;top:39vh;height:32vh;display:flex;align-items:center;gap:3vw}
.rankShell{font-size:1.5vw;font-weight:800;line-height:1.5;color:#f3d89c;min-width:8vw;text-align:center;white-space:nowrap;border:1px solid #f3d89c55;border-radius:2vw;padding:.6vw 1vw}
.heroCopy{flex:1;min-width:0}
#countryLabel{font-size:1.3vw;color:#f3d89c;margin-bottom:1vh}
#countryHero{font-size:7vw;font-weight:800;line-height:1.16;letter-spacing:-.03em;overflow-wrap:break-word}
#spotlight.active .heroCopy{animation:destinationIn .85s cubic-bezier(.16,1,.3,1) both}
#spotlight.active .rankShell{animation:rankIn 1.1s cubic-bezier(.16,1,.3,1) both}
@keyframes destinationIn{from{opacity:0;transform:translateX(-7vw)}to{opacity:1;transform:translateX(0)}}
@keyframes rankIn{from{opacity:0;transform:translateY(7vh) scale(.65) rotate(-12deg)}to{opacity:1;transform:translateY(0) scale(1) rotate(0)}}
.motionRoute{position:absolute;left:-10%;right:-10%;top:72vh;height:1px;background:linear-gradient(90deg,transparent,#f3d89c66,transparent);transform:rotate(-4deg)}
.motionRoute:after{content:"";position:absolute;width:14%;height:3px;top:-1px;background:linear-gradient(90deg,transparent,#f5deab,transparent);box-shadow:0 0 1vw #f5deab;animation:routeTravel 4.5s linear infinite}
@keyframes routeTravel{from{transform:translateX(-20vw)}to{transform:translateX(140vw)}}
#countryList{position:absolute;right:6vw;left:6vw;bottom:12vh;display:flex;gap:1vw;align-items:stretch}
.country{flex:1;min-width:0;display:flex;flex-direction:column;gap:.6vh;position:relative;padding:1vh .5vw;border-top:1px solid #ffffff30;opacity:.48;transition:opacity .5s,transform .5s,border-color .5s}
.country b{font-size:1.2vw;color:#f3d89c;direction:ltr;text-align:right;font-weight:800}
.country span{font-size:1.1vw;font-weight:800;line-height:1.3;overflow-wrap:anywhere;max-width:100%}
.country.selected{opacity:1;transform:translateY(-1.5vh);border-color:#f3d89c}
.country.selected:before{content:"";position:absolute;right:0;top:-2px;width:35%;height:3px;background:#f3d89c;box-shadow:0 0 1vw #f3d89c}
#countries footer{position:absolute;bottom:4vh;left:6vw;right:6vw;display:flex;align-items:center;justify-content:space-between;gap:2vw;font-size:1.2vw;color:#c8d5d5}
.relay{display:flex;align-items:center;gap:1vw}
#countryStep{display:flex;direction:ltr;gap:.5vw}
#countryStep b{display:flex;align-items:center;justify-content:center;width:2vw;height:2vw;border:1px solid #ffffff40;border-radius:50%;font-size:1vw}
#countryStep b.current{background:#f3d89c;color:#163d3c;border-color:#f3d89c;box-shadow:0 0 2vw #f3d89c50}
#countryStep b.passed{border-color:#f3d89c;color:#f3d89c}
#countryNext{color:#f3d89c;font-weight:800;min-width:20vw;text-align:center}
.countryNote{font-size:1vw}
.countryTrack{position:absolute;bottom:0;left:0;right:0;height:.4vh;background:#ffffff12;direction:ltr}
#countryProgress{height:100%;background:#f3d89c;width:0;box-shadow:0 0 1vw #f3d89c}
#alertProgress{position:absolute;bottom:0;right:0;height:.4vh;background:#e3bd3c}
#alert{z-index:4}
@media(prefers-reduced-motion:reduce){#countries.on,#countries.on.departing,.country,#spotlight.active .heroCopy,#spotlight.active .rankShell,.motionRoute:after,#alert.on #alertImg{animation:none}}

`;

export function screenPage(n: number, s: ScreenState, monitor: boolean): string {
  const first = core.adIndexAt(s.now, s.slotMs, s.position, s.ads.length);
  const src = first < 0 ? "" : s.ads[first].src;
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>شاشة ${n} — ترافليون</title>
<link rel="preload" href="/fonts/Tajawal-ExtraBold.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/fonts/Tajawal-Bold.ttf" as="font" type="font/ttf" crossorigin>
<style>${CSS}</style></head>
<body>
<img id="a0" class="ad on" alt=""${src ? ` src="${esc(src)}"` : ""}>
<img id="a1" class="ad" alt="">
<div id="alert"><img id="alertImg" alt=""><div id="shade"></div>
<div id="flight"><div id="trail"></div><svg id="plane" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg></div>
<div id="alertTag">تجربة</div>
<div id="msg"><div id="kicker"><i></i>طلب سفر جديد</div><div id="aName"></div><div id="aDest"></div></div><div id="alertProgress"></div></div>
<section id="countries">
<div class="motionTitle"><i></i> الوجهات الأكثر طلبًا اليوم <small>ترافليون · نبض السفر</small></div>
<div id="spotlight"><div class="rankShell" id="countryRank">01</div><div class="heroCopy"><div id="countryLabel"></div><div id="countryHero"></div></div></div>
<div class="motionRoute"></div><div id="countryList"></div>
<footer><div class="relay"><span>جولة الشاشات</span><span id="countryStep"></span></div><span id="countryNext"></span><span class="countryNote">طلبات اليوم · بتوقيت الرياض</span></footer>
<div class="countryTrack"><div id="countryProgress"></div></div></section>
<div id="band"><div id="tick">${esc(s.ticker?.text ?? "")}</div></div>
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
<style>@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-Bold.ttf) format("truetype");font-weight:700;font-display:block}
html,body{margin:0;height:100%;background:#0a3a33;color:#fff;font-family:Tajawal,Tahoma,Arial,sans-serif;cursor:none}
div{position:absolute;top:50%;left:8%;right:8%;-webkit-transform:translateY(-50%);transform:translateY(-50%);text-align:center;font-size:4vw;font-weight:700}
small{display:block;margin-top:2vw;font-size:2vw;font-weight:700;opacity:.75}</style></head>
<body><div>لا توجد شاشة بهذا الرقم (${n})<small>عدد الشاشات وترتيبها من «الإدارة ← الشاشات»</small></div></body></html>`;
}
