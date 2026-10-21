import assert from "node:assert/strict";
import { Apex6, buildFrame, parseReply } from "./protocol.js";

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
