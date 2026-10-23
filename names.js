// Names kept by the app, per controller (UUID). The controller only gets NAME_MAX bytes per name,
// so the app keeps the full name and writes what fits.
//
// Each entry is { full, dev }: `dev` is the name the controller held when the two were last in
// sync, or null when the name was set in the app and not written yet. If the controller's name no
// longer equals `dev` (renamed by the official app, a restore, …), the controller's name is shown
// and the app's name is only offered back, never applied silently.
//
// Ids: "slot.<i>" for a profile. "macro.<slot>.<layer>.<id>" names come from before the macro
// library (macros.js), which now keeps macro names; they are read once, when a macro joins it.

import { NAME_MAX, nameBytes } from "./mapping-edit.js";

const KEY = "apex6.names";
// Longest name the app accepts, in characters. Only a guard for the layout.
export const APP_NAME_MAX = 60;

// The part of a name the controller can hold (`max` bytes): whole graphemes, so Thai marks stay on
// their letter.
export function fit(s, max = NAME_MAX) {
  if (nameBytes(s) <= max) return s;
  let out = "";
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    if (nameBytes(out + segment) > max) break;
    out += segment;
  }
  return out.trimEnd();
}

// The name each slot had when the app last read it, per controller, with the slot's CRC16 then.
// Only the slot in use can be read; for the others 0xA1 reports a CRC16, and while it is still the
// one seen here the slot holds what it held, name included.
const SEEN_KEY = "apex6.slotNames";
export class SlotSeen {
  constructor(storage = globalThis.localStorage) {
    this.st = storage;
    try {
      this.all = JSON.parse(storage?.getItem(SEEN_KEY) ?? "{}") ?? {};
    } catch {
      this.all = {};
    }
  }
  put(uuid, slot, crc, name) {
    const m = (this.all[uuid ?? "?"] ??= {});
    if (m[slot]?.crc === crc && m[slot]?.name === name) return;
    m[slot] = { crc, name };
    try {
      this.st?.setItem(SEEN_KEY, JSON.stringify(this.all));
    } catch {}
  }
  // The slot's name if it still holds what was seen, else undefined.
  name(uuid, slot, crc) {
    const e = this.all[uuid ?? "?"]?.[slot];
    return e && crc != null && e.crc === crc ? e.name : undefined;
  }
}

export class Names {
  constructor(storage = globalThis.localStorage) {
    this.st = storage;
    try {
      this.all = JSON.parse(storage?.getItem(KEY) ?? "{}") ?? {};
    } catch {
      this.all = {};
    }
  }
  save() {
    try {
      this.st?.setItem(KEY, JSON.stringify(this.all));
    } catch {}
  }
  entry(uuid, id) {
    return this.all[uuid ?? "?"]?.[id];
  }
  // Records a name. When the controller holds the whole name there is nothing to remember, and
  // clearing a name that was never written just forgets it.
  put(uuid, id, full, dev) {
    const u = uuid ?? "?";
    const m = (this.all[u] ??= {});
    if (full === dev || (!full && dev == null)) delete m[id];
    else m[id] = { full, dev };
    if (!Object.keys(m).length) delete this.all[u];
    this.save();
  }
  // What to show for a name the controller reports as `dev`.
  // `other` is set when the app has a different name for it: { full, unsent }.
  resolve(uuid, id, dev) {
    const e = this.entry(uuid, id);
    if (!e) return { name: dev };
    if (dev === undefined || e.dev === dev) return { name: e.full };
    return { name: dev, other: { full: e.full, unsent: e.dev == null } };
  }
  export(uuid) {
    return { app: "apex6-config", kind: "names", uuid, names: this.all[uuid ?? "?"] ?? {} };
  }
  // Merges an exported file into this controller's names. Returns how many names it took.
  import(uuid, data) {
    if (data?.kind !== "names" || typeof data.names !== "object") throw new Error("ไม่ใช่ไฟล์ชื่อของแอปนี้");
    const m = (this.all[uuid ?? "?"] ??= {});
    let n = 0;
    for (const [id, e] of Object.entries(data.names)) {
      if (!/^(slot\.\d|macro\.\d\.\d+\.\d+|layer\.\d\.\d)$/.test(id) || typeof e?.full !== "string") continue;
      m[id] = { full: e.full.slice(0, APP_NAME_MAX), dev: typeof e.dev === "string" ? e.dev : null };
      n++;
    }
    this.save();
    return n;
  }
  // After a write, layer names follow their layers: `keep` is the layers the slot now holds, by the
  // id each had before the write → its id now (the write numbers them again from 0). Names of
  // layers not in it (deleted, or gone in a whole-profile write) are dropped.
  moveLayers(uuid, slot, keep) {
    const m = this.all[uuid ?? "?"];
    if (!m) return;
    const old = {};
    for (const id of Object.keys(m)) {
      const [kind, s, layer] = id.split(".");
      if (kind !== "layer" || Number(s) !== slot) continue;
      old[layer] = m[id];
      delete m[id];
    }
    for (const [from, to] of keep) if (old[from]) m[`layer.${slot}.${to}`] = old[from];
    if (!Object.keys(m).length) delete this.all[uuid ?? "?"];
    this.save();
  }
}
