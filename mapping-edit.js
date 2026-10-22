// In-place edits of the RAM-wrapped mapping buffer (RAM 0x05).
// We patch single bytes instead of re-encoding, so everything we don't touch stays byte-identical.

import { decodeMapping, BUTTONS } from "./mapping.js";

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
const MACRO_OP = /^macro\.(\d+)\.(\d+)\.(new|delete)$/;
const MACRO_MODE_KEY = /^macro\.(\d+)\.(\d+)\.mode$/;
const isName = (key) => key === "profile.name" || MACRO_NAME.test(key);
// "map.<layer>.<button>.<simple|long|double>" = target, or undefined to clear that press.
const MAP_KEY = /^map\.(\d+)\.(.+)\.(simple|long|double)$/;
// "layer.<id>.new" / "layer.<id>.delete" = true.
const LAYER_OP = /^layer\.(\d+)\.(new|delete)$/;
const isStructural = (key) => MACRO_OP.test(key) || MACRO_MODE_KEY.test(key) || MAP_KEY.test(key) || LAYER_OP.test(key);

export const WRITABLE = new Set([...Object.keys(FIELDS), "profile.name"]);
export const isWritable = (key) => WRITABLE.has(key) || MACRO_NAME.test(key) || MACRO_OP.test(key) || MAP_KEY.test(key) || LAYER_OP.test(key);
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
]);

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
    } else if (f.u16) {
      out[at] = v & 0xff;
      out[at + 1] = v >> 8;
    } else {
      out[at] = f.enc ? f.enc(v) : v;
    }
  }
  // Byte patches first: the splice below moves everything after TLV 0x20.
  if (Object.keys(names).length) out = withNames(out, cfg, names);
  // Only when layers change: a write that does not touch them keeps their order byte-for-byte.
  if (lops.length || mapEdits(edits, deadLayers).size) out = sortLayers(out);
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

// ---- Creating and deleting macros ----
// A macro sits in its layer's section of the blob, so adding or removing one changes the blob's
// length: the layer's macro count and entries move, and so does everything after them. Ids stay
// where they are (deleting #3 does not renumber #4), as in the official app.
// Edit keys: "macro.<layer>.<id>.new" = { mode, actions: [{ action, target, at_ms }] } and
// "macro.<layer>.<id>.delete" = true. "macro.<layer>.<id>.mode" may accompany a .new key.
export const MACRO_MAX = 8; // per layer
export const MACRO_STEPS_MAX = 255; // actions: the count is a u8
const MACRO_MODES = ["press_once", "press_loop_immediate", "press_loop_wait", "press_hold"];

function macroOps(edits) {
  const ops = [];
  for (const [k, v] of Object.entries(edits)) {
    const m = k.match(MACRO_OP);
    if (m) ops.push({ kind: m[3], layer: Number(m[1]), id: Number(m[2]), value: v });
  }
  for (const [k, v] of Object.entries(edits)) {
    const m = k.match(MACRO_MODE_KEY);
    if (!m) continue;
    const op = ops.find((o) => o.kind === "new" && o.layer === Number(m[1]) && o.id === Number(m[2]));
    if (!op) throw new Error("ยังเปลี่ยนวิธีเล่นของ macro ที่มีอยู่แล้วลงจอยไม่ได้");
    op.mode = v;
  }
  // Deletes first: a layer that is full can take a new macro in the same write.
  return ops.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "delete" ? -1 : 1));
}

function withMacroOps(wrapped, ops) {
  for (const op of ops) wrapped = op.kind === "delete" ? deleteMacro(wrapped, op.layer, op.id) : addMacro(wrapped, op);
  return wrapped;
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
export function encodeMacro(id, mode, actions, loopMs = 0) {
  const mi = MACRO_MODES.indexOf(mode);
  if (mi < 0) throw new Error(`วิธีเล่นไม่รู้จัก: ${mode}`);
  if (!Array.isArray(actions) || !actions.length) throw new Error("macro ต้องมีอย่างน้อย 1 ขั้น");
  if (actions.length > MACRO_STEPS_MAX) throw new Error(`macro ยาวเกิน ${MACRO_STEPS_MAX} action`);
  const out = [id, mi, loopMs & 0xff, loopMs >> 8, actions.length, 0];
  let last = 0;
  for (const a of actions) {
    if (a.action !== "press" && a.action !== "release") throw new Error(`action ไม่รู้จัก: ${a.action}`);
    if (a.target?.type !== "btn_gamepad") throw new Error("macro ที่สร้างใหม่ใช้ได้เฉพาะปุ่มจอยตอนนี้");
    const b = BUTTONS.indexOf(a.target.button);
    if (b < 0) throw new Error(`ไม่รู้จักปุ่ม ${a.target.button}`);
    if (!Number.isInteger(a.at_ms) || a.at_ms < last || a.at_ms > 0xffff) throw new Error("เวลาของแต่ละขั้นต้องเรียงจากน้อยไปมาก และไม่เกิน 65535 ms");
    last = a.at_ms;
    out.push(a.action === "press" ? 0 : 1, 0, b, 0, 0, a.at_ms & 0xff, a.at_ms >> 8);
  }
  return Uint8Array.from(out);
}

function addMacro(wrapped, { layer, id, value, mode }) {
  const { cfg } = unwrapMapping(wrapped);
  const li = layerAt(cfg, layer);
  if (li < 0) throw new Error(`โปรไฟล์นี้ไม่มี layer ${layer}`);
  const l = cfg.layers[li];
  if (!Number.isInteger(id) || id < 0 || id >= MACRO_MAX) throw new Error(`id ของ macro ต้องอยู่ระหว่าง 0–${MACRO_MAX - 1}`);
  if (l.macros.some((m) => m.macro_id === id)) throw new Error(`layer ${layer} มี macro #${id + 1} อยู่แล้ว`);
  if (l.macros.length >= MACRO_MAX) throw new Error(`layer ${layer} มี macro ครบ ${MACRO_MAX} ตัวแล้ว`);
  const bytes = encodeMacro(id, mode ?? value?.mode ?? "press_once", value?.actions);
  const at = cfg.offsets.layers[li];
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

// Puts the layer sections in id order (0, 1, 2, 3). Profiles from the official app can hold them
// out of order (it appends a re-added layer), and on hardware a hold to "layer 2" in a profile
// stored as 0, 2, 3, 1 did not reach layer 2. Same bytes, only moved; CRC left to the caller.
function sortLayers(wrapped) {
  const { cfg } = unwrapMapping(wrapped);
  const ats = cfg.offsets.layers;
  const order = cfg.layers.map((l, i) => i).sort((a, b) => cfg.layers[a].layer_id - cfg.layers[b].layer_id);
  if (order.every((v, i) => v === i)) return wrapped;
  const blob = wrapped.subarray(4);
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
