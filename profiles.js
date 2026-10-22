// The app's profile library: whole slots kept in the browser, to put into any of the 4 slots later.
// The 4 slots on the controller stay what the app edits; the library only holds copies. Putting a
// profile into a slot copies it there and makes nothing new in the library, so applying a profile
// twice never makes a duplicate (the official site's library does).
//
// A profile is stored as it will be written: its name set as the profile name (v1.9 keeps one),
// and passed through applyEdits, which numbers the layers again from 0 and runs checkProfile. So
// the CRC16 it keeps is the one a slot holding it will have, and a slot whose CRC16 (0xA1 reports
// one per slot) equals it is shown as holding it.

import { applyEdits, unwrapMapping } from "./mapping-edit.js";
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
const named = (wrapped, name) => applyEdits(wrapped, unwrapMapping(wrapped).cfg.version === "1.9" ? { "profile.name": fit(name) } : {});
const clean = (name) => String(name ?? "").trim().slice(0, APP_NAME_MAX);

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
      this.st?.setItem(KEY, JSON.stringify({ v: 1, items: this.items }));
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
  // A slot saved again with the same name and settings is the profile there is: nothing is added.
  add(name, wrapped, at = Date.now()) {
    name = clean(name);
    if (!name) throw new Error("ตั้งชื่อ profile ก่อน");
    const data = named(wrapped, name);
    const enc = b64(data);
    const same = this.items.find((p) => p.data === enc && p.name === name);
    if (same) return { profile: same, existed: true };
    if (this.items.length >= PROFILES_MAX) throw new Error(`คลังเก็บได้ ${PROFILES_MAX} profile ลบอันที่ไม่ใช้ก่อน`);
    const profile = { uid: newUid(), name, at, crc: crcOf(data), data: enc };
    this.items.unshift(profile);
    if (!this.save()) {
      this.items.shift();
      throw new Error("เบราว์เซอร์ไม่มีที่เก็บเหลือ");
    }
    return { profile, existed: false };
  }
  // The name inside the profile changes with it, so its CRC16 does too.
  rename(uid, name) {
    const p = this.get(uid);
    name = clean(name);
    if (!p || !name) return;
    const data = named(this.data(p), name);
    Object.assign(p, { name, crc: crcOf(data), data: b64(data) });
    this.save();
  }
  remove(uid) {
    this.items = this.items.filter((p) => p.uid !== uid);
    this.save();
  }
  // Profiles whose CRC16 equals the slot's. A CRC16 can match by chance, so callers say "probably".
  inSlot(crc) {
    return crc == null ? [] : this.items.filter((p) => p.crc === crc);
  }
}
