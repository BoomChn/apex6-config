// Draft model: every edit is a key → value pair layered over what was read from the controller.
// Keys editKey() maps to a writable field (mapping-edit.js) can be written; everything else stays a draft in this page
// until the protocol for it is known, and the UI says so.

import { isWritable } from "./mapping-edit.js";
import { fit } from "./names.js";
import { targetLabel } from "./profile-view.js";

export const pct = (v) => `${Math.round((v / 255) * 100)}%`;
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const BTN_NAME = { Back: "View", Start: "Menu", "LT (active)": "LT", "RT (active)": "RT", "D-pad ↑": "Up", "D-pad ↓": "Down", "D-pad ←": "Left", "D-pad →": "Right" };
export const btnName = (b) => BTN_NAME[b] ?? b;

export const PRESS = [
  { id: "simple", label: "กดปกติ" },
  { id: "long", label: "กดค้าง" },
  { id: "double", label: "ดับเบิลคลิก" },
];
const ACT_OF = { simple: ["simple", "timing_single"], long: ["timing_long"], double: ["timing_double"] };

export const GYRO_MODE = { disable: "ปิด", left_joystick: "Stick ซ้าย", right_joystick: "Stick ขวา", mouse: "เมาส์" };
export const LED_MODE = { off: "ปิด", solid: "สีเดียว", breath: "หายใจ", cycle: "ไล่สี" };
export const LAYER_NAME = (id) => (id === 0 ? "Base layer" : id === 1 ? "Shift layer" : `Layer ${id}`);

export function labelTarget(t, cfg) {
  if (t === undefined) return "ยังไม่กำหนด";
  if (t === null || t?.type === "none") return "ปิดปุ่ม";
  if (t.type === "btn_gamepad") return `${btnName(t.button)}`;
  if (t.type === "turbo_gamepad") return `Turbo ${btnName(t.button)} · ${t.interval_ms} ms`;
  if (t.type === "macro") return `Macro · ${macroName(cfg, t.layer ?? 0, t.macro)}`;
  return targetLabel(t);
}

export function macroName(cfg, layerId, macroId) {
  return cfg?.shown?.macros[`${layerId}.${macroId}`]?.name || deviceMacroName(cfg, layerId, macroId) || `Macro ${macroId + 1}`;
}
const deviceMacroName = (cfg, layerId, macroId) => cfg?.macro_names?.find((n) => n.layerId === layerId && n.macroId === macroId)?.name ?? "";

// App-side id of a name draft key, for names.js: "slot.<i>" or "macro.<slot>.<layer>.<id>".
export function nameId(key, S) {
  const p = key.split(".");
  if (p[0] === "slot") return `slot.${p[1]}`;
  return `macro.${S.current?.slot}.${p[1]}.${p[2]}`;
}

// Picks the names to show for the loaded slot (see names.js) and hangs them on cfg as `shown`:
// { profile: { name, other? }, macros: { "<layer>.<id>": { name, other? } } }.
export function resolveNames(S) {
  const cfg = S.current?.cfg;
  if (!cfg || !S.names) return;
  const slot = S.current.slot;
  const macros = {};
  for (const l of cfg.layers)
    for (const m of l.macros)
      macros[`${l.layer_id}.${m.macro_id}`] = S.names.resolve(S.uuid, `macro.${slot}.${l.layer_id}.${m.macro_id}`, deviceMacroName(cfg, l.layer_id, m.macro_id));
  const shown = { profile: S.names.resolve(S.uuid, `slot.${slot}`, cfg.name ?? ""), macros };
  Object.defineProperty(cfg, "shown", { value: shown, configurable: true });
}

// Activator target of a button for one press type, as read from the controller.
// Returns undefined when that press type is not set, the target otherwise.
export function baseTarget(cfg, layerId, source, press) {
  const layer = cfg?.layers.find((l) => l.layer_id === layerId);
  const m = layer?.mappings.find((x) => x.source === source);
  if (!m) return press === "simple" ? { type: "btn_gamepad", button: source } : undefined;
  if (m.activators.length === 0) return press === "simple" ? { type: "none" } : undefined;
  const a = m.activators.find((x) => ACT_OF[press].includes(x.type));
  return a ? a.target : undefined;
}

export function isIdentity(t, source) {
  return t?.type === "btn_gamepad" && t.button === source;
}

// ---- Field meta: label, tab, how to read the controller value, how to print a value ----

const SIDE = { left: "ซ้าย", right: "ขวา" };
const stick = (cfg, side) => cfg?.[`joystick_${side}`];
const trig = (cfg, side) => cfg?.[`trigger_${side}`];
const motor = (cfg, side) => cfg?.[`vibration_motor_${side}`];
const onOff = (v) => (v ? "เปิด" : "ปิด");
const ms = (v) => `${v} ms`;

export function meta(key, S) {
  const cfg = S.current?.cfg;
  const p = key.split(".");
  const [a, b, c] = p;
  if (a === "stick") {
    const s = stick(cfg, b);
    const what = { deadzone: "Deadzone", max: "ระยะสูงสุด", invertX: "กลับแกน X", invertY: "กลับแกน Y", round: "ขอบวงกลม", preset: "รูปแบบ curve" }[c];
    const base = {
      deadzone: s?.curve.start_x, max: s?.curve.end_x, invertX: s?.invert_x, invertY: s?.invert_y, round: s?.is_round,
      preset: s && (s.curve.mid_points.length ? "custom" : "linear"),
    }[c];
    const fmt = c === "deadzone" || c === "max" ? pct : c === "preset" ? (v) => PRESET[v] : onOff;
    return { tab: "sticks", group: "slot", label: `Stick ${SIDE[b]} · ${what}`, base, fmt };
  }
  if (a === "trigger") {
    const t = trig(cfg, b);
    const what = { start: "จุดเริ่มทำงาน", end: "จุดกดสุด", preset: "รูปแบบ" }[c];
    const base = { start: t?.curve.start_x, end: t?.curve.end_x, preset: t && (t.curve.mid_points.length ? "custom" : "linear") }[c];
    return { tab: "triggers", group: "slot", label: `ไก${SIDE[b]} · ${what}`, base, fmt: c === "preset" ? (v) => TPRESET[v] : pct };
  }
  if (a === "gyro") {
    const g = cfg?.gyroscope;
    const map = {
      mode: ["ทำหน้าที่เป็น", g?.mode, (v) => GYRO_MODE[v] ?? v],
      invertX: ["กลับซ้าย–ขวา", g?.invert_x, onOff],
      invertY: ["กลับบน–ล่าง", g?.invert_y, onOff],
      sens: ["ความไว", undefined, (v) => `${v}%`],
      preset: ["รูปแบบ curve", g && (g.curve.mid_points.length ? "custom" : "linear"), (v) => GPRESET[v]],
      axisX: ["แกนซ้าย–ขวา", g?.axis_x, (v) => AXIS[v] ?? v],
      axisY: ["แกนบน–ล่าง", g?.axis_y, (v) => AXIS[v] ?? v],
    }[b];
    return { tab: "gyro", group: "slot", label: `Gyro · ${map[0]}`, base: map[1], fmt: map[2] };
  }
  if (a === "motor") {
    const m = motor(cfg, b);
    return c === "enabled"
      ? { tab: "vibration", group: "slot", label: `มอเตอร์${SIDE[b]} · เปิด`, base: m?.enabled, fmt: onOff }
      : { tab: "vibration", group: "slot", label: `มอเตอร์${SIDE[b]} · แรงสุด`, base: m?.curve.end_y, fmt: pct };
  }
  if (a === "vibtrig") {
    const t = cfg?.[`vibration_trigger_${b}`];
    return c === "enabled"
      ? { tab: "vibration", group: "slot", label: `ไก${SIDE[b]} สั่น · เปิด`, base: t ? true : undefined, fmt: onOff }
      : { tab: "vibration", group: "slot", label: `ไก${SIDE[b]} สั่น · แรงสุด`, base: t?.curve.end_y, fmt: pct };
  }
  if (a === "runtime") {
    return { tab: "buttons", group: "slot", label: b === "long" ? "เวลากดค้าง" : "เวลาดับเบิลคลิก", base: b === "long" ? cfg?.runtime.long_press_ms : cfg?.runtime.double_press_ms, fmt: ms };
  }
  if (a === "map") {
    const layer = Number(b), source = p.slice(2, -1).join("."), press = p.at(-1);
    const pr = PRESS.find((x) => x.id === press)?.label;
    return {
      tab: "buttons", group: "slot",
      label: `ปุ่ม ${btnName(source)}${layer ? ` (${LAYER_NAME(layer)})` : ""} · ${pr}`,
      base: baseTarget(cfg, layer, source, press), fmt: (v) => labelTarget(v, cfg),
    };
  }
  if (a === "macro") {
    const layer = Number(b), id = Number(c), f = p[3];
    const m = cfg?.layers.find((l) => l.layer_id === layer)?.macros.find((x) => x.macro_id === id);
    const base = { name: macroName(cfg, layer, id), mode: m?.trigger_mode }[f];
    return { tab: "macros", group: "slot", label: `${macroName(cfg, layer, id)} · ${f === "name" ? "ชื่อ" : "เล่นแบบ"}`, base, fmt: f === "mode" ? (v) => MACRO_MODE[v] ?? v : (v) => v };
  }
  if (a === "slot") {
    const i = Number(b);
    // The loaded slot shows what resolveNames() picked; other slots only have the app's name.
    const base = cfg && i === S.current.slot ? cfg.shown?.profile.name ?? cfg.name ?? "" : S.names?.entry(S.uuid, `slot.${i}`)?.full;
    return { tab: "profiles", group: "slot", label: `Slot ${i + 1} · ชื่อ`, base, fmt: (v) => v || "ไม่มีชื่อ", slot: i };
  }
  if (a === "led") {
    const what = { mode: "โหมด", color: "สี", bright: "ความสว่าง" }[b];
    return { tab: "lighting", group: "device", label: `ไฟ RGB · ${what}`, base: undefined, fmt: b === "mode" ? (v) => LED_MODE[v] : b === "bright" ? (v) => `${v}%` : (v) => v.toUpperCase() };
  }
  if (a === "screen") {
    return { tab: "lighting", group: "device", label: b === "bright" ? "จอบนตัวจอย · ความสว่าง" : "จอบนตัวจอย · ปิดอัตโนมัติ", base: undefined, fmt: b === "bright" ? (v) => `${v}%` : (v) => TIMEOUT[v] };
  }
  if (a === "input") {
    const what = { mode: "โหมด", keyboard: "ส่งคีย์บอร์ด", mouse: "ส่งเมาส์", third: "ให้แอปอื่นคุม" }[b];
    return { tab: "device", group: "device", label: `จอยส่งสัญญาณ · ${what}`, base: undefined, fmt: b === "mode" ? (v) => v : onOff };
  }
  return { tab: "profiles", group: "slot", label: key, base: undefined, fmt: String };
}

export const PRESET = { linear: "Linear", precise: "เล็งละเอียด", fast: "ไวทันที", custom: "กำหนดเอง" };
export const TPRESET = { linear: "Linear", hair: "Hair trigger", short: "ไกสั้น", custom: "กำหนดเอง" };
export const GPRESET = { linear: "Linear", steady: "นิ่งตอนขยับน้อย", custom: "แก้ curve เอง" };
export const AXIS = { none: "ไม่ใช้", imu_x: "ก้ม–เงย (X)", imu_y: "เอียงซ้าย–ขวา (Y)", imu_z: "หมุนแนวนอน (Z)" };
export const MACRO_MODE = { press_once: "กดครั้งเดียว เล่นจบ", press_loop_immediate: "วนทันทีขณะกด", press_loop_wait: "วน · รอระหว่างรอบ", press_hold: "ค้างตามที่กด" };
export const TIMEOUT = { 30: "30 วิ", 60: "1 นาที", 300: "5 นาที", 0: "ไม่ปิด" };

// Draft key → key applyEdits takes, or null while it can only stay a draft.
// Only the loaded slot's name can be written: the other slots' blobs aren't in RAM 0x05.
export function editKey(key, S) {
  const k = key === `slot.${S.current?.slot}.name` ? "profile.name" : key;
  if (!isWritable(k)) return null;
  // Names need TLV 0x20, which only v1.9 profiles have.
  return k.endsWith(".name") && S.current?.cfg.version !== "1.9" ? null : k;
}

export class Drafts {
  constructor(S) {
    this.S = S;
    this.map = new Map();
  }
  base(key) {
    return meta(key, this.S).base;
  }
  get(key) {
    return this.map.has(key) ? this.map.get(key) : this.base(key);
  }
  set(key, v) {
    if (same(v, this.base(key))) this.map.delete(key);
    else this.map.set(key, v);
  }
  clear(prefix = "") {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
  has(key) {
    return this.map.has(key);
  }
  pendingKeys(prefix = "") {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
  // Drop drafts that now equal the controller (after a re-read).
  prune() {
    for (const [k, v] of this.map) if (same(v, this.base(k))) this.map.delete(k);
  }
  count(tab) {
    return [...this.map.keys()].filter((k) => !tab || meta(k, this.S).tab === tab).length;
  }
  writable() {
    // Names go to the controller cut to what it holds; the app keeps the full name (names.js).
    return Object.fromEntries(
      [...this.map].map(([k, v]) => [editKey(k, this.S), k.endsWith(".name") ? fit(v) : v]).filter(([k]) => k),
    );
  }
  items() {
    return [...this.map].map(([key, v]) => {
      const ek = editKey(key, this.S);
      return { key, value: v, writable: !!ek, editKey: ek, ...meta(key, this.S) };
    });
  }
}

// Curve evaluation for previews: piecewise linear through start, mid points and end. x, y in 0–255.
export function evalCurve(c, x) {
  if (x <= c.start_x) return 0;
  const pts = [[c.start_x, c.start_y], ...c.mid_points.map((m) => [m.x, m.y]), [c.end_x, c.end_y]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return c.end_y;
}
