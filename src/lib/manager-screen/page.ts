import type { ManagerScreenFeed } from "./rules";

/**
 * «قناة المدير» — the manager's office TV as a news channel (the owner,
 * 2026-10-19), in the owner's design order of 2026-10-20 («اريد تنسيق هذا الشكل
 * بشيء أجمل ومنسق وليس هكذا»): a channel lineup across the top, one report at a
 * time — four headline cards and two boxes of real content — the column of what
 * needs the manager now, and the gold band of today's events.
 *
 * The same light approach as the office screens (lib/office-screens/page.ts):
 * plain HTML and one ES5 script, no React; everything that moves is derived from
 * the server's clock (the offset set by each poll), everything from the feed is
 * escaped, errors are swallowed into what is on screen. Sized in vw from a
 * 1920-wide design, so a 1280 browser keeps the proportions; read from 3 m:
 * labels 26 px, numbers over 100 px, body 22 px at 1920.
 *
 * Internal data, so the route (app/m) serves it only to a dashboard.admin
 * session; the feed itself (api/manager-screen) refuses anyone else.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const LT = new RegExp(String.fromCharCode(60), "g");
const json = (v: unknown) => JSON.stringify(v).replace(LT, `${String.fromCharCode(92)}u003c`).replace(LS, "");
/** a 1920-wide design's pixels, in viewport widths */
const v = (px: number) => `${+(px / 19.2).toFixed(3)}vw`;

const RUNTIME = String.raw`
(function () {
  var F = window.__F__;
  var offset = F.now - Date.now(), born = Date.now(), lastRender = "", lastPanel = -1, lastTicker = "", lastSummary = "", lastNext = "";
  var PANEL_MS = 20000, SPEED = 90;
  var LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
  var DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  var CHIP = { green: "طبيعي", amber: "انتباه", red: "حرج" };
  var PCHIP = { green: "يسير جيداً", amber: "للمتابعة", red: "يحتاج تدخلك" };
  var PALETTE = ["#f0c419", "#e5636b", "#5aa0ff", "#9b8cff", "#f5a524", "#2fbf71"];
  var STATUS = { green: "#2fbf71", amber: "#f5a524", red: "#f0505a" };
  function now() { return Date.now() + offset; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function two(n) { return n < 10 ? "0" + n : "" + n; }

  function drawClock(t) {
    var d = new Date(t + 10800000);
    $("clock").textContent = two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
    $("date").textContent = DAYS[d.getUTCDay()] + " " + LRI + two(d.getUTCDate()) + "-" + two(d.getUTCMonth() + 1) + "-" + d.getUTCFullYear() + PDI;
  }

  // every chip says its word — a lone dot reads as nothing from across the room
  function chip(status, words) {
    return '<span class="chip s-' + esc(status) + '"><i></i>' + esc(words[status] || CHIP[status] || "") + "</span>";
  }

  // a target's ring: how much of it is used
  function ring(r, status) {
    var pct = r.target > 0 ? Math.max(0, Math.min(1, r.value / r.target)) : 0;
    return '<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3.2"/>' +
      '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + (STATUS[status] || STATUS.green) + '" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="' +
      (pct * 99.9).toFixed(1) + ' 100" transform="rotate(-90 18 18)"/></svg>';
  }

  function split(s) {
    var all = s.a + s.b, a = all ? (s.a / all) * 100 : 0;
    return '<div class="split"><div style="width:' + a.toFixed(1) + '%;background:#3fa6ff"></div><div style="width:' + (all ? (100 - a).toFixed(1) : 0) + '%;background:#5f7f78"></div></div>';
  }

  function kpi(k) {
    var n = String(k.num), size = n.length > 5 ? " n6" : n.length > 4 ? " n5" : n.length > 3 ? " n4" : "";
    var num = '<div class="num tnum' + size + '">' + esc(n) + (k.unit ? "<small>" + esc(k.unit) + "</small>" : "") + "</div>";
    return '<div class="kpi s-' + esc(k.status) + '"><div class="head"><label>' + esc(k.label) + "</label>" + chip(k.status, CHIP) + "</div>" +
      (k.ring ? '<div class="numrow">' + num + ring(k.ring, k.status) + "</div>" : num) +
      (k.split ? split(k.split) : "") +
      '<div class="sub">' + esc(k.sub) + "</div></div>";
  }

  function box(b) {
    var h = '<div class="box"><h3>' + esc(b.title) + "<span>" + esc(b.note) + "</span></h3>", items = b.items || [];
    if (!items.length) return h + '<div class="empty">' + esc(b.empty) + "</div></div>";
    for (var i = 0; i < items.length && i < 5; i++) {
      var it = items[i], st = it.status || "green";
      if (b.kind === "bars") {
        var color = st === "green" ? PALETTE[i % PALETTE.length] : STATUS[st];
        h += '<div class="bar"><span class="bl">' + esc(it.label) + '</span><div class="track"><div class="fill" style="width:' +
          Math.max(3, Math.round((it.share || 0) * 100)) + "%;background:" + color + '"></div></div><b class="tnum">' + esc(it.value) + "</b></div>";
      } else {
        var dot = it.presence ? "p-" + esc(it.presence) : "s-" + esc(st);
        h += '<div class="row s-' + esc(st) + '"><i class="dot ' + dot + '"></i><span class="n">' + esc(it.label) + '</span><span class="m tnum">' +
          esc(it.value) + '</span><span class="m d">' + esc(it.detail || "") + "</span></div>";
      }
    }
    return h + "</div>";
  }

  function drawPanel(t) {
    var n = F.panels.length;
    if (!n) return;
    var i = Math.floor(t / PANEL_MS) % n, left = PANEL_MS - (t % PANEL_MS);
    // the lineup's gold line fills as the report runs
    var bar = $("prog");
    if (bar) bar.style.width = ((1 - left / PANEL_MS) * 100).toFixed(2) + "%";
    var next = "التالي: " + F.panels[(i + 1) % n].short + " بعد " + Math.ceil(left / 1000) + " ث";
    if (next !== lastNext) { lastNext = next; $("next").textContent = next; }
    if (i === lastPanel) return;
    lastPanel = i;
    var p = F.panels[i], k = "", b = "", line = "";
    for (var a = 0; a < p.kpis.length && a < 4; a++) k += kpi(p.kpis[a]);
    for (var c = 0; c < p.boxes.length && c < 2; c++) b += box(p.boxes[c]);
    for (var j = 0; j < n; j++) {
      var q = F.panels[j];
      line += '<span class="' + (j === i ? "on" : "") + (q.status === "red" ? " warn" : "") + '">' + esc(q.short) + (j === i ? '<u><b id="prog"></b></u>' : "") + "</span>";
    }
    $("lineup").innerHTML = line;
    $("ptitle").textContent = p.title;
    $("pchip").innerHTML = chip(p.status, PCHIP);
    $("kpis").innerHTML = k;
    $("boxes").innerHTML = b;
  }

  function card(it, amber) {
    return '<div class="item' + (amber ? " amber" : "") + '"><b>' + esc(it.label) + ": " + esc(it.value) + "</b><p>" + esc(it.reason) + "</p>" +
      (amber ? "" : '<div class="act">← ' + esc(it.action) + "</div>") + "</div>";
  }

  function drawFixed() {
    var key = F.at + "|" + F.overall + "|" + F.urgent.length + "|" + F.watch.length;
    if (key === lastRender) return;
    lastRender = key;
    lastPanel = -1;
    var state = $("state"), red = F.urgent.length, amber = F.watch.length;
    state.className = "state s-" + F.overall;
    state.textContent = "● " + (red ? "حرج: " + red : amber ? "للمتابعة: " + amber : "كل شيء يسير جيداً");

    var h = '<h2>يحتاج تدخلك الآن' + (red ? '<em class="tnum">' + red + "</em>" : "") + "</h2>", k;
    if (red) {
      for (k = 0; k < red && k < 3; k++) h += card(F.urgent[k], false);
      if (red > 3) h += '<div class="more">و' + (red - 3) + " أخرى</div>";
    } else {
      h += '<div class="calm"><i>✓</i><b>لا شيء يحتاج تدخلك</b><span>كل الأقسام تسير جيداً الآن</span></div>';
    }
    if (amber) {
      // what the column holds below the red cards (or the calm state): three red leave room for the heading only
      var room = red >= 3 ? 0 : red === 2 ? 1 : 2;
      h += '<div class="watch">تحت المتابعة <em class="tnum">' + amber + "</em></div>";
      for (k = 0; k < amber && k < room; k++) h += card(F.watch[k], true);
      if (amber > room) h += '<div class="more">و' + (amber - room) + " أخرى</div>";
    }
    var at = new Date(Date.parse(F.at) + 10800000);
    h += '<div class="ok">● يتحدّث كل دقيقة · آخر تحديث ' + LRI + two(at.getUTCHours()) + ":" + two(at.getUTCMinutes()) + PDI + "</div>";
    var side = $("side");
    side.className = red ? "" : "calm";
    side.innerHTML = h;

    var words = "";
    for (var j = 0; j < F.ticker.length; j++) {
      var e = F.ticker[j];
      words += '<span class="' + (e.red ? "ti bad" : "ti") + '">' + esc(e.text) + "</span>";
    }
    if (words !== lastTicker) { lastTicker = words; $("tick").innerHTML = words || '<span class="ti">لا أحداث اليوم بعد</span>'; }
  }

  // left to right, as an Arabic news ticker; the loop from the clock alone
  function drawTicker(t) {
    var el = $("tick"), w = el.offsetWidth, box = $("rail").offsetWidth;
    if (!w || !box) return;
    var loop = w + box, x = ((t / 1000) * SPEED) % loop - w;
    var tr = "translate3d(" + x.toFixed(1) + "px,0,0)";
    el.style.webkitTransform = tr;
    el.style.transform = tr;
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
    for (var k = 0; k < lines.length; k++) if (lines[k]) h += "<li>" + esc(lines[k]) + "</li>";
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
:root{--card:rgba(255,255,255,.045);--line:rgba(255,255,255,.09);--text:#f2f7f5;--muted:#93b1aa;--dim:#5f7f78;--green:#2fbf71;--amber:#ff8f3a;--red:#f0505a;--gold:#f0ad22}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;cursor:none}
body{height:100vh;height:100dvh;font-family:Tajawal,"Noto Sans Arabic",Tahoma,Arial,sans-serif;font-weight:500;color:var(--text);
  background:radial-gradient(62vw 65vh at 85% 0%,#0c3d36 0%,transparent 60%),linear-gradient(160deg,#06302b,#021a17);
  display:grid;grid-template-rows:${v(112)} minmax(0,1fr) ${v(84)}}
.tnum,.num,.clock b{font-variant-numeric:tabular-nums}
.s-green{--c:var(--green)}.s-amber{--c:var(--amber)}.s-red{--c:var(--red)}

header{display:flex;align-items:center;gap:${v(28)};padding:0 ${v(48)};border-bottom:1px solid var(--line);min-width:0}
.brand{display:flex;align-items:center;gap:${v(14)};flex:0 0 auto}
.brand svg{width:${v(54)};height:${v(54)}}
.brand b{display:block;font-size:${v(34)};font-weight:800;line-height:1.1}
.brand small{display:block;font-size:${v(15)};color:var(--muted);letter-spacing:${v(3)};direction:ltr;text-align:right}
.live{flex:0 0 auto;display:inline-flex;align-items:center;gap:${v(10)};padding:${v(8)} ${v(18)};border-radius:${v(999)};background:rgba(240,80,90,.14);color:#ff8a92;font-size:${v(22)};font-weight:800}
.live i{width:${v(12)};height:${v(12)};border-radius:50%;background:var(--red);box-shadow:0 0 0 ${v(6)} rgba(240,80,90,.18)}
#lineup{flex:1;display:flex;justify-content:center;gap:${v(8)};min-width:0}
#lineup span{position:relative;padding:${v(10)} ${v(16)};font-size:${v(22)};font-weight:700;color:var(--dim);white-space:nowrap}
#lineup span.on{color:var(--text)}
#lineup u{position:absolute;inset-inline:${v(14)};bottom:0;height:${v(4)};border-radius:${v(4)};background:rgba(240,173,34,.25);overflow:hidden}
#lineup u b{position:absolute;inset-inline-start:0;top:0;bottom:0;width:0;background:var(--gold)}
#lineup span.warn:before{content:"";position:absolute;top:${v(8)};inset-inline-end:${v(4)};width:${v(9)};height:${v(9)};border-radius:50%;background:var(--red)}
.state{flex:0 0 auto;display:inline-flex;align-items:center;padding:${v(10)} ${v(22)};border-radius:${v(14)};background:var(--c);color:#fff;font-size:${v(24)};font-weight:800;white-space:nowrap}
.state.s-green{background:rgba(47,191,113,.18);color:#7fe0a8}
.clock{flex:0 0 auto;text-align:left}
.clock b{display:block;font-size:${v(52)};font-weight:800;line-height:1}
.clock span{font-size:${v(18)};color:var(--muted)}

main{display:grid;grid-template-columns:minmax(0,1fr) ${v(500)};gap:${v(32)};padding:${v(30)} ${v(48)} ${v(28)};min-height:0}
.panel{display:grid;grid-template-rows:auto ${v(300)} minmax(0,1fr);gap:${v(24)};min-height:0;min-width:0}
.title{display:flex;align-items:flex-end;gap:${v(20)};min-width:0}
.eyebrow{font-size:${v(20)};color:var(--muted);margin-bottom:${v(8)}}
.title h1{font-size:${v(54)};font-weight:800;line-height:1;white-space:nowrap}
.chip{display:inline-flex;align-items:center;gap:${v(8)};padding:${v(6)} ${v(14)};border-radius:${v(999)};font-size:${v(19)};font-weight:800;white-space:nowrap;background:rgba(255,255,255,.06);color:var(--c)}
.chip i{width:${v(10)};height:${v(10)};border-radius:50%;background:var(--c)}
.chip.s-red{background:rgba(240,80,90,.15);color:#ff9aa1}.chip.s-green{background:rgba(47,191,113,.14);color:#7fe0a8}.chip.s-amber{background:rgba(245,165,36,.15);color:#ffc768}
.next{margin-inline-start:auto;font-size:${v(19)};color:var(--dim);white-space:nowrap}

#kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${v(24)};min-height:0}
.kpi{position:relative;border-radius:${v(22)};background:var(--card);border:1px solid var(--line);padding:${v(26)} ${v(30)};display:flex;flex-direction:column;overflow:hidden;min-width:0}
.kpi:before{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;width:${v(6)};background:var(--c)}
.kpi.s-red{background:linear-gradient(160deg,rgba(240,80,90,.16),rgba(240,80,90,.05));border-color:rgba(240,80,90,.45)}
.kpi.s-amber{background:linear-gradient(160deg,rgba(245,165,36,.1),rgba(245,165,36,.03));border-color:rgba(245,165,36,.3)}
.kpi .head{display:flex;align-items:center;justify-content:space-between;gap:${v(10)}}
.kpi label{font-size:${v(26)};font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .chip{font-size:${v(17)};padding:${v(5)} ${v(12)};flex:0 0 auto}
.chip.dot-only{padding:${v(9)}}
.num{font-size:${v(112)};font-weight:800;line-height:1;margin-top:${v(18)};white-space:nowrap}
.num.n4{font-size:${v(96)}}.num.n5{font-size:${v(80)}}.num.n6{font-size:${v(64)}}
.num small{font-size:${v(40)};font-weight:700;color:var(--muted);margin-inline-start:${v(8)}}
.numrow{display:flex;align-items:center;justify-content:space-between;margin-top:${v(18)}}
.numrow .num{margin-top:0}
.ring{width:${v(104)};height:${v(104)};flex:0 0 auto}
.split{display:flex;height:${v(10)};border-radius:${v(10)};overflow:hidden;margin-top:${v(14)};background:rgba(255,255,255,.06)}
.split div{height:100%}
.sub{margin-top:auto;font-size:${v(22)};line-height:1.3;color:var(--muted);font-weight:500;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

#boxes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${v(24)};min-height:0}
.box{border-radius:${v(22)};background:var(--card);border:1px solid var(--line);padding:${v(26)} ${v(30)};min-height:0;min-width:0;overflow:hidden}
.box h3{font-size:${v(26)};font-weight:800;margin-bottom:${v(18)};display:flex;align-items:center;justify-content:space-between;gap:${v(12)}}
.box h3 span{font-size:${v(19)};color:var(--dim);font-weight:700;white-space:nowrap}
.bar{display:grid;grid-template-columns:minmax(0,44%) minmax(0,1fr) auto;align-items:center;gap:${v(18)};margin-bottom:${v(14)};line-height:1.4;font-size:${v(25)};font-weight:700}
.bl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{height:${v(18)};border-radius:${v(9)};background:rgba(255,255,255,.06);overflow:hidden}
.fill{height:100%;border-radius:${v(9)}}
.bar b{text-align:left;font-size:${v(28)};white-space:nowrap}
.row{display:grid;grid-template-columns:${v(22)} minmax(36%,1fr) auto minmax(0,auto);align-items:center;gap:${v(16)};padding:${v(10)} 0;line-height:1.4;border-bottom:1px solid var(--line);font-size:${v(24)}}
.row:last-child{border-bottom:0}
.row .dot{width:${v(14)};height:${v(14)};border-radius:50%;background:var(--c)}
.dot.p-online{background:var(--green)}.dot.p-busy{background:var(--amber)}.dot.p-offline{background:var(--dim)}
.row .n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row.s-red .n{color:#ff9aa1}.row.s-amber .n{color:var(--amber)}
.row .m{color:var(--muted);font-size:${v(21)};white-space:nowrap}
.row .m.d{max-width:${v(300)};overflow:hidden;text-overflow:ellipsis}
.empty{display:flex;align-items:center;justify-content:center;height:70%;font-size:${v(24)};color:var(--dim);text-align:center}

aside#side{border-radius:${v(26)};border:1px solid rgba(240,80,90,.4);background:linear-gradient(180deg,rgba(240,80,90,.12),rgba(240,80,90,.03) 40%,rgba(255,255,255,.02));padding:${v(28)};display:flex;flex-direction:column;gap:${v(16)};min-height:0;overflow:hidden}
aside#side.calm{border-color:rgba(47,191,113,.35);background:linear-gradient(180deg,rgba(47,191,113,.1),rgba(47,191,113,.02) 40%,rgba(255,255,255,.02))}
aside h2{display:flex;align-items:center;justify-content:space-between;font-size:${v(32)};font-weight:800;color:#ff9aa1}
aside.calm h2{color:#7fe0a8}
aside h2 em,.watch em{font-style:normal;min-width:${v(52)};height:${v(52)};padding:0 ${v(12)};border-radius:${v(26)};background:var(--red);color:#fff;display:grid;place-items:center;font-size:${v(28)}}
.item{border-radius:${v(18)};background:rgba(0,0,0,.25);border:1px solid rgba(240,80,90,.35);border-inline-start:${v(7)} solid var(--red);padding:${v(18)} ${v(22)}}
.item b{display:block;font-size:${v(27)};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item p{margin-top:${v(8)};font-size:${v(22)};color:var(--muted);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.item .act{margin-top:${v(12)};font-size:${v(20)};color:#ffc768;font-weight:700}
.item.amber{border-color:rgba(245,165,36,.3);border-inline-start-color:var(--amber);padding:${v(14)} ${v(20)}}
.item.amber b{font-size:${v(24)}}
.watch{display:flex;align-items:center;justify-content:space-between;margin-top:${v(4)};font-size:${v(22)};font-weight:800;color:var(--muted)}
.watch em{min-width:${v(40)};height:${v(40)};font-size:${v(22)};background:rgba(245,165,36,.25);color:#ffc768}
.calm{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${v(10)};padding:${v(26)} 0}
.calm i{font-style:normal;width:${v(120)};height:${v(120)};border-radius:50%;display:grid;place-items:center;background:rgba(47,191,113,.16);color:var(--green);font-size:${v(64)};font-weight:800}
.calm b{font-size:${v(36)};font-weight:800;color:#7fe0a8}
.calm span{font-size:${v(22)};color:var(--muted)}
.more{font-size:${v(20)};color:var(--muted);font-weight:700}
.ok{margin-top:auto;font-size:${v(20)};color:#7fe0a8}

footer{display:flex;align-items:stretch;background:var(--gold);color:#10221f;overflow:hidden}
footer .now{position:relative;z-index:1;display:grid;place-items:center;padding:0 ${v(34)};background:#0b2b27;color:var(--gold);font-size:${v(30)};font-weight:800}
#rail{position:relative;flex:1;overflow:hidden}
#tick{position:absolute;left:0;top:50%;transform:translateY(-50%);white-space:nowrap;direction:rtl;font-size:${v(30)};font-weight:800;line-height:1.3;will-change:transform}
.ti{display:inline-block;margin-inline-end:${v(44)}}
.ti:before{content:"◆";font-size:${v(16)};margin-inline-end:${v(16)};color:#0b2b27;vertical-align:middle}
.ti.bad{color:#9b1c25}

#summary{position:fixed;inset:0;z-index:5;background:rgba(2,26,23,.97);display:flex;flex-direction:column;justify-content:center;padding:${v(80)} ${v(160)};opacity:0;pointer-events:none;-webkit-transition:opacity .6s;transition:opacity .6s}
#summary.on{opacity:1}
#stitle{font-size:${v(62)};font-weight:800;color:var(--gold);margin-bottom:${v(36)}}
#slines{margin:0;padding:0 ${v(36)} 0 0;font-size:${v(34)};font-weight:700;line-height:1.7}
`;

/** the logo mark, as the office screens draw it */
const MARK = `<svg viewBox="230 201 116 126" aria-hidden="true"><path fill="#ffffff" fill-opacity="0.55" d="M243.98,226.78l35.4,0.12l0.01,28.5c0,6.09,4.94,11.02,11.03,11.02h29.36l-0.06,34.98c-0.01,4.83-2.22,9.39-6.01,12.39l-11.77,9.29c-2.11,1.67-5.21,0.16-5.21-2.52l-0.01-30.97l-29.43-0.17c-5.99-0.03-10.82-4.89-10.85-10.87l-0.1-29.03l-31.58,0.47c-2.7,0.04-4.25-3.06-2.59-5.19l9.26-11.91C234.44,229.01,239.07,226.76,243.98,226.78z"/><path fill="#ffffff" d="M342.84,213.91l-0.04,26.63c-0.01,4.88-2.25,9.49-6.1,12.5l-17.06,13.38l-0.01-29.46c0-5.62-4.57-10.18-10.19-10.16l-30.06,0.08l13.1-17.35c3.01-3.98,7.71-6.33,12.71-6.33h26.96C338.06,203.21,342.85,208,342.84,213.91z"/></svg>`;

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
<header>
  <div class="brand">${MARK}<div><b>ترافليون</b><small>TRAVELIUN</small></div></div>
  <span class="live"><i></i>مباشر</span>
  <nav id="lineup"></nav>
  <span class="state s-${esc(feed.overall)}" id="state"></span>
  <div class="clock"><b id="clock"></b><span id="date"></span></div>
</header>
<main>
  <section class="panel">
    <div class="title"><div><div class="eyebrow">التقرير الحالي</div><h1 id="ptitle"></h1></div><span id="pchip"></span><span class="next" id="next"></span></div>
    <div id="kpis"></div>
    <div id="boxes"></div>
  </section>
  <aside id="side"></aside>
</main>
<footer><div class="now">الآن</div><div id="rail"><div id="tick"></div></div></footer>
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
