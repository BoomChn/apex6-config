// Flydigi Apex 6 Pro (GPA6) HID protocol — read-only subset.
// Derived from observing space_station.flydigi.com; see PROTOCOL.md.

export const VENDOR_ID = 0x37d7;
export const PRODUCT_IDS = [0x2502, 0x2401];
export const USAGE_PAGE = 0xffa0;
export const HID_FILTERS = PRODUCT_IDS.map((productId) => ({
  vendorId: VENDOR_ID,
  productId,
  usagePage: USAGE_PAGE,
}));

const SYNC0 = 0x5a;
const SYNC1 = 0xa5;
const MAX_FRAME = 32;

export const CMD = {
  DEVICE_INFO: 0x01,
  UUID: 0x04,
  CONFIG_VERSIONS: 0x07,
  SKU: 0x0f,
  THIRDPARTY_STATUS: 0x10,
  SLOT_STATUS: 0xa1,
  RAM_READ: 0xa3,
  LCD_SETTINGS: 0xac,
};

export const RAM = { GLOBAL: 0x01, LIGHTING: 0x04, MAPPING: 0x05, RAM_6: 0x06 };

function sum8(bytes, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s = (s + bytes[i]) & 0xff;
  return s;
}

// 5A A5 <cmd> <payloadLen+2> <payload...> <sum8 of bytes[2..n-1)>
export function buildFrame(cmd, payload = new Uint8Array(0)) {
  const len = 4 + payload.length + 1;
  if (len > MAX_FRAME) throw new Error(`Frame too long: ${len}B > ${MAX_FRAME}B`);
  const f = new Uint8Array(len);
  f[0] = SYNC0;
  f[1] = SYNC1;
  f[2] = cmd;
  f[3] = payload.length + 2;
  f.set(payload, 4);
  f[len - 1] = sum8(f, 2, len - 1);
  return f;
}

function findSync(b) {
  let i = 0;
  while (i < b.length - 1 && !(b[i] === SYNC0 && b[i + 1] === SYNC1)) i++;
  return i;
}

// v1 reply: 5A A5 <cmd> <pkgCount> <pkgIndex> <payload...> <sum8>; pkgCount 0 = error.
// Reports are zero-padded, so the frame end is found by scanning for a valid checksum.
export function parseReply(b) {
  const t = findSync(b);
  if (t + 6 > b.length) return null;
  const cmd = b[t + 2], pkgCount = b[t + 3], pkgIndex = b[t + 4];
  for (let end = b.length; end >= t + 6; end--) {
    if (sum8(b, t + 2, end - 1) === b[end - 1]) {
      return { cmd, pkgCount, pkgIndex, payload: b.slice(t + 5, end - 1), isError: pkgCount === 0 };
    }
  }
  const end = Math.min(b.length, t + MAX_FRAME);
  return { cmd, pkgCount, pkgIndex, payload: b.slice(t + 5, end - 1), isError: pkgCount === 0 };
}

// v2.1 reply (0xA3/0xA4): 5A A5 <cmd> <payload...> <sum8>
export function parseReplyV2(b) {
  const t = findSync(b);
  if (t + 4 > b.length) return null;
  const cmd = b[t + 2];
  for (let end = b.length; end >= t + 4; end--) {
    if (sum8(b, t + 2, end - 1) === b[end - 1]) return { cmd, payload: b.slice(t + 3, end - 1) };
  }
  const end = Math.min(b.length, t + MAX_FRAME);
  return { cmd, payload: b.slice(t + 3, end - 1) };
}

const u16le = (b, o) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u16be = (b, o) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32le = (b, o) => (u16le(b, o) | (u16le(b, o + 2) << 16)) >>> 0;
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export class Apex6 {
  constructor(device) {
    this.device = device;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.onTraffic = null;
    this.reportId = 0;
    this.reportSize = 63;
    this._onInput = (e) => {
      const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
      this.onTraffic?.("in", data);
      for (const l of this.listeners) l(data);
    };
  }

  static async request() {
    const [device] = await navigator.hid.requestDevice({ filters: HID_FILTERS });
    if (!device) throw new Error("ไม่ได้เลือกอุปกรณ์");
    return Apex6.open(device);
  }

  static async reconnect() {
    const devices = await navigator.hid.getDevices();
    const device = devices.find(isApex6);
    return device ? Apex6.open(device) : null;
  }

  static async open(device) {
    if (!device.opened) await device.open();
    const a = new Apex6(device);
    const out = pickOutputReport(device);
    a.reportId = out.reportId;
    a.reportSize = out.size;
    device.addEventListener("inputreport", a._onInput);
    return a;
  }

  async close() {
    this.device.removeEventListener("inputreport", this._onInput);
    if (this.device.opened) await this.device.close();
  }

  async _send(frame) {
    const buf = new Uint8Array(this.reportSize);
    buf.set(frame);
    this.onTraffic?.("out", frame);
    await this.device.sendReport(this.reportId, buf);
  }

  // Serialised request/response with retries, mirroring the official client (1500ms × 3).
  _exec(cmd, payload, parse, accept, { timeoutMs = 1500, retries = 3 } = {}) {
    const run = async () => {
      let lastErr;
      for (let i = 0; i < retries; i++) {
        try {
          return await this._once(cmd, payload, parse, accept, timeoutMs);
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(`cmd 0x${cmd.toString(16)} failed: ${lastErr?.message}`);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  _once(cmd, payload, parse, accept, timeoutMs) {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => {
        clearTimeout(timer);
        this.listeners.delete(onData);
        fn(v);
      };
      const onData = (data) => {
        const r = parse(data);
        if (!r || r.cmd !== cmd || (accept && !accept(r))) return;
        if (r.isError) done(reject, new Error(`device error code=${r.payload[0] ?? 0}`));
        else done(resolve, r);
      };
      const timer = setTimeout(() => done(reject, new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
      this.listeners.add(onData);
      this._send(buildFrame(cmd, payload)).catch((e) => done(reject, e));
    });
  }

  request(cmd, payload = new Uint8Array(0), opts) {
    return this._exec(cmd, payload, parseReply, null, opts);
  }

  requestV2(cmd, payload, accept, opts) {
    return this._exec(cmd, payload, parseReplyV2, accept, opts);
  }

  async getDeviceInfo() {
    const p = (await this.request(CMD.DEVICE_INFO)).payload;
    const flags = p[24] ?? 0;
    return {
      deviceId: p[0],
      connectionMode: p[1],
      macAddr: u32le(p, 2).toString(16).padStart(8, "0"),
      batteryLevel: p[6] & 0x0f,
      chargingStatus: (p[6] >> 4) & 0x0f,
      chipTypeMain: p[7] & 0x0f,
      chipTypeRecv: (p[7] >> 4) & 0x0f,
      gyroType: p[8] & 0x0f,
      fw: {
        main: u16be(p, 10),
        receiver: u16be(p, 12),
        si: u16be(p, 14),
        trigger: u16be(p, 16),
        screen: u16be(p, 18),
        adc: u16be(p, 20),
        sstar: u16be(p, 22),
      },
      features: {
        imu: !!(flags & 1),
        led: !!(flags & 2),
        switch: !!(flags & 4),
        screen: !!(flags & 8),
        triggerHaptic: !!(flags & 16),
        triggerVibrate: !!(flags & 32),
        audio: !!(flags & 64),
        haptic: !!(flags & 128),
      },
    };
  }

  async getUuid() {
    return hex((await this.request(CMD.UUID)).payload.slice(0, 16)).replaceAll(" ", "");
  }

  async getSku() {
    const p = (await this.request(CMD.SKU)).payload;
    let end = 21;
    while (end > 1 && p[end - 1] === 0) end--;
    return { value: p[0], name: String.fromCharCode(...p.slice(1, end)) };
  }

  async getConfigVersions() {
    const p = (await this.request(CMD.CONFIG_VERSIONS)).payload;
    return { globalConfigVer: u16le(p, 0), mappingVer: u16le(p, 2), ledVer: u16le(p, 4) };
  }

  async getSlotStatus() {
    const p = (await this.request(CMD.SLOT_STATUS)).payload;
    return {
      activeSlot: p[0],
      slotCrc16: [u16le(p, 1), u16le(p, 3), u16le(p, 5), u16le(p, 7)],
      globalCrc16: u16le(p, 9),
    };
  }

  // 0xA3 op 0: READ_CHUNK <ramId> <chunkIndex> <chunkSize>
  async readRamChunk(ramId, chunkIndex, chunkSize = 16) {
    const r = await this.requestV2(
      CMD.RAM_READ,
      new Uint8Array([0, ramId, chunkIndex, chunkSize]),
      ({ payload: p }) => p[0] === 0 && p[2] === ramId && p[6] === chunkIndex,
    );
    const p = r.payload;
    const size = p[7] ?? 0;
    return {
      status: p[1] ?? 255,
      activeSlot: p[3] ?? 0,
      totalLen: u16le(p, 4),
      chunkIndex: p[6] ?? 0,
      data: p.slice(8, 8 + size),
    };
  }

  async readRam(ramId, onProgress) {
    const first = await this.readRamChunk(ramId, 0);
    if (first.status !== 0) throw new Error(`READ ramId=0x${ramId.toString(16)} status=${first.status}`);
    const total = first.totalLen;
    const out = new Uint8Array(total);
    out.set(first.data.slice(0, total));
    let got = Math.min(first.data.length, total);
    let idx = 1;
    const chunks = Math.max(1, Math.ceil(total / 16));
    onProgress?.(1, chunks);
    while (got < total) {
      const c = await this.readRamChunk(ramId, idx);
      if (c.status !== 0) throw new Error(`READ chunk ${idx} status=${c.status}`);
      if (c.chunkIndex !== idx) throw new Error(`READ chunk ${idx}: got ${c.chunkIndex}`);
      const n = Math.min(c.data.length, total - got);
      if (n === 0) throw new Error(`READ chunk ${idx}: empty`);
      out.set(c.data.slice(0, n), got);
      got += n;
      idx++;
      onProgress?.(idx, chunks);
      if (idx > 4096) throw new Error("READ: too many chunks");
    }
    return { activeSlot: first.activeSlot, data: out };
  }
}

function isApex6(d) {
  return (
    d.vendorId === VENDOR_ID &&
    PRODUCT_IDS.includes(d.productId) &&
    (d.collections ?? []).some((c) => c.usagePage === USAGE_PAGE)
  );
}

function pickOutputReport(device) {
  const cols = device.collections ?? [];
  const ordered = [...cols.filter((c) => c.usagePage === USAGE_PAGE), ...cols];
  for (const c of ordered) {
    const r = c.outputReports?.[0];
    if (r) return { reportId: r.reportId ?? 0, size: r.items?.[0]?.reportCount ?? 63 };
  }
  return { reportId: 0, size: 63 };
}
