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
  var text = $("tick"), tag = $("alertTag"), scale = 1;
  // the demo (while the TVs are set up): this load, on this screen only, one pass and then a «تجربة» alert
  var demo = S.demo, demoAt = Date.now();
  function passMs() { return 36000; }
  var pre = new Image();

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
    var end = (Math.floor(t / S.slotMs) + 1) * S.slotMs;
    if (end - t > 5000) return;
    var next = srcAt(end + 1);
    if (next && next !== preloaded) { preloaded = next; pre.src = next; }
  }

  function drawAlert(t) {
    var i = alertAt(S.events, t, LEAD, SHOW), e = i < 0 ? null : S.events[i];
    var d = demo ? Date.now() - demoAt - passMs() - LEAD : -1;
    if (!e && d >= 0 && d < SHOW) e = { at: -1, country: demo.country, line: demo.line, name: demo.name, test: true, src: demo.src };
    var key = e ? e.at + "|" + e.line + "|" + (e.name || "") : "";
    if (key === shownAlert) return;
    shownAlert = key;
    if (!e) { box.className = ""; return; }
    tag.style.display = e.test ? "block" : "none";
    $("aName").textContent = e.name || "";
    $("aName").style.display = e.name ? "block" : "none";
    $("aDest").textContent = e.line;
    if (e.src) { boxImg.setAttribute("src", e.src); boxImg.style.display = "block"; } else boxImg.style.display = "none";
    // from the start every time: off, a reflow, on — the animations run again
    box.className = "";
    void box.offsetWidth;
    box.className = "on";
  }

  // One screen at a time, in numeric order, on the shared server clock.
  var spotlightKey = "";
  function drawTicker(t) {
    var countries = S.countries || [], elapsed = countryBulletinElapsed(t, N, S.screens);
    var active = countries.length > 0 && elapsed >= 0;
    var panel = $("countries");
    panel.className = active ? (elapsed >= 34800 ? "on departing" : "on") : "";
    if (active) {
      var remaining = Math.ceil((36000 - elapsed) / 1000);
      $("countryNext").textContent = N < S.screens
        ? "تابعوا العرض على الشاشة " + (N + 1) + " بعد " + remaining + " ثانية ←"
        : "اكتملت الجولة · يعود العرض إلى الشاشة 1 في الموعد التالي";
    }
    var key = active ? Math.floor(t / 600000) + "|" + countries.join("|") : "";
    if (key === spotlightKey) return;
    spotlightKey = key;
    if (!active) return;
    var html = "";
    for (var i = 0; i < countries.length; i++) {
      var card = document.createElement("div");
      card.className = "country c" + i;
      var rank = document.createElement("b"); rank.textContent = (i + 1 < 10 ? "0" : "") + (i + 1);
      var name = document.createElement("span"); name.textContent = countries[i];
      card.appendChild(rank); card.appendChild(name); html += card.outerHTML;
    }
    $("countryList").innerHTML = html;
    $("countryStep").textContent = "الشاشة " + N + " من " + S.screens + " · عرض متتابع كل 10 دقائق";
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
  document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });

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
#alert{background:#000;opacity:0;visibility:hidden;overflow:hidden;-webkit-transition:opacity .5s,visibility 0s .5s;transition:opacity .5s,visibility 0s .5s}
#alert.on{opacity:1;visibility:visible;-webkit-transition:opacity .5s;transition:opacity .5s}
#alertImg{width:100%;height:100%;object-fit:cover}
#alert.on #alertImg{-webkit-animation:kb 9s ease-out both;animation:kb 9s ease-out both}
#shade{position:absolute;left:0;top:0;width:100%;height:100%;background:-webkit-linear-gradient(bottom,rgba(4,30,26,.94) 0%,rgba(4,30,26,.6) 50%,rgba(4,30,26,.2) 100%);background:linear-gradient(to top,rgba(4,30,26,.94) 0%,rgba(4,30,26,.6) 50%,rgba(4,30,26,.2) 100%)}
#flight{position:absolute;left:0;width:100%;top:26%;height:6vw}
#trail{position:absolute;left:0;top:50%;width:100%;height:.35vw;margin-top:-.17vw;background:-webkit-linear-gradient(left,rgba(201,162,39,0),#e3bd3c);background:linear-gradient(to right,rgba(201,162,39,0),#e3bd3c);-webkit-transform-origin:left;transform-origin:left;-webkit-transform:scaleX(0);transform:scaleX(0)}
#alert.on #trail{-webkit-animation:trail 1.7s .2s cubic-bezier(.3,.7,.2,1) both,fade .8s 2.4s both;animation:trail 1.7s .2s cubic-bezier(.3,.7,.2,1) both,fade .8s 2.4s both}
#plane{position:absolute;top:0;left:0;width:6vw;height:6vw;fill:#fff;-webkit-transform:translateX(-8vw) rotate(90deg);transform:translateX(-8vw) rotate(90deg);-webkit-filter:drop-shadow(0 0 1vw rgba(227,189,60,.9));filter:drop-shadow(0 0 1vw rgba(227,189,60,.9))}
#alert.on #plane{-webkit-animation:fly 1.7s .2s cubic-bezier(.3,.7,.2,1) both;animation:fly 1.7s .2s cubic-bezier(.3,.7,.2,1) both}
#msg{position:absolute;left:4%;right:4%;top:38%;text-align:center;direction:rtl}
#kicker{display:inline-block;font-size:2.8vw;font-weight:800;color:#e3bd3c;letter-spacing:.05em;opacity:0}
#kicker i{position:relative;display:inline-block;width:1.3vw;height:1.3vw;margin-left:1vw;border-radius:50%;background:#e53950;vertical-align:middle}
#kicker i:after{content:"";position:absolute;left:0;top:0;width:100%;height:100%;border-radius:50%;background:#e53950}
#alert.on #kicker{-webkit-animation:rise .6s .6s both;animation:rise .6s .6s both}
#alert.on #kicker i:after{-webkit-animation:ping 1.2s 1.1s infinite;animation:ping 1.2s 1.1s infinite}
#aName{font-size:4.6vw;font-weight:800;color:#fff;line-height:1.2;margin-top:.8vw;opacity:0}
#alert.on #aName{-webkit-animation:rise .6s 1s both;animation:rise .6s 1s both}
#aDest{font-size:8.4vw;font-weight:800;color:#fff;line-height:1.15;text-shadow:0 .4vw 2.4vw rgba(0,0,0,.6),0 0 3.5vw rgba(227,189,60,.5);opacity:0}
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
#countries{position:absolute;inset:0;z-index:2;display:none;background:radial-gradient(ellipse at top right,#245c50,#071e1a 70%);color:#fff;padding:5vh 6vw;box-sizing:border-box;text-align:right}
#countries.on{display:block;animation:bulletinEnter 1.2s ease-out both}
#countries.on.departing{animation:bulletinExit 1.2s ease-in both}
@keyframes bulletinEnter{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes bulletinExit{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}
#countries h1{font-size:4.3vw;margin:1vh 0 0;font-weight:800}
#countries p{font-size:1.8vw;color:#c7dbd3;margin:1vh 0 4vh}
#countries .eyebrow{font-size:1.6vw;color:#e4c567;letter-spacing:.08em}
#countryList{display:flex;flex-wrap:wrap;gap:1.4vw}
.country{width:calc(50% - .7vw);box-sizing:border-box;border:1px solid #476c5d;border-radius:1vw;padding:1.1vh 1.7vw;display:flex;align-items:center;gap:1.6vw;background:#163b32;animation:rise .8s both}
.country b{font-size:3.2vw;color:#e4c567;font-weight:800;min-width:4vw}
.country span{font-size:2.9vw;font-weight:800}
.country.c0{background:#e4c567;color:#102f27;border-color:#e4c567}.country.c0 b{color:#102f27}
.country.c1{animation-delay:.1s}.country.c2{animation-delay:.2s}.country.c3{animation-delay:.3s}.country.c4{animation-delay:.4s}.country.c5{animation-delay:.5s}.country.c6{animation-delay:.6s}.country.c7{animation-delay:.7s}
#countries footer{position:absolute;bottom:4vh;left:6vw;right:6vw;display:flex;justify-content:space-between;gap:2vw;font-size:1.6vw;color:#e4c567}
#alert{z-index:4}
@media(prefers-reduced-motion:reduce){#countries.on,#countries.on.departing,.country{animation:none}}

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
<div id="msg"><div id="kicker"><i></i>✨ مسافر جديد مع ترافليون</div><div id="aName"></div><div id="aDest"></div></div></div>
<section id="countries"><div class="eyebrow">ترافليون · نبض السفر</div><h1>الدول الأكثر طلبًا اليوم</h1><p>الوجهات مرتّبة حسب طلبات العملاء اليوم · بتوقيت الرياض</p><div id="countryList"></div><footer><span id="countryStep"></span><span id="countryNext"></span></footer></section>
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
