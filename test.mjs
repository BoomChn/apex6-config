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
