import assert from "node:assert/strict";
import { Apex6, buildFrame, parseReply, crc32 } from "./protocol.js";

// Reference encoder copied in behaviour from the official client: q(cmd, payload)
function ref(n, t) { const e=t.length+2,r=4+t.length+1,s=new Uint8Array(r); s[0]=90;s[1]=165;s[2]=n;s[3]=e;s.set(t,4); let c=0; for(let i=2;i<r-1;i++)c=(c+s[i])&255; s[r-1]=c; return s; }
assert.deepEqual(buildFrame(0xa3, new Uint8Array([0,5,2,16])), ref(0xa3, new Uint8Array([0,5,2,16])));
assert.deepEqual(buildFrame(0x01), ref(0x01, new Uint8Array(0)));

const sum = (b,f,t)=>{let s=0;for(let i=f;i<t;i++)s=(s+b[i])&255;return s;};
const reply = (cmd, head, payload) => { const f=new Uint8Array(63); const body=[0x5a,0xa5,cmd,...head,...payload]; f.set(body); f[body.length]=sum(f,2,body.length); return f; };
assert.deepEqual([...parseReply(reply(1,[1,0],[7,8,9])).payload],[7,8,9]);

// Mock HID device: 40-byte RAM blob served in 16-byte chunks; device info for 0x01.
const blob = Uint8Array.from({length:40},(_,i)=>i);
const dev = { opened:true, productId:0x2502, productName:"mock", collections:[{usagePage:0xffa0,outputReports:[{reportId:0,items:[{reportCount:63}]}]}],
  listeners:[], addEventListener(_,f){this.listeners.push(f)}, removeEventListener(){}, async close(){},
  async sendReport(id, data) {
    const cmd=data[2], p=data.slice(4,4+data[3]-2); let r;
    if (cmd===0xa3) { const [op,ram,idx,size]=p; const d=blob.slice(idx*size,(idx+1)*size);
      r=reply(0xa3,[],[op,0,ram,0,blob.length&255,blob.length>>8,idx,d.length,...d]); }
    else if (cmd===0x01) { const pl=new Uint8Array(25); pl[1]=2; pl[6]=0x18; pl[10]=1; pl[11]=0x23; pl[24]=0b11; r=reply(1,[1,0],[...pl]); }
    else r=reply(cmd,[0,0],[3]);
    setTimeout(()=>this.listeners.forEach(f=>f({data:new DataView(r.buffer)})),5);
  } };
const a = await Apex6.open(dev);
const info = await a.getDeviceInfo();
assert.equal(info.connectionMode,2); assert.equal(info.batteryLevel,8); assert.equal(info.chargingStatus,1);
assert.equal(info.fw.main,0x0123); assert.equal(info.features.imu,true); assert.equal(info.features.screen,false);
const {data} = await a.readRam(5);
assert.deepEqual([...data],[...blob]);
await assert.rejects(a.request(0x07,undefined,{timeoutMs:50,retries:1}), /error code=3/);
console.log("all ok");

// Real capture from an Apex 6 Pro, profile slot 2.
const { readFileSync } = await import("node:fs");
const { decodeMapping } = await import("./mapping.js");
const { renderProfile } = await import("./profile-view.js");
const cfg = decodeMapping(new Uint8Array(readFileSync(new URL("./samples/mapping_slot2.bin", import.meta.url))));
assert.equal(cfg.version, "1.9");
assert.equal(cfg.layers.length, 2);
assert.equal(cfg.layers[0].macros.length, 2);
assert.equal(cfg.joystick_left.curve.start_x, 13);
assert.equal(cfg.gyroscope.mode, "disable");
assert.ok(renderProfile(cfg).includes("มาโคร #1"));
console.log("mapping ok");

// --- Write path ---
const { crc16, unwrapMapping, withStickDeadzones, deadzoneMax, sameBytes } = await import("./mapping-edit.js");
const ascii = new TextEncoder().encode("123456789");
assert.equal(crc32(ascii), 0xcbf43926);
assert.equal(crc16(ascii), 0x29b1);

const sample = new Uint8Array(readFileSync(new URL("./samples/mapping_slot2.bin", import.meta.url)));
const { cfg: wcfg } = unwrapMapping(sample); // checks wrapper len + CRC16 of the real capture
assert.equal(wcfg.joystick_left.curve.start_x, 13);
assert.ok(sameBytes(withStickDeadzones(sample, { left: 13, right: 13 }), sample), "no-op patch is byte-identical");

const patched = withStickDeadzones(sample, { left: 25 });
const diff = [...patched].flatMap((b, i) => (b === sample[i] ? [] : [i]));
assert.ok(diff.length >= 1 && diff.length <= 3 && diff.filter((i) => i >= 4).length === 1, `unexpected diff ${diff}`);
const p2 = unwrapMapping(patched).cfg;
assert.equal(p2.joystick_left.curve.start_x, 25);
assert.equal(p2.joystick_right.curve.start_x, 13);
assert.throws(() => withStickDeadzones(sample, { left: deadzoneMax(wcfg.joystick_left) + 1 }));
assert.throws(() => withStickDeadzones(sample, { left: 1.5 }));
const broken = sample.slice(); broken[50] ^= 1;
assert.throws(() => unwrapMapping(broken), /CRC16/);

// Mock device implementing 0xA3 INFO and the 0xA4 FULL write state machine.
function writableDevice(initial, { corruptCommit = false } = {}) {
  const ram = { 5: initial.slice() };
  let pending = null;
  const d = { ...dev, listeners: [], ram, frames: [] };
  d.sendReport = async function (id, data) {
    const cmd = data[2], p = data.slice(4, 4 + data[3] - 2);
    this.frames.push([cmd, ...p]);
    const u16 = (o) => p[o] | (p[o + 1] << 8), u32 = (o) => (u16(o) | (u16(o + 2) << 16)) >>> 0;
    const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
    let r;
    if (cmd === 0xa3 && p[0] === 1) {
      const b = ram[p[1]];
      r = reply(0xa3, [], [1, 0, p[1], 1, b.length & 255, b.length >> 8, ...le32(crc32(b))]);
    } else if (cmd === 0xa3) {
      const [op, rid, idx, size] = p, b = ram[rid], c = b.slice(idx * size, (idx + 1) * size);
      r = reply(0xa3, [], [op, 0, rid, 1, b.length & 255, b.length >> 8, idx, c.length, ...c]);
    } else if (cmd === 0xa4 && p[0] === 0) {
      pending = { ram: p[1], len: u16(2), crc: u32(4), buf: new Uint8Array(u16(2)) };
      r = reply(0xa4, [], [0, 0, p[1]]);
    } else if (cmd === 0xa4 && p[0] === 1) {
      pending.buf.set(p.slice(4, 4 + p[3]), u16(1));
      r = reply(0xa4, [], [1, 0, pending.ram]);
    } else if (cmd === 0xa4 && p[0] === 2) {
      const c = (crc32(pending.buf) ^ (corruptCommit ? 1 : 0)) >>> 0;
      if (c === pending.crc && !corruptCommit) ram[pending.ram] = pending.buf;
      r = reply(0xa4, [], [2, 0, pending.ram, 1, pending.buf.length & 255, pending.buf.length >> 8, ...le32(c)]);
      pending = null;
    } else if (cmd === 0xa4 && p[0] === 3) {
      pending = null;
      r = reply(0xa4, [], [3, 0, 0]);
    } else r = reply(cmd, [0, 0], [3]);
    setTimeout(() => this.listeners.forEach((f) => f({ data: new DataView(r.buffer) })), 2);
  };
  return d;
}

const wd = writableDevice(sample);
const w = await Apex6.open(wd);
const info0 = await w.getRamInfo(5);
assert.equal(info0.len, sample.length);
assert.equal(info0.crc32, crc32(sample));
const res = await w.writeRam(5, patched);
assert.equal(res.len, patched.length);
assert.ok(sameBytes(wd.ram[5], patched));
assert.ok(sameBytes((await w.readRam(5)).data, patched));
const chunkFrames = wd.frames.filter((f) => f[0] === 0xa4 && f[1] === 1);
assert.equal(chunkFrames.length, Math.ceil(patched.length / 16));
assert.ok(wd.frames.every((f) => f.length + 4 <= 32), "every frame fits 32 bytes");

const bad = writableDevice(sample, { corruptCommit: true });
const wb = await Apex6.open(bad);
await assert.rejects(wb.writeRam(5, patched), /COMMIT mismatch/);
assert.ok(sameBytes(bad.ram[5], sample), "rejected commit leaves RAM unchanged");
console.log("write ok");

// --- Byte-level edits beyond deadzone ---
const { applyEdits, WRITABLE, curveEndMin } = await import("./mapping-edit.js");
const edits = {
  "stick.left.max": 240, "stick.right.round": !wcfg.joystick_right.is_round, "stick.left.invertY": true,
  "trigger.left.start": 20, "trigger.right.end": 230,
  "gyro.mode": "right_joystick", "gyro.invertY": true,
  "runtime.long": 400, "runtime.double": 200,
};
const e1 = applyEdits(sample, edits);
const c1 = unwrapMapping(e1).cfg; // CRC16 must still validate
assert.equal(c1.joystick_left.curve.end_x, 240);
assert.equal(c1.joystick_right.is_round, !wcfg.joystick_right.is_round);
assert.equal(c1.joystick_left.invert_y, true);
assert.equal(c1.joystick_left.invert_x, wcfg.joystick_left.invert_x, "other flag bits untouched");
assert.equal(c1.trigger_left.curve.start_x, 20);
assert.equal(c1.trigger_right.curve.end_x, 230);
assert.equal(c1.gyroscope.mode, "right_joystick");
assert.equal(c1.gyroscope.invert_y, true);
assert.equal(c1.runtime.long_press_ms, 400);
assert.equal(c1.runtime.double_press_ms, 200);
assert.equal(c1.layers.length, wcfg.layers.length);
const changed = [...e1].filter((b, i) => b !== sample[i]).length;
assert.ok(changed <= Object.keys(edits).length + 4, `too many bytes changed: ${changed}`);
if (wcfg.vibration_motor_left) {
  const e2 = unwrapMapping(applyEdits(sample, { "motor.left.enabled": false, "motor.left.max": 200 })).cfg;
  assert.equal(e2.vibration_motor_left.enabled, false);
  assert.equal(e2.vibration_motor_left.curve.end_y, 200);
}
assert.throws(() => applyEdits(sample, { "stick.left.max": curveEndMin(wcfg.joystick_left.curve) - 1 }));
assert.throws(() => applyEdits(sample, { "gyro.mode": "teleport" }));
assert.throws(() => applyEdits(sample, { "led.color": "#ff0000" }), /ยังเขียน/);
assert.ok(sameBytes(applyEdits(sample, {}), sample), "empty edit is byte-identical");
assert.ok(WRITABLE.has("stick.left.deadzone") && !WRITABLE.has("led.color"));
console.log("edits ok");

// Gyro block: every field the Gyro page writes, and the rules checkProfile holds it to.
{
  const { applyEdits, checkProfile, crc16: crc, gyroPct, gyroByte } = await import("./mapping-edit.js");
  const g0 = unwrapMapping(sample).cfg.gyroscope;
  const acts = [{ activation: "hold", button: "LT (active)" }, { activation: "hold", button: "M5" }];
  // The owner's curve from the official Advanced page: dead zone 1%, compensation 1%, mid point (29, 230).
  const curve = { start_x: 3, start_y: 3, end_x: 255, end_y: 255, mid_points: [{ x: 29, y: 230 }] };
  const out = applyEdits(sample, {
    "gyro.curve": curve, "gyro.activation": acts, "gyro.axisX": "imu_z", "gyro.axisY": "none", "gyro.mouseRadius": 50,
  });
  const g = unwrapMapping(out).cfg.gyroscope;
  assert.deepEqual(g.curve, curve);
  const at0 = 4 + unwrapMapping(out).cfg.offsets.gyroscope;
  assert.deepEqual([...out.subarray(at0, at0 + 11)], [3, 3, 255, 255, 1, 29, 230, 0, 0, 0, 0], "curve11 as the official encoder writes it");
  assert.deepEqual(g.activation, acts);
  assert.equal(g.axis_x, "imu_z");
  assert.equal(g.axis_y, "none");
  assert.equal(g.mouse_window_radius, 127, "50 * 2.55 rounds to 127 in JS, as in the official app");
  assert.equal(g.mode, g0.mode, "untouched gyro bytes stay");
  // Two mid points, then back to none: unused point bytes go back to 0.
  const two = { ...curve, mid_points: [{ x: 29, y: 230 }, { x: 100, y: 240 }] };
  assert.deepEqual(unwrapMapping(applyEdits(out, { "gyro.curve": two })).cfg.gyroscope.curve, two);
  const flat = { start_x: 0, start_y: 0, end_x: 255, end_y: 255, mid_points: [] };
  const fo = applyEdits(out, { "gyro.curve": flat });
  assert.deepEqual([...fo.subarray(at0, at0 + 11)], [0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0]);
  // The official percent scale: the stick default end_x 145 reads 57% and writes back as 145.
  assert.equal(gyroPct(145), 57);
  assert.equal(gyroByte(57), 145);
  // Fewer buttons clear the slots after them to (0, 0xFF); none at all is refused.
  assert.deepEqual(unwrapMapping(applyEdits(out, { "gyro.activation": [acts[0]] })).cfg.gyroscope.activation, [acts[0]]);
  assert.throws(() => applyEdits(out, { "gyro.activation": [] }), /อย่างน้อย 1/);
  // Curve values the editor can't make are refused.
  assert.throws(() => applyEdits(sample, { "gyro.curve": { ...curve, mid_points: [{ x: 300, y: 0 }] } }), /0–255/);
  assert.throws(() => applyEdits(sample, { "gyro.curve": { ...curve, start_x: 40 } }), /เรียง/);
  assert.throws(() => applyEdits(sample, { "gyro.curve": { ...two, mid_points: [...two.mid_points, { x: 200, y: 250 }] } }), /ไม่เกิน 2/);
  assert.throws(() => applyEdits(sample, { "gyro.axisX": "imu_w" }));
  assert.throws(() => applyEdits(sample, { "gyro.activation": [acts[0], acts[0]] }), /ซ้ำ/);
  assert.throws(() => applyEdits(sample, { "gyro.activation": [...acts, { activation: "hold", button: "A" }, { activation: "hold", button: "B" }, { activation: "hold", button: "X" }] }));
  assert.throws(() => applyEdits(sample, { "gyro.activation": [{ activation: "hold", button: "Q" }] }));
  assert.throws(() => applyEdits(sample, { "gyro.mouseRadius": 101 }));

  // checkProfile: bytes the official app doesn't know in the gyro block stop a write.
  const at = 4 + unwrapMapping(sample).cfg.offsets.gyroscope;
  const poke = (pairs) => {
    const b = sample.slice();
    for (const [i, v] of pairs) b[at + i] = v;
    const c = crc(b.subarray(4)); b[2] = c & 0xff; b[3] = c >> 8;
    return b;
  };
  checkProfile(sample);
  assert.throws(() => checkProfile(poke([[12, 9]])), /โหมด gyro/);
  assert.throws(() => checkProfile(poke([[21, 4]])), /แกน gyro/);
  assert.throws(() => checkProfile(poke([[22, 0xff]])), /แกน gyro/);
  assert.throws(() => checkProfile(poke([[14, 40]])), /ปุ่มเปิด gyro ไม่รู้จัก/);
  assert.throws(() => checkProfile(poke([[16, g0.activation.length ? 4 : 0xff]])), /ซ้ำ/);
  assert.throws(() => checkProfile(poke([[14, 0xff], [16, 0xff], [18, 0xff], [20, 0xff]])), /อย่างน้อย 1/);
}
console.log("gyro edits ok");

// --- Names (TLV 0x20): the blob changes length, everything else must survive ---
const { NAME_MAX, isWritable } = await import("./mapping-edit.js");
const strip = (c) => JSON.stringify({ ...c, name: undefined, macro_names: undefined });
const mac = wcfg.layers.flatMap((l) => l.macros.map((m) => ({ layer: l.layer_id, id: m.macro_id })));
assert.ok(mac.length, "sample has macros");
const mk = `macro.${mac[0].layer}.${mac[0].id}.name`;
const n1 = applyEdits(sample, { "profile.name": "FPS ยิงไว", [mk]: "Reload", "stick.left.max": 240 });
assert.equal(n1[0] | (n1[1] << 8), n1.length, "wrapper length follows the new size");
const nc = unwrapMapping(n1).cfg;
assert.equal(nc.name, "FPS ยิงไว");
assert.deepEqual(nc.macro_names, [{ layerId: mac[0].layer, macroId: mac[0].id, name: "Reload" }]);
assert.equal(nc.joystick_left.curve.end_x, 240, "byte patch applied alongside the rename");
assert.equal(strip(nc), strip(unwrapMapping(applyEdits(sample, { "stick.left.max": 240 })).cfg), "nothing else moved");
// Renaming again replaces the entry; clearing both names gives the original bytes back.
const n2 = applyEdits(n1, { [mk]: "Reload 2" });
assert.equal(unwrapMapping(n2).cfg.macro_names.length, 1);
assert.equal(unwrapMapping(n2).cfg.name, "FPS ยิงไว");
assert.ok(sameBytes(applyEdits(n1, { "profile.name": "", [mk]: "", "stick.left.max": wcfg.joystick_left.curve.end_x }), sample));
assert.throws(() => applyEdits(sample, { "profile.name": "ก".repeat(14) }), /เกิน/); // 42 bytes
assert.ok(unwrapMapping(applyEdits(sample, { "profile.name": "a".repeat(NAME_MAX) })).cfg.name.length === NAME_MAX);
assert.throws(() => applyEdits(sample, { "macro.0.99.name": "x" }), /ไม่มี macro/);
assert.ok(isWritable(mk) && isWritable("profile.name") && !isWritable("slot.0.name"));
// A v1.9 profile without TLV 0x20 gets one just before END.
{
  const blob = sample.subarray(4);
  const at = wcfg.offsets.meta - 2, len = blob[wcfg.offsets.meta - 1] + 2;
  const bare = new Uint8Array([...blob.subarray(0, at), ...blob.subarray(at + len)]);
  const wrapped = new Uint8Array(4 + bare.length);
  wrapped.set(bare, 4);
  wrapped[0] = wrapped.length & 0xff; wrapped[1] = wrapped.length >> 8;
  const c = crc16(bare); wrapped[2] = c & 0xff; wrapped[3] = c >> 8;
  assert.equal(unwrapMapping(wrapped).cfg.offsets.meta, undefined);
  assert.equal(unwrapMapping(applyEdits(wrapped, { "profile.name": "Race" })).cfg.name, "Race");
}
// The write path takes the new length.
const nd = writableDevice(sample);
const nw = await Apex6.open(nd);
await nw.writeRam(5, n1);
assert.ok(sameBytes((await nw.readRam(5)).data, n1));
// Drafts: the loaded slot's name maps to profile.name, other slots stay drafts.
const { editKey } = await import("./model.js");
const S0 = { current: { cfg: wcfg, slot: 1 } };
assert.equal(editKey("slot.1.name", S0), "profile.name");
assert.equal(editKey("slot.2.name", S0), null);
assert.equal(editKey(mk, S0), mk);
assert.equal(editKey("led.color", S0), null);
console.log("names ok");

// --- Creating and deleting macros: the layer section changes length ---
{
  const { encodeMacro, MACRO_MAX, crc16 } = await import("./mapping-edit.js");
  const seq = (s) => [...s].flatMap((b, i) => [
    { action: "press", target: { type: "btn_gamepad", button: b }, at_ms: i * 100 },
    { action: "release", target: { type: "btn_gamepad", button: b }, at_ms: i * 100 + 50 },
  ]);
  const mk1 = (s, mode) => ({ mode, actions: seq(s) });
  const ids = (buf, layer) => unwrapMapping(buf).cfg.layers.find((l) => l.layer_id === layer).macros.map((m) => m.macro_id);
  const the = (buf, layer, id) => unwrapMapping(buf).cfg.layers.find((l) => l.layer_id === layer).macros.find((m) => m.macro_id === id);
  const rest = (c) => JSON.stringify({ ...c, layers: c.layers.map((l) => ({ ...l, macros: undefined })) });
  const base = unwrapMapping(sample).cfg;
  assert.deepEqual(ids(sample, 0), [0, 1]);
  assert.deepEqual(ids(sample, 1), []);

  // New macro in the empty layer: valid wrapper, only that layer's macros change.
  const a1 = applyEdits(sample, { "macro.1.0.set": mk1("YABX", "press_once") });
  assert.equal(a1[0] | (a1[1] << 8), a1.length);
  assert.deepEqual(ids(a1, 1), [0]);
  assert.deepEqual(ids(a1, 0), [0, 1]);
  assert.deepEqual(the(a1, 1, 0).actions, seq("YABX"));
  assert.equal(the(a1, 1, 0).trigger_mode, "press_once");
  assert.equal(rest(unwrapMapping(a1).cfg), rest(base), "the rest of the profile did not move");
  assert.deepEqual(the(a1, 0, 1), base.layers[0].macros[1], "other macros are byte-for-byte the same");
  // Entries stay in id order.
  const a2 = applyEdits(a1, { "macro.0.5.set": mk1("AB", "press_once"), "macro.0.2.set": mk1("X", "press_loop_immediate") });
  assert.deepEqual(ids(a2, 0), [0, 1, 2, 5]);
  assert.equal(the(a2, 0, 2).trigger_mode, "press_loop_immediate");
  // Setting an id that is there replaces that macro in place; the others stay byte-for-byte.
  const r1 = applyEdits(a2, { "macro.0.2.set": mk1("YY", "press_hold") });
  assert.deepEqual(ids(r1, 0), [0, 1, 2, 5]);
  assert.deepEqual(the(r1, 0, 2).actions, seq("YY"));
  assert.equal(the(r1, 0, 2).trigger_mode, "press_hold");
  assert.deepEqual(the(r1, 0, 5), the(a2, 0, 5));
  // { bytes } writes a body as read from the controller (macroBody), and keeps the loop time.
  const { macroBody } = await import("./mapping-edit.js");
  const body = macroBody(sample.subarray(4), base, 0, 0);
  const r2 = applyEdits(sample, { "macro.1.6.set": { bytes: Array.from(body) } });
  assert.deepEqual({ ...the(r2, 1, 6), macro_id: 0 }, base.layers[0].macros[0], "a copy in another layer plays the same");
  assert.throws(() => applyEdits(sample, { "macro.1.6.set": { bytes: [0, 0, 0, 2, 0, 1, 2, 3] } }), /ไม่ครบ/);
  // Actions read from the controller carry their target bytes and are written back as they were.
  const kb = { mode: "press_once", actions: [{ action: "press", target: { type: "btn_keyboard", key: 4 }, raw: [1, 4, 2, 0], at_ms: 0 }, { action: "release", target: { type: "btn_keyboard", key: 4 }, raw: [1, 4, 2, 0], at_ms: 30 }] };
  assert.equal(the(applyEdits(sample, { "macro.1.0.set": kb }), 1, 0).actions[0].target.modifier, 2);
  // Create then delete gives the original bytes back, also with a name in between.
  assert.ok(sameBytes(applyEdits(a1, { "macro.1.0.delete": true }), sample));
  const a3 = applyEdits(sample, { "macro.1.3.set": mk1("Y", "press_once"), "macro.1.3.name": "Reinforce", "stick.left.max": 240 });
  const c3 = unwrapMapping(a3).cfg;
  assert.deepEqual(c3.macro_names, [{ layerId: 1, macroId: 3, name: "Reinforce" }]);
  assert.equal(c3.joystick_left.curve.end_x, 240, "other edits land after the splice");
  const a4 = applyEdits(a3, { "macro.1.3.delete": true, "stick.left.max": wcfg.joystick_left.curve.end_x });
  assert.ok(sameBytes(a4, sample), "deleting drops the name entry too");
  // Delete one, keep the other; ids are not renumbered. A name edit for a deleted macro is ignored.
  const d1 = applyEdits(sample, { "macro.0.0.delete": true, [`macro.0.0.name`]: "x" });
  assert.deepEqual(ids(d1, 0), [1]);
  assert.deepEqual(the(d1, 0, 1), base.layers[0].macros[1]);
  assert.deepEqual(ids(applyEdits(sample, { "macro.0.0.delete": true, "macro.0.1.delete": true }), 0), []);
  // A full layer takes a new macro in the same write once one is deleted.
  let full = sample;
  for (let i = 2; i < MACRO_MAX; i++) full = applyEdits(full, { [`macro.0.${i}.set`]: mk1("A", "press_once") });
  assert.equal(ids(full, 0).length, MACRO_MAX);
  assert.ok(ids(applyEdits(full, { "macro.0.4.delete": true, "macro.0.4.set": mk1("B", "press_once") }), 0).includes(4));
  // Things it must refuse.
  assert.throws(() => applyEdits(sample, { "macro.1.8.set": mk1("A", "press_once") }), /0–7/);
  assert.throws(() => applyEdits(sample, { "macro.7.0.set": mk1("A", "press_once") }), /ไม่มี layer 7/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.set": { mode: "press_once", actions: [] } }), /อย่างน้อย 1 ขั้น/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.set": mk1("A", "dance") }), /วิธีเล่นไม่รู้จัก/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.set": { mode: "press_once", actions: [{ action: "press", target: { type: "btn_keyboard", key: 4 }, at_ms: 0 }] } }), /เฉพาะปุ่มจอย/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.set": { mode: "press_once", actions: [...seq("A"), { action: "press", target: { type: "btn_gamepad", button: "A" }, at_ms: 10 }] } }), /เรียงจากน้อยไปมาก/);
  assert.throws(() => applyEdits(sample, { "macro.0.7.delete": true }), /ไม่มี macro #8/);

  // Buttons that played a deleted macro: only that press goes, a button with nothing left resets.
  const b0 = unwrapMapping(sample).cfg.offsets.layers[0];
  const entry = (src, ...acts) => [src, acts.length, 0, 0, ...acts.flatMap(([t, ty, a]) => [t, ty, a, 0, 0])];
  const blob = sample.subarray(4);
  const put = (entries) => {
    const bytes = Uint8Array.from(entries.flat());
    const parts = [blob.subarray(0, b0.macrosFrom), bytes, blob.subarray(b0.macrosFrom)];
    const out = new Uint8Array(4 + parts.reduce((n, p) => n + p.length, 0));
    let o = 4;
    for (const p of parts) { out.set(p, o); o += p.length; }
    out[0] = out.length & 255; out[1] = out.length >> 8;
    out[4 + b0.mapCountAt] = entries.length; // map count was 0
    const c = crc16(out.subarray(4)); out[2] = c & 255; out[3] = c >> 8;
    return out;
  };
  const bound = put([entry(16, [0, 30, 0]), entry(17, [0, 30, 1], [2, 30, 0]), entry(18, [0, 0, 0])]);
  const bc = unwrapMapping(bound).cfg;
  assert.deepEqual(bc.layers[0].mappings.map((m) => m.source), ["M1", "M2", "M3"]);
  assert.equal(bc.layers[0].mappings[0].activators[0].target.layer, 0, "a macro target knows its layer");
  const gone = unwrapMapping(applyEdits(bound, { "macro.0.0.delete": true })).cfg;
  assert.deepEqual(gone.layers[0].mappings.map((m) => m.source), ["M2", "M3"], "M1 only played that macro: back to default");
  assert.equal(gone.layers[0].mappings[0].activators.length, 1, "M2 keeps its other press");
  assert.equal(gone.layers[0].mappings[0].activators[0].target.macro, 1);
  assert.deepEqual(ids(applyEdits(bound, { "macro.0.0.delete": true }), 0), [1]);
}
{
  // The macro library (macros.js): copies on the controller are linked to it, and a write plans
  // the copies every layer needs.
  const { Library, planMacros, sigOf } = await import("./macros.js");
  const { fit } = await import("./names.js");
  const { Drafts, macroPlan, writeEdits, macroUses, resolveMacros, labelTarget, baseTarget } = await import("./model.js");
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const st = mem();
  const act = (b, i) => [
    { action: "press", target: { type: "btn_gamepad", button: b }, at_ms: i * 100 },
    { action: "release", target: { type: "btn_gamepad", button: b }, at_ms: i * 100 + 50 },
  ];
  const at = (buf) => ({ current: { cfg: unwrapMapping(buf).cfg, slot: 1, wrapped: buf }, uuid: "U", lib: new Library(st) });
  const ids = (buf, layer) => unwrapMapping(buf).cfg.layers.find((l) => l.layer_id === layer)?.macros.map((m) => m.macro_id);

  // Reading a slot takes its macros into the library, once.
  let S = at(sample);
  resolveMacros(S);
  assert.equal(S.lib.list().length, 2);
  assert.deepEqual(Object.keys(S.current.cfg.links), ["0.0", "0.1"]);
  const [p, q] = S.lib.list();
  assert.equal(sigOf(p), S.current.cfg.links["0.0"].sig, "a macro taken from the controller keeps its bytes");
  S = at(sample);
  resolveMacros(S);
  assert.equal(S.lib.list().length, 2, "reading again adds nothing");
  // A new macro in the library, played by A in the Shift layer.
  const r = S.lib.add({ name: "Reload ยาวมากกกกกกกกกกกกกกกกกกกกกกกกกก", mode: "press_once", actions: [...act("Y", 0), ...act("A", 1)] });
  let D = new Drafts(S);
  D.set("map.1.A.simple", { type: "macro", uid: r.uid });
  D.set("map.0.B.simple", { type: "macro", uid: p.uid });
  assert.equal(labelTarget(D.get("map.1.A.simple"), S.current.cfg), `Macro · ${r.name}`);
  let plan = macroPlan(S, D);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.rows.map((x) => [x.kind, x.layer, x.id]), [["remove", 0, 1], ["add", 1, 0]], "an unplayed copy goes, a played one is added");
  assert.deepEqual(plan.used, { 0: 1, 1: 1 });
  let { edits, drafts } = writeEdits(D, plan);
  assert.deepEqual(drafts.sort(), ["map.0.B.simple", "map.1.A.simple"]);
  assert.deepEqual(edits["map.1.A.simple"], { type: "macro", macro: 0, layer: 1 });
  assert.deepEqual(edits["map.0.B.simple"], { type: "macro", macro: 0, layer: 0 });
  let wrote = applyEdits(sample, edits);
  assert.deepEqual([ids(wrote, 0), ids(wrote, 1)], [[0], [0]]);
  const wc = unwrapMapping(wrote).cfg;
  assert.equal(wc.macro_names.find((n) => n.layerId === 1).name, fit(r.name), "the copy gets the name, cut to what fits");
  // After the write the links say which library macro each copy is.
  S.lib.setLinks("U", 1, plan.links);
  S = { ...at(wrote), lib: S.lib };
  resolveMacros(S);
  assert.equal(S.lib.list().length, 3);
  assert.deepEqual(baseTarget(S.current.cfg, 1, "A", "simple"), { type: "macro", uid: r.uid });
  D = new Drafts(S);
  assert.equal(macroPlan(S, D).rows.length, 0, "nothing left to do");
  assert.deepEqual(macroUses(S, D, r.uid), [{ layer: 1, source: "A", press: "simple" }]);
  // The same macro in a second layer is a second copy; editing it in the library updates both.
  D.set("map.0.X.long", { type: "macro", uid: r.uid });
  plan = macroPlan(S, D);
  assert.deepEqual(plan.rows.map((x) => [x.kind, x.layer, x.id]), [["add", 0, 1]]);
  wrote = applyEdits(S.current.wrapped, writeEdits(D, plan).edits);
  S.lib.setLinks("U", 1, plan.links);
  S = { ...at(wrote), lib: S.lib };
  resolveMacros(S);
  D = new Drafts(S);
  S.lib.update(r.uid, { mode: "press_hold" });
  S.plan = plan = macroPlan(S, D);
  assert.deepEqual(plan.rows.map((x) => [x.kind, x.layer, x.id]), [["update", 0, 1], ["update", 1, 0]]);
  assert.equal(D.count(), 2, "edited library macros count as pending");
  assert.equal(D.count("buttons"), 0);
  wrote = applyEdits(S.current.wrapped, writeEdits(D, plan).edits);
  assert.equal(unwrapMapping(wrote).cfg.layers[1].macros[0].trigger_mode, "press_hold");
  assert.equal(unwrapMapping(wrote).cfg.layers[0].mappings.find((m) => m.source === "X").activators.find((a) => a.type === "timing_long").target.macro, 1, "presses keep their copy");
  // A layer holds MACRO_MAX: one more is an error, not a write.
  D = new Drafts(S);
  const many = Array.from({ length: 9 }, (_, i) => S.lib.add({ name: `M${i}`, mode: "press_once", actions: act("B", 0) }));
  ["A", "B", "X", "Y", "LB", "RB", "LS", "RS", "Back"].forEach((b, i) => D.set(`map.1.${b}.simple`, { type: "macro", uid: many[i].uid }));
  assert.match(macroPlan(S, D).errors[0], /Shift layer ใช้ macro 9 ตัว/);
  // An empty macro can't be written.
  D = new Drafts(S);
  const empty = S.lib.add({ name: "ว่าง", mode: "press_once", actions: [] });
  D.set("map.0.Y.simple", { type: "macro", uid: empty.uid });
  assert.match(macroPlan(S, D).errors[0], /ยังไม่มีขั้น/);
  // Names that don't fit the 255-byte block are cut shorter for every copy.
  const L = new Library(mem());
  const long = Array.from({ length: 8 }, (_, i) => L.add({ name: `ชื่อยาวมากของมาโคร ${i}`, mode: "press_once", actions: act("A", 0) }));
  const cfg0 = unwrapMapping(sample).cfg;
  const pl = planMacros({ cfg: cfg0, links: {}, lib: L, layers: [0], sources: () => ["A", "B", "X", "Y", "LB", "RB", "LS", "RS"], target: (l, s, pr) => (pr === "simple" ? { type: "macro", uid: long[["A", "B", "X", "Y", "LB", "RB", "LS", "RS"].indexOf(s)].uid } : undefined) });
  const cap = pl.rows.find((x) => x.kind === "names")?.cap;
  assert.ok(cap && cap < 40, "names are cut");
  const named = applyEdits(sample, pl.edits);
  assert.equal(unwrapMapping(named).cfg.macro_names.length, 8);
  // Export and import.
  const L2 = new Library(mem());
  assert.equal(L2.import(S.lib.export()), S.lib.list().length);
  assert.equal(L2.import(S.lib.export()), 0, "nothing twice");
}
console.log("macro create/delete ok");

// --- Button maps and layers: entries and layers change the blob's length ---
{
  const { LAYER_MAX } = await import("./mapping-edit.js");
  const cfgOf = (buf) => unwrapMapping(buf).cfg;
  const L = (buf, id) => cfgOf(buf).layers.find((l) => l.layer_id === id);
  const maps = (buf, id) => L(buf, id).mappings.map((m) => [m.source, ...m.activators.map((a) => `${a.type}:${a.target.type}:${a.target.button ?? a.target.layer ?? a.target.macro ?? a.target.mouse ?? ""}`)]);
  const rest = (c) => JSON.stringify({ ...c, layers: c.layers.map((l) => ({ ...l, mappings: undefined })) });
  const base = cfgOf(sample);
  assert.deepEqual(base.layers.map((l) => l.layer_id), [0, 1]);
  assert.deepEqual(maps(sample, 0), []);

  // A remap adds an entry, only that layer's maps change, and putting it back gives the original bytes.
  const m1 = applyEdits(sample, { "map.0.M1.simple": { type: "btn_gamepad", button: "A" } });
  assert.deepEqual(maps(m1, 0), [["M1", "simple:btn_gamepad:A"]]);
  assert.equal(rest(cfgOf(m1)), rest(base));
  assert.deepEqual(L(m1, 0).macros, base.layers[0].macros, "macros after the new entry are intact");
  assert.ok(sameBytes(applyEdits(m1, { "map.0.M1.simple": { type: "btn_gamepad", button: "M1" } }), sample));
  // Long and double press: the normal press becomes timing_single and keeps the button itself.
  const m2 = applyEdits(m1, { "map.0.M2.long": { type: "turbo_gamepad", button: "B", interval_ms: 80 }, "map.0.M1.double": { type: "btn_mouse", mouse: 1 } });
  assert.deepEqual(maps(m2, 0), [["M1", "timing_single:btn_gamepad:A", "timing_double:btn_mouse:1"], ["M2", "timing_single:btn_gamepad:M2", "timing_long:turbo_gamepad:B"]]);
  assert.equal(L(m2, 0).mappings[1].activators[1].target.interval_ms, 80);
  // Clearing the long press leaves the default, so the entry goes; turning a button off keeps an empty one.
  const m3 = applyEdits(m2, { "map.0.M2.long": undefined, "map.0.M1.double": undefined, "map.0.B.simple": { type: "none" } });
  assert.deepEqual(maps(m3, 0), [["M1", "simple:btn_gamepad:A"], ["B"]]);
  assert.deepEqual(maps(applyEdits(m3, { "map.0.B.simple": { type: "btn_gamepad", button: "B" } }), 0), [["M1", "simple:btn_gamepad:A"]]);
  // Reset to factory default (what "รีเซ็ตปุ่มนี้" drafts): the entry goes, long and double with it.
  assert.ok(sameBytes(applyEdits(m2, { "map.0.M1.simple": { type: "btn_gamepad", button: "M1" }, "map.0.M1.double": undefined, "map.0.M2.simple": { type: "btn_gamepad", button: "M2" }, "map.0.M2.long": undefined }), sample));
  // Back buttons and LM/RM (M5/M6) as targets, and LM/RM as sources.
  assert.deepEqual(maps(applyEdits(sample, { "map.0.A.simple": { type: "btn_gamepad", button: "M1" }, "map.0.M5.simple": { type: "btn_gamepad", button: "M6" } }), 0), [["A", "simple:btn_gamepad:M1"], ["M5", "simple:btn_gamepad:M6"]]);

  // Layers: add one, map into it, and switch to it from the base layer.
  const l1 = applyEdits(sample, {
    "layer.2.new": true,
    "map.2.A.simple": { type: "btn_gamepad", button: "B" },
    "map.0.M3.simple": { type: "layer_hold", layer: 2 },
    "map.0.M4.double": { type: "layer_toggle", layer: 1 },
  });
  const c1 = cfgOf(l1);
  assert.deepEqual(c1.layers.map((l) => l.layer_id), [0, 1, 2]);
  assert.equal(l1[4 + c1.offsets.layerCountAt], 3, "layer_count follows");
  assert.deepEqual(maps(l1, 2), [["A", "simple:btn_gamepad:B"]]);
  assert.deepEqual(maps(l1, 0), [["M3", "simple:layer_hold:2"], ["M4", "timing_single:btn_gamepad:M4", "timing_double:layer_toggle:1"]]);
  assert.equal(JSON.stringify({ ...c1, layers: c1.layers.slice(0, 2).map((l) => ({ ...l, mappings: undefined })) }), rest(base), "the rest of the profile did not move");
  // Adding then deleting a layer gives the original bytes back.
  assert.ok(sameBytes(applyEdits(applyEdits(sample, { "layer.2.new": true }), { "layer.2.delete": true }), sample));
  // Deleting a layer takes its macros, their names and the presses that switched to it.
  const named = applyEdits(l1, { "macro.2.0.set": { mode: "press_once", actions: [{ action: "press", target: { type: "btn_gamepad", button: "A" }, at_ms: 0 }, { action: "release", target: { type: "btn_gamepad", button: "A" }, at_ms: 50 }] }, "macro.2.0.name": "Peek" });
  assert.deepEqual(cfgOf(named).macro_names, [{ layerId: 2, macroId: 0, name: "Peek" }]);
  const d1 = applyEdits(named, { "layer.2.delete": true, "map.2.B.simple": { type: "none" }, "macro.2.0.name": "x" });
  const dc = cfgOf(d1);
  assert.deepEqual(dc.layers.map((l) => l.layer_id), [0, 1]);
  assert.deepEqual(dc.macro_names, []);
  assert.deepEqual(maps(d1, 0), [["M4", "timing_single:btn_gamepad:M4", "timing_double:layer_toggle:1"]], "M3 only switched to layer 2: back to default");
  // Deleting layer 1 too: M4 is back to a plain normal press of itself, so the entry goes.
  assert.ok(sameBytes(applyEdits(d1, { "layer.1.delete": true, "layer.1.new": true }), sample));
  // Full: 4 layers, the free id goes to a new one only after a delete.
  const full = applyEdits(sample, { "layer.2.new": true, "layer.3.new": true });
  assert.equal(cfgOf(full).layers.length, LAYER_MAX);
  assert.throws(() => applyEdits(full, { "layer.2.new": true }), /มี layer 2 อยู่แล้ว/);
  assert.deepEqual(cfgOf(applyEdits(full, { "layer.2.delete": true, "layer.2.new": true })).layers.map((l) => l.layer_id), [0, 1, 2, 3], "layers are kept in id order");

  // Things it must refuse.
  assert.throws(() => applyEdits(sample, { "layer.0.delete": true }), /Base layer/);
  assert.throws(() => applyEdits(sample, { "layer.4.new": true }), /1–3/);
  assert.throws(() => applyEdits(sample, { "layer.3.delete": true }), /ไม่มี layer 3/);
  assert.throws(() => applyEdits(sample, { "map.3.A.simple": { type: "btn_gamepad", button: "B" } }), /ไม่มี layer 3/);
  assert.throws(() => applyEdits(sample, { "map.0.A.simple": { type: "layer_hold", layer: 3 } }), /ไม่มี layer 3 ให้สลับไป/);
  assert.throws(() => applyEdits(sample, { "map.0.A.double": { type: "layer_hold", layer: 1 } }), /ใช้แบบสลับแทน/);
  assert.throws(() => applyEdits(sample, { "map.0.A.long": { type: "none" } }), /เฉพาะการกดปกติ/);
  assert.throws(() => applyEdits(sample, { "map.1.A.simple": { type: "macro", macro: 0, layer: 1 } }), /ไม่มี macro #1/);
  assert.throws(() => applyEdits(sample, { "map.0.A.simple": { type: "macro", macro: 0, layer: 1 } }), /layer เดียวกัน/);
  assert.throws(() => applyEdits(sample, { "map.0.LM.simple": { type: "btn_gamepad", button: "A" } }), /ไม่รู้จักปุ่ม LM/);
  // A macro target to a macro being deleted in the same write.
  assert.throws(() => applyEdits(sample, { "macro.0.0.delete": true, "map.0.A.simple": { type: "macro", macro: 0, layer: 0 } }), /ไม่มี macro #1/);
  assert.ok(applyEdits(sample, { "map.0.A.simple": { type: "macro", macro: 1, layer: 0 } }));
}
{
  // The Buttons page's view of it: layer drafts, switches, the review rows, the write, prune.
  const { Drafts, layerList, nextLayerId, layerSwitches, layerKey, labelTarget } = await import("./model.js");
  const S3 = { current: { cfg: unwrapMapping(sample).cfg, slot: 1, wrapped: sample } };
  const D3 = new Drafts(S3);
  assert.equal(nextLayerId(S3, D3), 2);
  D3.set(layerKey(2, "new"), true);
  D3.set(layerKey(1, "delete"), true);
  assert.deepEqual(layerList(S3, D3), [{ id: 0, isNew: false, deleted: false }, { id: 1, isNew: false, deleted: true }, { id: 2, isNew: true, deleted: false }]);
  assert.equal(nextLayerId(S3, D3), 3, "a layer awaiting deletion keeps its id");
  D3.set("map.0.M1.simple", { type: "layer_hold", layer: 2 });
  D3.set("map.2.A.simple", { type: "btn_gamepad", button: "B" });
  assert.equal(labelTarget(D3.get("map.0.M1.simple")), "Layer 2 ขณะกด");
  assert.deepEqual(layerSwitches(S3, D3).map((s) => [s.layer, s.source, s.type, s.to]), [[0, "M1", "layer_hold", 2]]);
  assert.deepEqual(D3.items().map((i) => [i.writable, i.label]), [[true, "เพิ่ม Layer 2"], [true, "ลบ Shift layer"], [true, "ปุ่ม M1 (Base layer) · กดปกติ"], [true, "ปุ่ม A (Layer 2) · กดปกติ"]]);
  const out = applyEdits(sample, D3.writable());
  // Layers 0 and 2 are numbered again as 0 and 1 (the firmware finds layers by position).
  assert.deepEqual(unwrapMapping(out).cfg.layers.map((l) => l.layer_id), [0, 1]);
  assert.equal(unwrapMapping(out).cfg.layers[0].mappings.find((m) => m.source === "M1").activators[0].target.layer, 1);
  S3.current = { cfg: unwrapMapping(out).cfg, slot: 1, wrapped: out };
  for (const k of Object.keys(D3.writable())) D3.map.delete(k); // as runWrite does
  D3.prune();
  assert.equal(D3.count(), 0, "after the write every draft is done with");
}
{
  // The firmware finds a hold/toggle layer by position, so ids must run 0, 1, 2 with no gap.
  const cfgOf = (b) => unwrapMapping(b).cfg;
  const hold = (b, L, src) => cfgOf(b).layers.find((l) => l.layer_id === L).mappings.find((m) => m.source === src).activators[0].target.layer;
  const mk = { mode: "press_once", actions: [{ action: "press", target: { type: "btn_gamepad", button: "A" }, at_ms: 0 }, { action: "release", target: { type: "btn_gamepad", button: "A" }, at_ms: 50 }] };
  const three = applyEdits(sample, { "layer.2.new": true, "map.0.M1.simple": { type: "layer_hold", layer: 2 }, "map.2.B.simple": { type: "btn_gamepad", button: "X" }, "macro.2.0.set": mk, "macro.2.0.name": "Peek" });
  assert.deepEqual(cfgOf(three).layers.map((l) => l.layer_id), [0, 1, 2]);
  // Deleting layer 1 leaves 0, 2: layer 2 becomes layer 1, and so do the hold to it and its macro name.
  const gap = applyEdits(three, { "layer.1.delete": true });
  const g = cfgOf(gap);
  assert.deepEqual(g.layers.map((l) => l.layer_id), [0, 1]);
  assert.equal(hold(gap, 0, "M1"), 1);
  assert.equal(g.layers[1].mappings[0].activators[0].target.button, "X", "the layer keeps its buttons");
  assert.deepEqual(g.macro_names, [{ layerId: 1, macroId: 0, name: "Peek" }]);
  // checkProfile refuses what the firmware would get wrong; a gap stored on the controller is one.
  const { checkProfile, crc16: crc } = await import("./mapping-edit.js");
  const bad = three.slice();
  bad[4 + cfgOf(three).offsets.layers[2].from] = 3;
  const bc = crc(bad.subarray(4));
  bad[2] = bc & 255; bad[3] = bc >> 8;
  assert.throws(() => checkProfile(bad), /ไม่เขียนลงจอย: layer ลำดับที่ 3 มีเลข 3/);
  assert.equal(cfgOf(applyEdits(bad, {})).layers[2].layer_id, 2, "a write fixes it");
  // A profile already stored with a gap or out of order is fixed by any write.
  const { layerRenumber } = await import("./mapping-edit.js");
  assert.deepEqual([...layerRenumber([0, 3, 2])], [[0, 0], [2, 1], [3, 2]]);
  const fixed = applyEdits(three, { "stick.left.max": 240 });
  assert.ok(sameBytes(fixed.subarray(0, 4 + cfgOf(three).offsets.layersEnd).slice(4), three.subarray(4, 4 + cfgOf(three).offsets.layersEnd)), "layers already 0, 1, 2 are left as they are");
  // The app says so in the review, and moves the macro links with it.
  const { Drafts, layerMoves, macroPlan, resolveMacros } = await import("./model.js");
  const { Library } = await import("./macros.js");
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const S = { current: { cfg: cfgOf(three), slot: 0, wrapped: three }, uuid: "G", lib: new Library(mem()) };
  resolveMacros(S);
  const D = new Drafts(S);
  D.set("layer.1.delete", true);
  assert.deepEqual(layerMoves(S, D), [{ from: 2, to: 1 }]);
  D.set("map.2.A.simple", { type: "macro", uid: S.lib.list()[0].uid });
  assert.deepEqual(Object.keys(macroPlan(S, D).links).map((k) => k.split(".")[0]).sort(), ["1"], "links use the new layer ids");
}
console.log("button maps and layers ok");

// --- Vibration: levels as the official Vibration page, trigger feedback via 0x53, curve rules ---
{
  const { applyEdits, checkProfile, crc16: crc, vibLevel, gripCurve, feedbackLevel, feedbackCurve, motorCmd, checkMotorCmd, motorMode, isWritable } = await import("./mapping-edit.js");
  const { Drafts, writeEdits, meta } = await import("./model.js");
  const cfg0 = unwrapMapping(sample).cfg;
  // The owner's slot 2 shows grip "Level 3" and both triggers "Level 5" in the official app.
  assert.equal(vibLevel(cfg0.vibration_motor_left.curve, false), 3);
  assert.equal(feedbackLevel(cfg0.vibration_trigger_left.curve), 5);
  assert.equal(vibLevel(gripCurve(2, false), false), 2);
  assert.equal(vibLevel(gripCurve(4, true), true), 4);
  assert.equal(gripCurve(1, false).end_y, 51);
  assert.equal(gripCurve(1, true).end_y, 128);
  assert.equal(gripCurve(9, false).end_y, 255, "levels clamp to 1–5");
  // Feedback strength keeps the curve's shape and scales it to level/5.
  const lin = { start_x: 0, start_y: 0, end_x: 255, end_y: 255, mid_points: [] };
  assert.equal(feedbackCurve(lin, 3).end_y, 153);
  const shaped = { start_x: 0, start_y: 30, end_x: 255, end_y: 153, mid_points: [{ x: 100, y: 90 }] };
  assert.deepEqual(feedbackCurve(shaped, 5), { start_x: 0, start_y: 50, end_x: 255, end_y: 255, mid_points: [{ x: 100, y: 150 }] });
  assert.equal(feedbackLevel(feedbackCurve(shaped, 2)), 2);
  const zero = { start_x: 0, start_y: 0, end_x: 255, end_y: 0, mid_points: [{ x: 64, y: 0 }, { x: 192, y: 0 }] };
  assert.deepEqual(feedbackCurve(zero, 5).mid_points, [{ x: 64, y: 77 }, { x: 192, y: 217 }]);
  assert.equal(feedbackCurve({ ...zero, mid_points: [] }, 5).end_y, 255);

  // Drafts: grip sets both motors, a level writes a whole linear curve; feedback on/off is a 0x53 command.
  const ram6 = new Uint8Array(64); ram6[12] = 1;
  const S = { current: { cfg: cfg0, slot: 1, wrapped: sample }, info: { features: { haptic: false } }, motor: ram6 };
  const D = new Drafts(S);
  assert.equal(D.get("grip.level"), 3);
  assert.equal(D.get("gripfb.left.enabled"), false);
  D.set("grip.level", 2);
  D.set("grip.enabled", false);
  D.set("gripfb.left.level", 3);
  D.set("gripfb.right.enabled", true);
  const { edits, drafts } = writeEdits(D, { edits: {} });
  assert.deepEqual(Object.keys(edits).sort(), ["motor.left.curve", "motor.left.enabled", "motor.right.curve", "motor.right.enabled", "vibtrig.left.curve"]);
  assert.deepEqual(drafts.sort(), ["grip.enabled", "grip.level", "gripfb.left.level"], "on/off is not a profile edit");
  assert.deepEqual(D.motorCmds(), [{ key: "gripfb.right.enabled", side: "right", on: true }]);
  const out = unwrapMapping(applyEdits(sample, edits)).cfg;
  for (const m of [out.vibration_motor_left, out.vibration_motor_right]) {
    assert.equal(m.enabled, false);
    assert.deepEqual(m.curve, gripCurve(2, false));
  }
  assert.equal(out.vibration_trigger_left.curve.end_y, 153);
  assert.deepEqual(out.vibration_trigger_right, cfg0.vibration_trigger_right, "the other trigger is left alone");
  assert.equal(meta("grip.level", S).fmt(2), "ระดับ 2 · 40%");
  // Without RAM 0x06 the switch stays a draft; without device info so does the grip level.
  const S2 = { ...S, motor: null, info: null };
  const D2 = new Drafts(S2);
  D2.set("gripfb.left.enabled", true);
  D2.set("grip.level", 4);
  assert.deepEqual(D2.motorCmds(), []);
  assert.deepEqual(D2.writable(), {});
  assert.ok(isWritable("gripfb.left.enabled") && !isWritable("gripfb.both.enabled"));

  // 0x53: only what the official app sends for trigger feedback.
  assert.deepEqual(motorCmd("left", true), { area: 0, target: 0, mode: 2, params: [0, 64, 6] });
  assert.deepEqual(motorCmd("right", false), { area: 0, target: 1, mode: 0, params: [] });
  assert.throws(() => checkMotorCmd({ area: 0, target: 2, mode: 2, params: [0, 64, 6] }), /ไกฝั่ง/);
  assert.throws(() => checkMotorCmd({ area: 1, target: 0, mode: 0, params: [] }), /area/);
  assert.throws(() => checkMotorCmd({ area: 0, target: 0, mode: 1, params: [] }), /โหมด/);
  assert.throws(() => checkMotorCmd({ area: 0, target: 0, mode: 2, params: [0, 64] }), /โหมด/);
  assert.throws(() => checkMotorCmd({ area: 0, target: 0, mode: 0, params: [0, 64, 6] }), /โหมด/);
  assert.equal(motorMode(ram6, "right"), 1);
  assert.equal(motorMode(ram6, "left"), 0);
  assert.equal(motorMode(new Uint8Array(10), "left"), undefined, "too short to hold both sides");

  // checkProfile: every curve has at most 2 mid points, left to right.
  const poke = (key, pairs) => {
    const b = sample.slice(), at = 4 + cfg0.offsets[key];
    for (const [i, v] of pairs) b[at + i] = v;
    const c = crc(b.subarray(4)); b[2] = c & 0xff; b[3] = c >> 8;
    return b;
  };
  checkProfile(sample);
  assert.throws(() => checkProfile(poke("vibration_motor_left", [[5, 3]])), /จุดกลาง 3/);
  assert.throws(() => checkProfile(poke("vibration_trigger_right", [[1, 200], [3, 100]])), /เรียง/);
  assert.throws(() => checkProfile(poke("joystick_left", [[4, 5]])), /จุดกลาง 5/);
  assert.throws(() => applyEdits(sample, { "motor.left.curve": { ...lin, mid_points: [{ x: 9, y: 0 }, { x: 5, y: 0 }] } }), /เรียง/);
}
console.log("vibration ok");

// --- App-side names (names.js): full name in the app, what fits on the controller ---
{
  const { Names, fit } = await import("./names.js");
  const { resolveNames, Drafts } = await import("./model.js");
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const long = "ปืนไรเฟิลซุ่มยิงระยะไกลมาก"; // > 40 bytes
  assert.ok(new TextEncoder().encode(fit(long)).length <= NAME_MAX && long.startsWith(fit(long)));
  assert.equal(fit("short"), "short");
  assert.equal(fit("ก้".repeat(20)), "ก้".repeat(6), "never splits a letter from its mark"); // 6 bytes each

  const store = mem();
  const N = new Names(store);
  N.put("u1", "slot.1", long, fit(long));
  assert.deepEqual(N.resolve("u1", "slot.1", fit(long)), { name: long }, "in sync: full name");
  assert.equal(N.resolve("u1", "slot.1", "Other").name, "Other", "controller changed elsewhere: it wins");
  assert.equal(N.resolve("u1", "slot.1", "Other").other.full, long);
  assert.equal(N.resolve("u2", "slot.1", "X").name, "X", "per controller");
  assert.equal(new Names(store).entry("u1", "slot.1").full, long, "persisted");
  N.put("u1", "slot.1", "Same", "Same");
  assert.equal(N.entry("u1", "slot.1"), undefined, "nothing to keep when the controller has it all");
  N.put("u1", "slot.3", "Race", null);
  assert.ok(N.resolve("u1", "slot.3", "").other.unsent);
  const n = new Names(mem()).import("u9", N.export("u1"));
  assert.equal(n, 1);
  assert.throws(() => N.import("u1", { foo: 1 }));

  // Draft → write → re-read: the controller gets the cut name, the app shows the full one.
  const S1 = { uuid: "u1", names: new Names(mem()), current: { cfg: unwrapMapping(sample).cfg, slot: 1, wrapped: sample } };
  resolveNames(S1);
  const D1 = new Drafts(S1);
  D1.set("slot.1.name", long);
  assert.equal(D1.writable()["profile.name"], fit(long));
  const out = applyEdits(sample, D1.writable());
  S1.names.put("u1", "slot.1", long, fit(long));
  S1.current = { cfg: unwrapMapping(out).cfg, slot: 1, wrapped: out };
  resolveNames(S1);
  D1.prune();
  assert.equal(D1.count(), 0, "draft cleared once the controller holds the cut name");
  assert.equal(D1.get("slot.1.name"), long);
}
console.log("app names ok");

// Live input: 0x11 frame layout, 0xEF stick frames, 0x21 key events.
{
  const sent = [];
  const d = { opened: true, collections: [{ usagePage: 0xffa0, outputReports: [{ reportId: 0, items: [{ reportCount: 63 }] }] }],
    listeners: [], addEventListener(_, f) { this.listeners.push(f); }, removeEventListener() {}, async close() {},
    async sendReport(id, data) { sent.push(data.slice()); } };
  const p = await Apex6.open(d);
  await p.setInputModes({ dinput: 1 });
  assert.deepEqual([...sent[0].slice(0, 9)], [0x5a, 0xa5, 0x11, 29, 0xff, 1, 0xff, 0xff, 0xff]);
  assert.equal(sent[0][31], sum(sent[0], 2, 31));

  const push = (f) => d.listeners.forEach((l) => l({ data: new DataView(f.buffer) }));
  const sticks = [], events = [];
  const off = p.onStick((s) => sticks.push(s));
  p.onEvent((t) => events.push(t));
  const f = new Uint8Array(32), v = new DataView(f.buffer);
  f.set([0x5a, 0xa5, 0xef]);
  v.setInt16(3, 32767, true); v.setInt16(5, -100, true); v.setInt16(7, 5, true); v.setInt16(9, -32768, true); v.setUint32(11, 0x81, true); f[15] = 200; f[16] = 7;
  [1, -1, 32767, -32768, 0, 4096].forEach((x, i) => v.setInt16(17 + i * 2, x, true)); f[29] = 0xab; f[30] = 0x01;
  f[31] = sum(f, 2, 31);
  push(f);
  const bad = f.slice(); bad[31] ^= 1; push(bad);
  assert.deepEqual(sticks, [{ lx: 32767, ly: -100, rx: 5, ry: -32768, buttons: 0x81, lt: 200, rt: 7, imu: [1, -1, 32767, -32768, 0, 4096], tail: [0xab, 0x01] }]);
  off(); push(f); assert.equal(sticks.length, 1);

  push(reply(0x21, [1, 0], [...new TextEncoder().encode("KEY_DOWN GP_M1"), 0, 0x41]));
  assert.deepEqual(events, ["KEY_DOWN GP_M1"]);
  push(reply(0x01, [1, 0], [1, 2, 3]));
  assert.equal(events.length, 1);
}
console.log("live ok");

// Profile library: a profile is in one slot at most, found by its bytes (slot in use) or CRC16.
{
  const { Profiles, toWrite, crcOf, named, slotsOf, PROFILES_MAX } = await import("./profiles.js");
  const { fit } = await import("./names.js");
  const { crc16: crc } = await import("./mapping-edit.js");
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const cfgOf = (b) => unwrapMapping(b).cfg;
  const same = (a, b) => assert.deepEqual([...a], [...b]);
  const st = mem();
  const P = new Profiles(st);

  // Saving the slot in use keeps its bytes, so that slot holds the new profile right away.
  const { profile: p, existed } = P.add("Race", sample);
  assert.equal(existed, false);
  same(P.data(p), sample);
  assert.equal(p.crc, crcOf(sample));
  assert.deepEqual(slotsOf(p, [0, 0, 0, 0], { slot: 1, wrapped: sample }), [1], "the slot in use: equal bytes");
  assert.deepEqual(slotsOf(p, [0, 0, 0, p.crc], { slot: 1, wrapped: sample }), [1, 3], "other slots: CRC16");
  assert.deepEqual(slotsOf(p, [p.crc, 0, 0, 0], { slot: 0, wrapped: toWrite(applyEdits(sample, { "stick.left.deadzone": 21 })) }), [], "the slot in use is read in full: its bytes win over its CRC16");
  assert.equal(P.add("Other name", sample).existed, true, "the same slot saved again adds nothing, whatever the name");
  assert.deepEqual(P.holding(sample), [p]);
  assert.equal(new Profiles(st).list().length, 1, "persisted");
  assert.throws(() => P.add("   ", sample), /ตั้งชื่อ/);

  // A rename is the app's: the bytes (and so the slot that holds it) stay.
  P.rename(p.uid, "Race 2");
  assert.equal(p.name, "Race 2");
  same(P.data(p), sample);

  // What goes into a slot carries the profile's name; the copy then takes the bytes read back.
  const out = toWrite(named(P.data(p), p.name));
  assert.equal(cfgOf(out).name, "Race 2");
  P.update(p.uid, out);
  same(P.data(p), out);
  assert.equal(p.crc, crcOf(out));
  assert.equal(p.name, "Race 2", "the name stays unless the slot was renamed");

  // A slot that holds the profile, edited and written: the profile follows the slot.
  const edited = applyEdits(out, { "stick.left.deadzone": 21, "profile.name": "Race 3" });
  P.update(p.uid, edited, "Race 3");
  same(P.data(p), edited);
  assert.equal(p.name, "Race 3");
  assert.equal(new Profiles(st).get(p.uid).crc, crcOf(edited), "persisted");
  assert.equal(P.list().length, 1);

  // A profile named for the controller: v1.8 has no name block, so it becomes v1.9, as the
  // official codec encodes any profile with a name.
  const { DEFAULT_PROFILE } = await import("./defaults.js");
  const long = "โปรไฟล์สำหรับเกมยิงระยะไกลมากๆ"; // > 40 bytes
  const n8 = named(DEFAULT_PROFILE, long);
  assert.equal(cfgOf(DEFAULT_PROFILE).version, "1.8");
  // "Move to library" writes the default as it is: it must pass the hardware rules unchanged.
  same(toWrite(DEFAULT_PROFILE), DEFAULT_PROFILE);
  assert.deepEqual(cfgOf(DEFAULT_PROFILE).layers.map((l) => [l.layer_id, l.mappings.length, l.macros.length]), [[0, 0, 0]]);
  assert.equal(cfgOf(DEFAULT_PROFILE).gyroscope.mode, "disable");
  assert.equal(cfgOf(n8).version, "1.9");
  assert.equal(cfgOf(n8).name, fit(long));
  const strip = (c) => ({ ...c, version: 0, name: 0, offsets: 0, macro_names: 0 });
  assert.deepEqual(strip(cfgOf(n8)), strip(cfgOf(DEFAULT_PROFILE)), "only the version and the name change");

  // A slot the official app left with layers out of order is stored, and written, in order.
  const three = applyEdits(sample, { "layer.2.new": true, "map.0.M1.simple": { type: "layer_hold", layer: 2 } });
  const gap = three.slice();
  gap[4 + cfgOf(three).offsets.layers[2].from] = 3;
  const c = crc(gap.subarray(4));
  gap[2] = c & 255; gap[3] = c >> 8;
  assert.deepEqual(cfgOf(gap).layers.map((l) => l.layer_id), [0, 1, 3]);
  assert.deepEqual(cfgOf(toWrite(gap)).layers.map((l) => l.layer_id), [0, 1, 2], "a whole-profile write puts layers in order too");
  const { profile: g } = P.add("Gap", gap);
  assert.deepEqual(cfgOf(P.data(g)).layers.map((l) => l.layer_id), [0, 1, 2]);
  // A profile the rules refuse is not kept, and a whole-profile write of it stops.
  // A hold to a layer there is not: find the hold's layer byte by comparing with a hold to layer 1.
  const to1 = applyEdits(three, { "map.0.M1.simple": { type: "layer_hold", layer: 1 } });
  const broken = three.slice();
  broken[three.findIndex((x, i) => i > 3 && x !== to1[i])] = 7;
  const bc = crc(broken.subarray(4));
  broken[2] = bc & 255; broken[3] = bc >> 8;
  assert.throws(() => toWrite(broken), /ไม่เขียนลงจอย: ปุ่ม M1 ใน Base layer สลับไป layer 7 ที่ไม่มี/);
  assert.throws(() => P.add("Broken", broken));
  assert.equal(P.list().length, 2);
  assert.ok(PROFILES_MAX >= 16);
}
console.log("profiles ok");

// 0xA1 on the owner's controller (2026-10-23): slot 2 in use, and Slot 3 holding the same profile
// the app had put there. The CRC16 list runs slot 1..4: the slot in use is at its own index, equal
// to the wrapper CRC of the RAM 0x05 read, and two slots with equal bytes report equal CRC16s.
{
  const { parseSlotStatus } = await import("./protocol.js");
  const f = new Uint8Array(63);
  f.set([0x5a, 0xa5, 0xa1, 0x01, 0x00, 0x01, 0x47, 0x66, 0x61, 0x57, 0x61, 0x57, 0x81, 0x51, 0xb5, 0xd4]);
  f[31] = 0x1b;
  const s = parseSlotStatus(parseReply(f).payload);
  assert.equal(s.activeSlot, 1);
  assert.deepEqual(s.slotCrc16, [0x6647, 0x5761, 0x5761, 0x5181]);
  const wrapperHead = [0xf4, 0x04, 0x61, 0x57]; // first 0xA3 chunk of RAM 0x05 in the same log
  assert.equal(s.slotCrc16[s.activeSlot], wrapperHead[2] | (wrapperHead[3] << 8));
  const { slotsOf } = await import("./profiles.js");
  assert.deepEqual(slotsOf({ crc: 0x5761, data: "" }, s.slotCrc16), [1, 2], "the profile shows in both slots that hold it");
}
console.log("slot status ok");

// A slot's name while another slot is in use: the name it had when read, as long as its CRC16 holds.
{
  const { SlotSeen } = await import("./names.js");
  const { resolveNames } = await import("./model.js");
  const { Names } = await import("./names.js");
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const st = mem();
  const named = applyEdits(sample, { "profile.name": "Helldriver2" });
  const crc = named[2] | (named[3] << 8);
  const S = { uuid: "U", names: new Names(mem()), seen: new SlotSeen(st), current: { cfg: unwrapMapping(named).cfg, slot: 1, wrapped: named } };
  resolveNames(S); // reading slot 2 remembers its name
  assert.equal(new SlotSeen(st).name("U", 1, crc), "Helldriver2", "persisted, found while slot 2 is unchanged");
  assert.equal(S.seen.name("U", 1, crc ^ 1), undefined, "changed since (official app, another PC): not shown");
  assert.equal(S.seen.name("V", 1, crc), undefined, "per controller");
  assert.equal(S.seen.name("U", 2, crc), undefined, "per slot");
}
console.log("slot names ok");

// 0xA2 on the owner's controller (2026-10-23): switching to slot 3 replied in the 0xA1 layout with
// the new active slot, and the controller's light followed.
{
  const { parseSlotStatus } = await import("./protocol.js");
  const f = new Uint8Array(63);
  f.set([0x5a, 0xa5, 0xa2, 0x01, 0x00, 0x02, 0x10, 0x25, 0x61, 0x57, 0x10, 0x25, 0x81, 0x51, 0xb5, 0xd4]);
  f[31] = 0x22;
  const s = parseSlotStatus(parseReply(f).payload);
  assert.equal(s.activeSlot, 2);
  assert.deepEqual(s.slotCrc16, [0x2510, 0x5761, 0x2510, 0x5181], "slots 1 and 3 hold the default profile");
}
console.log("slot switch ok");

// Paper v3 review (2026-10-23): the write count matches the review rows. Macro copies no button
// plays leave with the next write, so they count, but only once there is a write to make.
{
  const { Drafts } = await import("./model.js");
  const S = { current: { cfg: wcfg, slot: 1 }, plan: { rows: [{ kind: "remove", layer: 0, id: 0 }, { kind: "remove", layer: 0, id: 1 }], moves: [] } };
  const D = new Drafts(S);
  assert.equal(D.count(), 0, "nothing edited: the copies stay until a write");
  assert.equal(D.count("macros"), 0);
  D.map.set("led.mode", "solid");
  assert.equal(D.count(), 1, "a draft the controller can't take writes nothing, so nothing is removed");
  assert.equal(D.count("macros"), 0);
  D.map.delete("led.mode");
  D.map.set("stick.left.deadzone", 10);
  assert.equal(D.count(), 3, "one edit + two copies removed by its write");
  assert.equal(D.count("macros"), 2, "the Macros tab shows the two");
  assert.equal(D.count("sticks"), 1);
}
console.log("write count ok");

// The Apex 6 Pro has no C/Z and no M5/M6 to press (PRODUCT.md): a new macro step can't offer them.
{
  const { MACRO_PAD } = await import("./model.js");
  for (const b of ["C", "Z", "M5", "M6"]) assert.ok(!MACRO_PAD.includes(b), `macro pad offers ${b}`);
}
console.log("macro pad ok");

// RGB lighting, RAM 0x04 (lighting.js). Layout from the official codec (2026-10-23).
{
  const { decodeLighting, encodeLighting, checkLighting, composeLighting, lightValue } = await import("./lighting.js");
  const { LIGHT_DEFAULT, LIGHT_EMPTY } = await import("./mock-device.js");
  const { Drafts, writeEdits, macroPlan } = await import("./model.js");
  // The official site's default. Its wrapper CRC16 (0xAB26) matches no CRC16 of the blob and the
  // official reader skips it, so only LGHT's own checksums are checked.
  const d = decodeLighting(LIGHT_DEFAULT);
  assert.deepEqual(d, { version: 2, mode: "streaming", bright: 25, speed: 51, colors: [], vibration: false });
  const re = encodeLighting(d, { keptSpeed: 51 });
  assert.ok(sameBytes(re.subarray(4), LIGHT_DEFAULT.subarray(4)) && re[0] === 22, "re-encodes the same blob");
  assert.equal(re[2] | (re[3] << 8), crc16(re.subarray(4)), "written with the CRC16 the official app writes");
  assert.deepEqual(decodeLighting(LIGHT_EMPTY), { empty: true }, "a slot never set reads RGBD");
  const bad = LIGHT_DEFAULT.slice();
  bad[17] = 26;
  assert.throws(() => decodeLighting(bad), /checksum ของข้อมูล/);
  const badHead = LIGHT_DEFAULT.slice();
  badHead[8] = 3;
  assert.throws(() => decodeLighting(badHead), /checksum ของ header/);
  assert.throws(() => decodeLighting(LIGHT_DEFAULT.subarray(0, 20)), /ความยาว/);
  // Every mode round-trips.
  for (const L of [
    { mode: "off", bright: null, speed: null, colors: [], vibration: false },
    { mode: "solid", bright: 80, speed: null, colors: ["#E0303A"], vibration: true },
    { mode: "breathing", bright: 0, speed: 10, colors: ["#FFD700"], vibration: false },
    { mode: "gradient", bright: 100, speed: 100, colors: Array(8).fill("#3080FF"), vibration: false },
    { mode: "default", bright: 80, speed: 50, colors: [], vibration: false },
  ]) {
    const w = encodeLighting(L);
    assert.deepEqual(decodeLighting(w), { version: 2, ...L });
    assert.equal(w[0] | (w[1] << 8), w.length);
  }
  // checkLighting: the limits of the controller and the official app, edges included.
  const ok = { mode: "gradient", bright: 50, speed: 50, colors: ["#FFFFFF"], vibration: false };
  checkLighting(ok);
  for (const [bad, re] of [
    [{ mode: "rainbow" }, /โหมด/],
    [{ bright: 101 }, /ความสว่าง/],
    [{ bright: -1 }, /ความสว่าง/],
    [{ bright: 50.5 }, /ความสว่าง/],
    [{ speed: 0 }, /ความเร็ว/],
    [{ speed: 110 }, /ความเร็ว/],
    [{ speed: 55 }, /ความเร็ว/],
    [{ colors: [] }, /สี/],
    [{ colors: Array(9).fill("#FFFFFF") }, /สี/],
    [{ colors: ["red"] }, /#RRGGBB/],
    [{ mode: "solid", colors: ["#FFFFFF", "#000000"] }, /1 สี/],
  ]) assert.throws(() => checkLighting({ ...ok, ...bad }), re, JSON.stringify(bad));
  checkLighting({ ...ok, speed: 51 }, { keptSpeed: 51 });
  assert.throws(() => encodeLighting({ ...ok, bright: 200 }), /ไม่เขียนไฟลงจอย/, "encode checks first");
  // Off needs nothing else.
  checkLighting({ mode: "off", bright: null, speed: null, colors: [], vibration: false });

  // Drafts: led keys write to RAM 0x04 only once lighting was read, never into the profile.
  const S = { current: { cfg: wcfg, slot: 1 }, light: { wrapped: LIGHT_DEFAULT, cfg: d, slot: 1 }, lib: { list: () => [] } };
  const D = new Drafts(S);
  assert.equal(D.get("led.mode"), "streaming");
  assert.equal(D.get("led.speed"), 5, "speed byte 51 shows as level 5");
  D.set("led.bright", 60);
  let lw = D.lightWrite();
  assert.deepEqual(lw.light, { mode: "streaming", bright: 60, speed: 51, colors: [], vibration: false }, "an untouched speed keeps its byte");
  assert.deepEqual(D.writable(), {}, "nothing for the profile");
  D.set("led.speed", 7);
  assert.equal(D.lightWrite().light.speed, 70);
  D.set("led.mode", "solid");
  D.set("led.color", "#00FF00");
  lw = D.lightWrite();
  assert.deepEqual(lw.light, { mode: "solid", bright: 60, speed: null, colors: ["#00FF00"], vibration: false });
  assert.deepEqual(lw.keys.sort(), ["led.bright", "led.color", "led.mode", "led.speed"]);
  encodeLighting(lw.light, { keptSpeed: d.speed });
  D.set("led.mode", "gradient");
  assert.deepEqual(D.lightWrite().light.colors, ["#FFD700"], "a new color set starts from gold, as the official app");
  // A slot never set: modes start from the official app's defaults.
  const S2 = { ...S, light: { wrapped: LIGHT_EMPTY, cfg: { empty: true }, slot: 1 } };
  const D2 = new Drafts(S2);
  assert.equal(D2.get("led.mode"), null);
  D2.set("led.mode", "breathing");
  assert.deepEqual(D2.lightWrite().light, { mode: "breathing", bright: 80, speed: 50, colors: ["#FFD700"], vibration: false });
  assert.equal(lightValue({ empty: true }, "led.bright"), 80);
  // Lighting that couldn't be read stays a draft.
  const D3 = new Drafts({ ...S, light: null });
  D3.set("led.mode", "off");
  assert.equal(D3.lightWrite(), null);
  assert.equal(D3.items()[0].writable, false);
  // The profile write leaves led drafts to the lighting step.
  const { drafts } = writeEdits(D, { edits: {}, links: [], rows: [], errors: [] });
  assert.deepEqual(drafts, []);
  assert.equal(composeLighting(d, (k) => lightValue(d, k)).speed, 51);
  // A write of lighting alone leaves the profile alone: macro copies no button plays stay (demo, 2026-10-23).
  const { profileDrafts } = await import("./model.js");
  const SL = { ...S, plan: { rows: [{ kind: "remove", layer: 0, id: 0 }], moves: [] } };
  const DL = new Drafts(SL);
  DL.set("led.bright", 60);
  assert.equal(profileDrafts(SL, DL), false);
  assert.equal(DL.count(), 1, "the copy is not counted for removal");
  assert.deepEqual(writeEdits(DL, { edits: { "macro.0.0.delete": true }, profile: false }).edits, {}, "and not removed");
  DL.set("stick.left.deadzone", 10);
  assert.equal(profileDrafts(SL, DL), true);
  assert.equal(DL.count(), 3);
}
console.log("lighting ok");

// "สร้างสีเอง" on Lighting: made colors kept by the app, at most CUSTOM_MAX, deletable.
{
  const { CustomColors, CUSTOM_MAX, PRESETS, hexToHsv, hsvToHex, normHex } = await import("./lighting.js");
  const mem = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  };
  const st = mem();
  const C = new CustomColors(st);
  assert.deepEqual(C.list(), []);
  assert.equal(C.add("#00b8a9"), "added");
  assert.equal(C.add("00B8A9"), "known", "same color in any case or without # is not added twice");
  assert.equal(C.add(PRESETS[0]), "known", "a ready color is not copied into the row");
  assert.throws(() => C.add("#12345"), /#RRGGBB/);
  assert.deepEqual(new CustomColors(st).list(), ["#00B8A9"], "kept across loads");
  for (let i = 1; i < CUSTOM_MAX; i++) assert.equal(C.add(`#00000${i}`), "added");
  assert.equal(C.add("#123456"), "full", "the row holds at most CUSTOM_MAX");
  assert.equal(C.list().length, CUSTOM_MAX);
  // Delete: the one asked, any case; a color not in the row is a no-op.
  assert.equal(C.remove("#00b8a9"), true);
  assert.equal(C.remove("#00B8A9"), false);
  assert.ok(!new CustomColors(st).list().includes("#00B8A9"), "the delete is kept");
  assert.equal(C.add("#123456"), "added", "room again after a delete");
  // Broken or hand-edited storage doesn't break the page.
  const bad = mem();
  bad.setItem("apex6.customColors", "{oops");
  assert.deepEqual(new CustomColors(bad).list(), []);
  bad.setItem("apex6.customColors", JSON.stringify(["#ff0000", "nope", "#FF0000", ...Array(10).fill(0).map((_, i) => `#1111${i}${i}`)]));
  const loaded = new CustomColors(bad).list();
  assert.equal(loaded[0], "#FF0000");
  assert.equal(loaded.length, CUSTOM_MAX, "deduped, invalid dropped, capped");
  assert.doesNotThrow(() => new CustomColors(null).add("#ABCDEF"), "works without storage");
  // Picker conversions round-trip every ready color and the edges.
  for (const h of [...PRESETS, "#000000", "#FF0000", "#00B8A9", "#808080"]) assert.equal(hsvToHex(hexToHsv(h)), h, h);
  assert.equal(normHex(" 00b8a9 "), "#00B8A9");
  assert.equal(normHex("#GGGGGG"), null);
}
console.log("custom colors ok");

// Keyboard targets (PROTOCOL.md "Keyboard targets"): HID usage + modifier bits, a modifier alone is
// key 0xFF. The capture box turns key events into these; checkProfile refuses what isn't a key.
{
  const { applyEdits, checkProfile, crc16: crc } = await import("./mapping-edit.js");
  const { KEY_GROUPS, MOD_ONLY, keyOfCode, keyCaps, keyLabel, keyProblem, modsOfEvent, MOD_CODE } = await import("./keys.js");
  const keys = KEY_GROUPS.flatMap((g) => g.keys);
  assert.equal(new Set(keys.map((k) => k.key)).size, keys.length, "one entry per HID usage");
  assert.equal(new Set(keys.map((k) => k.code)).size, keys.length, "one entry per event.code");
  for (const k of keys) assert.equal(keyProblem(k.key, 0), null, k.label);
  // Values from the official site's table.
  assert.deepEqual(["KeyA", "KeyM", "KeyZ", "Digit1", "Digit0", "Enter", "Escape", "F1", "F12", "Space", "ArrowRight", "ArrowUp", "Numpad9"].map((c) => keyOfCode(c).key), [4, 16, 29, 30, 39, 40, 41, 58, 69, 44, 79, 82, 97]);
  assert.equal(keyOfCode("PrintScreen"), null, "not in the official picker");
  // F13–F24 (HID 104–115): F24 gave nothing on the owner's PC, so none of the block is offered.
  assert.equal(keyOfCode("F24"), null);
  assert.equal(keyOfCode("F13"), null);
  assert.equal(keyLabel(115, 1), "Ctrl + F24", "still named when read from a profile");
  assert.equal(keyOfCode("ShiftLeft"), null, "modifiers are bits, not keys");
  assert.equal(MOD_CODE.ShiftRight, 2, "right-hand modifiers are written as the left bit");
  assert.equal(modsOfEvent({ ctrlKey: true, shiftKey: true }), 3);
  assert.equal(keyLabel(16, 3), "Ctrl + Shift + M");
  assert.deepEqual(keyCaps(MOD_ONLY, 4), ["Alt"]);
  assert.deepEqual(keyCaps(0x46, 16), ["R Ctrl", "คีย์ 0x46"], "keys from elsewhere still show");

  const at = (w) => decodeMapping(w).layers[0].mappings.find((m) => m.source === "M1").activators.find((a) => a.type === "simple").target;
  const w = applyEdits(sample, { "map.0.M1.simple": { type: "btn_keyboard", key: 16, modifier: 3 } });
  assert.deepEqual(at(w), { type: "btn_keyboard", key: 16, modifier: 3 });
  checkProfile(w);
  const alone = applyEdits(sample, { "map.0.M1.simple": { type: "btn_keyboard", key: MOD_ONLY, modifier: 2 } });
  assert.deepEqual(at(alone), { type: "btn_keyboard", key: 0xff, modifier: 2 });
  checkProfile(alone);
  // Find the key byte by comparing two keys, then poke it (and the modifier) to what the firmware can't use.
  const w2 = applyEdits(sample, { "map.0.M1.simple": { type: "btn_keyboard", key: 17, modifier: 3 } });
  const ki = w.findIndex((x, i) => i > 3 && x !== w2[i]);
  const poke = (key, mod) => {
    const b = w.slice();
    b[ki] = key;
    b[ki + 1] = mod;
    const c = crc(b.subarray(4));
    b[2] = c & 255; b[3] = c >> 8;
    return b;
  };
  checkProfile(poke(0xe7, 0));
  checkProfile(poke(103, 0));
  assert.throws(() => checkProfile(poke(115, 0)), /F24 จอยส่งไปไม่ถึง Windows/);
  assert.throws(() => checkProfile(poke(104, 1)), /F13 จอยส่งไปไม่ถึง Windows/);
  assert.throws(() => checkProfile(poke(110, 0)), /F19/);
  checkProfile(poke(116, 0));
  assert.throws(() => checkProfile(poke(0xff, 0)), /ไม่เขียนลงจอย: ปุ่ม M1 ใน Base layer: คีย์ 0xFF ต้องมี/);
  assert.throws(() => checkProfile(poke(0, 1)), /ไม่ใช่คีย์บอร์ด/);
  assert.throws(() => checkProfile(poke(3, 0)), /ไม่ใช่คีย์บอร์ด/);
  assert.throws(() => checkProfile(poke(0xe8, 0)), /ไม่ใช่คีย์บอร์ด/);
}
console.log("keyboard ok");

// Presses confirmed on hardware: keyboard, gamepad, layer hold, macro. Mouse, turbo and layer toggle not yet.
{
  const { hwTested } = await import("./mapping-edit.js");
  assert.equal(hwTested("map.0.M1.simple", { type: "btn_keyboard", key: 14, modifier: 2 }), true);
  assert.equal(hwTested("map.1.A.long", { type: "btn_keyboard", key: 14, modifier: 0 }), true);
  assert.equal(hwTested("map.0.M1.simple", { type: "btn_keyboard", key: 69, modifier: 0 }), true, "F12");
  assert.equal(hwTested("map.0.M1.simple", { type: "btn_mouse", mouse: 0 }), false);
  assert.equal(hwTested("map.0.M4.simple", { type: "layer_hold", layer: 1 }), true);
  assert.equal(hwTested("map.0.M4.double", { type: "layer_toggle", layer: 1 }), false);
  assert.equal(hwTested("map.1.A.simple", { type: "macro", uid: "m1" }), true);
  assert.equal(hwTested("map.1.A.simple", { type: "btn_gamepad", button: "B" }), true);
  assert.equal(hwTested("map.0.A.simple", { type: "turbo_gamepad", button: "A", interval_ms: 80 }), false);
  assert.equal(hwTested("macro.1.0.set"), true, "a macro copied into a layer");
  assert.equal(hwTested("macro.1.0.delete"), false);
  assert.equal(hwTested("macro.1.0.name"), false);
  assert.equal(hwTested("map.0.M1.simple", undefined), false);
  assert.equal(hwTested("gyro.mode"), true);
  assert.equal(hwTested("runtime.long", { type: "btn_keyboard" }), false, "only button presses go by type");
}
console.log("hw tested ok");

// Deleting a layer (owner, 2026-10-23): asked first, then the layer is gone from the page, with what
// was set in it, and a press that switched to it shows what the write leaves (dropActivators).
{
  const V = await import("./views.js");
  const { Drafts, layerKey } = await import("./model.js");
  const hold1 = { type: "layer_hold", layer: 1 };
  const cfg = {
    name: "", links: {}, macro_names: [], runtime: { long_press_ms: 300, double_press_ms: 400 },
    layers: [
      { layer_id: 0, macros: [], mappings: [
        { source: "M3", identity: false, activators: [{ type: "simple", target: hold1 }] },
        { source: "M4", identity: false, activators: [{ type: "timing_single", target: { type: "btn_gamepad", button: "M4" } }, { type: "timing_long", target: hold1 }, { type: "timing_double", target: { type: "btn_gamepad", button: "A" } }] },
      ] },
      { layer_id: 1, macros: [], mappings: [{ source: "RB", identity: false, activators: [{ type: "simple", target: { type: "btn_gamepad", button: "LB" } }] }] },
    ],
  };
  const S = { current: { cfg, slot: 0 }, ui: { layer: 0, sel: "M3", press: "simple", dpad: "D-pad ↑", layerMenu: null }, lib: { list: () => [], get: () => null }, plan: null, slots: { activeSlot: 0 } };
  const D = new Drafts(S);
  const ask = V.layerDelete(S, D, 1);
  assert.match(ask, /ลบ Shift layer\?/);
  assert.match(ask, /จะหายไป · 1 ปุ่ม/);
  assert.match(ask, /กด M3 ค้างไว้/, "the confirm names the presses that switch to it");
  let page = V.buttons(S, D);
  assert.match(page, /data-act="layer-menu" data-layer="1"/, "a ⋯ menu on the Shift row");
  assert.doesNotMatch(page, /data-act="layer-menu" data-layer="0"/, "Base can't be deleted");
  assert.match(page, /เพิ่มได้อีก 2 layer/);
  D.set(layerKey(1, "delete"), true);
  page = V.buttons(S, D);
  assert.doesNotMatch(page, /<b>Shift layer<\/b>|data-layer="1"/, "a deleted layer is gone from the page");
  assert.match(page, /aria-label="Base layer · กดปกติ: M3"/, "presses that switched to it show what the write leaves");
  assert.match(page, /ค่าบนจอย: Shift layer ขณะกด/, "the controller still holds it until the write");
  assert.doesNotMatch(page, /data-act="pick-src" data-src="M3"/, "M3 ends up default, so it leaves the changed list");
  assert.match(page, /data-act="pick-src" data-src="M4"/, "M4 keeps its double press");
  assert.match(page, /เพิ่มได้อีก 2 layer · ที่ลบไว้จะว่างหลังเขียนลงจอย/, "its id is taken until the write");
  S.ui.sel = "M4";
  page = V.buttons(S, D);
  assert.match(page, /aria-label="Base layer · กดค้าง: ยังไม่กำหนด"/, "the long press to the gone layer is dropped");
  assert.match(page, /aria-label="Base layer · ดับเบิลคลิก: A"/, "the other presses stay");
}
console.log("layer delete ok");

// Layer switches only from Base (owner, 2026-10-23). Hardware: a button that holds a layer also plays
// its own map there (B hold → Shift with Shift's B = K typed k while held), so once B switches layers its
// cells in the other layers are locked to what the app writes: off, or switch back for a toggle.
{
  const V = await import("./views.js");
  const { Drafts } = await import("./model.js");
  const cfg = {
    name: "", links: {}, macro_names: [], runtime: { long_press_ms: 300, double_press_ms: 400 },
    layers: [
      { layer_id: 0, macros: [], mappings: [{ source: "B", identity: false, activators: [{ type: "simple", target: { type: "layer_hold", layer: 1 } }] }] },
      { layer_id: 1, macros: [], mappings: [] },
    ],
  };
  const S = { current: { cfg, slot: 0 }, ui: { layer: 0, sel: "B", press: "simple", dpad: "D-pad ↑", layerMenu: null }, lib: { list: () => [], get: () => null }, plan: null, slots: { activeSlot: 0 } };
  const D = new Drafts(S);
  let page = V.buttons(S, D);
  assert.match(page, /class="mx-c lock" disabled aria-label="Shift layer · กดปกติ: ปิดปุ่ม/, "held layer: B off there");
  assert.match(page, /class="mx-c lock unset" disabled aria-label="Shift layer · กดค้าง: ไม่ใช้/);
  assert.match(page, /class="lock-note"[\s\S]*ใน Shift layer แอปปิด B ไว้/);
  D.set("map.0.B.simple", { type: "layer_toggle", layer: 1 });
  page = V.buttons(S, D);
  assert.match(page, /aria-label="Shift layer · กดปกติ: สลับกลับ Base layer/, "toggle: the same press switches back");
  assert.match(page, /ใน Shift layer กด B อีกครั้งเพื่อกลับ Base layer/);
  D.set("map.0.B.simple", { type: "btn_gamepad", button: "B" });
  page = V.buttons(S, D);
  assert.doesNotMatch(page, /mx-c lock|lock-note/, "a plain button is editable in every layer");
  S.ui.layer = 1;
  assert.match(V.buttons(S, D), /<button class="utab" disabled title="เปลี่ยน layer ตั้งได้ใน Base layer เท่านั้น">เปลี่ยน layer<\/button>/, "no layer switch outside Base");
}
console.log("layer switch from Base only ok");
