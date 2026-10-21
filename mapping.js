// Decoder for the per-profile mapping blob (RAM 0x05, magic "XMUL", v1.8/v1.9).
// Layout notes are in PROTOCOL.md.

export const BUTTONS = [
  "A", "B", "X", "Y", "LB", "RB", "Back", "Start", "LS", "RS",
  "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →", "C", "Z",
  "M1", "M2", "M3", "M4", "M5", "M6", "LT (active)", "RT (active)",
];
const NONE = 0xff;
const ACTIVATORS = ["simple", "timing_single", "timing_long", "timing_double", "pulse_press", "pulse_release", "toggle"];
const MACRO_MODES = ["press_once", "press_loop_immediate", "press_loop_wait", "press_hold"];
const ANGLE_MODES = ["4way", "8way", "4way_overlap"];
const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];
const GYRO_MODES = ["disable", "left_joystick", "right_joystick", "mouse"];
const GYRO_AXES = ["none", "imu_x", "imu_y", "imu_z"];
const TARGET_SIZE = 4;
const CURVE_LEN = 11;

const i8 = (v) => (v > 127 ? v - 256 : v);
const btn = (id) => (id === NONE ? "none" : (BUTTONS[id] ?? `#${id}`));

class Reader {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  get remaining() {
    return this.b.length - this.o;
  }
  need(n) {
    if (this.o + n > this.b.length) throw new Error(`mapping truncated at ${this.o} (need ${n})`);
  }
  u8() {
    this.need(1);
    return this.b[this.o++];
  }
  u16() {
    this.need(2);
    const v = this.b[this.o] | (this.b[this.o + 1] << 8);
    this.o += 2;
    return v;
  }
  u32() {
    const lo = this.u16();
    return (lo | (this.u16() << 16)) >>> 0;
  }
  bytes(n) {
    this.need(n);
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  skip(n) {
    this.need(n);
    this.o += n;
  }
}

function target(b) {
  const [type, a, c, d] = b;
  switch (type) {
    case 0: return { type: "btn_gamepad", button: btn(a) };
    case 1: return { type: "btn_keyboard", key: a, modifier: c };
    case 2: return { type: "btn_mouse", mouse: a };
    case 3: return { type: "btn_consumer", consumer: a };
    case 10: return { type: "turbo_gamepad", button: btn(a), interval_ms: (c | (d << 8)) * 10 };
    case 20: return { type: "layer_hold", layer: a };
    case 21: return { type: "layer_toggle", layer: a };
    case 30: return { type: "macro", macro: a };
    case 40: return { type: "mouse_move", dx: i8(a), dy: i8(c) };
    case 41: return { type: "mouse_wheel", delta: i8(a) };
    case 42: return { type: "stick_left", x: i8(a), y: i8(c) };
    case 43: return { type: "stick_right", x: i8(a), y: i8(c) };
    case 44: return { type: "linear_left", value: a };
    case 45: return { type: "linear_right", value: a };
    case 46: return { type: "motor", left: a, right: c };
    default: return { type: `unknown(${type})`, raw: Array.from(b) };
  }
}

function curve(r, len) {
  const start_x = r.u8(), start_y = r.u8(), end_x = r.u8(), end_y = r.u8(), count = r.u8();
  const slots = (len - 7) / 2;
  const mid_points = [];
  for (let i = 0; i < slots; i++) {
    const x = r.u8(), y = r.u8();
    if (i < count) mid_points.push({ x, y });
  }
  r.skip(2);
  return { start_x, start_y, end_x, end_y, mid_points };
}

function gyroSlots(r) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const act = r.u8(), b = r.u8();
    if (b !== NONE) out.push({ activation: act === 1 ? "toggle" : "hold", button: btn(b) });
  }
  return out;
}

function layer(r) {
  const layer_id = r.u8();
  r.skip(1);
  const mapCount = r.u16(), macroCount = r.u16();
  r.skip(2);

  const mappings = [];
  for (let i = 0; i < mapCount; i++) {
    const src = r.u8(), n = r.u8();
    r.skip(2);
    const activators = [];
    for (let j = 0; j < n; j++) {
      const t = r.u8();
      activators.push({ type: ACTIVATORS[t] ?? `unknown(${t})`, target: target(r.bytes(TARGET_SIZE)) });
    }
    const identity = n === 1 && activators[0].type === "simple" &&
      activators[0].target.type === "btn_gamepad" && activators[0].target.button === btn(src);
    mappings.push({ source: btn(src), activators, identity });
  }

  const macros = [];
  for (let i = 0; i < macroCount; i++) {
    const macro_id = r.u8(), mode = r.u8(), loop_interval_ms = r.u16(), n = r.u8();
    r.skip(1);
    const actions = [];
    for (let j = 0; j < n; j++) {
      const a = r.u8();
      actions.push({ action: a === 0 ? "press" : "release", target: target(r.bytes(TARGET_SIZE)), at_ms: r.u16() });
    }
    macros.push({ macro_id, trigger_mode: MACRO_MODES[mode] ?? mode, loop_interval_ms, actions });
  }

  const triggerZones = () => {
    if (r.u8() === 0) return null;
    const n = r.u8();
    const zones = [];
    for (let i = 0; i < n; i++) zones.push({ start: r.u8(), stop: r.u8(), target: target(r.bytes(TARGET_SIZE)) });
    return zones.length ? zones : null;
  };
  const stickZones = () => {
    if (r.u8() === 0) return null;
    const angle_mode = ANGLE_MODES[r.u8()] ?? "4way";
    const n = r.u8();
    const zones = [];
    for (let i = 0; i < 8; i++) {
      if (i < n) zones.push({ start: r.u8(), stop: r.u8(), dir: DIRS[r.u8()] ?? "up", target: target(r.bytes(TARGET_SIZE)) });
      else r.skip(3 + TARGET_SIZE);
    }
    return zones.length ? { angle_mode, zones } : null;
  };

  return {
    layer_id,
    mappings,
    macros,
    trigger_zones_left: triggerZones(),
    trigger_zones_right: triggerZones(),
    stick_zones_left: stickZones(),
    stick_zones_right: stickZones(),
  };
}

function tlv(r, out) {
  while (r.remaining >= 2) {
    const tag = r.u8(), len = r.u8();
    if (tag === 0xff && len === 0) return;
    const start = r.o;
    const take = () => new Reader(r.bytes(len));
    switch (tag) {
      case 1:
      case 2: {
        if (len !== CURVE_LEN + 1) { r.skip(len); break; }
        const s = take();
        const c = curve(s, CURVE_LEN);
        const f = s.u8();
        out[tag === 1 ? "joystick_left" : "joystick_right"] = { curve: c, invert_x: !!(f & 1), invert_y: !!(f & 2), is_round: !!(f & 4) };
        break;
      }
      case 3:
      case 4:
        if (len !== CURVE_LEN) { r.skip(len); break; }
        out[tag === 3 ? "trigger_left" : "trigger_right"] = { curve: curve(take(), CURVE_LEN) };
        break;
      case 5: {
        if (len !== 24) { r.skip(len); break; }
        const s = take();
        const c = curve(s, CURVE_LEN);
        const f = s.u8(), mode = s.u8();
        out.gyroscope = {
          curve: c, invert_x: !!(f & 1), invert_y: !!(f & 2), mode: GYRO_MODES[mode] ?? mode,
          activation: gyroSlots(s), axis_x: GYRO_AXES[s.u8()], axis_y: GYRO_AXES[s.u8()], mouse_window_radius: s.u8(),
        };
        break;
      }
      case 6: case 7: case 8: case 9: {
        if (len !== CURVE_LEN + 1) { r.skip(len); break; }
        const s = take();
        const f = s.u8();
        const key = { 6: "vibration_trigger_left", 7: "vibration_trigger_right", 8: "vibration_motor_left", 9: "vibration_motor_right" }[tag];
        out[key] = tag >= 8 ? { enabled: !!(f & 1), curve: curve(s, CURVE_LEN) } : { curve: curve(s, CURVE_LEN) };
        break;
      }
      case 32: {
        const s = r.bytes(len);
        const dec = new TextDecoder();
        let o = 0;
        const nameLen = s[o++] ?? 0;
        out.name = dec.decode(s.subarray(o, o + nameLen));
        o += nameLen;
        const n = s[o++] ?? 0;
        out.macro_names = [];
        for (let i = 0; i < n && o + 3 <= s.length; i++) {
          const layerId = s[o++], macroId = s[o++], l = s[o++];
          out.macro_names.push({ layerId, macroId, name: dec.decode(s.subarray(o, o + l)) });
          o += l;
        }
        break;
      }
      default:
        r.skip(len);
    }
    if (r.o !== start + len) r.o = start + len;
  }
}

// Accepts either the raw blob or the RAM-wrapped form (len u16, crc16 u16, blob).
export function decodeMapping(buf) {
  const magic = (o) => buf[o] === 0x58 && buf[o + 1] === 0x4d && buf[o + 2] === 0x55 && buf[o + 3] === 0x4c;
  if (!magic(0) && magic(4)) buf = buf.subarray(4);
  const r = new Reader(buf);
  if (!magic(0) && !magic(4)) throw new Error('not an XMUL mapping blob');
  r.skip(4);
  const ver = r.u32();
  if (ver !== 8 && ver !== 9) throw new Error(`unsupported mapping version ${ver}`);
  r.u8(); // slot_count, always 1
  r.skip(3);
  const runtime = { long_press_ms: r.u16(), double_press_ms: r.u16() };
  r.skip(4);
  r.skip(4);
  const layerCount = r.u8();
  r.skip(3);
  const layers = [];
  for (let i = 0; i < layerCount; i++) layers.push(layer(r));
  const config = { version: ver === 9 ? "1.9" : "1.8", runtime, layers };
  tlv(r, config);
  return config;
}
