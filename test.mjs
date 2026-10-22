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
  const a1 = applyEdits(sample, { "macro.1.0.new": mk1("YABX", "press_once") });
  assert.equal(a1[0] | (a1[1] << 8), a1.length);
  assert.deepEqual(ids(a1, 1), [0]);
  assert.deepEqual(ids(a1, 0), [0, 1]);
  assert.deepEqual(the(a1, 1, 0).actions, seq("YABX"));
  assert.equal(the(a1, 1, 0).trigger_mode, "press_once");
  assert.equal(rest(unwrapMapping(a1).cfg), rest(base), "the rest of the profile did not move");
  assert.deepEqual(the(a1, 0, 1), base.layers[0].macros[1], "other macros are byte-for-byte the same");
  // Entries stay in id order, and a mode can come with the new macro.
  const a2 = applyEdits(a1, { "macro.0.5.new": mk1("AB", "press_once"), "macro.0.2.new": mk1("X", "press_hold"), "macro.0.2.mode": "press_loop_immediate" });
  assert.deepEqual(ids(a2, 0), [0, 1, 2, 5]);
  assert.equal(the(a2, 0, 2).trigger_mode, "press_loop_immediate");
  // Create then delete gives the original bytes back, also with a name in between.
  assert.ok(sameBytes(applyEdits(a1, { "macro.1.0.delete": true }), sample));
  const a3 = applyEdits(sample, { "macro.1.3.new": mk1("Y", "press_once"), "macro.1.3.name": "Reinforce", "stick.left.max": 240 });
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
  for (let i = 2; i < MACRO_MAX; i++) full = applyEdits(full, { [`macro.0.${i}.new`]: mk1("A", "press_once") });
  assert.equal(ids(full, 0).length, MACRO_MAX);
  assert.throws(() => applyEdits(full, { "macro.1.0.new": mk1("A", "press_once"), "macro.0.2.new": mk1("A", "press_once") }), /มี macro #3 อยู่แล้ว/);
  assert.ok(ids(applyEdits(full, { "macro.0.4.delete": true, "macro.0.4.new": mk1("B", "press_once") }), 0).includes(4));
  // Things it must refuse.
  assert.throws(() => applyEdits(sample, { "macro.1.8.new": mk1("A", "press_once") }), /0–7/);
  assert.throws(() => applyEdits(sample, { "macro.7.0.new": mk1("A", "press_once") }), /ไม่มี layer 7/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.new": { mode: "press_once", actions: [] } }), /อย่างน้อย 1 ขั้น/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.new": mk1("A", "dance") }), /วิธีเล่นไม่รู้จัก/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.new": { mode: "press_once", actions: [{ action: "press", target: { type: "btn_keyboard", key: 4 }, at_ms: 0 }] } }), /เฉพาะปุ่มจอย/);
  assert.throws(() => applyEdits(sample, { "macro.1.0.new": { mode: "press_once", actions: [...seq("A"), { action: "press", target: { type: "btn_gamepad", button: "A" }, at_ms: 10 }] } }), /เรียงจากน้อยไปมาก/);
  assert.throws(() => applyEdits(sample, { "macro.0.7.delete": true }), /ไม่มี macro #8/);
  assert.throws(() => applyEdits(sample, { "macro.0.0.mode": "press_hold" }), /ที่มีอยู่แล้ว/);

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
  // The Macros page's view of it: drafts, grouping by layer, the review rows.
  const { Drafts, macroLayers, nextMacroId, macroKey } = await import("./model.js");
  const act = (b, i) => [
    { action: "press", target: { type: "btn_gamepad", button: b }, at_ms: i * 100 },
    { action: "release", target: { type: "btn_gamepad", button: b }, at_ms: i * 100 + 50 },
  ];
  const S2 = { current: { cfg: unwrapMapping(sample).cfg, slot: 1, wrapped: sample } };
  const D2 = new Drafts(S2);
  D2.set(macroKey(1, 0, "new"), { mode: "press_once", actions: [...act("Y", 0), ...act("A", 1)] });
  D2.set(macroKey(0, 0, "delete"), true);
  const g = macroLayers(S2, D2);
  assert.deepEqual(g.map((x) => [x.layer, x.items.map((i) => [i.id, i.isNew, i.deleted])]), [[0, [[0, false, true], [1, false, false]]], [1, [[0, true, false]]]]);
  assert.deepEqual(g.map((x) => x.nextId), [2, 1], "free ids per layer; the id of a macro awaiting deletion stays taken");
  assert.deepEqual(D2.items().map((i) => [i.writable, i.label, i.baseText]), [[true, "สร้าง Macro 1 · Shift layer", "ยังไม่มี"], [true, "ลบ Macro 1 · Base layer", undefined]]);
  assert.equal(D2.items()[1].fmt(true), "ลบ");
  assert.equal(D2.items()[0].fmt(D2.map.get(macroKey(1, 0, "new"))), "2 ขั้น · กดครั้งเดียว เล่นจบ");
  assert.equal(D2.count("macros"), 2);
  assert.equal(nextMacroId(S2.current.cfg, new Drafts(S2), 0), 2);
  const wrote = applyEdits(sample, D2.writable());
  assert.deepEqual(unwrapMapping(wrote).cfg.layers.map((l) => l.macros.map((m) => m.macro_id)), [[1], [0]]);
  S2.current = { cfg: unwrapMapping(wrote).cfg, slot: 1, wrapped: wrote };
  D2.prune();
  assert.equal(D2.count(), 0, "after the write both drafts are done with");
  D2.set(macroKey(0, 5, "delete"), true);
  D2.prune();
  assert.equal(D2.count(), 0, "a delete of a macro that is not there is dropped");
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
  // Reset to factory default (what "ตั้งเป็นค่าเริ่มต้น" drafts): the entry goes, long and double with it.
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
  assert.ok(sameBytes(applyEdits(applyEdits(sample, { "layer.3.new": true }), { "layer.3.delete": true }), sample));
  // Deleting a layer takes its macros, their names and the presses that switched to it.
  const named = applyEdits(l1, { "macro.2.0.new": { mode: "press_once", actions: [{ action: "press", target: { type: "btn_gamepad", button: "A" }, at_ms: 0 }, { action: "release", target: { type: "btn_gamepad", button: "A" }, at_ms: 50 }] }, "macro.2.0.name": "Peek" });
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
  assert.equal(labelTarget(D3.get("map.0.M1.simple")), "กดค้างเข้า Layer 2");
  assert.deepEqual(layerSwitches(S3, D3).map((s) => [s.layer, s.source, s.type, s.to]), [[0, "M1", "layer_hold", 2]]);
  assert.deepEqual(D3.items().map((i) => [i.writable, i.label]), [[true, "เพิ่ม Layer 2"], [true, "ลบ Shift layer"], [true, "ปุ่ม M1 · กดปกติ"], [true, "ปุ่ม A (Layer 2) · กดปกติ"]]);
  const out = applyEdits(sample, D3.writable());
  assert.deepEqual(unwrapMapping(out).cfg.layers.map((l) => l.layer_id), [0, 2]);
  S3.current = { cfg: unwrapMapping(out).cfg, slot: 1, wrapped: out };
  D3.prune();
  assert.equal(D3.count(), 0, "after the write every draft is done with");
}
console.log("button maps and layers ok");

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
  f[31] = sum(f, 2, 31);
  push(f);
  const bad = f.slice(); bad[31] ^= 1; push(bad);
  assert.deepEqual(sticks, [{ lx: 32767, ly: -100, rx: 5, ry: -32768, buttons: 0x81, lt: 200, rt: 7 }]);
  off(); push(f); assert.equal(sticks.length, 1);

  push(reply(0x21, [1, 0], [...new TextEncoder().encode("KEY_DOWN GP_M1"), 0, 0x41]));
  assert.deepEqual(events, ["KEY_DOWN GP_M1"]);
  push(reply(0x01, [1, 0], [1, 2, 3]));
  assert.equal(events.length, 1);
}
console.log("live ok");
