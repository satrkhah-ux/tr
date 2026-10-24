import { LANDMARK_IDS } from "./landmarks";
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
    // a client in the office (the user, 2026-10-25): «عميلنا محمد» over «طلب بكج إلى جورجيا»
    var name = e.walkIn ? "عميلنا" + (e.name ? " " + e.name : "") : e.name;
    $("kickerText").textContent = e.walkIn ? "في مكتب ترافليون الآن" : "✨ مسافر جديد مع ترافليون";
    $("aName").textContent = name || "";
    $("aName").style.display = name ? "block" : "none";
    $("aDest").textContent = e.walkIn ? "طلب " + e.line : e.line;
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
  var spotlightKey = "";
  function scenery(country) {
    var key = country.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ً-ْ]/g, "").trim();
    return window.__LANDMARKS__[key] ? "/screen-landmarks/" + window.__LANDMARKS__[key] + ".webp" : "/screen-landmarks/journey.svg";
  }
  // the polaroid strip (/screen/top) covers the bulletin: ONE strip over the whole wall at once, each
  // screen drawing its own part from the server's clock — told where it hangs and when the pass begins.
  // It is loaded and told half a minute AHEAD, and shown only once loaded, so when the bulletin comes up
  // it is already sized with its photos in — no green, no white, no settling on screen (the user, 2026-10-25)
  var polaroidStart = -1;
  function polaroid(t, elapsed, count) {
    if (!count || N < 1 || N > S.screens) return;
    var into = mod(t, 600000), start = elapsed >= 0 ? t - elapsed : into >= 570000 ? t - into + 600000 : -1;
    if (start < 0 || start === polaroidStart) return;
    polaroidStart = start;
    var pf = $("polaroid"), wall = { tt: "start", pos: S.position, of: S.screens, start: start, now: t };
    if (!pf.getAttribute("src")) {
      pf.onload = function () { setTimeout(function () { pf.className = "ready"; }, 1200); };
      pf.setAttribute("src", "/screen/top?pos=" + wall.pos + "&of=" + wall.of + "&start=" + wall.start + "&now=" + wall.now);
    } else try { pf.contentWindow.postMessage(wall, location.origin); } catch (e) { /* still loading: the link carried it */ }
  }
  function drawTicker(t) {
    var countries = S.countries || [];
    var elapsed = countryBulletinElapsed(t, N, S.screens);
    var active = countries.length > 0 && elapsed >= 0;
    polaroid(t, elapsed, countries.length);
    var panel = $("countries");
    panel.className = active ? (elapsed >= 58800 ? "on departing" : "on") : "";
    if (!active) { spotlightKey = ""; return; }
    var slot = 60000 / countries.length, index = Math.min(countries.length - 1, Math.floor(elapsed / slot));
    $("countryProgress").style.width = (100 * elapsed / 60000) + "%";
    var date = new Date(t + 3 * 3600000);
    var days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    var months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    $("bulletinDate").textContent = days[date.getUTCDay()] + "، " + date.getUTCDate() + " " + months[date.getUTCMonth()] + " " + date.getUTCFullYear();
    var key = Math.floor(t / 600000) + "|" + countries.join("|");
    if (key !== spotlightKey) {
      spotlightKey = key;
      // the share of demand as a bar, never a number (the owner: no counts on the screens)
      var stats = S.countryStats && S.countryStats.length ? S.countryStats : [];
      if (!stats.length) for (var c = 0; c < countries.length; c++) stats.push({ country: countries[c], count: countries.length - c });
      var top = stats[0].count || 1;
      var hero = $("heroImg");
      hero.style.visibility = "visible";
      hero.onerror = function () { this.style.visibility = "hidden"; };
      hero.src = scenery(stats[0].country);
      $("heroName").textContent = stats[0].country;
      var list = $("ranks");
      while (list.firstChild) list.removeChild(list.firstChild);
      for (var i = 1; i < stats.length && i < 8; i++) {
        var row = document.createElement("div"); row.className = "rk";
        row.style.webkitAnimationDelay = row.style.animationDelay = (0.7 + i * 0.22).toFixed(2) + "s";
        var rank = document.createElement("b"); rank.textContent = (i + 1 < 10 ? "0" : "") + (i + 1);
        var pic = document.createElement("img"); pic.alt = ""; pic.src = scenery(stats[i].country); pic.onerror = function () { this.style.visibility = "hidden"; };
        var name = document.createElement("span"); name.textContent = stats[i].country;
        var track = document.createElement("i"); var bar = document.createElement("u");
        bar.style.width = Math.max(10, Math.round(100 * stats[i].count / top)) + "%";
        bar.style.webkitAnimationDelay = bar.style.animationDelay = (1 + i * 0.22).toFixed(2) + "s";
        track.appendChild(bar);
        row.appendChild(rank); row.appendChild(pic); row.appendChild(name); row.appendChild(track);
        list.appendChild(row);
      }
      list.className = stats.length > 1 ? "" : "none";
      // restart the entrance for every new edition
      var panelNow = $("countries"); panelNow.className = ""; void panelNow.offsetWidth; panelNow.className = active ? (elapsed >= 58800 ? "on departing" : "on") : "";
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
#countries{position:absolute;inset:0;z-index:2;display:none;color:#fff;overflow:hidden;text-align:right;background:radial-gradient(120% 95% at 88% 8%,#17504f 0%,#0a2b2f 48%,#04171b 100%)}
#countries.on{display:block;-webkit-animation:bulletinEnter .8s ease both;animation:bulletinEnter .8s ease both}
#countries.on.departing{-webkit-animation:bulletinExit 1.1s ease both;animation:bulletinExit 1.1s ease both}
@keyframes bulletinEnter{from{opacity:0}to{opacity:1}}
@keyframes bulletinExit{from{opacity:1}to{opacity:0}}
.bHead{position:absolute;top:5.5vh;right:4.5vw;left:4.5vw;display:flex;align-items:flex-end;justify-content:space-between}
.bHead .eyebrow{display:flex;align-items:center;gap:.8vw;font-size:1.25vw;font-weight:800;color:#e3bd3c}
.bHead .eyebrow i{width:.8vw;height:.8vw;border-radius:50%;background:#e5354f;box-shadow:0 0 0 0 rgba(229,53,79,.7)}
#countries.on .bHead .eyebrow i{animation:livePing 1.6s infinite}
.bHead h1{margin:.8vh 0 0;font-size:3.7vw;font-weight:800;line-height:1.08}
.bHead p{margin:.6vh 0 0;font-size:1.3vw;font-weight:700;color:#a9c3bd}
#countries.on .bHead{animation:titleReveal .9s .25s cubic-bezier(.16,1,.3,1) both}
.bWhen{text-align:left;font-size:1.35vw;font-weight:700;color:#d7bd86}
@keyframes titleReveal{from{opacity:0;transform:translateY(1.6vh)}to{opacity:1;transform:translateY(0)}}
@keyframes livePing{0%{box-shadow:0 0 0 0 rgba(229,53,79,.7)}100%{box-shadow:0 0 0 1.2vw rgba(229,53,79,0)}}
#hero{position:absolute;top:22vh;bottom:9vh;right:4.5vw;width:40vw;border-radius:1.6vw;overflow:hidden;background:#123d40;box-shadow:0 2vw 4vw rgba(0,0,0,.45)}
#heroImg{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
#countries.on #heroImg{animation:sceneryDrift 36s linear both}
@keyframes sceneryDrift{from{transform:scale(1.1)}to{transform:scale(1)}}
#hero:after{content:"";position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(0deg,rgba(3,20,24,.96) 0%,rgba(3,20,24,.4) 48%,rgba(3,20,24,.06) 100%)}
#hero .crown{position:absolute;top:2vw;right:2vw;z-index:2;background:#e3bd3c;color:#0a2a2e;font-weight:800;font-size:1.35vw;border-radius:2vw;padding:.5vw 1.4vw}
#hero .first{position:absolute;right:2.2vw;bottom:10vw;z-index:2;font-size:5.4vw;font-weight:800;color:#e3bd3c;line-height:1;font-variant-numeric:tabular-nums}
#heroName{position:absolute;right:2.2vw;left:2.2vw;bottom:2.4vw;z-index:2;font-size:5.8vw;font-weight:800;line-height:1.05;text-shadow:0 .4vw 2vw rgba(0,0,0,.6)}
#countries.on #hero .crown,#countries.on #hero .first{animation:titleReveal .7s .6s cubic-bezier(.16,1,.3,1) both}
#countries.on #heroName{animation:heroPop .9s .8s cubic-bezier(.2,1.4,.4,1) both}
@keyframes heroPop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
#ranks{position:absolute;top:22vh;bottom:9vh;left:4.5vw;right:47vw;display:flex;flex-direction:column;justify-content:flex-start;gap:1.5vh}
#ranks.none{display:none}
.rk{display:grid;grid-template-columns:3.6vw 5.6vw minmax(0,1fr) 15vw;align-items:center;gap:1.3vw;height:8.2vh;padding:0 1.3vw;border-radius:1vw;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.07);opacity:0}
#countries.on .rk{animation:rowIn .6s cubic-bezier(.16,1,.3,1) both}
@keyframes rowIn{from{opacity:0;transform:translateX(-3vw)}to{opacity:1;transform:translateX(0)}}
.rk b{font-size:2.1vw;font-weight:800;color:#e3bd3c;font-variant-numeric:tabular-nums}
.rk img{width:5.6vw;height:6.2vh;border-radius:.7vw;object-fit:cover;background:#123d40}
.rk span{font-size:2.3vw;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rk i{display:block;height:1.2vh;border-radius:1vh;background:rgba(255,255,255,.1);overflow:hidden}
.rk u{display:block;height:100%;border-radius:1vh;background:linear-gradient(270deg,#c9a227,#f3d16b);transform-origin:right}
#countries.on .rk u{animation:barGrow 1s cubic-bezier(.16,1,.3,1) both}
@keyframes barGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.bFoot{position:absolute;bottom:3.6vh;left:4.5vw;right:4.5vw;font-size:1.1vw;font-weight:700;color:#8fb0a9}
.countryNote{font-size:1.2vw;color:#d7bd86}
.countryTrack{position:absolute;bottom:0;left:0;right:0;height:3px;background:#ffffff12;z-index:4}
#polaroid{position:absolute;left:0;top:0;width:100%;height:100%;border:0;z-index:3;background:#0b3a32;visibility:hidden}
#polaroid.ready{visibility:visible}
#countryProgress{height:100%;background:#e3bd3c;width:0}
#alertProgress{position:absolute;bottom:0;right:0;height:.4vh;background:#e3bd3c}
#alert{z-index:4}
@media(prefers-reduced-motion:reduce){#countries.on,#countries.on.departing,#countries.on #heroImg,#alert.on #alertImg,#countries.on .bHead,#countries.on .rk,#countries.on .rk u,#countries.on #heroName{animation:none;opacity:1}}

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
<div id="msg"><div id="kicker"><i></i><span id="kickerText">✨ مسافر جديد مع ترافليون</span></div><div id="aName"></div><div id="aDest"></div></div><div id="alertProgress"></div></div>
<section id="countries">
<header class="bHead"><div><div class="eyebrow"><i></i>ترافليون · نبض السفر</div><h1>الوجهات الأكثر طلباً اليوم</h1><p>بحسب طلبات العملاء اليوم · بتوقيت الرياض</p></div><div class="bWhen" id="bulletinDate"></div></header>
<div id="hero"><img id="heroImg" alt=""><div class="crown">الأكثر طلباً</div><div class="first">01</div><div id="heroName"></div></div>
<div id="ranks"></div>
<div class="bFoot">الوجهة القادمة تبدأ بسؤال — يتجدد كل 10 دقائق</div>
<iframe id="polaroid" title="الأكثر طلباً اليوم" scrolling="no"></iframe>
<div class="countryTrack"><div id="countryProgress"></div></div></section>
<div id="band"><div id="tick">${esc(s.ticker?.text ?? "")}</div></div>
<script>window.__LANDMARKS__=${json(LANDMARK_IDS)};window.__S__=${json(s)};window.__N__=${n};window.__M__=${monitor ? "true" : "false"};</script>
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
