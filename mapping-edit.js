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

const STICKS = { left: "joystick_left", right: "joystick_right" };

// Returns a new wrapped buffer with start_x of each given stick curve replaced and the CRC16 updated.
export function withStickDeadzones(wrapped, values) {
  const { cfg } = unwrapMapping(wrapped);
  const out = wrapped.slice();
  for (const [side, key] of Object.entries(STICKS)) {
    const v = values[side];
    if (v == null) continue;
    const stick = cfg[key];
    if (!stick || cfg.offsets[key] == null) throw new Error(`โปรไฟล์นี้ไม่มีค่าสติ๊ก${side === "left" ? "ซ้าย" : "ขวา"}`);
    const max = deadzoneMax(stick);
    if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`deadzone ต้องอยู่ระหว่าง 0–${max} (ได้ ${v})`);
    out[4 + cfg.offsets[key]] = v; // start_x is the first byte of the stick curve
  }
  const c = crc16(out.subarray(4));
  out[2] = c & 0xff;
  out[3] = c >> 8;
  return out;
}

export const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
