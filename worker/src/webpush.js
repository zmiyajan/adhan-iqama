// Web Push with WebCrypto only (runs in Workers and in Node 20+):
// RFC 8291 message encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID (ES256 JWT).
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(str) {
  const s = atob(String(str).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

// One HKDF call is Extract (with salt) followed by Expand (with info), as each RFC 8291 step needs.
async function hkdf(salt, ikm, info, bytes) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// A P-256 key as JWK from the 65-byte uncompressed public point and, for a private key, the 32-byte d.
function jwk(pub, d) {
  const k = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  if (d) k.d = b64u(d);
  return k;
}

// Encrypt `plaintext` for one subscription. `uaPublic` = keys.p256dh, `authSecret` = keys.auth (bytes).
// `asKeys` and `salt` are for the test vector only; normally both are fresh for every message.
export async function encrypt(plaintext, uaPublic, authSecret, { asKeys, salt } = {}) {
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  let asPrivate, asPublic;
  if (asKeys) {
    asPublic = asKeys.publicKey;
    asPrivate = await subtle.importKey("jwk", jwk(asPublic, asKeys.privateKey), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // A single record: the plaintext, then the 0x02 "last record" delimiter.
  const data = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(data, new Uint8Array([2]))));

  // Header: salt (16) | record size (uint32, 4096) | key id length (1) | key id = as_public (65).
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return { body: concat(header, asPublic, sealed), ecdhSecret, ikm, cek, nonce };
}

// VAPID: `vapid t=<ES256 JWT>, k=<public key>`; keys are base64url (65-byte public, 32-byte private d).
export async function vapidAuth(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = unb64u(publicKey);
  const key = await subtle.importKey("jwk", jwk(pub, unb64u(privateKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject };
  const body = b64u(enc.encode(JSON.stringify(claims)));
  // WebCrypto signs ECDSA as raw r|s (64 bytes), which is exactly the JWS ES256 form.
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

// One JWT per push service origin, reused for an hour (it is valid for 12).
const jwtCache = new Map();
async function cachedAuth(endpoint, vapid) {
  const aud = new URL(endpoint).origin, now = Date.now();
  const hit = jwtCache.get(aud);
  if (hit && hit.until > now && hit.key === vapid.publicKey) return hit.value;
  const value = await vapidAuth(endpoint, vapid, now);
  jwtCache.set(aud, { value, key: vapid.publicKey, until: now + 3600e3 });
  return value;
}

// Send one push. `sub` = {endpoint, p256dh, auth} (base64url keys). Returns the push service's Response.
export async function sendPush(sub, payload, vapid, { ttl = 300, urgency = "high", topic } = {}) {
  const { body } = await encrypt(JSON.stringify(payload), unb64u(sub.p256dh), unb64u(sub.auth));
  const headers = {
    "content-type": "application/octet-stream",
    "content-encoding": "aes128gcm",
    ttl: String(ttl),
    urgency,
    authorization: await cachedAuth(sub.endpoint, vapid),
  };
  // Topic replaces a still-undelivered message with the same topic (max 32 base64url chars).
  if (topic) headers.topic = topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return fetch(sub.endpoint, { method: "POST", headers, body });
}
