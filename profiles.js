// The app's profile library. Settings belong to a profile; a slot on the controller only carries
// one. Each profile is in at most one slot. The library keeps a copy of each profile's bytes:
//  - a slot holds a profile when its bytes equal the copy (the slot in use, read in full) or its
//    CRC16 equals the copy's (other slots: 0xA1 only reports their CRC16, so this is "probably");
//  - a write to a slot that holds a profile updates the copy with what was read back, so the copy
//    follows every edit, and putting a profile into a slot is a copy that adds nothing here.
// The library name is the app's; on the controller the profile carries its name cut to NAME_MAX,
// set when it goes into a slot, and a rename here renames the slot that holds it.

import { applyEdits } from "./mapping-edit.js";
import { fit, APP_NAME_MAX } from "./names.js";

const KEY = "apex6.profiles";
export const PROFILES_MAX = 64;
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const newUid = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// The bytes a write sends for a whole profile (a library profile, a backup, an imported file):
// layers numbered 0, 1, 2, … and every hardware rule checked. Throws when a rule fails.
export const toWrite = (wrapped) => applyEdits(wrapped, {});
export const crcOf = (wrapped) => wrapped[2] | (wrapped[3] << 8);
// The profile with its name inside, ready to write (a v1.8 profile becomes v1.9 to hold it).
export const named = (wrapped, name) => applyEdits(wrapped, { "profile.name": fit(name) });
const clean = (name) => String(name ?? "").trim().slice(0, APP_NAME_MAX);

// Slots (0–3) that hold profile p. crcs: 0xA1 CRC16 per slot; current: { slot, wrapped } as read.
export function slotsOf(p, crcs = [], current = null) {
  return [0, 1, 2, 3].filter((i) => (current && i === current.slot ? b64(current.wrapped) === p.data : crcs[i] === p.crc));
}

export class Profiles {
  constructor(storage = globalThis.localStorage) {
    this.st = storage;
    let d = null;
    try {
      d = JSON.parse(storage?.getItem(KEY) ?? "null");
    } catch {}
    this.items = Array.isArray(d?.items) ? d.items.filter((p) => p?.uid && p.data) : [];
  }
  save() {
    try {
      this.st?.setItem(KEY, JSON.stringify({ v: 2, items: this.items }));
      return true;
    } catch {
      return false;
    }
  }
  list() {
    return this.items;
  }
  get(uid) {
    return this.items.find((p) => p.uid === uid) ?? null;
  }
  data(p) {
    return unb64(p.data);
  }
  // Library profiles with exactly these bytes (a slot holding them holds those profiles).
  holding(wrapped) {
    const enc = b64(wrapped);
    return this.items.filter((p) => p.data === enc);
  }
  push(name, data) {
    if (this.items.length >= PROFILES_MAX) throw new Error(`คลังเก็บได้ ${PROFILES_MAX} profile ลบอันที่ไม่ใช้ก่อน`);
    const profile = { uid: newUid(), name, at: Date.now(), crc: crcOf(data), data: b64(data) };
    this.items.unshift(profile);
    if (!this.save()) {
      this.items.shift();
      throw new Error("เบราว์เซอร์ไม่มีที่เก็บเหลือ");
    }
    return profile;
  }
  // The slot in use, kept as it is so the slot holds the new profile. Bytes the library already
  // has are that profile: nothing is added.
  add(name, wrapped) {
    name = clean(name);
    if (!name) throw new Error("ตั้งชื่อ profile ก่อน");
    const data = toWrite(wrapped);
    const same = this.holding(data)[0];
    return same ? { profile: same, existed: true } : { profile: this.push(name, data), existed: false };
  }
  rename(uid, name) {
    const p = this.get(uid);
    name = clean(name);
    if (!p || !name) return null;
    p.name = name;
    this.save();
    return p;
  }
  // A write to a slot that held this profile: it takes what was read back from the slot (already
  // in order and checked), and the slot's new full name when it was renamed.
  update(uid, wrapped, name = null) {
    const p = this.get(uid);
    if (!p) return;
    Object.assign(p, { crc: crcOf(wrapped), data: b64(wrapped), at: Date.now(), ...(clean(name) ? { name: clean(name) } : {}) });
    this.save();
  }
  remove(uid) {
    this.items = this.items.filter((p) => p.uid !== uid);
    this.save();
  }
}
