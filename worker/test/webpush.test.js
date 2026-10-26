import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify, generateKeyPairSync } from "node:crypto";
import { encrypt, vapidAuth, b64u, unb64u } from "../src/webpush.js";

// RFC 8291 section 5 and appendix A, copied from https://www.rfc-editor.org/rfc/rfc8291.txt (spaces removed).
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  message: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const vector = () => encrypt(V.plaintext, unb64u(V.uaPublic), unb64u(V.auth), {
  asKeys: { publicKey: unb64u(V.asPublic), privateKey: unb64u(V.asPrivate) },
  salt: unb64u(V.salt),
});

test("RFC 8291 appendix A: intermediate values", async () => {
  const r = await vector();
  assert.equal(b64u(r.ecdhSecret), V.ecdhSecret);
  assert.equal(b64u(r.ikm), V.ikm);
  assert.equal(b64u(r.cek), V.cek);
  assert.equal(b64u(r.nonce), V.nonce);
});

test("RFC 8291 section 5: the exact encrypted message", async () => {
  const { body } = await vector();
  // 86-byte header + 41 + 1 (delimiter) + 16 (tag). The RFC's own message decodes to 144, though its example says Content-Length: 145.
  assert.equal(body.length, 144);
  assert.equal(b64u(body.slice(0, 86)), V.header);
  assert.equal(b64u(body.slice(86)), V.ciphertext);
  assert.equal(b64u(body), V.message);
});

// The receiver's side, written independently from the RFC text, to decrypt fresh (random) messages.
async function decrypt(body, uaPublic, uaPrivate, auth) {
  const s = crypto.subtle, te = new TextEncoder();
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(uaPublic.slice(1, 33)), y: b64u(uaPublic.slice(33)), d: b64u(uaPrivate) };
  const priv = await s.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await s.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await s.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const h = async (salt, ikm, info, n) => new Uint8Array(await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info },
    await s.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const info = new Uint8Array([...te.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await h(auth, secret, info, 32);
  const cek = await h(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await h(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await s.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  assert.equal(plain[plain.length - 1], 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("random keys and salt: decrypts back to the payload", async () => {
  const msg = JSON.stringify({ title: "إقامة العصر بعد دقيقتين", body: "الساعة 3:42 م", tag: "warn-asr-2026-10-25" });
  const a = await encrypt(msg, unb64u(V.uaPublic), unb64u(V.auth));
  const b = await encrypt(msg, unb64u(V.uaPublic), unb64u(V.auth));
  assert.notEqual(b64u(a.body), b64u(b.body));
  assert.equal(await decrypt(a.body, unb64u(V.uaPublic), unb64u(V.uaPrivate), unb64u(V.auth)), msg);
  assert.equal(await decrypt(b.body, unb64u(V.uaPublic), unb64u(V.uaPrivate), unb64u(V.auth)), msg);
});

test("VAPID: ES256 JWT verifies with node:crypto, claims and header are right", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pj = publicKey.export({ format: "jwk" }), dj = privateKey.export({ format: "jwk" });
  const pub = b64u(new Uint8Array([4, ...unb64u(pj.x), ...unb64u(pj.y)]));
  const now = Date.UTC(2026, 9, 25, 12);
  const header = await vapidAuth("https://web.push.apple.com/QGuR3jA3eM-abc?x=1", { publicKey: pub, privateKey: dj.d, subject: "https://adhan-iqama.pages.dev" }, now);

  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, header);
  assert.equal(m[2], pub);
  const [h, c, sig] = m[1].split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(h))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://adhan-iqama.pages.dev");
  assert.equal(claims.exp, now / 1000 + 12 * 3600);
  assert.equal(unb64u(sig).length, 64);

  // Independent check: OpenSSL via node:crypto, with the key rebuilt from the public point only.
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(unb64u(m[2]).slice(1, 33)), y: b64u(unb64u(m[2]).slice(33)) }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, unb64u(sig)));
  // A changed claim must fail.
  const forged = b64u(new TextEncoder().encode(JSON.stringify({ ...claims, aud: "https://fcm.googleapis.com" })));
  assert.ok(!verify("sha256", Buffer.from(`${h}.${forged}`), { key, dsaEncoding: "ieee-p1363" }, unb64u(sig)));
});
