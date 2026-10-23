// RGB lighting (RAM 0x04, magic "LGHT"). Layout from the official codec (vendor-gpa6-codec-*.js,
// 2026-10-23), see PROTOCOL.md. Lighting belongs to a slot: RAM 0x04 reads and writes the active one.

import { crc16 } from "./mapping-edit.js";

// Mode byte. The official page lists them in this order: Default, Streaming, Breathing,
// Gradient, Solid, Off.
export const LIGHT_MODE = { default: 5, streaming: 4, breathing: 2, gradient: 3, solid: 1, off: 0 };
const MODE_OF = Object.fromEntries(Object.entries(LIGHT_MODE).map(([k, v]) => [v, k]));
export const LIGHT_COLORS_MAX = 8;
// Speed is stored as level × 10, level 1–10 (official contract J/xn).
export const SPEED_MIN = 1, SPEED_MAX = 10;
export const hasSpeed = (mode) => mode === "streaming" || mode === "breathing" || mode === "gradient" || mode === "default";
export const hasColors = (mode) => mode === "breathing" || mode === "gradient";
// Draft keys of the Lighting page.
export const LED_KEY = /^led\.(mode|color|colors|bright|speed|vibration)$/;

const MAGIC = [0x4c, 0x47, 0x48, 0x54];
// A slot that was never given lighting reads back 8 bytes starting "RGBD"; the official app
// shows its built-in default then.
const EMPTY = [0x52, 0x47, 0x42, 0x44];
const VERSION = 2;
// What the official app writes when a mode is picked (contract Wt): brightness 80, speed level 5,
// colors gold, then blue for the second gradient color.
export const NEW_BRIGHT = 80, NEW_SPEED = 5;
export const GOLD = "#FFD700", BLUE = "#3080FF";

const sum16 = (b, from = 0, to = b.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s = (s + b[i]) & 0xffff;
  return s;
};
const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const fromHex = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h ?? "");
  if (!m) throw new Error(`สี "${h}" ไม่ใช่ #RRGGBB`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
export const speedLevel = (byte) => Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(byte / 10)));

// Wrapped RAM 0x04 buffer → { mode, bright, speed (raw byte), colors [hex], vibration, version },
// or { empty: true } for a slot that was never set.
export function decodeLighting(buf) {
  if (buf.length === 8 && EMPTY.every((b, i) => buf[i] === b)) return { empty: true };
  if (buf.length < 4) throw new Error("ข้อมูลไฟสั้นเกินไป");
  const len = buf[0] | (buf[1] << 8);
  if (len !== buf.length) throw new Error(`ข้อมูลไฟ: ความยาวใน header (${len}) ไม่ตรงกับที่อ่านได้ (${buf.length})`);
  // The wrapper CRC16 is not checked: the official default's (0xAB26) matches no CRC16 of the blob,
  // and the official reader skips the 4 bytes. LGHT's own two checksums guard the data instead.
  const t = buf.subarray(4);
  if (t.length < 14 || MAGIC.some((b, i) => t[i] !== b)) throw new Error("ข้อมูลไฟไม่ได้ขึ้นต้นด้วย LGHT");
  const version = t[4] | (t[5] << 8);
  const size = (t[6] | (t[7] << 8) | (t[8] << 16) | (t[9] << 24)) >>> 0;
  if ((t[10] | (t[11] << 8)) !== sum16(t, 0, 10)) throw new Error("ข้อมูลไฟ: checksum ของ header ไม่ตรง");
  if (12 + size + 2 !== t.length) throw new Error(`ข้อมูลไฟ: ขนาด ${size} ไม่ตรงกับความยาว`);
  const p = t.subarray(12, 12 + size);
  if ((t[12 + size] | (t[13 + size] << 8)) !== sum16(p)) throw new Error("ข้อมูลไฟ: checksum ของข้อมูลไม่ตรง");
  const mode = MODE_OF[p[0]];
  if (!mode) throw new Error(`ข้อมูลไฟ: ไม่รู้จักโหมด ${p[0]}`);
  const out = { version, mode, bright: null, speed: null, colors: [], vibration: false };
  let o = 1;
  const need = (n) => {
    if (o + n > p.length) throw new Error(`ข้อมูลไฟ: โหมด ${mode} สั้นเกินไป`);
  };
  if (mode === "solid") {
    need(4);
    out.colors = [toHex(p[1], p[2], p[3])];
    out.bright = p[4];
    o = 5;
  } else if (hasColors(mode)) {
    need(3);
    out.bright = p[1];
    out.speed = p[2];
    const n = p[3];
    o = 4;
    need(n * 3);
    for (let i = 0; i < n; i++, o += 3) out.colors.push(toHex(p[o], p[o + 1], p[o + 2]));
  } else if (mode !== "off") {
    need(2);
    out.bright = p[1];
    out.speed = p[2];
    o = 3;
  }
  // One byte after the mode's data: bit 0 = light follows vibration. Older data may not have it.
  out.vibration = o < p.length ? (p[o] & 1) === 1 : false;
  return out;
}

// What the controller will take. Hardware facts and the official app's limits, kept as code:
// a known mode, brightness 0–100, speed 10–100 in steps of 10 (or what was read), 1–8 colors for
// breathing and gradient, one color for solid.
export function checkLighting(L, { keptSpeed = null } = {}) {
  const fail = (msg) => {
    throw new Error(`ไม่เขียนไฟลงจอย: ${msg}`);
  };
  if (!(L.mode in LIGHT_MODE)) fail(`ไม่รู้จักโหมด ${L.mode}`);
  if (L.mode === "off") return;
  if (!Number.isInteger(L.bright) || L.bright < 0 || L.bright > 100) fail(`ความสว่าง ${L.bright} (ได้ 0–100)`);
  if (hasSpeed(L.mode)) {
    const s = L.speed;
    const ok = Number.isInteger(s) && ((s % 10 === 0 && s >= SPEED_MIN * 10 && s <= SPEED_MAX * 10) || s === keptSpeed);
    if (!ok) fail(`ความเร็ว ${s} (ได้ 10–100 ทีละ 10)`);
  }
  if (L.mode === "solid" && L.colors.length !== 1) fail(`โหมดสีเดียวต้องมี 1 สี (มี ${L.colors.length})`);
  if (hasColors(L.mode) && (L.colors.length < 1 || L.colors.length > LIGHT_COLORS_MAX)) fail(`มี ${L.colors.length} สี (ได้ 1–${LIGHT_COLORS_MAX})`);
  for (const c of L.colors) {
    try {
      fromHex(c);
    } catch (e) {
      fail(e.message);
    }
  }
}

// { mode, bright, speed, colors, vibration } → wrapped RAM 0x04 buffer, as the official app writes it
// (codec Mn, wrapped like RAM 0x05: len u16le, CRC16/CCITT-FALSE of the blob). Checked first, then
// decoded again to be sure it reads back.
export function encodeLighting(L, opts) {
  checkLighting(L, opts);
  const p = [LIGHT_MODE[L.mode]];
  if (L.mode === "solid") p.push(...fromHex(L.colors[0]), L.bright);
  else if (hasColors(L.mode)) p.push(L.bright, L.speed, L.colors.length, ...L.colors.flatMap(fromHex));
  else if (L.mode !== "off") p.push(L.bright, L.speed);
  p.push(L.vibration ? 1 : 0);
  const t = new Uint8Array(12 + p.length + 2);
  t.set(MAGIC);
  t[4] = VERSION;
  t[6] = p.length;
  const h = sum16(t, 0, 10);
  t[10] = h & 255;
  t[11] = h >> 8;
  t.set(p, 12);
  const d = sum16(p);
  t[12 + p.length] = d & 255;
  t[13 + p.length] = d >> 8;
  const out = new Uint8Array(4 + t.length);
  out[0] = out.length & 255;
  out[1] = out.length >> 8;
  const c = crc16(t);
  out[2] = c & 255;
  out[3] = c >> 8;
  out.set(t, 4);
  const back = decodeLighting(out);
  const same = (x) => JSON.stringify([x.mode, x.bright, x.speed, x.colors.map((c) => c.toUpperCase()), !!x.vibration]);
  if (same(back) !== same(L)) throw new Error("ไม่เขียนไฟลงจอย: อ่านข้อมูลที่สร้างกลับมาไม่ตรง");
  return out;
}

// The lighting to write: what the slot holds (base, from decodeLighting) with the page's drafts
// on top (get(key) → draft or base value, see lightValue). A mode that wasn't on before starts
// from what was set in the old one, or the official app's defaults.
export function composeLighting(base, get) {
  const mode = get("led.mode");
  const L = { mode, bright: null, speed: null, colors: [], vibration: !!get("led.vibration") };
  if (mode === "off") return L;
  L.bright = get("led.bright");
  if (hasSpeed(mode)) {
    // An untouched speed keeps the byte the slot holds (the factory default is 51, not a step of 10).
    const level = get("led.speed");
    L.speed = base && !base.empty && hasSpeed(base.mode) && base.speed != null && speedLevel(base.speed) === level ? base.speed : level * 10;
  }
  if (mode === "solid") L.colors = [get("led.color")];
  if (hasColors(mode)) L.colors = get("led.colors");
  return L;
}

// What the page shows for a draft key while it isn't drafted, from what the slot holds.
export function lightValue(base, key) {
  const b = base && !base.empty ? base : null;
  const f = key.split(".")[1];
  if (f === "mode") return b?.mode ?? null;
  if (f === "bright") return b?.bright ?? NEW_BRIGHT;
  if (f === "speed") return b?.speed != null ? speedLevel(b.speed) : NEW_SPEED;
  if (f === "vibration") return b?.vibration ?? false;
  if (f === "color") return b?.colors[0] ?? GOLD;
  if (f === "colors") {
    if (b && hasColors(b.mode)) return b.colors;
    return b?.colors.length ? [...b.colors] : [GOLD];
  }
  return undefined;
}
