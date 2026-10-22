// The app's macro library. On the controller a macro lives inside one layer of a slot (8 at most
// per layer), and a button can only play a macro of its own layer. The app keeps every macro in
// one library instead: a button picks any of them, and a write puts a copy of each macro into the
// layers whose buttons play it and removes the copies no button plays any more.
//
// Links tie each copy on the controller to its library macro, per controller (UUID), slot and
// "<layer>.<id>", together with the copy's bytes (`sig`) when the two were last in sync. A copy
// whose bytes no longer match its link (changed by the official app, a restore, …) is matched
// again by content, and taken into the library when nothing matches.

import { encodeMacro, macroBody, MACRO_MAX, NAME_MAX, nameBytes } from "./mapping-edit.js";
import { fit } from "./names.js";

const KEY = "apex6.macros";
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

// Body bytes of a library macro (the entry without its id, see macroBody), or null while it has no
// steps. A macro taken from the controller keeps its bytes until it is edited.
export function bodyOf(m) {
  if (m.bytes) return unhex(m.bytes);
  if (!m.actions?.length) return null;
  return encodeMacro(0, m.mode, m.actions, m.loop_ms ?? 0).slice(1);
}
export function sigOf(m) {
  try {
    const b = bodyOf(m);
    return b ? hex(b) : null;
  } catch {
    return null;
  }
}

// Actions of a copy on the controller, each with its target bytes so it can be written back as is.
function actionsOf(blob, cfg, li, mi) {
  const m = cfg.layers[li].macros[mi];
  const body = macroBody(blob, cfg, li, mi);
  return m.actions.map((a, i) => ({ ...a, raw: Array.from(body.subarray(5 + i * 7 + 1, 5 + i * 7 + 5)) }));
}

const newUid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class Library {
  constructor(storage = globalThis.localStorage) {
    this.st = storage;
    let d = null;
    try {
      d = JSON.parse(storage?.getItem(KEY) ?? "null");
    } catch {}
    this.items = Array.isArray(d?.items) ? d.items : [];
    this.linkMap = d?.links && typeof d.links === "object" ? d.links : {};
  }
  save() {
    try {
      this.st?.setItem(KEY, JSON.stringify({ v: 1, items: this.items, links: this.linkMap }));
    } catch {}
  }
  list() {
    return this.items;
  }
  get(uid) {
    return uid ? this.items.find((m) => m.uid === uid) ?? null : null;
  }
  // { name, mode, loop_ms?, actions, bytes?, named? } → the new macro. `named: false` marks a name
  // the app made up for a macro that had none on the controller: it is not written to the controller.
  add(m, uid = newUid()) {
    const it = { uid, name: m.name, named: m.named ?? true, mode: m.mode ?? "press_once", loop_ms: m.loop_ms ?? 0, actions: m.actions ?? [], ...(m.bytes ? { bytes: m.bytes } : {}) };
    this.items.push(it);
    this.save();
    return it;
  }
  // A change to what the macro does drops the bytes it was read with, so it is encoded again.
  update(uid, patch) {
    const it = this.get(uid);
    if (!it) return null;
    Object.assign(it, patch);
    if ("name" in patch) it.named = true;
    if ("mode" in patch || "actions" in patch || "loop_ms" in patch) delete it.bytes;
    this.save();
    return it;
  }
  remove(uid) {
    this.items = this.items.filter((m) => m.uid !== uid);
    this.save();
  }
  links(uuid, slot) {
    return this.linkMap[uuid ?? "?"]?.[slot] ?? {};
  }
  setLinks(uuid, slot, links) {
    (this.linkMap[uuid ?? "?"] ??= {})[slot] = links;
    this.save();
  }

  // Links every copy in the slot just read to a library macro, adding to the library what it does
  // not have yet. fullName(layer, id, deviceName) gives a longer name the app kept, if any.
  // Returns { "<layer>.<id>": { uid, sig } }. A copy linked to a macro that was deleted from the
  // library keeps that link when no button plays it (the next write removes it), and brings the
  // macro back when one does.
  adopt(uuid, slot, cfg, blob, fullName = () => "") {
    const old = this.links(uuid, slot);
    const next = {};
    const bySig = new Map();
    for (const it of this.items) {
      const s = sigOf(it);
      if (s) bySig.set(s, [...(bySig.get(s) ?? []), it]);
    }
    cfg.layers.forEach((l, li) =>
      l.macros.forEach((m, mi) => {
        const key = `${l.layer_id}.${m.macro_id}`;
        const sig = hex(macroBody(blob, cfg, li, mi));
        const dev = cfg.macro_names?.find((n) => n.layerId === l.layer_id && n.macroId === m.macro_id)?.name ?? "";
        const played = l.mappings.some((mp) => mp.activators.some((a) => a.target.type === "macro" && a.target.macro === m.macro_id));
        let uid = old[key]?.sig === sig ? old[key].uid : null;
        if (!uid) {
          const same = bySig.get(sig) ?? [];
          uid = (same.find((it) => fit(it.name) === dev) ?? same[0])?.uid ?? null;
        }
        if (!uid || (!this.get(uid) && played)) {
          const name = fullName(l.layer_id, m.macro_id, dev) || dev;
          const it = this.add(
            {
              name: name || `Slot ${slot + 1} · ${l.layer_id ? `Layer ${l.layer_id}` : "Base"} · Macro ${m.macro_id + 1}`,
              named: !!name,
              mode: m.trigger_mode,
              loop_ms: m.loop_interval_ms,
              actions: actionsOf(blob, cfg, li, mi),
              bytes: sig,
            },
            uid ?? undefined,
          );
          bySig.set(sig, [...(bySig.get(sig) ?? []), it]);
          uid = it.uid;
        }
        next[key] = { uid, sig };
      }),
    );
    this.setLinks(uuid, slot, next);
    return next;
  }

  export() {
    return { app: "apex6-config", kind: "macros", macros: this.items.map(({ uid, name, named, mode, loop_ms, actions, bytes }) => ({ uid, name, named, mode, loop_ms, actions, bytes })) };
  }
  // Adds the macros of an exported file that this library doesn't have. Returns how many it took.
  import(data) {
    if (data?.kind !== "macros" || !Array.isArray(data.macros)) throw new Error("ไม่ใช่ไฟล์ macro ของแอปนี้");
    let n = 0;
    for (const m of data.macros) {
      if (typeof m?.name !== "string" || !Array.isArray(m.actions)) continue;
      const sig = sigOf(m);
      if (this.get(m.uid) || this.items.some((x) => x.name === m.name && sigOf(x) === sig)) continue;
      this.add({ ...m, name: m.name.slice(0, 60) }, typeof m.uid === "string" ? m.uid : undefined);
      n++;
    }
    return n;
  }
}

// Activator types a press of the Buttons page sets; other types (pulse, toggle) are kept as they are.
const PRESS_ACTS = { simple: ["simple", "timing_single"], long: ["timing_long"], double: ["timing_double"] };
const PRESS_TYPES = Object.values(PRESS_ACTS).flat();
const devPressMacro = (layer, src, press) =>
  layer?.mappings.find((m) => m.source === src)?.activators.find((a) => PRESS_ACTS[press].includes(a.type) && a.target.type === "macro")?.target.macro;

// Device name caps to try when all the names don't fit TLV 0x20 (255 bytes, shared with the
// profile name): the full NAME_MAX first, then shorter. 0 writes no macro names.
const NAME_CAPS = [NAME_MAX, 24, 15, 9, 0];

// Works out what a write must do to the slot's macros so that every press ends up playing the
// library macro it was given. Pure: everything comes in as arguments.
//   cfg, links      the slot as read, and adopt()'s links for it
//   lib             the Library
//   layers          layer ids the slot will have after the write
//   sources(L)      buttons of layer L that may play a macro
//   target(L, s, p) what press p of button s in layer L will do: { type: "macro", uid } for a macro
//   profileName     the profile name that will be on the controller (it shares the name block)
// Returns { edits, rows, errors, links, used }: edits for applyEdits (macro set/delete/name and the
// macro presses with their new ids), review rows { kind: add|update|remove|rename|names, … },
// errors that stop the write, the links after it, and how many macros each layer will hold.
export function planMacros({ cfg, links, lib, layers, sources, target, profileName = "", layerName = (l) => `Layer ${l}` }) {
  const edits = {};
  const rows = [];
  const errors = [];
  const after = {};
  const used = {};
  const copies = [];
  for (const L of layers) {
    const dev = cfg.layers.find((l) => l.layer_id === L);
    const devMacros = dev?.macros ?? [];
    const uidOf = (id) => links[`${L}.${id}`]?.uid ?? null;
    // Copies played by activators this app does not edit stay where they are.
    const pinned = new Set();
    for (const mp of dev?.mappings ?? []) for (const a of mp.activators) if (a.target.type === "macro" && !PRESS_TYPES.includes(a.type)) pinned.add(a.target.macro);
    const binds = [];
    for (const src of sources(L))
      for (const press of Object.keys(PRESS_ACTS)) {
        const t = target(L, src, press);
        if (t?.type !== "macro") continue;
        binds.push({ src, press, uid: t.uid ?? uidOf(t.macro), devId: devPressMacro(dev, src, press) });
      }
    const want = [...new Set(binds.map((b) => b.uid))];
    // A macro already in the layer keeps its copy and id.
    const assigned = new Map();
    for (const uid of want) {
      const have = devMacros.map((m) => m.macro_id).filter((id) => uidOf(id) === uid);
      if (have.length) assigned.set(uid, have.find((id) => pinned.has(id)) ?? have[0]);
    }
    for (const id of pinned) {
      if ([...assigned.values()].includes(id)) continue;
      const uid = uidOf(id);
      assigned.set(uid && !assigned.has(uid) ? uid : `#${id}`, id);
    }
    // New copies take ids no copy uses first, then ids of copies that are removed.
    const taken = new Set(assigned.values());
    const onDev = new Set(devMacros.map((m) => m.macro_id));
    const free = [...Array(MACRO_MAX).keys()].filter((i) => !taken.has(i)).sort((a, b) => onDev.has(a) - onDev.has(b) || a - b);
    const missing = want.filter((uid) => !assigned.has(uid));
    if (missing.length > free.length) errors.push(`${layerName(L)} ใช้ macro ${taken.size + missing.length} ตัว จอยเก็บได้ ${MACRO_MAX} ตัวต่อ layer`);
    for (const uid of missing) if (free.length) assigned.set(uid, free.shift());
    used[L] = assigned.size;

    for (const [uid, id] of assigned) {
      const it = lib.get(uid);
      const devM = devMacros.find((m) => m.macro_id === id);
      const devSig = devM ? links[`${L}.${id}`]?.sig : null;
      if (!it) {
        // Only a copy nothing in the library stands for: leave it.
        if (devM) copies.push({ layer: L, id, name: null, fresh: false });
        if (devM && devSig) after[`${L}.${id}`] = links[`${L}.${id}`];
        continue;
      }
      const sig = sigOf(it);
      if (!sig) {
        errors.push(`"${it.name}" ยังไม่มีขั้น เพิ่มขั้นที่หน้า Macros ก่อน`);
        continue;
      }
      if (sig !== devSig) {
        edits[`macro.${L}.${id}.set`] = { bytes: Array.from(unhex(sig)) };
        rows.push({ kind: devM ? "update" : "add", layer: L, id, uid, name: it.name });
      }
      after[`${L}.${id}`] = { uid, sig };
      copies.push({ layer: L, id, name: it.named === false ? "" : it.name, fresh: !devM });
    }
    const keep = new Set(assigned.values());
    for (const m of devMacros) {
      if (keep.has(m.macro_id)) continue;
      edits[`macro.${L}.${m.macro_id}.delete`] = true;
      const it = lib.get(uidOf(m.macro_id));
      const dev = cfg.macro_names?.find((n) => n.layerId === L && n.macroId === m.macro_id)?.name;
      rows.push({ kind: "remove", layer: L, id: m.macro_id, uid: it?.uid ?? null, name: it?.name ?? (dev || `Macro ${m.macro_id + 1}`) });
    }
    for (const b of binds) {
      const id = assigned.get(b.uid);
      if (id !== undefined && b.devId !== id) edits[`map.${L}.${b.src}.${b.press}`] = { type: "macro", macro: id, layer: L };
    }
  }

  // Names: each copy gets its macro's name, cut to what fits the shared 255-byte block.
  if (cfg.version === "1.9") {
    const devName = (c) => c.fresh ? "" : cfg.macro_names?.find((n) => n.layerId === c.layer && n.macroId === c.id)?.name ?? "";
    const want = (c, cap) => (c.name === null ? devName(c) : cap ? fit(c.name, cap) : "");
    const size = (cap) => 2 + nameBytes(profileName) + copies.reduce((n, c) => n + (want(c, cap) ? 3 + nameBytes(want(c, cap)) : 0), 0);
    const cap = NAME_CAPS.find((c) => size(c) <= 255) ?? 0;
    if (cap < NAME_MAX && copies.some((c) => c.name)) rows.push({ kind: "names", cap });
    for (const c of copies) {
      const v = want(c, cap);
      if (v === devName(c)) continue;
      edits[`macro.${c.layer}.${c.id}.name`] = v;
      if (!rows.some((r) => r.layer === c.layer && r.id === c.id && r.kind !== "remove")) rows.push({ kind: "rename", layer: c.layer, id: c.id, name: v });
    }
  }
  return { edits, rows, errors, links: after, used };
}
