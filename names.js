// Names kept by the app, per controller (UUID). The controller only gets NAME_MAX bytes per name,
// so the app keeps the full name and writes what fits.
//
// Each entry is { full, dev }: `dev` is the name the controller held when the two were last in
// sync, or null when the name was set in the app and not written yet. If the controller's name no
// longer equals `dev` (renamed by the official app, a restore, …), the controller's name is shown
// and the app's name is only offered back, never applied silently.
//
// Ids: "slot.<i>" for a profile, "macro.<slot>.<layer>.<id>" for a macro.

import { NAME_MAX, nameBytes } from "./mapping-edit.js";

const KEY = "apex6.names";
// Longest name the app accepts, in characters. Only a guard for the layout.
export const APP_NAME_MAX = 60;

// The part of a name the controller can hold: whole graphemes, so Thai marks stay on their letter.
export function fit(s) {
  if (nameBytes(s) <= NAME_MAX) return s;
  let out = "";
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    if (nameBytes(out + segment) > NAME_MAX) break;
    out += segment;
  }
  return out.trimEnd();
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
      if (!/^(slot\.\d|macro\.\d\.\d+\.\d+)$/.test(id) || typeof e?.full !== "string") continue;
      m[id] = { full: e.full.slice(0, APP_NAME_MAX), dev: typeof e.dev === "string" ? e.dev : null };
      n++;
    }
    this.save();
    return n;
  }
}
