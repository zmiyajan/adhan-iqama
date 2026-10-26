// Checks for what a phone sends to api/subscribe. Shared by the Pages Function and the cron Worker.
export const METHODS = ["UmmAlQura", "MuslimWorldLeague", "Egyptian", "Dubai", "Kuwait", "Qatar", "Karachi", "Turkey", "NorthAmerica"];
export const IQAMA_KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const DEFAULT_IQAMA = { fajr: 25, dhuhr: 20, asr: 20, maghrib: 10, isha: 20 };

// Push services of Chrome/Android, Firefox, Safari/iPhone and Edge/Windows.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

const onOff = (v, d) => (v === "on" || v === "off" ? v : d);

// A clean settings object, or null when something essential is wrong.
export function cleanSettings(s) {
  if (!s || typeof s !== "object") return null;
  const lat = Number(s.lat), lng = Number(s.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const tz = typeof s.tz === "string" && s.tz.length <= 64 ? s.tz : "";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch (e) { return null; }
  if (!tz) return null;
  const method = METHODS.includes(s.method) ? s.method : "UmmAlQura";
  const iqama = {};
  for (const k of IQAMA_KEYS) {
    const n = Math.round(Number(s.iqama && s.iqama[k]));
    iqama[k] = Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : DEFAULT_IQAMA[k];
  }
  return { lat, lng, tz, method, iqama, preAdhan: onOff(s.preAdhan, "on"), muezzin: onOff(s.muezzin, "off"), warn: onOff(s.warn, "on") };
}

function b64uLength(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(v)) return -1;
  try { return atob(v.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/")).length; } catch (e) { return -1; }
}

// {endpoint, p256dh, auth} from a PushSubscription's toJSON(), or null.
export function cleanSubscription(sub) {
  if (!sub || typeof sub !== "object" || !sub.keys) return null;
  const endpoint = validEndpoint(sub.endpoint);
  const { p256dh, auth } = sub.keys;
  if (!endpoint || b64uLength(p256dh) !== 65 || b64uLength(auth) !== 16) return null;
  if (atob(p256dh.slice(0, 4).replace(/-/g, "+").replace(/_/g, "/")).charCodeAt(0) !== 4) return null;
  return { endpoint, p256dh: p256dh.replace(/=+$/, ""), auth: auth.replace(/=+$/, "") };
}

export function validEndpoint(e) {
  if (typeof e !== "string" || e.length > 1024) return null;
  let u;
  try { u = new URL(e); } catch (err) { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  return PUSH_HOSTS.some(h => h.test(u.hostname)) ? e : null;
}
