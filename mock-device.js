// In-memory Apex 6 for ?demo: serves samples/mapping_slot2.bin over a fake WebHID device,
// including slot switching and the 0xA4 write path, so the whole UI works without hardware.
// Nothing here talks to a real controller.

import { crc32 } from "./protocol.js";
import { applyEdits } from "./mapping-edit.js";

const sum = (b, f, t) => {
  let s = 0;
  for (let i = f; i < t; i++) s = (s + b[i]) & 255;
  return s;
};
const reply = (cmd, head, payload) => {
  const f = new Uint8Array(63);
  const body = [0x5a, 0xa5, cmd, ...head, ...payload];
  f.set(body);
  f[body.length] = sum(f, 2, body.length);
  return f;
};
const le16 = (v) => [v & 255, v >> 8];
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
const be16 = (v) => [v >> 8, v & 255];

export async function createMockDevice() {
  const sample = new Uint8Array(await (await fetch("./samples/mapping_slot2.bin")).arrayBuffer());
  // Four slots that differ a little, so their CRCs differ like on a real controller.
  const slots = [
    applyEdits(sample, { "stick.left.deadzone": 8, "stick.right.deadzone": 8, "gyro.mode": "right_joystick" }),
    sample.slice(),
    applyEdits(sample, { "trigger.left.start": 30, "trigger.right.start": 30 }),
    applyEdits(sample, { "stick.left.deadzone": 0, "stick.right.deadzone": 0 }),
  ];
  let active = 1;
  const ram = { 1: new Uint8Array(82), 4: new Uint8Array(64), 6: new Uint8Array(32) };
  const buf = (id) => (id === 5 ? slots[active] : ram[id]);
  let pending = null;
  // Live input for Sticks and Triggers: with dinput on, stream 0xEF frames (left stick circles,
  // LT and RT ramp in turn);
  // with key events on, press and release A every 2 s.
  let stream = null, keys = null;
  const emit = (f) => dev.listeners.forEach((l) => l({ data: new DataView(f.buffer) }));
  const stickFrame = (t) => {
    const f = new Uint8Array(32), v = new DataView(f.buffer);
    f.set([0x5a, 0xa5, 0xef]);
    v.setInt16(3, Math.round(Math.cos(t) * 30000), true);
    v.setInt16(5, Math.round(Math.sin(t) * 30000), true);
    f[15] = Math.round(Math.max(0, Math.sin(t)) * 255);
    f[16] = Math.round(Math.max(0, -Math.sin(t)) * 255);
    // Bytes 17..28: made-up gyro (3 slow waves) and accel (gravity on the 6th) for the Gyro page.
    [Math.sin(t * 2) * 3000, Math.sin(t * 0.7) * 800, 0, 40, -60, 4096 + Math.sin(t) * 200]
      .forEach((x, i) => v.setInt16(17 + i * 2, Math.round(x), true));
    f[31] = sum(f, 2, 31);
    return f;
  };
  const event = (text) => reply(0x21, [1, 0], [...new TextEncoder().encode(text), 0]);

  const dev = {
    opened: false,
    vendorId: 0x37d7,
    productId: 0x2502,
    productName: "Apex 6 Pro (ตัวอย่าง)",
    collections: [{ usagePage: 0xffa0, outputReports: [{ reportId: 0, items: [{ reportCount: 63 }] }] }],
    listeners: [],
    addEventListener(_, f) {
      this.listeners.push(f);
    },
    removeEventListener(_, f) {
      this.listeners = this.listeners.filter((x) => x !== f);
    },
    async open() {
      this.opened = true;
    },
    async close() {
      this.opened = false;
      clearInterval(stream);
      clearInterval(keys);
      stream = keys = null;
    },
    async sendReport(id, data) {
      const cmd = data[2], p = data.slice(4, 4 + data[3] - 2);
      const u16 = (o) => p[o] | (p[o + 1] << 8), u32 = (o) => (u16(o) | (u16(o + 2) << 16)) >>> 0;
      const crcOf = (s) => slots[s][2] | (slots[s][3] << 8);
      const status = () => [active, ...[0, 1, 2, 3].flatMap((s) => le16(crcOf(s))), ...le16(0x5a17)];
      let r;
      if (cmd === 0x11) {
        // No reply, like the real controller.
        if (p[1] === 1 && !stream) {
          const t0 = Date.now();
          stream = setInterval(() => emit(stickFrame((Date.now() - t0) / 1500)), 50);
        } else if (p[1] === 0) {
          clearInterval(stream);
          stream = null;
        }
        return;
      }
      if (cmd === 0x20) {
        const text = new TextDecoder().decode(p);
        clearInterval(keys);
        keys = null;
        if (text === "ENABLE_KEY_EVENT") {
          let down = false;
          keys = setInterval(() => emit(event(`${(down = !down) ? "KEY_DOWN" : "KEY_UP"} GP_A`)), 1000);
        }
        r = reply(0x20, [1, 0], [0]);
      } else if (cmd === 0x01) {
        const pl = [0x06, 1, ...le32(0x3f2ac91e), (1 << 4) | 8, 0x11, 1, 0,
          ...be16(0x9055), ...be16(0x9021), ...be16(0x0103), ...be16(0x0210), ...be16(0x0305), ...be16(0x0101), ...be16(0x0001), 0b10111011];
        r = reply(1, [1, 0], pl);
      } else if (cmd === 0x04) r = reply(4, [1, 0], Array.from({ length: 16 }, (_, i) => (0x3f + i * 29) & 255));
      else if (cmd === 0x07) r = reply(7, [1, 0], [...le16(3), ...le16(12), ...le16(2)]);
      else if (cmd === 0x0f) r = reply(0x0f, [1, 0], [1, ...new TextEncoder().encode("GPA6 Pro")]);
      else if (cmd === 0xa1) r = reply(0xa1, [1, 0], status());
      else if (cmd === 0xa2) {
        if (p[0] < 4) active = p[0];
        r = reply(0xa2, [1, 0], status());
      } else if (cmd === 0xa3 && p[0] === 1) {
        const b = buf(p[1]);
        r = reply(0xa3, [], [1, 0, p[1], active, ...le16(b.length), ...le32(crc32(b))]);
      } else if (cmd === 0xa3) {
        const [op, rid, idx, size] = p, b = buf(rid), c = b.slice(idx * size, (idx + 1) * size);
        r = reply(0xa3, [], [op, 0, rid, active, ...le16(b.length), idx, c.length, ...c]);
      } else if (cmd === 0xa4 && p[0] === 0) {
        pending = { ram: p[1], crc: u32(4), buf: new Uint8Array(u16(2)) };
        r = reply(0xa4, [], [0, 0, p[1]]);
      } else if (cmd === 0xa4 && p[0] === 1) {
        pending.buf.set(p.slice(4, 4 + p[3]), u16(1));
        r = reply(0xa4, [], [1, 0, pending.ram]);
      } else if (cmd === 0xa4 && p[0] === 2) {
        const c = crc32(pending.buf);
        if (c === pending.crc) {
          if (pending.ram === 5) slots[active] = pending.buf;
          else ram[pending.ram] = pending.buf;
        }
        r = reply(0xa4, [], [2, 0, pending.ram, active, ...le16(pending.buf.length), ...le32(c)]);
        pending = null;
      } else if (cmd === 0xa4 && p[0] === 3) {
        pending = null;
        r = reply(0xa4, [], [3, 0, 0]);
      } else r = reply(cmd, [0, 0], [3]);
      setTimeout(() => this.listeners.forEach((f) => f({ data: new DataView(r.buffer) })), 4);
    },
  };
  return dev;
}
