// In-place edits of the RAM-wrapped mapping buffer (RAM 0x05).
// We patch single bytes instead of re-encoding, so everything we don't touch stays byte-identical.

import { decodeMapping } from "./mapping.js";

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF); the wrapper CRC covers the XMUL blob only.
export function crc16(bytes) {
  let c = 0xffff;
  for (const b of bytes) {
    c ^= b << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

// Wrapper: len u16le (whole buffer, header included), crc16 u16le, XMUL blob.
export function unwrapMapping(buf) {
  if (buf.length < 8) throw new Error("ไฟล์สั้นเกินไป");
  const len = buf[0] | (buf[1] << 8), crc = buf[2] | (buf[3] << 8);
  if (len !== buf.length) throw new Error(`ความยาวใน header (${len}) ไม่ตรงกับขนาดไฟล์ (${buf.length})`);
  const blob = buf.subarray(4);
  if (crc16(blob) !== crc) throw new Error("CRC16 ไม่ตรง — ไฟล์เสียหรือไม่ใช่ข้อมูลโปรไฟล์");
  return { blob, cfg: decodeMapping(blob) };
}

// Highest safe deadzone: stay below 50% and below the curve's next point (first mid point or end).
export const DEADZONE_CAP = 127;
export function deadzoneMax(stick) {
  const xs = [stick.curve.end_x, ...stick.curve.mid_points.map((m) => m.x)];
  return Math.max(0, Math.min(DEADZONE_CAP, Math.min(...xs) - 1));
}

// Lowest allowed curve end: above the start and every mid point, so the curve stays monotonic.
export function curveEndMin(curve) {
  return Math.min(255, Math.max(curve.start_x, ...curve.mid_points.map((m) => m.x)) + 1);
}
export function curveStartMax(curve) {
  return Math.max(0, Math.min(curve.end_x, ...curve.mid_points.map((m) => m.x)) - 1);
}
export function motorMaxMin(curve) {
  return Math.max(curve.start_y, ...curve.mid_points.map((m) => m.y));
}

const GYRO_MODES = ["disable", "left_joystick", "right_joystick", "mouse"];
const SIDE_KEY = { left: "_left", right: "_right" };

// Every byte-level edit the app can write. Offsets are relative to the TLV value start
// (see the TLV layout in PROTOCOL.md); `header` edits are relative to the blob start.
// check(cfg, v) returns an error string when v is out of range.
const FIELDS = {
  "stick.left.deadzone": stickField("left", 0, "u8", (s, v) => range(v, 0, deadzoneMax(s))),
  "stick.right.deadzone": stickField("right", 0, "u8", (s, v) => range(v, 0, deadzoneMax(s))),
  "stick.left.max": stickField("left", 2, "u8", (s, v) => range(v, curveEndMin(s.curve), 255)),
  "stick.right.max": stickField("right", 2, "u8", (s, v) => range(v, curveEndMin(s.curve), 255)),
  "stick.left.invertX": stickField("left", 11, 1),
  "stick.left.invertY": stickField("left", 11, 2),
  "stick.left.round": stickField("left", 11, 4),
  "stick.right.invertX": stickField("right", 11, 1),
  "stick.right.invertY": stickField("right", 11, 2),
  "stick.right.round": stickField("right", 11, 4),
  "trigger.left.start": trigField("left", 0, (t, v) => range(v, 0, curveStartMax(t.curve))),
  "trigger.right.start": trigField("right", 0, (t, v) => range(v, 0, curveStartMax(t.curve))),
  "trigger.left.end": trigField("left", 2, (t, v) => range(v, curveEndMin(t.curve), 255)),
  "trigger.right.end": trigField("right", 2, (t, v) => range(v, curveEndMin(t.curve), 255)),
  "gyro.mode": { key: "gyroscope", at: 12, enc: (v) => GYRO_MODES.indexOf(v), check: (_, v) => (GYRO_MODES.includes(v) ? null : `โหมด gyro ไม่รู้จัก: ${v}`) },
  "gyro.invertX": { key: "gyroscope", at: 11, bit: 1 },
  "gyro.invertY": { key: "gyroscope", at: 11, bit: 2 },
  "motor.left.enabled": { key: "vibration_motor_left", at: 0, bit: 1 },
  "motor.right.enabled": { key: "vibration_motor_right", at: 0, bit: 1 },
  "motor.left.max": { key: "vibration_motor_left", at: 4, check: (m, v) => range(v, motorMaxMin(m.curve), 255) },
  "motor.right.max": { key: "vibration_motor_right", at: 4, check: (m, v) => range(v, motorMaxMin(m.curve), 255) },
  "runtime.long": { header: 12, u16: true, check: (_, v) => range(v, 50, 2000) },
  "runtime.double": { header: 14, u16: true, check: (_, v) => range(v, 50, 1000) },
};

function stickField(side, at, kind, check) {
  const key = `joystick${SIDE_KEY[side]}`;
  return typeof kind === "number" ? { key, at, bit: kind } : { key, at, check };
}
function trigField(side, at, check) {
  return { key: `trigger${SIDE_KEY[side]}`, at, check };
}
function range(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi ? null : `ต้องอยู่ระหว่าง ${lo}–${hi} (ได้ ${v})`;
}

// Names live in TLV 0x20 (v1.9 only): u8 nameLen, name, u8 n, n × (layer, macro, len, name), UTF-8.
// A new name can change the TLV's size, so name edits splice the blob instead of patching bytes.
// "profile.name" is the name of the slot the buffer came from; "macro.<layer>.<id>.name" a macro's.
// NAME_MAX is our own cap: the device limit is unknown, and the whole TLV must stay under 256 bytes.
export const NAME_MAX = 40;
const MACRO_NAME = /^macro\.(\d+)\.(\d+)\.name$/;
const isName = (key) => key === "profile.name" || MACRO_NAME.test(key);

export const WRITABLE = new Set([...Object.keys(FIELDS), "profile.name"]);
export const isWritable = (key) => WRITABLE.has(key) || MACRO_NAME.test(key);
export const nameBytes = (s) => new TextEncoder().encode(s).length;
// Fields confirmed by a write to a real Apex 6 Pro; the UI labels every other writable field.
// Add a key here once it has been tried on hardware.
// 2026-10-22, checked in joy.cpl: stick.left.max (255 → 179, edge at ~70% travel), then
// stick.left.deadzone, stick.left.invertX, stick.right.max, and trigger end on both sides.
// Then: right stick deadzone/invert X/Y, left invert Y, round edge on both sticks, trigger start.
export const HW_TESTED = new Set([
  "stick.left.max", "stick.left.deadzone", "stick.left.invertX", "stick.left.invertY", "stick.left.round",
  "stick.right.max", "stick.right.deadzone", "stick.right.invertX", "stick.right.invertY", "stick.right.round",
  "trigger.left.start", "trigger.right.start", "trigger.left.end", "trigger.right.end",
]);

// Returns a new wrapped buffer with the given edits applied and the CRC16 updated.
// edits: { "stick.left.deadzone": 20, "gyro.mode": "mouse", ... }
export function applyEdits(wrapped, edits) {
  const { cfg } = unwrapMapping(wrapped);
  let out = wrapped.slice();
  const names = {};
  for (const [name, v] of Object.entries(edits)) {
    if (isName(name)) {
      names[name] = v;
      continue;
    }
    const f = FIELDS[name];
    if (!f) throw new Error(`ยังเขียน ${name} ลงจอยไม่ได้`);
    let at;
    if (f.header != null) {
      at = 4 + f.header;
    } else {
      const part = cfg[f.key];
      if (!part || cfg.offsets[f.key] == null) throw new Error(`โปรไฟล์นี้ไม่มีค่า ${name}`);
      at = 4 + cfg.offsets[f.key] + f.at;
    }
    const err = f.check?.(f.key ? cfg[f.key] : cfg, v);
    if (err) throw new Error(`${name}: ${err}`);
    if (f.bit != null) {
      if (typeof v !== "boolean") throw new Error(`${name}: ต้องเป็นเปิด/ปิด`);
      out[at] = v ? out[at] | f.bit : out[at] & ~f.bit;
    } else if (f.u16) {
      out[at] = v & 0xff;
      out[at + 1] = v >> 8;
    } else {
      out[at] = f.enc ? f.enc(v) : v;
    }
  }
  // Byte patches first: the splice below moves everything after TLV 0x20.
  if (Object.keys(names).length) out = withNames(out, cfg, names);
  const c = crc16(out.subarray(4));
  out[2] = c & 0xff;
  out[3] = c >> 8;
  return out;
}

// Rebuilds TLV 0x20 with the new names and splices it into the wrapped buffer (length updated,
// CRC16 left to the caller). Entries we don't touch keep their order and bytes.
function withNames(wrapped, cfg, names) {
  if (cfg.version !== "1.9") throw new Error("โปรไฟล์ v1.8 ไม่มีที่เก็บชื่อ ตั้งชื่อไม่ได้");
  const enc = new TextEncoder();
  const blob = wrapped.subarray(4);
  const { meta, end } = cfg.offsets;
  if (meta == null && end == null) throw new Error("หาตำแหน่งเก็บชื่อในโปรไฟล์ไม่เจอ");

  // Parse the current TLV value, keeping any bytes after the entries as they are.
  let profile = enc.encode(cfg.name ?? "");
  let entries = [];
  let rest = new Uint8Array(0);
  if (meta != null) {
    const v = blob.subarray(meta, meta + blob[meta - 1]);
    let o = 0;
    const nl = v[o++] ?? 0;
    profile = v.slice(o, o + nl);
    o += nl;
    const n = v[o++] ?? 0;
    for (let i = 0; i < n && o + 3 <= v.length; i++) {
      const l = v[o + 2];
      entries.push({ layer: v[o], macro: v[o + 1], name: v.slice(o + 3, o + 3 + l) });
      o += 3 + l;
    }
    rest = v.slice(o);
  }

  for (const [key, v] of Object.entries(names)) {
    if (typeof v !== "string") throw new Error(`${key}: ชื่อต้องเป็นข้อความ`);
    const bytes = enc.encode(v);
    if (bytes.length > NAME_MAX) throw new Error(`ชื่อ "${v}" ยาว ${bytes.length} ไบต์ เกิน ${NAME_MAX}`);
    if (key === "profile.name") {
      profile = bytes;
      continue;
    }
    const [, layer, macro] = key.match(MACRO_NAME).map(Number);
    if (!cfg.layers.find((l) => l.layer_id === layer)?.macros.some((m) => m.macro_id === macro)) {
      throw new Error(`โปรไฟล์นี้ไม่มี macro #${macro + 1} ใน layer ${layer}`);
    }
    const at = entries.findIndex((e) => e.layer === layer && e.macro === macro);
    // An empty name drops the entry, so the macro falls back to its default name.
    if (!bytes.length) {
      if (at >= 0) entries.splice(at, 1);
    } else if (at >= 0) entries[at].name = bytes;
    else entries.push({ layer, macro, name: bytes });
  }

  const value = [profile.length, ...profile, entries.length];
  for (const e of entries) value.push(e.layer, e.macro, e.name.length, ...e.name);
  value.push(...rest);
  if (value.length > 255 || entries.length > 255) throw new Error("ชื่อทั้งหมดรวมกันยาวเกินที่โปรไฟล์เก็บได้ (255 ไบต์)");

  // Replace the old TLV, or add one just before the END marker.
  const from = meta != null ? meta - 2 : end;
  const to = meta != null ? meta + blob[meta - 1] : end;
  const nextBlob = new Uint8Array([...blob.subarray(0, from), 0x20, value.length, ...value, ...blob.subarray(to)]);
  const out = new Uint8Array(4 + nextBlob.length);
  out.set(nextBlob, 4);
  out[0] = out.length & 0xff;
  out[1] = out.length >> 8;
  return out;
}

// Kept for callers that only touch deadzones.
export function withStickDeadzones(wrapped, values) {
  const edits = {};
  for (const [side, v] of Object.entries(values)) if (v != null) edits[`stick.${side}.deadzone`] = v;
  return applyEdits(wrapped, edits);
}

export const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
