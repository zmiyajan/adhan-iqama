// Which notifications are due this minute for one subscriber. The prayer rules are the page's own
// (public/index.html: computeDay, dayEvents), computed with the very same adhan.min.js file.
import adhan from "../../public/adhan.min.js";

export const PRAYERS = [
  { key: "fajr", name: "الفجر" },
  { key: "dhuhr", name: "الظهر" },
  { key: "asr", name: "العصر" },
  { key: "maghrib", name: "المغرب" },
  { key: "isha", name: "العشاء" },
];

// Ramadan by the Umm al-Qura calendar. The runtime's ICU is used when it has that calendar
// (workerd and Node do); otherwise this table, made from the same ICU data, [1 Ramadan, 1 Shawwal).
const hijriMonth = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { month: "numeric" });
export const ICU_UMALQURA = hijriMonth.resolvedOptions().calendar === "islamic-umalqura";
const RAMADAN = [["2025-03-01","2025-03-30"],["2026-02-18","2026-03-20"],["2027-02-08","2027-03-09"],["2028-01-28","2028-02-26"],
  ["2029-01-16","2029-02-14"],["2030-01-05","2030-02-04"],["2030-12-26","2031-01-24"],["2031-12-16","2032-01-14"],
  ["2032-12-04","2033-01-03"],["2033-11-23","2033-12-23"],["2034-11-12","2034-12-12"],["2035-11-01","2035-12-01"],
  ["2036-10-21","2036-11-19"],["2037-10-10","2037-11-09"],["2038-09-30","2038-10-29"],["2039-09-19","2039-10-19"],
  ["2040-09-08","2040-10-07"],["2041-08-28","2041-09-27"],["2042-08-17","2042-09-16"],["2043-08-06","2043-09-05"],
  ["2044-07-26","2044-08-24"],["2045-07-16","2045-08-14"]];

// `local` is noon of the day, built in the runtime's own zone exactly as the page builds it.
export function isRamadan(local, useIcu = ICU_UMALQURA) {
  if (useIcu) return parseInt(hijriMonth.format(local), 10) === 9;
  const p = n => String(n).padStart(2, "0");
  const key = `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`;
  return RAMADAN.some(([a, b]) => key >= a && key < b);
}

export function ymd(date, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)) p[x.type] = x.value;
  return [+p.year, +p.month, +p.day];
}

// Adhan and iqama events of one calendar day. Friday Dhuhr is Jumu'ah, with no iqama.
export function dayEvents(S, y, m, d) {
  const local = new Date(y, m - 1, d, 12);
  const params = adhan.CalculationMethod[S.method]();
  if (S.method === "UmmAlQura" && isRamadan(local)) params.ishaInterval = 120;
  if (S.method === "UmmAlQura") params.rounding = adhan.Rounding.Up;
  const t = new adhan.PrayerTimes(new adhan.Coordinates(S.lat, S.lng), local, params);
  const friday = local.getDay() === 5;
  const day = `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`;
  const list = [];
  for (const p of PRAYERS) {
    const at = t[p.key];
    const jumuah = friday && p.key === "dhuhr";
    list.push({ p, kind: "adhan", at, jumuah, day });
    const min = S.iqama[p.key];
    if (!jumuah && min > 0) list.push({ p, kind: "iqama", at: new Date(at.getTime() + min * 6e4), jumuah, day });
  }
  return list;
}

const fmtCache = new Map();
function clock(date, tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }));
  return fmtCache.get(tz).format(date);
}

// The three kinds of notice: [setting, event kind, minutes before, title].
const RULES = [
  ["preAdhan", "adhan", 5, e => `${adhanName(e)} بعد 5 دقائق`],
  ["muezzin", "adhan", 30, e => `تذكير المؤذن: ${adhanName(e)} بعد 30 دقيقة`],
  ["warn", "iqama", 2, e => `إقامة ${e.p.name} بعد دقيقتين`],
];
const adhanName = e => (e.jumuah ? "أذان الجمعة" : `أذان ${e.p.name}`);

// Notifications whose send minute (event time − lead) is the minute of `now` (ms).
export function due(S, now) {
  const minute = Math.floor(now / 6e4);
  const [y, m, d] = ymd(new Date(now), S.tz);
  const out = [];
  // Yesterday too: a late Isha iqama can fall after midnight far north; tomorrow for a 30-minute lead before midnight.
  for (const off of [-1, 0, 1]) {
    for (const e of dayEvents(S, y, m, d + off)) {
      for (const [setting, kind, lead, title] of RULES) {
        if (S[setting] !== "on" || e.kind !== kind) continue;
        if (Math.floor((e.at.getTime() - lead * 6e4) / 6e4) !== minute) continue;
        out.push({
          title: title(e),
          body: `الساعة ${clock(e.at, S.tz)}`,
          tag: `${setting}-${e.p.key}-${e.day}`,
          ttl: lead * 60,
        });
      }
    }
  }
  return out;
}
