import type { ManagerScreenFeed } from "./rules";

/**
 * «قناة المدير» — the manager's office TV as an economic news channel (the user,
 * 2026-10-22: «اعتبرها شاشة قناة فضائية و تنقل بيانات كاملة … وحتى الاسلوب اريد
 * تصميمهم كقناة اخبارية اقتصادية»): the channel bar with its lineup and clock, a
 * market strip of today's headline figures, one segment at a time in the studio —
 * a lower third saying the whole fact («9 محادثات بانتظار الرد — أطولها 23 د عند …»)
 * over a visual that shows it (the waiting conversations lane by lane under the
 * colleague who holds them, today by the hour, a destinations board, a departures
 * board of today's and tomorrow's steps, the team table, the campaigns) — the rail
 * of what needs the manager now, a red «عاجل» strip, and the gold crawl.
 *
 * The same light approach as the office screens (lib/office-screens/page.ts):
 * plain HTML and one ES5 script, no React; everything that moves is derived from
 * the server's clock (the offset set by each poll), everything from the feed is
 * escaped, errors are swallowed into what is on screen. Sized in vw from a
 * 1920-wide design, read from 3 m.
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
  var offset = F.now - Date.now(), born = Date.now();
  var SEG_MS = 20000, SPEED = 70;
  var LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
  var DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  var MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  var WORD = { green: "طبيعي", amber: "انتباه", red: "حرج" };
  var OVERALL = { green: "كل شيء يسير جيداً", amber: "للمتابعة", red: "يحتاج تدخلك" };
  var shown = { seg: "", index: "", rail: "", tick: "", breaking: "", summary: "" };
  // ?seg=0…6 holds one segment on screen — to look at one without waiting for its turn
  var HOLD = (location.search.match(/seg=([0-9])/) || [])[1];
  function now() { return Date.now() + offset; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function two(n) { return n < 10 ? "0" + n : "" + n; }
  function mins(m) { if (m == null) return "—"; if (m < 60) return Math.round(m) + " د"; if (m < 2880) return Math.round(m / 60) + " س"; return Math.round(m / 1440) + " يوم"; }
  function count(n, one, two_, few) { return n === 1 ? one : n === 2 ? two_ : n <= 10 ? n + " " + few : n + " " + one; }
  function panel(key) { for (var i = 0; i < F.panels.length; i++) if (F.panels[i].key === key) return F.panels[i]; return null; }
  function riyadh(t) { return new Date(t + 10800000); }
  // the rows the room holds, the rest counted under them: measured on the TV, not reckoned from the
  // design (a fixed 8 left the team table four names short over a third of an empty box, 2026-10-22)
  function fit(root) {
    var boxes = root.querySelectorAll("[data-more]");
    for (var i = 0; i < boxes.length; i++) {
      var el = boxes[i], rows = el.querySelectorAll(".row"), hidden = 0, rest = null;
      if (el.scrollHeight > el.clientHeight + 1) el.className += " dense";
      while (el.scrollHeight > el.clientHeight + 1 && hidden < rows.length) {
        rows[rows.length - 1 - hidden].style.display = "none";
        hidden++;
        if (!rest) { rest = document.createElement("div"); rest.className = "rest"; el.insertBefore(rest, el.querySelector(".closed")); }
        rest.textContent = "و" + hidden + " " + el.getAttribute("data-more");
      }
    }
  }

  function drawClock(t) {
    var d = riyadh(t);
    $("clock").textContent = two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
    $("date").textContent = DAYS[d.getUTCDay()] + " " + LRI + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() + PDI;
  }

  // ---------------------------------------------------------------- the market strip
  function drawIndex() {
    var c = F.channel, key = F.at;
    if (shown.index === key) return;
    shown.index = key;
    var h = "";
    for (var i = 0; i < c.index.length; i++) {
      var x = c.index[i];
      h += '<div class="ix s-' + esc(x.status) + '"><label>' + esc(x.label) + '</label><b class="tnum">' + esc(x.value) + "</b><small>" + esc(x.note) + "</small></div>";
    }
    $("index").innerHTML = h;
    var o = $("overall");
    o.className = "overall s-" + F.overall;
    o.innerHTML = "<i></i>" + esc(OVERALL[F.overall] || "") + (F.urgent.length ? " · " + F.urgent.length : "");
  }

  // ---------------------------------------------------------------- the segments
  function figures(p) {
    var h = '<div class="figs">';
    for (var i = 0; i < p.kpis.length; i++) {
      var k = p.kpis[i];
      h += '<div class="fig s-' + esc(k.status) + '"><div class="fh"><label>' + esc(k.label) + '</label><span class="w">' + esc(WORD[k.status]) + '</span></div><b class="tnum">' + esc(k.num) + (k.unit ? "<em>" + esc(k.unit) + "</em>" : "") + "</b><small>" + esc(k.sub) + "</small></div>";
    }
    return h + "</div>";
  }
  function bars(items, valueOf) {
    var max = 0, h = "";
    for (var i = 0; i < items.length; i++) if (items[i][1] > max) max = items[i][1];
    for (var j = 0; j < items.length; j++) {
      var share = max ? items[j][1] / max : 0;
      h += '<div class="bar"><span>' + esc(items[j][0]) + '</span><i><u style="width:' + Math.max(4, Math.round(share * 100)) + '%"></u></i><b class="tnum">' + esc(valueOf ? valueOf(items[j][1]) : items[j][1]) + "</b></div>";
    }
    return h;
  }
  function box(title, note, inner) {
    return '<section class="box"><header><h3>' + esc(title) + "</h3><span>" + esc(note) + "</span></header>" + inner + "</section>";
  }
  function hoursChart(hours) {
    var max = 1, n = 24, h = "", peak = 0;
    for (var i = 0; i < hours.length; i++) if (hours[i] > max) { max = hours[i]; peak = i; }
    var W = 100 / n;
    for (var k = 0; k < n; k++) {
      var val = k < hours.length ? hours[k] : 0, future = k >= hours.length, cur = k === hours.length - 1;
      var hgt = future ? 2 : Math.max(2, Math.round(val / max * 100));
      h += '<div class="hb' + (future ? " fut" : "") + (cur ? " cur" : "") + '" style="width:' + W + '%"><i style="height:' + hgt + '%">' + (!future && val && (cur || k === peak) ? "<b>" + val + "</b>" : "") + "</i>" + (k % 6 === 0 ? "<em>" + two(k) + "</em>" : "") + "</div>";
    }
    return '<div class="hours">' + h + "</div>";
  }

  function segConversations() {
    var w = F.channel.waiting, lanes = w.lanes, head, body = "";
    var longest = null, at = "";
    for (var i = 0; i < lanes.length; i++) if (lanes[i].waits.length && (longest === null || lanes[i].waits[0].minutes > longest)) { longest = lanes[i].waits[0].minutes; at = lanes[i].agent; }
    if (!w.known) head = "تليتيل لا يرد الآن — أوقات الانتظار غير معروفة";
    else if (!w.total) head = "لا أحد ينتظر رداً الآن";
    else head = count(w.total, "محادثة واحدة", "محادثتان", "محادثات") + " بانتظار الرد — أطولها " + mins(longest) + " عند " + at;
    if (w.known && w.total) {
      for (var j = 0; j < lanes.length; j++) {
        var l = lanes[j], chips = "";
        for (var c = 0; c < l.waits.length && c < 10; c++) {
          var x = l.waits[c];
          chips += '<span class="wc s-' + esc(x.status) + '"><b class="tnum">' + esc(mins(x.minutes)) + "</b>" + (x.client ? "<small>" + esc(x.client) + "</small>" : "") + "</span>";
        }
        if (l.waits.length > 10) chips += '<span class="wc more">+' + (l.waits.length - 10) + "</span>";
        body += '<div class="lane row"><div class="who"><i class="pd ' + (l.presence ? "p-" + esc(l.presence) : "p-none") + '"></i><b>' + esc(l.agent) + '</b><em class="tnum">' + l.waits.length + '</em></div><div class="chips">' + chips + "</div></div>";
      }
    } else {
      body = '<div class="calm big"><b>✓</b>' + esc(w.known ? "كل العملاء تلقّوا رداً" : "سنعرض الانتظار حين يرد تليتيل") + "</div>";
    }
    // today's closings in Teletel, and where the returning clients went (order 2's lifecycle)
    var cl = F.channel.closures;
    if (cl && cl.employee + cl.system + cl.murad + cl.travelling + cl.returned + cl.unassigned > 0) {
      body += '<div class="closed"><span>أُغلقت اليوم: <b class="tnum">' + (cl.employee + cl.system + cl.murad) + '</b></span><span>موظف ' + cl.employee + '</span><span>النظام ' + cl.system + '</span>' + (cl.murad ? '<span>مُراد ' + cl.murad + '</span>' : '') + (cl.travelling ? '<span>مسافرون ' + cl.travelling + '</span>' : '') + '<span class="back">عادت لموظفها ' + cl.returned + '</span><span class="back">عادت طلباً جديداً ' + cl.unassigned + '</span></div>';
    }
    var kinds = F.channel.kinds.slice(0, 6);
    var side = box("حركة المحادثات اليوم بالساعة", "حتى الآن", hoursChart(F.channel.hours)) + box("حسب نوع الطلب", "اليوم", bars(kinds));
    return { head: head, body: '<div class="split"><div class="main">' + box("بانتظار الرد — لدى كل موظف", "الأحمر تجاوز الحد", '<div class="lanes" data-more="موظفين آخرين لديهم محادثات بانتظار الرد">' + body + "</div>") + '</div><div class="aside">' + side + "</div></div>" };
  }

  function segSales() {
    var p = panel("sales"), d = F.channel.destinations, rows = "";
    var max = 1;
    for (var i = 0; i < d.length; i++) if (d[i].requests > max) max = d[i].requests;
    for (var j = 0; j < d.length; j++) {
      var x = d[j];
      rows += '<div class="tr row"><span class="c">' + esc(x.country) + '</span><span class="g"><i><u style="width:' + Math.max(4, Math.round(x.requests / max * 100)) + '%"></u></i><b class="tnum">' + x.requests + '</b></span><span class="n tnum">' + x.issued + '</span><span class="n tnum ok">' + (x.confirmed ? "✓ " + x.confirmed : "—") + "</span></div>";
    }
    var table = d.length ? '<div class="tbl" data-more="وجهات أخرى"><div class="th"><span>الوجهة</span><span>محادثات اليوم</span><span>عروض صدرت</span><span>تأكدت</span></div>' + rows + "</div>" : '<div class="calm">لا وجهة محددة في محادثات اليوم بعد</div>';
    var top = d.length ? "الوجهة الأولى اليوم: " + d[0].country + " — " + d[0].requests + " محادثة" : "لا وجهة محددة بعد";
    return { head: top, body: figures(p) + box("لوحة الوجهات", "اليوم منذ منتصف الليل", table) };
  }

  function segOperations() {
    var p = panel("operations"), ops = F.channel.ops, rows = "";
    for (var i = 0; i < ops.length; i++) {
      var x = ops[i];
      rows += '<div class="dep row s-' + esc(x.status) + '"><span class="sn tnum">' + esc(x.serial) + '</span><span class="when">' + esc(x.when) + '</span><span class="what">' + esc(x.what) + '</span><span class="lamp"><i></i>' + esc(WORD[x.status]) + "</span></div>";
    }
    var board = ops.length ? '<div class="deps" data-more="ملفات أخرى"><div class="dh"><span>الملف</span><span>الموعد</span><span>الخطوة</span><span>الحالة</span></div>' + rows + "</div>" : '<div class="calm big"><b>✓</b>لا خطوة مستحقة اليوم أو غداً</div>';
    var head = ops.length ? count(ops.length, "ملف واحد", "ملفان", "ملفات") + " عليها خطوة اليوم أو غداً" : "العمليات جاهزة لليوم وغداً";
    return { head: head, body: figures(p) + box("لوحة الخطوات — اليوم وغداً", "مثل لوحة المغادرة", board) };
  }

  function segTeam() {
    var a = F.channel.agents, rows = "", maxOpen = 1, list = a.list;
    for (var i = 0; i < list.length; i++) if (list[i].open > maxOpen) maxOpen = list[i].open;
    for (var j = 0; j < list.length; j++) {
      var x = list[j];
      rows += '<div class="tr t5 row"><span class="c"><i class="pd p-' + esc(x.presence) + '"></i>' + esc(x.name) + '</span><span class="g"><i><u style="width:' + Math.max(4, Math.round(x.open / maxOpen * 100)) + '%"></u></i><b class="tnum">' + x.open + '</b></span><span class="n tnum">' + x.replies + '</span><span class="n tnum s-' + esc(x.status) + '">' + esc(mins(x.avg)) + "</span></div>";
    }
    var table = a.list.length ? '<div class="tbl" data-more="غيرهم تحركت محادثاتهم اليوم"><div class="th t5"><span>الموظف</span><span>مفتوحة اليوم</span><span>ردود اليوم</span><span>متوسط أول رد</span></div>' + rows + "</div>" : '<div class="calm">' + esc(a.known ? "لا أحد متصل ولا محادثة تحركت اليوم" : "تليتيل لا يرد") + "</div>";
    var head = a.known ? a.present + " متصلون على تليتيل من " + a.total : "تليتيل لا يرد — حالة الفريق غير معروفة";
    return { head: head, body: box("الفريق على تليتيل — اليوم", "الأخضر متصل · البرتقالي مشغول · الرمادي غير متصل", table) };
  }

  function segAds() {
    var p = panel("ads"), c = F.channel.campaigns, cur = F.channel.currency, rows = "";
    var money = function (n) { return cur === "USD" ? "$" + n.toFixed(2) : n.toFixed(2) + " " + cur; };
    var max = 0.01;
    for (var i = 0; i < c.length; i++) if (c[i].spend > max) max = c[i].spend;
    for (var j = 0; j < c.length; j++) {
      var x = c[j];
      rows += '<div class="tr t4 row"><span class="c">' + esc(x.name) + '</span><span class="g"><i><u style="width:' + Math.max(4, Math.round(x.spend / max * 100)) + '%"></u></i><b class="tnum">' + esc(money(x.spend)) + '</b></span><span class="n tnum s-' + esc(x.status) + '">' + (x.conversions ? x.conversions + " تحويل" : "بلا تحويل") + "</span></div>";
    }
    var table = c.length ? '<div class="tbl" data-more="حملات أخرى"><div class="th t4"><span>الحملة</span><span>الإنفاق اليوم</span><span>تحويلات Google</span></div>' + rows + "</div>" : '<div class="calm">لم تصل أرقام الحملات لهذا اليوم بعد</div>';
    var spend = panel("ads") ? panel("ads").tiles[0] : null;
    return { head: spend ? "إنفاق الإعلانات اليوم: " + spend.value : "الإعلانات", body: figures(p) + box("الحملات اليوم", "حسب الإنفاق", table) };
  }

  function segRows(key, headOf) {
    var p = panel(key), rows = "";
    var b = p.boxes[1] && p.boxes[1].items.length ? p.boxes[1] : p.boxes[0];
    for (var i = 0; b && i < b.items.length; i++) {
      var x = b.items[i];
      rows += '<div class="li row s-' + esc(x.status || "green") + '"><i></i><b>' + esc(x.label) + "</b><span>" + esc(x.detail || "") + '</span><em class="tnum">' + esc(x.value) + "</em></div>";
    }
    return { head: headOf(p), body: figures(p) + box(b ? b.title : p.title, b ? b.note : "", rows ? '<div class="list" data-more="غيرها">' + rows + "</div>" : '<div class="calm">' + esc(b ? b.empty : "") + "</div>") };
  }

  var SEGMENTS = [
    { key: "conversations", title: "المحادثات", draw: segConversations },
    { key: "sales", title: "المبيعات", draw: segSales },
    { key: "operations", title: "العمليات", draw: segOperations },
    { key: "team", title: "الفريق", draw: segTeam },
    { key: "ads", title: "الإعلانات", draw: segAds },
    { key: "murad", title: "مُراد", draw: function () { return segRows("murad", function (p) { return "مُراد اليوم: " + p.kpis[0].num + " رد آلي · " + p.kpis[1].num + " تسليم لزميل"; }); } },
    { key: "system", title: "النظام", draw: function () { return segRows("system", function (p) { return p.status === "green" ? "كل أنظمة الشركة تعمل" : "تنبيه في الأنظمة — " + p.kpis[0].sub; }); } },
  ];

  function drawSegment(t) {
    var n = SEGMENTS.length, i = HOLD != null ? Number(HOLD) % n : Math.floor(t / SEG_MS) % n, into = (t % SEG_MS) / SEG_MS;
    var lineup = "";
    for (var k = 0; k < n; k++) {
      var p = panel(SEGMENTS[k].key);
      lineup += '<span class="' + (k === i ? "on" : "") + '">' + (p && p.status === "red" ? '<i class="dot"></i>' : "") + esc(SEGMENTS[k].title) + (k === i ? '<u style="width:' + Math.round(into * 100) + '%"></u>' : "") + "</span>";
    }
    $("lineup").innerHTML = lineup;
    var key = i + "|" + F.at;
    if (shown.seg === key) return;
    shown.seg = key;
    var seg = SEGMENTS[i], p = panel(seg.key), out;
    try { out = seg.draw(); } catch (e) { out = { head: seg.title, body: "" }; }
    var st = p ? p.status : "green";
    $("segTag").className = "tag s-" + st;
    $("segTag").textContent = seg.title;
    $("segHead").textContent = out.head;
    $("segNext").textContent = "التالي: " + SEGMENTS[(i + 1) % n].title;
    var body = $("segBody");
    body.innerHTML = out.body;
    fit(body);
    body.className = "";
    void body.offsetWidth;
    body.className = "in";
  }

  // ---------------------------------------------------------------- the rail, the breaking strip, the crawl
  function drawRail() {
    var key = F.at;
    if (shown.rail === key) return;
    shown.rail = key;
    var h = "";
    for (var i = 0; i < F.urgent.length && i < 4; i++) {
      var u = F.urgent[i];
      h += '<div class="uc"><small>' + esc(u.panelTitle) + "</small><b>" + esc(u.label) + ": " + esc(u.value) + "</b><p>" + esc(u.detail || u.reason) + "</p><em>← " + esc(u.action) + "</em></div>";
    }
    if (!F.urgent.length) h = '<div class="calm rail"><b>✓</b>لا شيء يحتاج تدخلك الآن</div>';
    var wch = "";
    for (var j = 0; j < F.watch.length; j++) wch += '<li class="row">' + esc(F.watch[j].label) + ": " + esc(F.watch[j].value) + "</li>";
    $("ucount").textContent = F.urgent.length ? String(F.urgent.length) : "";
    $("urgent").innerHTML = h;
    $("watch").innerHTML = wch ? "<h4>تحت المتابعة · " + F.watch.length + '</h4><ul data-more="غيرها">' + wch + "</ul>" : "";
    fit($("watch"));
  }

  function drawBreaking(t) {
    var strip = $("breaking");
    if (!F.urgent.length) { if (shown.breaking !== "none") { strip.className = ""; shown.breaking = "none"; } return; }
    var i = Math.floor(t / 7000) % F.urgent.length, u = F.urgent[i], key = F.at + "|" + i;
    if (shown.breaking === key) return;
    shown.breaking = key;
    // the whole of it where there is more (who, his number, what he wrote — rules.ts waitDetail)
    $("breakText").textContent = u.label + ": " + u.value + " — " + (u.detail || u.reason);
    strip.className = "on";
  }

  function drawCrawl(t) {
    var key = F.at;
    if (shown.tick !== key) {
      shown.tick = key;
      // each section is named once — «التأشيرات    …الأخبار» — then its news, a dot between them (the owner, 2026-10-29)
      var words = "", last = null;
      for (var j = 0; j < F.ticker.length; j++) {
        var it = F.ticker[j], sec = it.section || "";
        if (sec !== last) {
          words += (j ? '<span class="sep">◆</span>' : "") + (sec ? '<span class="' + (sec === "قرار الإدارة يحتاج تنفيذ" ? "sec warn" : "sec") + '">' + esc(sec) + "</span>" : "");
          last = sec;
        } else words += '<span class="dot">·</span>';
        words += '<span class="' + (it.red ? "ti red" : "ti") + '">' + esc(it.text) + "</span>";
      }
      $("tick").innerHTML = words || "لا أحداث في الساعات الأخيرة";
    }
    var el = $("tick"), w = el.offsetWidth, rail = $("rail").offsetWidth;
    if (!w || !rail) return;
    var x = ((t / 1000) * SPEED) % (w + rail) - w;
    var tr = "translate3d(" + x.toFixed(1) + "px,0,0)";
    el.style.webkitTransform = tr;
    el.style.transform = tr;
  }

  // on the hour, 30 s: the day's summary once it exists, else the hour's
  function drawSummary(t) {
    var d = riyadh(t), on = d.getUTCMinutes() === 0 && d.getUTCSeconds() < 30;
    var lines = F.daily && F.daily.length ? F.daily : F.hourly, title = F.daily && F.daily.length ? "ملخص اليوم" : "ملخص الساعة";
    var key = on ? title + "|" + lines.join("|") : "";
    if (key === shown.summary) return;
    shown.summary = key;
    var box_ = $("summary");
    if (!on) { box_.className = ""; return; }
    var h = "";
    for (var k = 0; k < lines.length; k++) h += "<li>" + esc(lines[k]) + "</li>";
    $("stitle").textContent = title;
    $("slines").innerHTML = h;
    box_.className = "on";
  }

  function frame() {
    try {
      var t = now();
      drawCrawl(t);
      drawSegment(t);
      drawBreaking(t);
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
      // a new version: load it (else the TV kept this morning's page until 04:00, 2026-10-22)
      if (f.build && F.build && f.build !== F.build) { location.reload(); return; }
      offset =f.now + (Date.now() - t0) / 2 - Date.now();
      F = f;
      drawIndex();
      drawRail();
    };
    x.send();
  }

  setInterval(function () { try { drawClock(now()); } catch (e) {} }, 1000);
  setInterval(function () {
    if (riyadh(now()).getUTCHours() === 4 && Date.now() - born > 3600000) location.reload();
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

  // the TV crops its edges (overscan: the clock, the first figure and the crawl were cut, 2026-10-22),
  // so the page shrinks into the safe area — ?safe=N is N% a side (0 for a screen that shows it all),
  // kept by this browser
  var safe = (location.search.match(/safe=([0-9.]+)/) || [])[1];
  try { if (safe != null) localStorage.setItem("managerSafe", safe); else safe = localStorage.getItem("managerSafe"); } catch (e) {}
  safe = safe == null || isNaN(+safe) ? 3 : Math.min(10, +safe);
  document.body.style.webkitTransform = document.body.style.transform = "scale(" + (1 - safe / 50) + ")";

  drawClock(now());
  drawIndex();
  drawRail();
  loop();
  // measured again in the real font (Tajawal's rows are taller than the fallback's)
  try { document.fonts.ready.then(function () { shown.seg = shown.rail = ""; drawRail(); }); } catch (e) {}
  // a throttled page still turns the segments
  setInterval(frame, 1000);
  setInterval(poll, 30000);
})();
`;

const CSS = `
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-Medium.ttf) format("truetype");font-weight:500;font-display:block}
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-Bold.ttf) format("truetype");font-weight:700;font-display:block}
@font-face{font-family:Tajawal;src:url(/fonts/Tajawal-ExtraBold.ttf) format("truetype");font-weight:800;font-display:block}
:root{--bg:#04101a;--panel:#0a1c28;--panel2:#0e2533;--line:#18384a;--text:#f3f7fa;--muted:#8fa7b8;--dim:#4f6b7d;--green:#22c55e;--amber:#ff9f1c;--red:#ff3b4e;--gold:#f5b400;--blue:#3ea6ff}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;cursor:none;background:var(--bg);color:var(--text)}
body{font-family:Tajawal,"Noto Sans Arabic",Tahoma,Arial,sans-serif;font-size:${v(22)};height:100vh;height:100dvh;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:${v(86)} ${v(96)} minmax(0,1fr) ${v(56)} ${v(62)}}
/* nothing inside may widen the page: a long line made the track wider than the screen and pushed the left rail off it (the owner's TV photo, 2026-10-26) */
body>*{min-width:0}
.tnum{font-variant-numeric:tabular-nums}
.s-green{--c:var(--green)}.s-amber{--c:var(--amber)}.s-red{--c:var(--red)}

/* the channel bar */
#top{display:flex;align-items:center;gap:${v(28)};padding:0 ${v(40)};background:linear-gradient(180deg,#071a27,#04101a);border-bottom:1px solid var(--line)}
.bug{display:flex;align-items:center;gap:${v(16)}}
.bug img{height:${v(46)};filter:brightness(0) invert(1)}
.bug .ch{display:flex;flex-direction:column;line-height:1.1}
.bug .ch b{font-size:${v(28)};font-weight:800}
.bug .ch small{font-size:${v(16)};font-weight:700;color:var(--gold);letter-spacing:.06em}
.live{display:flex;align-items:center;gap:${v(10)};background:var(--red);color:#fff;font-weight:800;font-size:${v(20)};padding:${v(6)} ${v(16)};border-radius:${v(6)}}
.live i{width:${v(11)};height:${v(11)};border-radius:50%;background:#fff;animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.25}}
#lineup{flex:1;display:flex;justify-content:center;gap:${v(10)}}
#lineup span{position:relative;padding:${v(10)} ${v(16)};font-size:${v(22)};font-weight:700;color:var(--dim);white-space:nowrap}
#lineup span.on{color:#fff}
#lineup span u{position:absolute;right:${v(16)};bottom:0;height:${v(4)};background:var(--gold);border-radius:${v(4)}}
#lineup .dot{display:inline-block;width:${v(10)};height:${v(10)};border-radius:50%;background:var(--red);margin-left:${v(8)};vertical-align:middle}
.overall{display:flex;align-items:center;gap:${v(10)};padding:${v(8)} ${v(18)};border-radius:${v(8)};font-weight:800;font-size:${v(22)};color:#fff;background:var(--c)}
.overall i{width:${v(10)};height:${v(10)};border-radius:50%;background:#fff}
.when{text-align:left;min-width:${v(190)}}
#clock{font-size:${v(46)};font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
#date{font-size:${v(17)};color:var(--muted);font-weight:700;margin-top:${v(4)}}

/* the market strip */
#index{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));background:#061722;border-bottom:1px solid var(--line)}
.ix{position:relative;padding:${v(12)} ${v(22)} ${v(10)};border-left:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;min-width:0}
.ix:before{content:"";position:absolute;top:0;right:0;left:0;height:${v(4)};background:var(--c)}
.ix label{font-size:${v(18)};font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ix b{font-size:${v(40)};font-weight:800;line-height:1.1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ix.s-red b{color:#ff7b88}.ix.s-amber b{color:#ffbf6b}
.ix small{font-size:${v(16)};font-weight:700;color:var(--c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* the studio */
main{display:grid;grid-template-columns:minmax(0,1fr) ${v(450)};gap:${v(26)};padding:${v(22)} ${v(40)} ${v(18)};min-height:0}
.studio{display:grid;grid-template-rows:auto minmax(0,1fr);gap:${v(16)};min-height:0;min-width:0}
.lower{display:flex;align-items:stretch;gap:0;min-width:0}
.tag{display:flex;align-items:center;padding:0 ${v(24)};background:var(--c);color:#04101a;font-size:${v(26)};font-weight:800;border-radius:0 ${v(10)} ${v(10)} 0}
.tag.s-green{background:var(--gold)}
#segHead{flex:1;display:flex;align-items:center;padding:${v(12)} ${v(26)};background:#fff;color:#04101a;font-size:${v(34)};font-weight:800;line-height:1.25;min-width:0;border-radius:${v(10)} 0 0 ${v(10)}}
#segNext{align-self:center;margin-right:${v(18)};font-size:${v(18)};font-weight:700;color:var(--muted);white-space:nowrap}
#segBody{display:flex;flex-direction:column;gap:${v(16)};min-height:0;opacity:0}
#segBody.in{animation:segIn .7s cubic-bezier(.16,1,.3,1) both}
@keyframes segIn{from{opacity:0;transform:translateY(${v(18)})}to{opacity:1;transform:none}}
.figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${v(16)}}
.fig{background:var(--panel);border:1px solid var(--line);border-top:${v(5)} solid var(--c);border-radius:${v(12)};padding:${v(14)} ${v(20)};min-width:0}
.fig.s-red{background:rgba(255,59,78,.12);border-color:rgba(255,59,78,.5)}
.fig .fh{display:flex;justify-content:space-between;align-items:center;gap:${v(8)}}
.fig label{font-size:${v(22)};font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fig .w{font-size:${v(16)};font-weight:800;color:var(--c);white-space:nowrap}
.fig b{display:block;font-size:${v(64)};font-weight:800;line-height:1.1;margin-top:${v(4)}}
.fig b em{font-style:normal;font-size:${v(28)};color:var(--muted);margin-right:${v(8)}}
.fig small{display:block;font-size:${v(18)};color:var(--muted);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.box{background:var(--panel);border:1px solid var(--line);border-radius:${v(12)};padding:${v(16)} ${v(22)};min-height:0;overflow:hidden;display:flex;flex-direction:column}
.box header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:${v(12)}}
.box h3{margin:0;font-size:${v(26)};font-weight:800}
.box header span{font-size:${v(17)};color:var(--muted);font-weight:700}
.split{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:${v(16)};min-height:0;flex:1}
.split .main,.split .aside{display:flex;flex-direction:column;gap:${v(16)};min-height:0}
.split .main .box{flex:1}
.split .aside .box:first-child{flex:1.2}.split .aside .box:last-child{flex:1}
#segBody>.box:last-child{flex:1 1 0}
[data-more]{flex:1 1 auto;min-height:0;overflow:hidden}

/* the waiting, lane by lane */
.lanes{display:flex;flex-direction:column;gap:${v(14)};overflow:hidden}
.lane{display:grid;grid-template-columns:${v(290)} minmax(0,1fr);align-items:center;gap:${v(18)};padding:${v(14)} ${v(16)};background:var(--panel2);border-radius:${v(12)}}
.who{display:flex;align-items:center;gap:${v(10)};min-width:0}
.who b{font-size:${v(30)};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who em{font-style:normal;margin-right:auto;background:#fff;color:#04101a;font-weight:800;font-size:${v(20)};border-radius:${v(8)};padding:${v(2)} ${v(12)}}
.pd{flex:0 0 auto;width:${v(14)};height:${v(14)};border-radius:50%;background:var(--dim)}
.pd.p-online{background:var(--green);box-shadow:0 0 ${v(10)} var(--green)}.pd.p-busy{background:var(--amber)}.pd.p-none{background:transparent;border:2px dashed var(--dim)}
.chips{display:flex;flex-wrap:wrap;gap:${v(8)}}
.wc{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;min-width:${v(112)};padding:${v(8)} ${v(14)};border-radius:${v(8)};background:color-mix(in srgb,var(--c) 22%,transparent);border:2px solid var(--c);line-height:1.05}
.wc b{font-size:${v(32)};font-weight:800;color:#fff}
.wc small{font-size:${v(18)};font-weight:700;color:#ffd0d5}
.wc.more{border-style:dashed;border-color:var(--muted);background:transparent;color:var(--muted);font-weight:800;font-size:${v(22)}}
.rest{margin:${v(6)} 0 0;color:var(--muted);font-size:${v(19)};font-weight:700}
.closed{display:flex;flex-wrap:wrap;gap:${v(10)};margin-top:auto;padding-top:${v(12)};border-top:1px solid var(--line);font-size:${v(20)};font-weight:700;color:var(--muted)}
.closed span{background:#061722;border-radius:${v(8)};padding:${v(6)} ${v(14)}}
.closed b{color:#fff}
.closed .back{color:#8fd0ff}

/* today by the hour */
.hours{flex:1;display:flex;align-items:flex-end;gap:0;min-height:${v(160)};padding-top:${v(26)};padding-bottom:${v(28)};direction:ltr}
.hb{position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center}
.hb i{position:relative;display:block;width:62%;background:var(--blue);border-radius:${v(4)} ${v(4)} 0 0;opacity:.85}
.hb.fut i{background:var(--line)}
.hb.cur i{background:var(--gold);opacity:1}
.hb b{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:${v(4)};font-size:${v(20)};color:#fff;font-weight:800;font-style:normal}
.hb.cur b{color:var(--gold)}
.hb em{position:absolute;bottom:-${v(26)};font-style:normal;font-size:${v(15)};color:var(--dim);font-weight:700}

/* bars, tables, boards */
.bar{display:grid;grid-template-columns:minmax(0,38%) minmax(0,1fr) auto;align-items:center;gap:${v(14)};margin-bottom:${v(10)};font-size:${v(22)};font-weight:700}
.bar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar i{display:block;height:${v(14)};background:rgba(255,255,255,.07);border-radius:${v(8)};overflow:hidden}
.bar u{display:block;height:100%;background:linear-gradient(270deg,var(--gold),#ffd66b);border-radius:${v(8)}}
.bar b{font-weight:800}
.tbl{display:flex;flex-direction:column;gap:${v(6)}}
.th,.tr{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) ${v(170)} ${v(170)};align-items:center;gap:${v(16)};padding:${v(8)} ${v(14)}}
.th.t4,.tr.t4{grid-template-columns:minmax(0,1.4fr) minmax(0,1.6fr) ${v(220)}}
.th{font-size:${v(18)};font-weight:700;color:var(--muted);border-bottom:1px solid var(--line)}
.tr{background:var(--panel2);border-radius:${v(8)};font-size:${v(24)};font-weight:800}
.tr .c{display:flex;align-items:center;gap:${v(10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tr .g{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:${v(12)}}
.tr .g i{display:block;height:${v(14)};background:rgba(255,255,255,.07);border-radius:${v(8)};overflow:hidden}
.tr .g u{display:block;height:100%;background:linear-gradient(270deg,var(--blue),#8fd0ff);border-radius:${v(8)}}
.tr .n{text-align:center}
.tr .n.ok{color:var(--green)}
.tr .n.s-red,.tr .n.s-amber{color:var(--c)}
.deps{display:flex;flex-direction:column;gap:${v(6)}}
.dh,.dep{display:grid;grid-template-columns:${v(220)} ${v(140)} minmax(0,1fr) ${v(150)};align-items:center;gap:${v(16)};padding:${v(10)} ${v(16)}}
.dh{font-size:${v(18)};font-weight:700;color:var(--muted);border-bottom:1px solid var(--line)}
.dep{background:#061722;border:1px solid var(--line);border-radius:${v(8)};font-size:${v(25)};font-weight:800}
.dep .sn{color:var(--gold);letter-spacing:.04em}
.dep .when{justify-self:start;background:#fff;color:#04101a;border-radius:${v(6)};padding:${v(2)} ${v(12)};font-size:${v(20)}}
.dep .what{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dep .lamp{display:flex;align-items:center;gap:${v(8)};color:var(--c);font-size:${v(20)}}
.dep .lamp i{width:${v(14)};height:${v(14)};border-radius:50%;background:var(--c);box-shadow:0 0 ${v(12)} var(--c)}
.list{display:flex;flex-direction:column;gap:${v(8)}}
.li{display:grid;grid-template-columns:${v(14)} minmax(0,auto) minmax(0,1fr) auto;align-items:center;gap:${v(14)};padding:${v(10)} ${v(14)};background:var(--panel2);border-radius:${v(8)};font-size:${v(23)}}
.li i{width:${v(12)};height:${v(12)};border-radius:50%;background:var(--c)}
.li b{font-weight:800;white-space:nowrap}
.li span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li em{font-style:normal;font-weight:800}
/* more rows than the room: tighter first, then the rest counted (fit) */
.dense{gap:${v(4)};line-height:1.3}
.dense>.tr,.dense>.dep,.dense>.li,.dense>.lane{padding-top:${v(4)};padding-bottom:${v(4)};font-size:${v(21)}}
.calm{display:flex;align-items:center;justify-content:center;gap:${v(14)};padding:${v(26)};color:#7ee2a8;font-size:${v(26)};font-weight:800;text-align:center}
.calm b{font-size:${v(40)}}
.box>.calm{flex:1}
.calm.big{flex:1;flex-direction:column;font-size:${v(32)}}
.calm.big b{font-size:${v(80)}}

/* the rail */
aside.rail{display:flex;flex-direction:column;gap:${v(12)};background:linear-gradient(180deg,rgba(255,59,78,.1),rgba(255,59,78,.02));border:1px solid rgba(255,59,78,.35);border-radius:${v(14)};padding:${v(18)};min-height:0;overflow:hidden}
aside.rail h2{margin:0;display:flex;justify-content:space-between;align-items:center;font-size:${v(28)};font-weight:800;color:#ff8d99}
#ucount{background:var(--red);color:#fff;border-radius:${v(10)};padding:0 ${v(14)};font-size:${v(26)}}
#urgent{display:flex;flex-direction:column;gap:${v(10)}}
.uc{background:#1a0c14;border:1px solid rgba(255,59,78,.45);border-right:${v(6)} solid var(--red);border-radius:${v(10)};padding:${v(12)} ${v(14)}}
.uc small{font-size:${v(16)};color:#ff9aa5;font-weight:700}
.uc b{display:block;font-size:${v(24)};font-weight:800;margin:${v(2)} 0}
.uc p{margin:0;font-size:${v(19)};color:#d8c4c9;line-height:1.35}
.uc em{display:block;margin-top:${v(6)};font-style:normal;font-size:${v(19)};font-weight:800;color:var(--gold)}
.calm.rail{flex-direction:column;flex:1;border-radius:${v(10)};background:rgba(34,197,94,.08);font-size:${v(28)}}
.calm.rail b{font-size:${v(72)}}
#watch{flex:1;min-height:0;display:flex;flex-direction:column}
#watch h4{margin:${v(6)} 0;font-size:${v(20)};color:#ffbf6b;font-weight:800}
#watch ul{margin:0;padding:0 ${v(22)} 0 0;font-size:${v(18)};color:var(--muted);line-height:1.5}

/* the breaking strip and the crawl */
#breaking{display:flex;align-items:stretch;background:#3a0711;visibility:hidden}
#breaking.on{visibility:visible}
#breaking .lbl{display:flex;align-items:center;padding:0 ${v(30)};background:var(--red);color:#fff;font-weight:800;font-size:${v(28)}}
#breakText{flex:1;display:flex;align-items:center;padding:0 ${v(24)};font-size:${v(26)};font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#breaking.on #breakText{animation:slideIn .6s cubic-bezier(.16,1,.3,1) both}
@keyframes slideIn{from{opacity:0;transform:translateX(${v(-40)})}to{opacity:1;transform:none}}
footer{display:flex;align-items:stretch;background:var(--gold);color:#10221f;overflow:hidden}
footer .now{position:relative;z-index:1;display:grid;place-items:center;padding:0 ${v(30)};background:#04101a;color:var(--gold);font-size:${v(28)};font-weight:800}
#rail{position:relative;flex:1;overflow:hidden}
#tick{position:absolute;left:0;top:0;bottom:0;display:flex;align-items:center;white-space:nowrap;direction:rtl;font-size:${v(28)};font-weight:800;line-height:1.3;will-change:transform}
.ti.red{color:#8a0f22}.ti.red:before{content:"● ";color:#c4122f}
.sep{margin:0 ${v(26)};opacity:.5}
#tick .sec{display:inline-block;margin-inline-end:${v(22)};padding:${v(2)} ${v(18)};border-radius:${v(8)};background:#04101a;color:var(--gold);font-size:${v(24)}}
#tick .sec.warn{background:#8a0f22;color:#fff}
#tick .dot{margin:0 ${v(14)};opacity:.55}

/* on the hour */
#summary{position:fixed;left:0;top:0;width:100%;height:100%;z-index:5;background:rgba(4,16,26,.97);display:flex;flex-direction:column;justify-content:center;padding:${v(80)} ${v(160)};opacity:0;pointer-events:none;transition:opacity .6s}
#summary.on{opacity:1}
#stitle{font-size:${v(62)};font-weight:800;color:var(--gold);margin-bottom:${v(36)}}
#slines{margin:0;padding:0 ${v(40)} 0 0;font-size:${v(36)};font-weight:700;line-height:1.7}
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
<header id="top">
  <div class="bug"><img src="/traveliun/logo-body.svg" alt="ترافليون"><div class="ch"><b>النشرة</b></div></div>
  <div class="live"><i></i>مباشر</div>
  <nav id="lineup"></nav>
  <div id="overall" class="overall s-${feed.overall}"></div>
  <div class="when"><div id="clock"></div><div id="date"></div></div>
</header>
<div id="index"></div>
<main>
  <div class="studio">
    <div class="lower"><div id="segTag" class="tag"></div><div id="segHead"></div><div id="segNext"></div></div>
    <div id="segBody"></div>
  </div>
  <aside class="rail"><h2>يحتاج تدخلك الآن <span id="ucount"></span></h2><div id="urgent"></div><div id="watch"></div></aside>
</main>
<div id="breaking"><div class="lbl">عاجل</div><div id="breakText"></div></div>
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
