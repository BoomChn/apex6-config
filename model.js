// Draft model: every edit is a key → value pair layered over what was read from the controller.
// Keys editKey() maps to a writable field (mapping-edit.js) can be written; everything else stays a draft in this page
// until the protocol for it is known, and the UI says so.

import { isWritable, LAYER_MAX, layerRenumber, gyroPct, vibLevel, gripCurve, gripEndY, feedbackLevel, feedbackCurve, motorMode, FEEDBACK_MODE, FEEDBACK_KEY } from "./mapping-edit.js";
import { planMacros } from "./macros.js";
import { fit } from "./names.js";
import { targetLabel } from "./profile-view.js";

export const pct = (v) => `${Math.round((v / 255) * 100)}%`;
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// M5/M6 are the shoulder buttons LM/RM (confirmed on hardware): Flydigi Space Station names ControllerKey_M5 "LM" and M6 "RM".
export const BTN_NAME = { M5: "LM", M6: "RM", Back: "View", Start: "Menu", "LT (active)": "LT", "RT (active)": "RT", "D-pad ↑": "Up", "D-pad ↓": "Down", "D-pad ←": "Left", "D-pad →": "Right" };
export const btnName = (b) => BTN_NAME[b] ?? b;

export const PRESS = [
  { id: "simple", label: "กดปกติ" },
  { id: "long", label: "กดค้าง" },
  { id: "double", label: "ดับเบิลคลิก" },
];
const ACT_OF = { simple: ["simple", "timing_single"], long: ["timing_long"], double: ["timing_double"] };

// The gyro curve in the official app's terms, e.g. "Deadzone 1% · ชดเชย 1% · สุดที่ 100% → 100% · จุดกลาง (29, 230)".
export const gyroCurveText = (c) =>
  c
    ? `Deadzone ${gyroPct(c.start_x)}% · ชดเชย ${gyroPct(c.start_y)}% · สุดที่ ${gyroPct(c.end_x)}% → ${gyroPct(c.end_y)}%${c.mid_points.length ? ` · จุดกลาง ${c.mid_points.map((m) => `(${m.x}, ${m.y})`).join(" ")}` : ""}`
    : "—";
// "กดค้าง LT, กดสลับ RB", or "ไม่ตั้ง · ทำงานตลอด" for an empty list.
export const gyroActText = (list) =>
  list?.length ? list.map((a) => `${a.activation === "toggle" ? "กดสลับ" : "กดค้าง"} ${btnName(a.button)}`).join(", ") : "ไม่ตั้ง · ทำงานตลอด";
export const GYRO_MODE = { disable: "ปิด", left_joystick: "Stick ซ้าย", right_joystick: "Stick ขวา", mouse: "เมาส์" };
export const LED_MODE = { off: "ปิด", solid: "สีเดียว", breath: "หายใจ", cycle: "ไล่สี" };
export const LAYER_NAME = (id) => (id === 0 ? "Base layer" : id === 1 ? "Shift layer" : `Layer ${id}`);

export function labelTarget(t, cfg) {
  if (t === undefined) return "ยังไม่กำหนด";
  if (t === null || t?.type === "none") return "ปิดปุ่ม";
  if (t.type === "btn_gamepad") return `${btnName(t.button)}`;
  if (t.type === "turbo_gamepad") return `Turbo ${btnName(t.button)} · ${t.interval_ms} ms`;
  if (t.type === "macro") return `Macro · ${t.uid ? cfg?.lib?.get(t.uid)?.name ?? "ไม่มีในคลังแล้ว" : macroName(cfg, t.layer ?? 0, t.macro)}`;
  if (t.type === "layer_hold") return `กดค้างเข้า ${LAYER_NAME(t.layer)}`;
  if (t.type === "layer_toggle") return `สลับไป ${LAYER_NAME(t.layer)}`;
  return targetLabel(t);
}

export const layerKey = (id, f) => `layer.${id}.${f}`;

// The layers of the loaded slot as the Buttons page shows them: what the controller holds (marked
// when drafted for deletion) plus what is drafted as new, in the order the controller will hold them.
export function layerList(S, D) {
  const out = S.current.cfg.layers.map((l) => ({ id: l.layer_id, isNew: false, deleted: !!D?.has(layerKey(l.layer_id, "delete")) }));
  for (const k of D?.pendingKeys("layer.") ?? []) {
    const [, id, f] = k.split(".");
    if (f === "new") out.push({ id: Number(id), isNew: true, deleted: false });
  }
  return out;
}

// First free layer id (1–3, as the official app picks), or null when the profile has LAYER_MAX.
// A layer drafted for deletion still counts until the delete is written.
export function nextLayerId(S, D) {
  const ids = new Set(layerList(S, D).map((l) => l.id));
  if (ids.size >= LAYER_MAX) return null;
  for (let i = 1; i < LAYER_MAX; i++) if (!ids.has(i)) return i;
  return null;
}

// Buttons that switch layers, drafts included: { layer, source, press, type, to }. `match` filters.
export function layerSwitches(S, D, match = () => true) {
  const cfg = S.current.cfg;
  const pairs = new Map();
  for (const l of cfg.layers) for (const m of l.mappings) pairs.set(`${l.layer_id}|${m.source}`, [l.layer_id, m.source]);
  for (const k of D.pendingKeys("map.")) {
    const p = k.split(".");
    pairs.set(`${p[1]}|${p.slice(2, -1).join(".")}`, [Number(p[1]), p.slice(2, -1).join(".")]);
  }
  const out = [];
  for (const [layer, source] of pairs.values())
    for (const p of PRESS) {
      const t = D.get(`map.${layer}.${source}.${p.id}`);
      if (t?.type !== "layer_hold" && t?.type !== "layer_toggle") continue;
      const s = { layer, source, press: p.id, type: t.type, to: t.layer };
      if (match(s)) out.push(s);
    }
  return out;
}

// Name of a copy on the controller that is not linked to the library (see macros.js).
export function macroName(cfg, layerId, macroId) {
  return cfg?.macro_names?.find((n) => n.layerId === layerId && n.macroId === macroId)?.name || `Macro ${macroId + 1}`;
}
export const macroSteps = (actions) => actions.filter((a) => a.action === "press").length;

// App-side id of a name draft key, for names.js: "slot.<i>".
export function nameId(key) {
  return `slot.${key.split(".")[1]}`;
}

// Picks the profile name to show for the loaded slot (see names.js) and hangs it on cfg as `shown`.
export function resolveNames(S) {
  const cfg = S.current?.cfg;
  if (!cfg || !S.names) return;
  Object.defineProperty(cfg, "shown", { value: { profile: S.names.resolve(S.uuid, `slot.${S.current.slot}`, cfg.name ?? "") }, configurable: true });
  // Remembered for when another slot is in use (names.js SlotSeen).
  const w = S.current.wrapped;
  S.seen?.put(S.uuid, S.current.slot, w[2] | (w[3] << 8), cfg.shown.profile.name ?? "");
}

// Links the macros of the loaded slot to the library (macros.js) and hangs the links and the
// library on cfg, so a press that plays a macro reads as { type: "macro", uid }.
export function resolveMacros(S) {
  const cfg = S.current?.cfg;
  if (!cfg || !S.lib) return;
  const slot = S.current.slot;
  // Names the app kept for macros before the library existed.
  const full = (l, id, dev) => S.names?.resolve(S.uuid, `macro.${slot}.${l}.${id}`, dev).name ?? "";
  const links = S.lib.adopt(S.uuid, slot, cfg, S.current.wrapped.subarray(4), full);
  Object.defineProperty(cfg, "links", { value: links, configurable: true });
  Object.defineProperty(cfg, "lib", { value: S.lib, configurable: true });
}

// Buttons of a layer that may play something: the ones with an entry on the controller and the
// ones with a draft.
function layerSources(S, D, L) {
  const out = new Set(S.current.cfg.layers.find((l) => l.layer_id === L)?.mappings.map((m) => m.source));
  for (const k of D.pendingKeys(`map.${L}.`)) out.add(k.split(".").slice(2, -1).join("."));
  return [...out];
}

// What the next write does to the macros of the loaded slot (planMacros in macros.js).
export function macroPlan(S, D) {
  const cfg = S.current.cfg;
  const slot = S.current.slot;
  const layers = layerList(S, D).filter((l) => !l.deleted).map((l) => l.id);
  const plan = planMacros({
    cfg, lib: S.lib, links: cfg.links ?? {}, layers,
    sources: (L) => layerSources(S, D, L),
    target: (L, src, press) => D.get(`map.${L}.${src}.${press}`),
    profileName: D.has(`slot.${slot}.name`) ? fit(D.get(`slot.${slot}.name`)) : cfg.name ?? "",
    layerName: LAYER_NAME,
  });
  // The write numbers the layers again from 0 (normalizeLayers): the links follow.
  const to = layerRenumber(layers);
  plan.moves = layerMoves(S, D);
  plan.links = Object.fromEntries(Object.entries(plan.links).map(([k, v]) => [`${to.get(Number(k.split(".")[0]))}.${k.split(".")[1]}`, v]));
  return plan;
}

// Layers whose id the next write changes, so each one sits at the position of its id (see
// normalizeLayers in mapping-edit.js): [{ from, to }].
export function layerMoves(S, D) {
  const to = layerRenumber(layerList(S, D).filter((l) => !l.deleted).map((l) => l.id));
  return [...to].filter(([a, b]) => a !== b).map(([from, t]) => ({ from, to: t }));
}

// The edits for applyEdits: the drafts that can be written, with presses that play a library macro
// replaced by the plan's (which knows the id of the copy in each layer). `drafts` are the draft
// keys the write takes care of.
export function writeEdits(D, plan) {
  const edits = D.writable();
  const drafts = D.items().filter((i) => i.writable && !FEEDBACK_KEY.test(i.key)).map((i) => i.key);
  for (const [k, v] of Object.entries(edits)) if (v?.type === "macro") delete edits[k];
  return { edits: { ...edits, ...plan.edits }, drafts };
}

// Presses in the loaded slot that will play this library macro: [{ layer, source, press }].
export function macroUses(S, D, uid) {
  const out = [];
  for (const l of layerList(S, D).filter((x) => !x.deleted))
    for (const source of layerSources(S, D, l.id))
      for (const p of PRESS) if (D.get(`map.${l.id}.${source}.${p.id}`)?.uid === uid) out.push({ layer: l.id, source, press: p.id });
  return out;
}

// Activator target of a button for one press type, as read from the controller.
// Returns undefined when that press type is not set, the target otherwise.
export function baseTarget(cfg, layerId, source, press) {
  const layer = cfg?.layers.find((l) => l.layer_id === layerId);
  const m = layer?.mappings.find((x) => x.source === source);
  if (!m) return press === "simple" ? { type: "btn_gamepad", button: source } : undefined;
  if (m.activators.length === 0) return press === "simple" ? { type: "none" } : undefined;
  const a = m.activators.find((x) => ACT_OF[press].includes(x.type));
  if (a?.target.type === "macro") {
    const uid = cfg.links?.[`${layerId}.${a.target.macro}`]?.uid;
    if (uid) return { type: "macro", uid };
  }
  return a ? a.target : undefined;
}

export function isIdentity(t, source) {
  return t?.type === "btn_gamepad" && t.button === source;
}

// ---- Field meta: label, tab, how to read the controller value, how to print a value ----

const SIDE = { left: "ซ้าย", right: "ขวา" };
const stick = (cfg, side) => cfg?.[`joystick_${side}`];
const trig = (cfg, side) => cfg?.[`trigger_${side}`];
// Grips with LRA motors (device info flag "haptic") get stronger low levels in the official app.
export const lraGrip = (S) => !!S.info?.features?.haptic;
// Grip vibration is both motors at once; the official app reads the left one unless only the right is on.
export function gripPart(cfg) {
  const l = cfg?.vibration_motor_left, r = cfg?.vibration_motor_right;
  if (!l || !r) return null;
  return { enabled: l.enabled || r.enabled, curve: (l.enabled || !r.enabled ? l : r).curve };
}
export const levelText = (v, pct) => `ระดับ ${v}${pct != null ? ` · ${pct}%` : ""}`;
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
      curve: ["Response curve", g?.curve, gyroCurveText],
      activation: ["ปุ่มเปิด gyro", g?.activation, gyroActText],
      axisX: ["เล็งซ้าย–ขวาด้วย", g?.axis_x, (v) => AXIS[v] ?? v],
      axisY: ["เล็งบน–ล่างด้วย", g?.axis_y, (v) => AXIS[v] ?? v],
      mouseRadius: ["Deadzone เมาส์", g && gyroPct(g.mouse_window_radius), (v) => `${v}%`],
    }[b];
    return { tab: "gyro", group: "slot", label: `Gyro · ${map[0]}`, base: map[1], fmt: map[2] };
  }
  if (a === "grip") {
    const g = gripPart(cfg);
    const lra = lraGrip(S);
    return b === "enabled"
      ? { tab: "vibration", group: "slot", label: "ด้ามสั่นตามเกม · เปิด", base: g?.enabled, fmt: onOff }
      : {
          tab: "vibration", group: "slot", label: "ด้ามสั่นตามเกม · ความแรง", base: vibLevel(g?.curve, lra), fmt: (v) => levelText(v, Math.round((gripEndY(v, lra) / 255) * 100)),
          // A curve with mid points is not one of the levels: say so instead of a level's percent.
          ...(g?.curve.mid_points.length ? { baseText: `curve ที่ตั้งเอง · ใกล้ระดับ ${vibLevel(g.curve, lra)}` } : {}),
        };
  }
  if (a === "gripfb") {
    const t = cfg?.[`vibration_trigger_${b}`];
    const mode = motorMode(S.motor, b);
    return c === "enabled"
      ? { tab: "vibration", group: "slot", label: `บีบไก${SIDE[b]}แล้วด้ามสั่น · เปิด`, base: mode === undefined ? undefined : mode === FEEDBACK_MODE, fmt: onOff }
      : { tab: "vibration", group: "slot", label: `บีบไก${SIDE[b]}แล้วด้ามสั่น · ความแรง`, base: feedbackLevel(t?.curve), fmt: (v) => levelText(v) };
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
      ...(baseTarget(cfg, layer, source, press) === undefined ? { baseText: labelTarget(undefined) } : {}),
    };
  }
  if (a === "layer") {
    const id = Number(b);
    if (c === "new") return { tab: "buttons", group: "slot", label: `เพิ่ม ${LAYER_NAME(id)}`, base: undefined, baseText: "ยังไม่มี", fmt: () => "layer ว่าง ทุกปุ่มเป็นค่าเดิม" };
    const lay = cfg?.layers.find((l) => l.layer_id === id);
    const what = lay ? [lay.mappings.filter((m) => !m.identity).length && `${lay.mappings.filter((m) => !m.identity).length} ปุ่ม`, lay.macros.length && `${lay.macros.length} macro`].filter(Boolean).join(" · ") : "";
    const into = (cfg?.layers ?? []).flatMap((l) => l.mappings.filter((m) => m.activators.some((x) => (x.target.type === "layer_hold" || x.target.type === "layer_toggle") && x.target.layer === id)).map((m) => btnName(m.source)));
    const reset = into.length ? ` · ปุ่ม ${[...new Set(into)].join(", ")} ที่สลับมา layer นี้กลับเป็นค่าเดิม` : "";
    return { tab: "buttons", group: "slot", label: `ลบ ${LAYER_NAME(id)}`, base: false, fmt: (v) => (v ? `ลบ${what ? ` พร้อม ${what}` : ""}${reset}` : "มีอยู่") };
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
export const AXIS = { none: "ไม่ใช้", imu_x: "หมุนแบบพวงมาลัย (X)", imu_y: "ก้ม–เงย (Y)", imu_z: "เอียงซ้าย–ขวา (Z)" };
// imu_x = yaw and imu_y = pitch were checked in joy.cpl (2026-10-22); imu_z = roll is the one left over.
export const MACRO_MODE = { press_once: "กดครั้งเดียว เล่นจบ", press_loop_immediate: "วนทันทีขณะกด", press_loop_wait: "วน · รอระหว่างรอบ", press_hold: "ค้างตามที่กด" };
export const TIMEOUT = { 30: "30 วิ", 60: "1 นาที", 300: "5 นาที", 0: "ไม่ปิด" };

// Draft key → key applyEdits takes, or null while it can only stay a draft.
// Only the loaded slot's name can be written: the other slots' blobs aren't in RAM 0x05.
export function editKey(key, S) {
  const cfg = S.current?.cfg;
  // Vibration drafts stand for fields in another form (expand below).
  if (key === "grip.enabled") return gripPart(cfg) ? "motor.left.enabled" : null;
  // The level table depends on the grip motors, which device info tells.
  if (key === "grip.level") return gripPart(cfg) && S.info ? "motor.left.curve" : null;
  const fb = key.match(/^gripfb\.(left|right)\.level$/);
  if (fb) return cfg?.[`vibration_trigger_${fb[1]}`] ? `vibtrig.${fb[1]}.curve` : null;
  // On/off is sent with 0x53 after the profile, once RAM 0x06 could be read.
  if (FEEDBACK_KEY.test(key)) return S.motor ? key : null;
  const k = key === `slot.${S.current?.slot}.name` ? "profile.name" : key;
  if (!isWritable(k)) return null;
  // Names need TLV 0x20: a v1.8 profile becomes v1.9 when it gets one (withNames).
  return k;
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
    // A layer create or delete that no longer fits what the controller holds (re-read after a restore, say).
    const cfg = this.S.current?.cfg;
    if (!cfg) return;
    for (const k of [...this.map.keys()]) {
      const m = k.match(/^layer\.(\d+)\.(new|delete)$/);
      if (!m) continue;
      const has = cfg.layers.some((l) => l.layer_id === Number(m[1]));
      if (m[2] === "delete" ? !has : has) this.map.delete(k);
    }
  }
  // Library macros edited since their copies were written count too (S.plan, see macroPlan).
  count(tab) {
    const stale = !tab || tab === "macros" ? (this.S.plan?.rows ?? []).filter((r) => r.kind === "update" || r.kind === "rename").length : 0;
    // So do layers the write has to number again (layerMoves).
    const moves = !tab || tab === "buttons" ? this.S.plan?.moves?.length ?? 0 : 0;
    return [...this.map.keys()].filter((k) => !tab || meta(k, this.S).tab === tab).length + stale + moves;
  }
  // Edits for applyEdits. On/off of trigger feedback is not in the profile: see motorCmds().
  writable() {
    const out = {};
    for (const [k, v] of this.map) {
      if (!editKey(k, this.S) || FEEDBACK_KEY.test(k)) continue;
      for (const [ek, ev] of expand(k, v, this.S)) out[ek] = ev;
    }
    return out;
  }
  // Writable trigger feedback drafts: [{ key, side, on }], sent with 0x53 after the profile.
  motorCmds() {
    return [...this.map].filter(([k]) => FEEDBACK_KEY.test(k) && editKey(k, this.S)).map(([key, on]) => ({ key, side: key.split(".")[1], on }));
  }
  items() {
    return [...this.map].map(([key, v]) => {
      const ek = editKey(key, this.S);
      return { key, value: v, writable: !!ek, editKey: ek, ...meta(key, this.S) };
    });
  }
}

// A draft as the fields applyEdits takes. Names go to the controller cut to what it holds; the app
// keeps the full name (names.js). Grip drafts set both motors; a level writes a whole curve.
function expand(key, v, S) {
  const cfg = S.current.cfg;
  if (key === "grip.enabled") return [["motor.left.enabled", v], ["motor.right.enabled", v]];
  if (key === "grip.level") {
    const c = gripCurve(v, lraGrip(S));
    return [["motor.left.curve", c], ["motor.right.curve", c]];
  }
  const fb = key.match(/^gripfb\.(left|right)\.level$/);
  if (fb) return [[`vibtrig.${fb[1]}.curve`, feedbackCurve(cfg[`vibration_trigger_${fb[1]}`].curve, v)]];
  return [[editKey(key, S), key.endsWith(".name") ? fit(v) : v]];
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

// The library as the Macros page lists it (filtered by its search box), and the macro it has open:
// the one picked, or the first in the list.
export function macroList(S) {
  const q = (S.ui.macroQ ?? "").trim().toLowerCase();
  return q ? S.lib.list().filter((m) => m.name.toLowerCase().includes(q)) : S.lib.list();
}
export const openMacro = (S) => S.lib.get(S.ui.macro) ?? macroList(S)[0] ?? null;
