// Everything the app keeps (macro library, names, profile library, custom colors, slot backups)
// lives in the browser's localStorage under "apex6.*", and clearing the browser wipes it. The vault
// keeps the same data outside the browser too:
//
// - one file with all of it, to download and bring back (snapshot / replaceAll);
// - a folder on the PC the user picks once: every change is written to apex6-data.json there, and
//   once a day to a dated copy in daily/. A browser cleared of its data gets it all back from the
//   folder when it is picked again.
//
// What the controller holds is not part of this: it stays on the controller.

export const PREFIX = "apex6.";
// Kept beside the data, never in a snapshot:
const AT = "apex6.vault.at"; // when this browser's data last changed (ms)
const SYNC = "apex6.vault.sync"; // `at` of the folder file this browser last wrote or took
export const FILE = "apex6-data.json";
const DAILY = "daily";
const DAILY_KEEP = 30;
const APP = "apex6-config";

const appKeys = (st) => {
  const out = [];
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i);
    if (k?.startsWith(PREFIX) && k !== AT && k !== SYNC) out.push(k);
  }
  return out.sort();
};

export const localAt = (st) => Number(st.getItem(AT)) || 0;
// Empty lists the app writes on its own when it starts (no backups yet, …) are not data.
const EMPTY = /^\s*(\[\s*\]|\{\s*\}|null|)\s*$/;
export const hasData = (st) => appKeys(st).some((k) => !EMPTY.test(st.getItem(k) ?? ""));

// `at`: when it was taken (a folder file: when it was written).
export function snapshot(st, at = Date.now()) {
  const data = {};
  for (const k of appKeys(st)) data[k] = st.getItem(k);
  return { app: APP, v: 1, at, data };
}

// What a snapshot holds, in words, for the owner to compare two of them.
export function summary(snap) {
  const j = (k) => {
    try {
      return JSON.parse(snap.data[`${PREFIX}${k}`] ?? "null");
    } catch {
      return null;
    }
  };
  const names = Object.values(j("names") ?? {}).reduce((n, per) => n + Object.keys(per ?? {}).length, 0);
  const parts = [
    ["macro", j("macros")?.items?.length],
    ["profile ในคลัง", j("profiles")?.items?.length],
    ["ชื่อ", names],
    ["สีที่สร้างเอง", j("customColors")?.length],
    ["ไฟล์สำรอง slot", j("backups")?.length],
  ].filter(([, n]) => n > 0);
  return parts.length ? parts.map(([w, n]) => `${w} ${n}`).join(" · ") : "ไม่มีข้อมูล";
}

// The text of a snapshot file → the snapshot. Throws (in Thai, shown to the owner) on anything else.
export function parseSnapshot(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw new Error("ไฟล์นี้ไม่ใช่ไฟล์ข้อมูลของแอป (อ่าน JSON ไม่ได้)");
  }
  if (s?.app !== APP || !s.data || typeof s.data !== "object") throw new Error("ไฟล์นี้ไม่ใช่ไฟล์ข้อมูลของแอป");
  if (s.v !== 1) throw new Error(`ไฟล์นี้มาจากแอปรุ่นใหม่กว่า (v${s.v})`);
  for (const [k, v] of Object.entries(s.data)) {
    if (!k.startsWith(PREFIX) || typeof v !== "string") throw new Error(`ไฟล์เสีย: ${k}`);
  }
  return { app: APP, v: 1, at: Number(s.at) || 0, data: s.data };
}

export const sameData = (a, b) => {
  const ka = Object.keys(a.data).sort(), kb = Object.keys(b.data).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a.data[k] === b.data[k]);
};

// Replaces all the app's data in this browser with the snapshot's. The page has to load again
// after this: the libraries read their data once, when the app starts.
// fromFolder: the snapshot is the folder's file, so this browser has now seen it.
export function replaceAll(st, snap, { fromFolder = false } = {}) {
  for (const k of appKeys(st)) st.removeItem(k);
  for (const [k, v] of Object.entries(snap.data)) st.setItem(k, v);
  st.setItem(AT, String(Date.now()));
  if (fromFolder) st.setItem(SYNC, String(snap.at));
}

// localStorage as the libraries see it: a change to an "apex6.*" key marks the time and calls
// onChange (the folder writes on it). A failed write throws as localStorage does, without marking.
export class Tracked {
  constructor(base, onChange = () => {}) {
    this.base = base;
    this.onChange = onChange;
  }
  getItem(k) {
    return this.base.getItem(k);
  }
  setItem(k, v) {
    const same = this.base.getItem(k) === String(v);
    this.base.setItem(k, v);
    if (!same) this.changed(k);
  }
  removeItem(k) {
    if (this.base.getItem(k) == null) return;
    this.base.removeItem(k);
    this.changed(k);
  }
  changed(k) {
    if (!k.startsWith(PREFIX) || k === AT || k === SYNC) return;
    try {
      this.base.setItem(AT, String(Date.now()));
    } catch {}
    this.onChange();
  }
}

export const stamp = (t, withTime = false) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return withTime ? `${day}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : day;
};

// ---------------- Folder ----------------

// The folder handle is kept in IndexedDB (localStorage can't hold it).
export const idbHandles = {
  db() {
    return new Promise((ok, fail) => {
      const r = indexedDB.open("apex6-vault", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("h");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  },
  async run(mode, f) {
    const db = await this.db();
    return new Promise((ok, fail) => {
      const tx = db.transaction("h", mode);
      const r = f(tx.objectStore("h"));
      tx.oncomplete = () => ok(r?.result);
      tx.onerror = () => fail(tx.error);
    });
  },
  get: () => idbHandles.run("readonly", (s) => s.get("dir")),
  set: (h) => idbHandles.run("readwrite", (s) => s.put(h, "dir")),
  clear: () => idbHandles.run("readwrite", (s) => s.delete("dir")),
};

async function readFile(dir, name) {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch (e) {
    if (e?.name === "NotFoundError") return null;
    throw e;
  }
}
async function writeFile(dir, name, text) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

// state: "unsupported" (no folder access in this browser), "none" (no folder picked),
// "permission" (picked, the browser wants a click to allow it again), "ok", "error".
// init(), link(), allow() return what the app must do: null (nothing: the folder now has this
// browser's data), { restore: snap } (this browser has nothing, the folder has it: take it), or
// { ask: snap } (the folder holds other data this browser has not seen: the owner picks).
export class Folder {
  constructor(st, { handles = idbHandles, picker = globalThis.showDirectoryPicker, onState = () => {}, delay = 600 } = {}) {
    this.st = st;
    this.handles = handles;
    this.picker = picker;
    this.onState = onState;
    this.delay = delay;
    this.dir = null;
    this.state = picker ? "none" : "unsupported";
    this.error = "";
    this.savedAt = null;
    this.timer = null;
    this.chain = Promise.resolve();
  }
  get name() {
    return this.dir?.name ?? "";
  }
  // onState only when the state changes: a save every few seconds must not redraw the page.
  set(state, error = "") {
    if (state === this.state && error === this.error) return;
    this.state = state;
    this.error = error;
    this.onState();
  }
  async init() {
    if (!this.picker) return null;
    try {
      this.dir = (await this.handles.get()) ?? null;
    } catch {}
    if (!this.dir) return null;
    let p = "prompt";
    try {
      p = await this.dir.queryPermission({ mode: "readwrite" });
    } catch {}
    if (p !== "granted") return this.set("permission"), null;
    return this.sync();
  }
  // link() and allow() need a click from the owner (the browser asks).
  async link() {
    const dir = await this.picker({ id: "apex6-data", mode: "readwrite", startIn: "documents" });
    clearTimeout(this.timer);
    this.dir = dir;
    this.st.removeItem(SYNC); // a folder picked now may hold anything: nothing in it was seen yet
    try {
      await this.handles.set(dir);
    } catch {}
    return this.sync();
  }
  async allow() {
    if (!this.dir) return null;
    if ((await this.dir.requestPermission({ mode: "readwrite" })) !== "granted") return null;
    return this.sync();
  }
  async unlink() {
    clearTimeout(this.timer);
    this.dir = null;
    this.savedAt = null;
    this.st.removeItem(SYNC);
    try {
      await this.handles.clear();
    } catch {}
    this.set("none");
  }
  async sync() {
    let text;
    try {
      text = await readFile(this.dir, FILE);
    } catch (e) {
      return this.fail(e), null;
    }
    if (text != null) {
      let snap = null;
      try {
        snap = parseSnapshot(text);
      } catch {
        // Not ours or broken: keep it aside rather than only writing over it.
        try {
          await writeFile(this.dir, `apex6-data-broken-${stamp(Date.now(), true)}.json`, text);
        } catch {}
      }
      if (snap && !sameData(snap, snapshot(this.st))) {
        if (!hasData(this.st)) return { restore: snap };
        // Written by another browser or PC since this one last wrote it (or never seen at all).
        const seen = Number(this.st.getItem(SYNC)) || 0;
        if (!seen || snap.at > seen) return { ask: snap };
      }
    }
    await this.write();
    return null;
  }
  // The owner keeps this browser's data: the folder's is kept aside in a file first.
  async keepLocal(snap) {
    try {
      await writeFile(this.dir, `apex6-data-before-${stamp(Date.now(), true)}.json`, JSON.stringify(snap, null, 1));
    } catch (e) {
      return this.fail(e);
    }
    await this.write();
  }
  // After a change: write soon, once for a burst of changes.
  schedule() {
    if (this.state !== "ok") return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), this.delay);
  }
  // Writes one after another, so two quick changes can't race on the file.
  write() {
    clearTimeout(this.timer);
    this.chain = this.chain.then(() => this.writeNow());
    return this.chain;
  }
  async writeNow() {
    if (!this.dir) return;
    const snap = snapshot(this.st);
    const text = JSON.stringify(snap, null, 1);
    try {
      await writeFile(this.dir, FILE, text);
      this.st.setItem(SYNC, String(snap.at));
      this.savedAt = snap.at;
      const daily = await this.dir.getDirectoryHandle(DAILY, { create: true });
      await writeFile(daily, `apex6-data-${stamp(snap.at)}.json`, text);
      const old = [];
      for await (const name of daily.keys()) if (/^apex6-data-\d{8}\.json$/.test(name)) old.push(name);
      for (const name of old.sort().slice(0, -DAILY_KEEP)) await daily.removeEntry(name);
      this.set("ok");
    } catch (e) {
      this.fail(e);
    }
  }
  fail(e) {
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") this.set("permission");
    else if (e?.name === "NotFoundError") this.set("error", "หาโฟลเดอร์ไม่เจอ อาจถูกลบหรือย้าย หรือถอดไดรฟ์ออก");
    else this.set("error", e?.message ?? String(e));
  }
}
