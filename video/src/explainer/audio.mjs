// Light sounds only, no background and nothing between scenes: notification dings, countdown ticks,
// the app's own iqama chime and quiet taps. Synthesised here (pure tones, no noise, no licences).
// Times are video seconds. Writes ../../out/soundtrack.wav (48 kHz, stereo, 16-bit), peaking at -6 dBFS.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "out");
const SR = 48000, DURATION = 55.5, N = Math.round(SR * DURATION);
const L = new Float32Array(N), R = new Float32Array(N);

// The composition holds still for the landscape beat; later events shift by BEAT (see composition.html).
const HOLD = 42.3, BEAT = 3;
const rt = t => (t < HOLD ? t : t + BEAT);

function add(at, len, fn, pan = 0) {
  const i0 = Math.max(0, Math.round(at * SR)), n = Math.min(N - i0, Math.round(len * SR));
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) { const v = fn(i / SR); L[i0 + i] += v * gl; R[i0 + i] += v * gr; }
}

// A clean bell tone: a sine with one soft overtone and a smooth decay.
function tone(at, f, gain, len, pan = 0) {
  add(at, len, t => {
    const env = Math.min(1, t / .008) * Math.exp(-t * 4.5 / len);
    return gain * env * (Math.sin(2 * Math.PI * f * t) + .12 * Math.sin(4 * Math.PI * f * t));
  }, pan);
}

// Countdown tick: very short and quiet.
function tick(at, gain = .08, f = 1500) {
  add(at, .03, t => gain * Math.exp(-t * 170) * Math.sin(2 * Math.PI * f * t));
}

// A soft tap: a short pitched "tock".
function tap(at, gain = .14) {
  add(at, .08, t => gain * Math.exp(-t * 60) * Math.sin(2 * Math.PI * (900 - 3000 * t) * t));
}

// Countdown digits roll 00:24:12 → 00:23:45 between 5.25 and 7.55 (27 steps).
for (let k = 0; k <= 27; k++) tick(5.25 + (k / 27) * 2.3, .07);

// Three notification banners: a gentle two-note ding each.
for (const at of [17.75, 19.35, 20.95]) { tone(at, 1046.5, .16, .5, .2); tone(at + .1, 1318.5, .13, .6, .2); }

// Full-screen iqama: a tick per second 60 → 0, then the app's chime (880 Hz, then 660 Hz).
{
  const T0 = 24.75, T1 = 28.85;
  for (let k = 1; k <= 60; k++) tick(T0 + (1 - Math.pow(1 - k / 60, 1 / 2.2)) * (T1 - T0), k > 54 ? .12 : .06);
  tone(T1, 880, .28, 1.2); tone(T1 + .45, 660, .28, 1.5);
}

// Taps: radio play, settings «+» and «فاتح», Share, «إضافة إلى الشاشة الرئيسية», the app icon.
for (const at of [33.0, 38.95, 39.5, rt(43.65), rt(45.25), rt(46.75)]) tap(at);

// Normalise so the loudest sound peaks at -6 dBFS (light, never harsh), then write 16-bit PCM.
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = .5 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "soundtrack.wav"), buf);
console.log(`soundtrack.wav ${DURATION}s (light sounds, no background)`);
