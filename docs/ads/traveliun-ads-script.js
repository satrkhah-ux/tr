/* eslint-disable @typescript-eslint/no-unused-vars -- main() is called by Google Ads, not by this file */
/**
 * Traveliun — Google Ads Script (the owner's account, scheduled HOURLY).
 * Version 2 — 2026-10-19. Replaces the old script entirely.
 *
 * Every run:
 *   1) the Telegram bot (@atraveliunbot) gets EXACTLY the payload it always had
 *      (today + yesterday totals and per campaign) — its «📢 الإعلانات» and the
 *      09:00 digest keep working as before;
 *   2) pkg.traveliun.com («رؤية للإعلانات») gets per-day, per-campaign rows for
 *      yesterday (closed) and today (so far), and where the clicks were (country,
 *      city), what was searched (top terms) and the hour of day.
 *
 * The history (once): set BACKFILL = true, Run it by hand once («تشغيل»), then set
 * it back to false and save. It sends a week at a time from BACKFILL_FROM to
 * yesterday, and stops itself before the 30-minute limit — if the log says
 * «توقف عند …», put that date in BACKFILL_FROM and run again.
 *
 * Two keys, filled in by the developer — never shared anywhere else:
 */
var BOT_HOOK_KEY = '<<BOT_HOOK_KEY — من ملف .env للبوت على الخادم>>';
var PKG_HOOK_KEY = '<<PKG_HOOK_KEY — من خادم النظام>>';

var BOT_URL = 'http://186.241.16.106:8787/hook?key=' + encodeURIComponent(BOT_HOOK_KEY);
var PKG_URL = 'https://pkg.traveliun.com/api/ads/hook?key=' + encodeURIComponent(PKG_HOOK_KEY);

var BACKFILL = false;
var BACKFILL_FROM = '2026-07-01';
var TOP_TERMS = 30; // search terms kept per campaign and day
var CHUNK_DAYS = 7; // days per post while backfilling
var STOP_AFTER_MS = 25 * 60 * 1000; // stop before Google's 30-minute limit

function main() {
  var started = Date.now();
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var yesterday = Utilities.formatDate(new Date(Date.now() - 864e5), tz, 'yyyy-MM-dd');

  // 1) the bot — unchanged payload
  try {
    post(BOT_URL, botPayload(account), 'bot');
  } catch (e) {
    Logger.log('bot: ' + e);
  }

  // 2) pkg — the history once, else yesterday + today
  if (BACKFILL) {
    var from = BACKFILL_FROM;
    while (from <= yesterday) {
      if (Date.now() - started > STOP_AFTER_MS) {
        Logger.log('توقف عند ' + from + ' — ضعه في BACKFILL_FROM وشغّل مرة أخرى');
        return;
      }
      var to = addDays(from, CHUNK_DAYS - 1);
      if (to > yesterday) to = yesterday;
      post(PKG_URL, pkgPayload(account, from, to, today), 'pkg ' + from + '..' + to);
      from = addDays(to, 1);
    }
    Logger.log('اكتمل السجل حتى ' + yesterday + ' — أعد BACKFILL إلى false واحفظ');
  }
  post(PKG_URL, pkgPayload(account, yesterday, today, today), 'pkg ' + yesterday + '..' + today);
}

// ---------- 1) the bot's payload, as the old script sent it ----------

function botPayload(account) {
  var byName = {};
  var all = AdsApp.search("SELECT campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'");
  while (all.hasNext()) {
    var r = all.next();
    byName[r.campaign.name] = { name: r.campaign.name, status: r.campaign.status, today: zero(), yesterday: zero() };
  }
  var totals = { today: zero(), yesterday: zero() };
  [['today', 'TODAY'], ['yesterday', 'YESTERDAY']].forEach(function (span) {
    var rows = AdsApp.search(
      'SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions ' +
        "FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING " + span[1],
    );
    while (rows.hasNext()) {
      var row = rows.next();
      var c = byName[row.campaign.name] || (byName[row.campaign.name] = { name: row.campaign.name, status: row.campaign.status, today: zero(), yesterday: zero() });
      var m = metrics(row.metrics);
      c[span[0]] = m;
      add(totals[span[0]], m);
    }
  });
  return { account: account.getName(), currency: account.getCurrencyCode(), totals: totals, campaigns: Object.keys(byName).map(function (k) { return byName[k]; }) };
}

// ---------- 2) pkg's payload: days, places, terms, hours ----------

function pkgPayload(account, from, to, today) {
  var span = "segments.date BETWEEN '" + from + "' AND '" + to + "'";
  var days = {};
  var rows = AdsApp.search(
    'SELECT segments.date, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE ' + span,
  );
  while (rows.hasNext()) {
    var r = rows.next();
    var d = r.segments.date;
    (days[d] || (days[d] = { date: d, final: d < today, campaigns: [] })).campaigns.push(
      merge({ name: r.campaign.name, status: r.campaign.status }, metrics(r.metrics)),
    );
  }
  return {
    v: 2,
    account: account.getName(),
    currency: account.getCurrencyCode(),
    days: Object.keys(days).sort().map(function (k) { return days[k]; }),
    locations: safe('locations', function () { return locations(span); }),
    terms: safe('terms', function () { return terms(span); }),
    hours: safe('hours', function () { return hours(span); }),
  };
}

/** Where the people who clicked were: country (user_location_view), and city where Google gives one (geographic_view). */
function locations(span) {
  var out = [];
  var names = {};
  var rows = AdsApp.search(
    'SELECT segments.date, campaign.name, user_location_view.country_criterion_id, metrics.clicks, metrics.impressions, metrics.cost_micros ' +
      'FROM user_location_view WHERE ' + span + ' AND metrics.impressions > 0',
  );
  while (rows.hasNext()) {
    var r = rows.next();
    var id = 'geoTargetConstants/' + r.userLocationView.countryCriterionId;
    names[id] = true;
    out.push({ date: r.segments.date, campaign: r.campaign.name, country: id, city: '', clicks: n(r.metrics.clicks), impressions: n(r.metrics.impressions), cost: n(r.metrics.costMicros) / 1e6 });
  }
  try {
    var cities = AdsApp.search(
      'SELECT segments.date, campaign.name, geographic_view.country_criterion_id, segments.geo_target_city, metrics.clicks, metrics.impressions, metrics.cost_micros ' +
        "FROM geographic_view WHERE " + span + " AND geographic_view.location_type = 'LOCATION_OF_PRESENCE' AND metrics.clicks > 0",
    );
    while (cities.hasNext()) {
      var c = cities.next();
      if (!c.segments.geoTargetCity) continue;
      var country = 'geoTargetConstants/' + c.geographicView.countryCriterionId;
      names[country] = true;
      names[c.segments.geoTargetCity] = true;
      out.push({ date: c.segments.date, campaign: c.campaign.name, country: country, city: c.segments.geoTargetCity, clicks: n(c.metrics.clicks), impressions: n(c.metrics.impressions), cost: n(c.metrics.costMicros) / 1e6 });
    }
  } catch (e) {
    Logger.log('cities: ' + e);
  }
  var named = geoNames(Object.keys(names));
  out.forEach(function (o) {
    o.country = named[o.country] || o.country;
    o.city = o.city ? named[o.city] || o.city : '';
  });
  return out;
}

/** The top search terms per campaign and day, by clicks. */
function terms(span) {
  var group = {};
  var rows = AdsApp.search(
    'SELECT segments.date, campaign.name, search_term_view.search_term, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions ' +
      'FROM search_term_view WHERE ' + span + ' AND metrics.clicks > 0',
  );
  while (rows.hasNext()) {
    var r = rows.next();
    var key = r.segments.date + '|' + r.campaign.name;
    (group[key] || (group[key] = [])).push({
      date: r.segments.date,
      campaign: r.campaign.name,
      term: r.searchTermView.searchTerm,
      clicks: n(r.metrics.clicks),
      impressions: n(r.metrics.impressions),
      cost: n(r.metrics.costMicros) / 1e6,
      conversions: n(r.metrics.conversions),
    });
  }
  var out = [];
  Object.keys(group).forEach(function (k) {
    group[k].sort(function (a, b) { return b.clicks - a.clicks; });
    out = out.concat(group[k].slice(0, TOP_TERMS));
  });
  return out;
}

/** The hour of day (account time) the clicks came in. */
function hours(span) {
  var out = [];
  var rows = AdsApp.search(
    'SELECT segments.date, segments.hour, campaign.name, metrics.clicks, metrics.impressions, metrics.cost_micros FROM campaign WHERE ' + span + ' AND metrics.impressions > 0',
  );
  while (rows.hasNext()) {
    var r = rows.next();
    out.push({ date: r.segments.date, campaign: r.campaign.name, hour: n(r.segments.hour), clicks: n(r.metrics.clicks), impressions: n(r.metrics.impressions), cost: n(r.metrics.costMicros) / 1e6 });
  }
  return out;
}

/** «geoTargetConstants/2682» → «Saudi Arabia», a hundred at a time. */
function geoNames(ids) {
  var named = {};
  for (var i = 0; i < ids.length; i += 100) {
    var batch = ids.slice(i, i + 100).map(function (id) { return "'" + id + "'"; }).join(',');
    try {
      var rows = AdsApp.search('SELECT geo_target_constant.resource_name, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (' + batch + ')');
      while (rows.hasNext()) {
        var g = rows.next().geoTargetConstant;
        named[g.resourceName] = g.name;
      }
    } catch (e) {
      Logger.log('geo names: ' + e);
    }
  }
  return named;
}

// ---------- helpers ----------

function post(url, body, label) {
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  Logger.log(label + ': ' + res.getResponseCode() + ' ' + String(res.getContentText()).slice(0, 200));
}
function safe(label, fn) {
  try {
    return fn();
  } catch (e) {
    Logger.log(label + ': ' + e);
    return [];
  }
}
function zero() { return { cost: 0, clicks: 0, impressions: 0, conversions: 0 }; }
function metrics(m) { return { cost: n(m.costMicros) / 1e6, clicks: n(m.clicks), impressions: n(m.impressions), conversions: n(m.conversions) }; }
function add(t, m) { t.cost += m.cost; t.clicks += m.clicks; t.impressions += m.impressions; t.conversions += m.conversions; }
function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }
function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function addDays(day, by) {
  var d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
