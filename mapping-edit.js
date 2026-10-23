// In-place edits of the RAM-wrapped mapping buffer (RAM 0x05).
// We patch single bytes instead of re-encoding, so everything we don't touch stays byte-identical.

import { decodeMapping, BUTTONS, GYRO_AXES } from "./mapping.js";
import { keyProblem, isExtraKey } from "./keys.js";

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

// The official web app shows gyro bytes as a percent of 255 (GyroBody on space_station.flydigi.com):
// p = round(byte / 2.55), byte = round(p * 2.55).
export const gyroPct = (b) => Math.round(Math.max(0, Math.min(255, b)) / 2.55);
export const gyroByte = (p) => Math.round(Math.max(0, Math.min(100, p)) * 2.55);

// A curve is written whole, as the official encoder writes curve11: start_x start_y end_x
// end_y n, two (x, y) mid points (unused ones 0, 0), two zero pad bytes.
export const GYRO_MIDS_MAX = 2;
function curveBytes(c) {
  const m = c.mid_points;
  return [c.start_x, c.start_y, c.end_x, c.end_y, m.length, m[0]?.x ?? 0, m[0]?.y ?? 0, m[1]?.x ?? 0, m[1]?.y ?? 0, 0, 0];
}
function curveCheck(_, c) {
  const byte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
  const m = c?.mid_points;
  if (!Array.isArray(m) || m.length > GYRO_MIDS_MAX) return `จุดกลางได้ไม่เกิน ${GYRO_MIDS_MAX} จุด`;
  if (![c.start_x, c.start_y, c.end_x, c.end_y, ...m.flatMap((p) => [p.x, p.y])].every(byte)) return "ค่าใน curve ต้องอยู่ระหว่าง 0–255";
  const xs = [c.start_x, ...m.map((p) => p.x), c.end_x];
  return xs.every((x, i) => !i || x >= xs[i - 1]) ? null : "จุดใน curve ต้องเรียงจากซ้ายไปขวา";
}

// Gyro activation: 4 slots of (0 hold | 1 toggle, button id), an empty slot is (0, 0xFF).
export const GYRO_ACT_MAX = 4;
function gyroActBytes(list) {
  const out = [];
  for (let i = 0; i < GYRO_ACT_MAX; i++) {
    const a = list[i];
    out.push(a ? (a.activation === "toggle" ? 1 : 0) : 0, a ? BUTTONS.indexOf(a.button) : 0xff);
  }
  return out;
}
function gyroActCheck(_, list) {
  if (!Array.isArray(list) || list.length > GYRO_ACT_MAX) return `ตั้งได้ไม่เกิน ${GYRO_ACT_MAX} ปุ่ม`;
  if (!list.length) return "ต้องมีปุ่มเปิด gyro อย่างน้อย 1 ปุ่ม";
  for (const a of list) {
    if (!BUTTONS.includes(a?.button)) return `ปุ่มไม่รู้จัก: ${a?.button}`;
    if (a.activation !== "hold" && a.activation !== "toggle") return `แบบการกดไม่รู้จัก: ${a.activation}`;
  }
  return new Set(list.map((a) => a.button)).size === list.length ? null : "ปุ่มซ้ำกัน";
}
const gyroAxis = (at) => ({ key: "gyroscope", at, enc: (v) => GYRO_AXES.indexOf(v), check: (_, v) => (GYRO_AXES.includes(v) ? null : `แกน gyro ไม่รู้จัก: ${v}`) });
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
  "gyro.curve": { key: "gyroscope", at: 0, bytes: curveBytes, check: curveCheck },
  "gyro.activation": { key: "gyroscope", at: 13, bytes: gyroActBytes, check: gyroActCheck },
  "gyro.axisX": gyroAxis(21),
  "gyro.axisY": gyroAxis(22),
  "gyro.mouseRadius": { key: "gyroscope", at: 23, enc: gyroByte, check: (_, v) => range(v, 0, 100) },
  "motor.left.enabled": { key: "vibration_motor_left", at: 0, bit: 1 },
  "motor.right.enabled": { key: "vibration_motor_right", at: 0, bit: 1 },
  "motor.left.max": { key: "vibration_motor_left", at: 4, check: (m, v) => range(v, motorMaxMin(m.curve), 255) },
  "motor.right.max": { key: "vibration_motor_right", at: 4, check: (m, v) => range(v, motorMaxMin(m.curve), 255) },
  // TLV 6–9 are 1 byte (motor: enabled bit, trigger: pad) + curve11.
  "motor.left.curve": { key: "vibration_motor_left", at: 1, bytes: curveBytes, check: curveCheck },
  "motor.right.curve": { key: "vibration_motor_right", at: 1, bytes: curveBytes, check: curveCheck },
  "vibtrig.left.curve": { key: "vibration_trigger_left", at: 1, bytes: curveBytes, check: curveCheck },
  "vibtrig.right.curve": { key: "vibration_trigger_right", at: 1, bytes: curveBytes, check: curveCheck },
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

// ---- Vibration, as the official Vibration page shows it (PROTOCOL.md, TLV 6–9 and RAM 0x06) ----
// Levels 1–5. "Grip" is both motors (TLV 8/9) at one level: a level writes a fresh linear curve.
export const VIB_LEVELS = 5;
const GRIP_END_Y = { std: [0, 51, 102, 153, 204, 255], lra: [0, 128, 166, 204, 230, 255] };
const clampLevel = (v) => Math.max(1, Math.min(VIB_LEVELS, Math.round(v)));
const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const gripEndY = (level, lra) => GRIP_END_Y[lra ? "lra" : "std"][clampLevel(level)];
export const gripCurve = (level, lra) => ({ start_x: 0, start_y: 0, end_x: 255, end_y: gripEndY(level, lra), mid_points: [] });
// A curve of the official shape (no mid points) reads as the nearest level; any other as end_y in fifths.
export function vibLevel(curve, lra) {
  if (!curve) return undefined;
  if (curve.mid_points.length) return clampLevel((curve.end_y / 255) * VIB_LEVELS);
  let best = 1;
  for (let l = 1; l <= VIB_LEVELS; l++) {
    const d = (c) => Math.abs(c.start_y - curve.start_y) + Math.abs(c.end_y - curve.end_y);
    if (d(gripCurve(l, lra)) < d(gripCurve(best, lra))) best = l;
  }
  return best;
}
// Trigger-bound grip feedback (TLV 6/7): the strength is the curve's shape scaled to level/5.
export const feedbackLevel = (curve) => (curve ? clampLevel((curve.end_y / 255) * VIB_LEVELS) : undefined);
export function feedbackCurve(curve, level) {
  let c = structuredClone(curve);
  const ys = [c.start_y, c.end_y, ...c.mid_points.map((m) => m.y)];
  if (ys.every((y) => !y)) {
    // A curve at zero has no shape left to scale: the official app picks one from the mid points.
    const xs = c.mid_points.map((m) => m.x).join();
    c.end_y = 255;
    if (xs === "64,192") c.mid_points = [{ x: 64, y: 77 }, { x: 192, y: 217 }];
    else if (xs === "60,200") c.mid_points = [{ x: 60, y: 255 }, { x: 200, y: 255 }];
  } else {
    const e = Math.max(1 / 255, c.end_y / 255);
    c = { ...c, start_y: byte(c.start_y / e), end_y: byte(c.end_y / e), mid_points: c.mid_points.map((m) => ({ x: m.x, y: byte(m.y / e) })) };
  }
  const k = clampLevel(level) / VIB_LEVELS;
  return { ...c, start_y: byte(c.start_y * k), end_y: byte(c.end_y * k), mid_points: c.mid_points.map((m) => ({ x: m.x, y: byte(m.y * k) })) };
}

// Trigger-bound grip feedback on/off is not in the profile: it is the mode of each side in RAM 0x06,
// set with 0x53 [area, target, mode, params…]. Mode 2 is this feedback, 0 off; others are X-Haptics scenes.
export const FEEDBACK_MODE = 2;
const FEEDBACK_PARAMS = [0, 64, 6];
const MOTOR_SIDE = { left: 0, right: 1 };
export const motorMode = (ram, side) => (ram && ram.length >= 23 ? ram[side === "left" ? 1 : 12] : undefined);
export const FEEDBACK_KEY = /^gripfb\.(left|right)\.enabled$/;
export function motorCmd(side, on) {
  const cmd = { area: 0, target: MOTOR_SIDE[side], mode: on ? FEEDBACK_MODE : 0, params: on ? FEEDBACK_PARAMS : [] };
  checkMotorCmd(cmd);
  return cmd;
}
// The only 0x53 commands the app sends: feedback on or off for one side, as the official app sends them.
export function checkMotorCmd({ area, target, mode, params }) {
  const fail = (msg) => {
    throw new Error(`ไม่ส่งคำสั่งสั่นลงจอย: ${msg}`);
  };
  if (area !== 0) fail(`area ${area} ไม่รู้จัก`);
  if (target !== 0 && target !== 1) fail(`ไกฝั่ง ${target} ไม่รู้จัก (ได้ 0 ซ้าย, 1 ขวา)`);
  if (mode === FEEDBACK_MODE ? params.join() !== FEEDBACK_PARAMS.join() : mode !== 0 || params.length) fail(`โหมด ${mode} กับค่า [${params}] ไม่ใช่แบบที่แอป Flydigi ส่ง`);
}

// Names live in TLV 0x20 (v1.9): u8 nameLen, name, u8 n, n × (layer, macro, len, name), UTF-8.
// A new name can change the TLV's size, so name edits splice the blob instead of patching bytes.
// "profile.name" is the name of the slot the buffer came from; "macro.<layer>.<id>.name" a macro's.
// A v1.8 profile has no TLV 0x20; naming it makes it v1.9, as the official codec does when it
// encodes a profile with a name (version "1.9" whenever there is one). The rest of the blob is the same.
// NAME_MAX is our own cap: the device limit is unknown, and the whole TLV must stay under 256 bytes.
export const NAME_MAX = 40;
const MACRO_NAME = /^macro\.(\d+)\.(\d+)\.name$/;
const MACRO_OP = /^macro\.(\d+)\.(\d+)\.(set|delete)$/;
const isName = (key) => key === "profile.name" || MACRO_NAME.test(key);
// "map.<layer>.<button>.<simple|long|double>" = target, or undefined to clear that press.
const MAP_KEY = /^map\.(\d+)\.(.+)\.(simple|long|double)$/;
// "layer.<id>.new" / "layer.<id>.delete" = true.
const LAYER_OP = /^layer\.(\d+)\.(new|delete)$/;
const isStructural = (key) => MACRO_OP.test(key) || MAP_KEY.test(key) || LAYER_OP.test(key);

export const WRITABLE = new Set([...Object.keys(FIELDS), "profile.name"]);
export const isWritable = (key) => WRITABLE.has(key) || FEEDBACK_KEY.test(key) || MACRO_NAME.test(key) || MACRO_OP.test(key) || MAP_KEY.test(key) || LAYER_OP.test(key);
export const nameBytes = (s) => new TextEncoder().encode(s).length;
// Fields confirmed by a write to a real Apex 6 Pro; the UI labels every other writable field.
// Add a key here once it has been tried on hardware.
// 2026-10-22, checked in joy.cpl: stick.left.max (255 → 179, edge at ~70% travel), then
// stick.left.deadzone, stick.left.invertX, stick.right.max, and trigger end on both sides.
// Then: right stick deadzone/invert X/Y, left invert Y, round edge on both sticks, trigger start.
// profile.name: a long slot name written and read back byte-identical. The official web app can't
// set names, so there is nothing to compare it against there.
export const HW_TESTED = new Set([
  "profile.name",
  "stick.left.max", "stick.left.deadzone", "stick.left.invertX", "stick.left.invertY", "stick.left.round",
  "stick.right.max", "stick.right.deadzone", "stick.right.invertX", "stick.right.invertY", "stick.right.round",
  "trigger.left.start", "trigger.right.start", "trigger.left.end", "trigger.right.end",
  // Right stick + "hold LT" confirmed in joy.cpl; the other modes write the same byte.
  "gyro.mode",
  // Lighting (RAM 0x04), owner 2026-10-23: solid red at 100%, breathing with 2 colors at speed 2
  // and 9, off, and each slot keeping its own light across a switch. The other modes write the same
  // bytes. Vibration sync not tried yet.
  "led.mode", "led.color", "led.colors", "led.bright", "led.speed",
]);
// Button presses all share map.* keys, so they are confirmed by what they send, not by key.
// Keyboard: owner 2026-10-23, M1 → K and Shift + K typed k and K in Notepad.
// Gamepad button and layer hold: 2026-10-22, M1 "hold → Layer 2" + Layer 2 A → B in joy.cpl, and LM/RM remaps.
// Macro: owner 2026-10-23, in a game, M4 "hold → Shift layer" and a button of Shift playing a macro
// from the library (a copy the write put into that layer).
export const HW_TESTED_TARGETS = new Set(["btn_keyboard", "btn_gamepad", "layer_hold", "macro"]);
// Putting a library macro into a layer (macro.<layer>.<id>.set) is confirmed with it; removing a
// copy and macro names are not yet.
const HW_TESTED_MACRO = /^macro\.\d+\.\d+\.set$/;
// F13–F24 are keyboard targets too, but the official picker never sends them: not confirmed yet.
export const hwTested = (key, value) => HW_TESTED.has(key) || HW_TESTED_MACRO.test(key ?? "") || (MAP_KEY.test(key ?? "") && HW_TESTED_TARGETS.has(value?.type) && !(value.type === "btn_keyboard" && isExtraKey(value.key)));

// Returns a new wrapped buffer with the given edits applied and the CRC16 updated.
// edits: { "stick.left.deadzone": 20, "gyro.mode": "mouse", ... }
export function applyEdits(wrapped, edits) {
  // Layers, macros and button maps move bytes, so they go first and everything else patches the
  // result. Layers first: a new layer can take macros and button maps in the same write.
  const lops = layerOps(edits);
  wrapped = lops.length ? withLayerOps(wrapped, lops) : wrapped;
  const deadLayers = new Set(lops.filter((o) => o.kind === "delete").map((o) => o.layer));
  // Edits to a layer that is being deleted go with it.
  const ops = macroOps(edits).filter((o) => !deadLayers.has(o.layer));
  wrapped = ops.length ? withMacroOps(wrapped, ops) : wrapped;
  wrapped = withMapEdits(wrapped, mapEdits(edits, deadLayers));
  const gone = new Set(ops.filter((o) => o.kind === "delete").map((o) => `${o.layer}.${o.id}`));
  const { cfg } = unwrapMapping(wrapped);
  let out = wrapped.slice();
  const names = {};
  for (const [name, v] of Object.entries(edits)) {
    if (isStructural(name)) continue;
    if (isName(name)) {
      const m = name.match(MACRO_NAME);
      if (m && (gone.has(`${m[1]}.${m[2]}`) || deadLayers.has(Number(m[1])))) continue;
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
    } else if (f.bytes) {
      out.set(f.bytes(v), at);
    } else if (f.u16) {
      out[at] = v & 0xff;
      out[at + 1] = v >> 8;
    } else {
      out[at] = f.enc ? f.enc(v) : v;
    }
  }
  // Byte patches first: the splice below moves everything after TLV 0x20.
  if (Object.keys(names).length) out = withNames(out, cfg, names);
  // A layer out of place (see normalizeLayers) is fixed by any write; a profile whose layers are
  // already 0, 1, 2, … in order is left byte-for-byte.
  out = normalizeLayers(out);
  const c = crc16(out.subarray(4));
  out[2] = c & 0xff;
  out[3] = c >> 8;
  checkProfile(out);
  return out;
}

// Rules the controller's firmware holds a profile to, as found on hardware (PROTOCOL.md). Every
// write passes through here, so a bug in an edit stops the write instead of reaching the controller.
// Add a rule here whenever the hardware teaches us one.
export function checkProfile(wrapped) {
  const { cfg } = unwrapMapping(wrapped);
  const where = (l) => (l.layer_id ? `layer ${l.layer_id}` : "Base layer");
  const fail = (msg) => {
    throw new Error(`ไม่เขียนลงจอย: ${msg}`);
  };
  if (cfg.layers.length < 1 || cfg.layers.length > LAYER_MAX) fail(`มี ${cfg.layers.length} layer (ได้ 1–${LAYER_MAX})`);
  // The firmware finds a layer by its position, so layer ids must be 0, 1, 2, … in order.
  cfg.layers.forEach((l, i) => l.layer_id !== i && fail(`layer ลำดับที่ ${i + 1} มีเลข ${l.layer_id} จอยจะหา layer ผิดตัว`));
  for (const l of cfg.layers) {
    const ids = l.macros.map((m) => m.macro_id);
    if (ids.length > MACRO_MAX) fail(`${where(l)} มี macro ${ids.length} ตัว (ได้ ${MACRO_MAX})`);
    if (new Set(ids).size !== ids.length) fail(`${where(l)} มี macro เลขซ้ำกัน`);
    for (const m of l.mappings)
      for (const a of m.activators) {
        const t = a.target;
        // A layer switch must reach a layer there is; a macro target plays a macro of its own layer.
        if ((t.type === "layer_hold" || t.type === "layer_toggle") && !(t.layer < cfg.layers.length)) fail(`ปุ่ม ${m.source} ใน ${where(l)} สลับไป layer ${t.layer} ที่ไม่มี`);
        if (t.type === "macro" && !ids.includes(t.macro)) fail(`ปุ่ม ${m.source} ใน ${where(l)} เล่น macro #${t.macro + 1} ที่ไม่มีใน layer นี้`);
        const kp = t.type === "btn_keyboard" && keyProblem(t.key, t.modifier);
        if (kp) fail(`ปุ่ม ${m.source} ใน ${where(l)}: ${kp}`);
      }
    for (const m of l.macros)
      for (const a of m.actions) {
        const kp = a.target?.type === "btn_keyboard" && keyProblem(a.target.key, a.target.modifier);
        if (kp) fail(`macro #${m.macro_id + 1} ใน ${where(l)}: ${kp}`);
      }
  }
  // Gyro block (TLV 5): only values the official app knows. Its schema wants 1–4 activation slots.
  const g = cfg.gyroscope;
  if (g) {
    if (!GYRO_MODES.includes(g.mode)) fail(`โหมด gyro ไม่รู้จัก (${g.mode})`);
    for (const k of ["axis_x", "axis_y"]) if (!GYRO_AXES.includes(g[k])) fail(`แกน gyro ไม่รู้จัก (${g[k]})`);
    for (const a of g.activation) if (!BUTTONS.includes(a.button)) fail(`ปุ่มเปิด gyro ไม่รู้จัก (${a.button})`);
    if (new Set(g.activation.map((a) => a.button)).size !== g.activation.length) fail("ปุ่มเปิด gyro ซ้ำกัน");
    if (!g.activation.length) fail("ไม่มีปุ่มเปิด gyro เลย แอป Flydigi ต้องมีอย่างน้อย 1 ปุ่ม");
  }
  // Every curve11 (sticks, triggers, gyro, vibration): at most 2 mid points, points left to right.
  for (const k of ["joystick_left", "joystick_right", "trigger_left", "trigger_right", "gyroscope", "vibration_trigger_left", "vibration_trigger_right", "vibration_motor_left", "vibration_motor_right"]) {
    const c = cfg[k]?.curve;
    if (!c) continue;
    // The decoder keeps 2 mid points at most, so read the count byte itself (TLV 6–9 start with 1 extra byte).
    const n = wrapped[4 + cfg.offsets[k] + (k.startsWith("vibration") ? 1 : 0) + 4];
    if (n > GYRO_MIDS_MAX) fail(`curve ของ ${k} มีจุดกลาง ${n} จุด (ได้ ${GYRO_MIDS_MAX})`);
    const xs = [c.start_x, ...c.mid_points.map((m) => m.x), c.end_x];
    if (xs.some((x, i) => i && x < xs[i - 1])) fail(`จุดใน curve ของ ${k} ไม่ได้เรียงจากซ้ายไปขวา`);
  }
}

// Rebuilds TLV 0x20 with the new names and splices it into the wrapped buffer (length updated,
// CRC16 left to the caller). Entries we don't touch keep their order and bytes.
function withNames(wrapped, cfg, names) {
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
  out[8] = 9; // version u32le at blob offset 4: v1.8 → v1.9
  out[0] = out.length & 0xff;
  out[1] = out.length >> 8;
  return out;
}

// ---- Writing and deleting macros ----
// A macro sits in its layer's section of the blob, so adding or removing one changes the blob's
// length: the layer's macro count and entries move, and so does everything after them. Ids stay
// where they are (deleting #3 does not renumber #4), as in the official app.
// Edit keys: "macro.<layer>.<id>.set" = { mode, loop_ms?, actions: [{ action, target, at_ms, raw? }] }
// or { bytes } (the entry without its id byte, as macroBody() returns it), which adds the macro or
// replaces the one with that id; and "macro.<layer>.<id>.delete" = true.
export const MACRO_MAX = 8; // per layer
export const MACRO_STEPS_MAX = 255; // actions: the count is a u8
const MACRO_MODES = ["press_once", "press_loop_immediate", "press_loop_wait", "press_hold"];

function macroOps(edits) {
  const ops = [];
  for (const [k, v] of Object.entries(edits)) {
    const m = k.match(MACRO_OP);
    if (m) ops.push({ kind: m[3], layer: Number(m[1]), id: Number(m[2]), value: v });
  }
  // Deletes first: a layer that is full can take a new macro in the same write.
  return ops.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "delete" ? -1 : 1));
}

function withMacroOps(wrapped, ops) {
  for (const op of ops) wrapped = op.kind === "delete" ? deleteMacro(wrapped, op.layer, op.id) : setMacro(wrapped, op);
  return wrapped;
}

// The bytes of macro `mi` of layer `li` without its id byte: what the macro does, wherever it sits.
export function macroBody(blob, cfg, li, mi) {
  const r = cfg.offsets.layers[li].macros[mi];
  return blob.slice(r.from + 1, r.to);
}

const withCrc = (out) => {
  const c = crc16(out.subarray(4));
  out[2] = c & 0xff;
  out[3] = c >> 8;
  return out;
};

// Replaces byte ranges of the blob { from, to, bytes } (not overlapping) and fixes length and CRC.
function splice(wrapped, repl) {
  const blob = wrapped.subarray(4);
  const parts = [];
  let at = 0;
  for (const r of [...repl].sort((a, b) => a.from - b.from)) {
    if (r.from < at) throw new Error("ช่วงไบต์ที่แก้ทับกัน");
    parts.push(blob.subarray(at, r.from), r.bytes);
    at = r.to;
  }
  parts.push(blob.subarray(at));
  const size = parts.reduce((n, p) => n + p.length, 0);
  if (4 + size > 0xffff) throw new Error("โปรไฟล์ยาวเกินที่จอยเก็บได้");
  const out = new Uint8Array(4 + size);
  let o = 4;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  out[0] = out.length & 0xff;
  out[1] = out.length >> 8;
  return withCrc(out);
}

const u16 = (v) => Uint8Array.of(v & 0xff, v >> 8);
const layerAt = (cfg, layer) => cfg.layers.findIndex((l) => l.layer_id === layer);

// Bytes of one macro entry: id, mode, loop_ms u16, n, pad, n × (press/release, target[4], t_ms u16).
// An action read from the controller carries its target bytes as `raw`, so it is written back as it
// was; a new action can only press a gamepad button for now.
export function encodeMacro(id, mode, actions, loopMs = 0) {
  const mi = MACRO_MODES.indexOf(mode);
  if (mi < 0) throw new Error(`วิธีเล่นไม่รู้จัก: ${mode}`);
  if (!Array.isArray(actions) || !actions.length) throw new Error("macro ต้องมีอย่างน้อย 1 ขั้น");
  if (actions.length > MACRO_STEPS_MAX) throw new Error(`macro ยาวเกิน ${MACRO_STEPS_MAX} action`);
  if (!Number.isInteger(loopMs) || loopMs < 0 || loopMs > 0xffff) throw new Error(`เวลารอระหว่างรอบต้องอยู่ระหว่าง 0–65535 ms`);
  const out = [id, mi, loopMs & 0xff, loopMs >> 8, actions.length, 0];
  let last = 0;
  for (const a of actions) {
    if (a.action !== "press" && a.action !== "release") throw new Error(`action ไม่รู้จัก: ${a.action}`);
    let t;
    if (a.raw?.length === 4) t = [...a.raw];
    else {
      if (a.target?.type !== "btn_gamepad") throw new Error("ขั้นที่เพิ่มใหม่ใช้ได้เฉพาะปุ่มจอยตอนนี้");
      const b = BUTTONS.indexOf(a.target.button);
      if (b < 0) throw new Error(`ไม่รู้จักปุ่ม ${a.target.button}`);
      t = [0, b, 0, 0];
    }
    if (!Number.isInteger(a.at_ms) || a.at_ms < last || a.at_ms > 0xffff) throw new Error("เวลาของแต่ละขั้นต้องเรียงจากน้อยไปมาก และไม่เกิน 65535 ms");
    last = a.at_ms;
    out.push(a.action === "press" ? 0 : 1, ...t, a.at_ms & 0xff, a.at_ms >> 8);
  }
  return Uint8Array.from(out);
}

// A whole entry from a { bytes } value: the id, then the body exactly as given.
function entryFromBytes(id, body) {
  const b = Uint8Array.from(body ?? []);
  if (b.length < 5 || b.length !== 5 + b[3] * 7 || !b[3]) throw new Error("ข้อมูล macro ไม่ครบหรือไม่มีขั้น");
  return Uint8Array.of(id, ...b);
}

// Adds the macro, or replaces the one with the same id in place (buttons that play it keep doing so).
function setMacro(wrapped, { layer, id, value }) {
  const { cfg } = unwrapMapping(wrapped);
  const li = layerAt(cfg, layer);
  if (li < 0) throw new Error(`โปรไฟล์นี้ไม่มี layer ${layer}`);
  const l = cfg.layers[li];
  if (!Number.isInteger(id) || id < 0 || id >= MACRO_MAX) throw new Error(`id ของ macro ต้องอยู่ระหว่าง 0–${MACRO_MAX - 1}`);
  const bytes = value?.bytes ? entryFromBytes(id, value.bytes) : encodeMacro(id, value?.mode ?? "press_once", value?.actions, value?.loop_ms ?? 0);
  const at = cfg.offsets.layers[li];
  const mi = l.macros.findIndex((m) => m.macro_id === id);
  if (mi >= 0) return splice(wrapped, [{ from: at.macros[mi].from, to: at.macros[mi].to, bytes }]);
  if (l.macros.length >= MACRO_MAX) throw new Error(`layer ${layer} มี macro ครบ ${MACRO_MAX} ตัวแล้ว`);
  // Entries stay in id order.
  const pos = at.macros.find((m) => m.id > id)?.from ?? at.macrosTo;
  return splice(wrapped, [
    { from: pos, to: pos, bytes },
    { from: at.macroCountAt, to: at.macroCountAt + 2, bytes: u16(l.macros.length + 1) },
  ]);
}

// Removes the macro, its name, and the button presses that played it: a button left with nothing
// else to do goes back to its default.
function deleteMacro(wrapped, layer, id) {
  let { cfg } = unwrapMapping(wrapped);
  const li = layerAt(cfg, layer);
  const mi = li < 0 ? -1 : cfg.layers[li].macros.findIndex((m) => m.macro_id === id);
  if (mi < 0) throw new Error(`โปรไฟล์นี้ไม่มี macro #${id + 1} ใน layer ${layer}`);
  // The name goes first: withNames needs the macro to still be there.
  if (cfg.version === "1.9" && cfg.macro_names?.some((n) => n.layerId === layer && n.macroId === id)) {
    wrapped = withCrc(withNames(wrapped, cfg, { [`macro.${layer}.${id}.name`]: "" }));
    cfg = unwrapMapping(wrapped).cfg;
  }
  const at = cfg.offsets.layers[li];
  const blob = wrapped.subarray(4);
  return splice(wrapped, [
    { from: at.macros[mi].from, to: at.macros[mi].to, bytes: new Uint8Array(0) },
    { from: at.macroCountAt, to: at.macroCountAt + 2, bytes: u16(cfg.layers[li].macros.length - 1) },
    // target type 30 is a macro, its first byte the macro id
    ...dropActivators(blob, at, (a) => a[1] === 30 && a[2] === id),
  ]);
}

// Activator bytes: type (0 simple, 1 timing_single, 2 timing_long, 3 timing_double, …), target[4].
const ACT_SIZE = 5;
const activatorsOf = (blob, e) => Array.from({ length: e.n }, (_, j) => blob.slice(e.from + 4 + j * ACT_SIZE, e.from + 4 + (j + 1) * ACT_SIZE));
const entryBytes = (src, acts) => Uint8Array.from([src, acts.length, 0, 0, ...acts.flatMap((a) => [...a])]);
// A normal press waits to tell itself apart from a long or double press only when the button has one.
function settleNormalPress(acts) {
  const timed = acts.some((a) => a[0] === 2 || a[0] === 3);
  for (const a of acts) if (a[0] === 0 || a[0] === 1) a[0] = timed ? 1 : 0;
}
// Only a normal press of the button itself: the same as having no entry.
const isDefault = (src, acts) => acts.length === 1 && [...acts[0]].join() === [0, 0, src, 0, 0].join();

// Splice ranges that drop the activators `drop(bytes)` matches from one layer's button maps.
// A button left with nothing else to do goes back to its default.
function dropActivators(blob, at, drop) {
  const repl = [];
  let maps = at.maps.length;
  for (const e of at.maps) {
    const acts = activatorsOf(blob, e);
    const kept = acts.filter((a) => !drop(a));
    if (kept.length === acts.length) continue;
    settleNormalPress(kept);
    if (kept.length && !isDefault(e.src, kept)) {
      repl.push({ from: e.from, to: e.to, bytes: entryBytes(e.src, kept) });
    } else {
      repl.push({ from: e.from, to: e.to, bytes: new Uint8Array(0) });
      maps--;
    }
  }
  if (maps !== at.maps.length) repl.push({ from: at.mapCountAt, to: at.mapCountAt + 2, bytes: u16(maps) });
  return repl;
}

// ---- Adding and deleting layers ----
// A profile holds 1–4 layers. Layer 0 is the base and always there; the official app gives new
// layers the first free id of 1–3 and appends them after the last one, which is what we do too.
export const LAYER_MAX = 4;

function layerOps(edits) {
  const ops = [];
  for (const k of Object.keys(edits)) {
    const m = k.match(LAYER_OP);
    if (m) ops.push({ kind: m[2], layer: Number(m[1]) });
  }
  // Deletes first: a profile with 4 layers can swap one in the same write.
  return ops.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "delete" ? -1 : 1));
}

function withLayerOps(wrapped, ops) {
  for (const op of ops) wrapped = op.kind === "delete" ? deleteLayer(wrapped, op.layer) : addLayer(wrapped, op.layer);
  return wrapped;
}

function addLayer(wrapped, id) {
  const { cfg } = unwrapMapping(wrapped);
  if (!Number.isInteger(id) || id < 1 || id >= LAYER_MAX) throw new Error(`id ของ layer ต้องอยู่ระหว่าง 1–${LAYER_MAX - 1}`);
  if (layerAt(cfg, id) >= 0) throw new Error(`โปรไฟล์นี้มี layer ${id} อยู่แล้ว`);
  if (cfg.layers.length >= LAYER_MAX) throw new Error(`โปรไฟล์นี้มี layer ครบ ${LAYER_MAX} อันแล้ว`);
  const end = cfg.offsets.layersEnd;
  return splice(wrapped, [
    { from: cfg.offsets.layerCountAt, to: cfg.offsets.layerCountAt + 1, bytes: Uint8Array.of(cfg.layers.length + 1) },
    // id, pad, map count u16, macro count u16, pad u16, then the four zone blocks marked absent.
    { from: end, to: end, bytes: Uint8Array.of(id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) },
  ]);
}

// Removes the layer with its button maps, macros and macro names, and the presses in other layers
// that switched to it: a button left with nothing else to do goes back to its default.
function deleteLayer(wrapped, id) {
  if (id === 0) throw new Error("ลบ Base layer ไม่ได้");
  let { cfg } = unwrapMapping(wrapped);
  if (layerAt(cfg, id) < 0) throw new Error(`โปรไฟล์นี้ไม่มี layer ${id}`);
  // Names first: withNames needs the macros to still be there.
  const named = cfg.version === "1.9" ? (cfg.macro_names ?? []).filter((n) => n.layerId === id) : [];
  if (named.length) {
    wrapped = withCrc(withNames(wrapped, cfg, Object.fromEntries(named.map((n) => [`macro.${id}.${n.macroId}.name`, ""]))));
    cfg = unwrapMapping(wrapped).cfg;
  }
  const li = layerAt(cfg, id);
  const blob = wrapped.subarray(4);
  const at = cfg.offsets.layers[li];
  const repl = [
    { from: cfg.offsets.layerCountAt, to: cfg.offsets.layerCountAt + 1, bytes: Uint8Array.of(cfg.layers.length - 1) },
    { from: at.from, to: at.to, bytes: new Uint8Array(0) },
  ];
  // target types 20 (hold) and 21 (toggle) switch layers, their first byte the layer id
  cfg.offsets.layers.forEach((o, i) => {
    if (i !== li) repl.push(...dropActivators(blob, o, (a) => (a[1] === 20 || a[1] === 21) && a[2] === id));
  });
  return splice(wrapped, repl);
}

// The firmware finds the layer of a hold/toggle by its position in the blob, not by its id: on
// hardware a hold to "layer 2" in a profile stored as 0, 2, 3, 1 reached layer 3. So every layer
// must sit at the position of its id, which means ids 0, 1, 2, … with no gap (a profile with
// layers 0, 2, 3 sends "layer 2" to layer 3 too). This puts the sections in id order and numbers
// them again from 0, moving the layer of every hold/toggle and of every macro name along.
// Profiles from the official app can hold layers out of order (it appends a re-added layer).
// Same length; CRC left to the caller.
export const layerRenumber = (ids) => new Map([...ids].sort((a, b) => a - b).map((id, i) => [id, i]));

function normalizeLayers(wrapped) {
  // Not unwrapMapping: a name edit just before leaves the CRC to the caller.
  const cfg = decodeMapping(wrapped.subarray(4));
  const ats = cfg.offsets.layers;
  const order = cfg.layers.map((l, i) => i).sort((a, b) => cfg.layers[a].layer_id - cfg.layers[b].layer_id);
  const to = layerRenumber(cfg.layers.map((l) => l.layer_id));
  if (order.every((v, i) => v === i) && cfg.layers.every((l) => to.get(l.layer_id) === l.layer_id)) return wrapped;
  const blob = wrapped.slice(4);
  cfg.layers.forEach((l, li) => {
    const at = ats[li];
    blob[at.from] = to.get(l.layer_id);
    for (const e of at.maps)
      for (let j = 0; j < e.n; j++) {
        const p = e.from + 4 + j * ACT_SIZE;
        if ((blob[p + 1] === 20 || blob[p + 1] === 21) && to.has(blob[p + 2])) blob[p + 2] = to.get(blob[p + 2]);
      }
  });
  const meta = cfg.offsets.meta;
  if (meta != null) {
    const end = meta + blob[meta - 1];
    let o = meta + 1 + blob[meta];
    const n = blob[o++] ?? 0;
    for (let i = 0; i < n && o + 3 <= end; i++) {
      if (to.has(blob[o])) blob[o] = to.get(blob[o]);
      o += 3 + blob[o + 2];
    }
  }
  const from = ats[0].from;
  const parts = [blob.subarray(0, from), ...order.map((i) => blob.subarray(ats[i].from, ats[i].to)), blob.subarray(cfg.offsets.layersEnd)];
  const out = new Uint8Array(wrapped.length);
  out.set(wrapped.subarray(0, 4));
  let o = 4;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---- Button maps ----
// Each press type is one activator of the button's map entry: a normal press is "simple", or
// "timing_single" when the button also has a long or double press; long is timing_long, double is
// timing_double. Activators of other types (pulse, toggle) that the official app can set are kept.
// A button whose only activator is a normal press of itself is the default and has no entry.
const PRESS_ACTS = { simple: [0, 1], long: [2], double: [3] };

function mapEdits(edits, deadLayers) {
  const byLayer = new Map();
  for (const [k, v] of Object.entries(edits)) {
    const m = k.match(MAP_KEY);
    if (!m) continue;
    const layer = Number(m[1]);
    if (deadLayers.has(layer)) continue;
    if (!byLayer.has(layer)) byLayer.set(layer, new Map());
    const srcs = byLayer.get(layer);
    if (!srcs.has(m[2])) srcs.set(m[2], {});
    srcs.get(m[2])[m[3]] = v;
  }
  return byLayer;
}

function withMapEdits(wrapped, byLayer) {
  for (const [layer, srcs] of byLayer) wrapped = editLayerMaps(wrapped, layer, srcs);
  return wrapped;
}

function editLayerMaps(wrapped, layer, srcs) {
  const { cfg } = unwrapMapping(wrapped);
  const li = layerAt(cfg, layer);
  if (li < 0) throw new Error(`โปรไฟล์นี้ไม่มี layer ${layer}`);
  const at = cfg.offsets.layers[li];
  const blob = wrapped.subarray(4);
  const repl = [];
  const added = [];
  let count = at.maps.length;
  for (const [src, presses] of srcs) {
    const id = BUTTONS.indexOf(src);
    if (id < 0) throw new Error(`ไม่รู้จักปุ่ม ${src}`);
    const e = at.maps.find((x) => x.src === id);
    let acts = e ? activatorsOf(blob, e) : [Uint8Array.of(0, 0, id, 0, 0)];
    for (const [press, v] of Object.entries(presses)) {
      acts = acts.filter((a) => !PRESS_ACTS[press].includes(a[0]));
      if (v === undefined) continue;
      if (v?.type === "none") {
        if (press !== "simple") throw new Error(`ปุ่ม ${src}: ปิดปุ่มได้เฉพาะการกดปกติ`);
        continue;
      }
      if (press === "double" && v?.type === "layer_hold") throw new Error(`ปุ่ม ${src}: ดับเบิลคลิกใช้กดค้างเข้า layer ไม่ได้ ใช้แบบสลับแทน`);
      acts.push(Uint8Array.of(PRESS_ACTS[press][0], ...encodeTarget(v, cfg, li)));
    }
    settleNormalPress(acts);
    acts.sort((a, b) => a[0] - b[0]);
    const dflt = isDefault(id, acts);
    const bytes = dflt ? new Uint8Array(0) : entryBytes(id, acts);
    if (e) {
      repl.push({ from: e.from, to: e.to, bytes });
      if (dflt) count--;
    } else if (!dflt) {
      added.push(...bytes);
      count++;
    }
  }
  // New entries go after the last one, just before the layer's macros.
  if (added.length) repl.push({ from: at.macrosFrom, to: at.macrosFrom, bytes: Uint8Array.from(added) });
  if (count !== at.maps.length) repl.push({ from: at.mapCountAt, to: at.mapCountAt + 2, bytes: u16(count) });
  return repl.length ? splice(wrapped, repl) : wrapped;
}

// target[4] for one button press, in layer cfg.layers[li]. See the target types in PROTOCOL.md.
function encodeTarget(t, cfg, li) {
  const btn = (b) => {
    const i = BUTTONS.indexOf(b);
    if (i < 0) throw new Error(`ไม่รู้จักปุ่ม ${b}`);
    return i;
  };
  const layer = cfg.layers[li];
  switch (t?.type) {
    case "btn_gamepad":
      return [0, btn(t.button), 0, 0];
    case "btn_keyboard":
      return [1, t.key, t.modifier ?? 0, 0];
    case "btn_mouse":
      if (!Number.isInteger(t.mouse) || t.mouse < 0 || t.mouse > 4) throw new Error(`ปุ่มเมาส์ไม่รู้จัก: ${t.mouse}`);
      return [2, t.mouse, 0, 0];
    case "turbo_gamepad": {
      const iv = Math.round(t.interval_ms / 10); // stored in 10 ms steps
      if (!(iv >= 1 && iv <= 0xffff)) throw new Error(`Turbo ต้องรอบละอย่างน้อย 10 ms (ได้ ${t.interval_ms})`);
      return [10, btn(t.button), iv & 0xff, iv >> 8];
    }
    case "layer_hold":
    case "layer_toggle":
      if (layerAt(cfg, t.layer) < 0) throw new Error(`โปรไฟล์นี้ไม่มี layer ${t.layer} ให้สลับไป`);
      return [t.type === "layer_hold" ? 20 : 21, t.layer, 0, 0];
    case "macro":
      // A macro target plays the macro of the button's own layer.
      if ((t.layer ?? layer.layer_id) !== layer.layer_id) throw new Error("ปุ่มเล่นได้เฉพาะ macro ใน layer เดียวกัน");
      if (!layer.macros.some((m) => m.macro_id === t.macro)) throw new Error(`layer ${layer.layer_id} ไม่มี macro #${t.macro + 1}`);
      return [30, t.macro, 0, 0];
    default:
      throw new Error(`ยังเขียนปุ่มแบบ ${t?.type} ลงจอยไม่ได้`);
  }
}

// Kept for callers that only touch deadzones.
export function withStickDeadzones(wrapped, values) {
  const edits = {};
  for (const [side, v] of Object.entries(values)) if (v != null) edits[`stick.${side}.deadzone`] = v;
  return applyEdits(wrapped, edits);
}

export const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
