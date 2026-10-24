import { Apex6, RAM, hex, crc32 } from "./protocol.js";
import { decodeMapping } from "./mapping.js";
import { unwrapMapping, applyEdits, sameBytes, deadzoneMax, curveEndMin, curveStartMax, MACRO_STEPS_MAX, motorCmd, motorMode, FEEDBACK_MODE, gyroByte, gyroPct, gyroSimple, gyroFromSimple, GYRO_MIDS_MAX } from "./mapping-edit.js";
import { Drafts, meta, esc, resolveNames, resolveMacros, macroPlan, writeEdits, macroUses, openMacro, layerMoves, nameId, evalCurve, layerKey, layerList, nextLayerId, LAYER_NAME, btnName, useLayerNames, slotLayerNames, layerNameId } from "./model.js";
import { Names, SlotSeen, fit } from "./names.js";
import { Library } from "./macros.js";
import { Profiles, toWrite, named, slotsOf } from "./profiles.js";
import { DEFAULT_PROFILE } from "./defaults.js";
import { decodeLighting, encodeLighting, LIGHT_COLORS_MAX, CustomColors, CUSTOM_MAX, hexToHsv, hsvToHex, normHex, GOLD } from "./lighting.js";
import { MOD_ONLY, MOD_CODE, keyOfCode, modsOfEvent } from "./keys.js";
import * as V from "./views.js";
import { Tracked, Folder, snapshot, parseSnapshot, replaceAll, summary, stamp, hasData } from "./vault.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

// localStorage as the libraries see it: every change is also written to the folder the owner
// picked (vault.js), so the data outlives the browser.
const STORE = new Tracked(localStorage, () => S.folder.schedule());

const S = {
  pad: null,
  demo: params.has("demo"),
  hid: "hid" in navigator,
  info: null, sku: null, uuid: null, vers: null, slots: null,
  current: null, // { wrapped, cfg, slot } as last read from the controller
  motor: null, // RAM 0x06 (motor output) as last read, or null when it could not be read
  light: null, // { wrapped, cfg (decodeLighting), slot }: RAM 0x04 as last read, or null when it could not be read
  lightError: null,
  readAt: null,
  loading: null,
  loadError: null,
  connectError: null,
  tab: tabFromHash(),
  // ui.macro: uid of the library macro the Macros page has open; macroQ/pickQ: list filters.
  ui: { layer: 0, focus: null, layerMode: "hold", sel: "M1", press: "simple", outType: null, dpad: "D-pad ↑", renaming: null, slotMenu: null, layerMenu: null, pressMenu: false, addedPress: [], macro: null, step: 0, macroQ: "", pickQ: "", ledPick: 0, picker: null },
  log: [],
  backups: [],
  dump: null,
  dumpStatus: "",
  writing: false,
  names: new Names(STORE), // full names kept by the app, see names.js
  seen: new SlotSeen(STORE), // each slot's name when last read, see names.js
  lib: new Library(STORE), // the macro library, see macros.js
  profiles: new Profiles(STORE), // the profile library, see profiles.js
  colors: new CustomColors(STORE), // colors made with "สร้างสีเอง" on Lighting, see lighting.js
  folder: new Folder(localStorage, { onState: () => render() }), // the folder outside the browser, see vault.js
  dataSummary: () => summary(snapshot(localStorage)),
  dataSummary: () => summary(snapshot(localStorage)),
  plan: null, // what the next write does to the slot's macros, see macroPlan
};
const D = new Drafts(S);

function tabFromHash() {
  const t = location.hash.slice(1);
  return V.TABS.some((x) => x.id === t) ? t : "buttons";
}

// ---------------- Rendering ----------------

const PAGES = {
  profiles: V.profiles, buttons: V.buttons, macros: V.macros, sticks: V.sticks, triggers: V.triggers,
  gyro: V.gyro, vibration: V.vibration, lighting: V.lighting, device: V.device,
};

// The macro plan follows the drafts and the library, so it is worked out again on every render.
function refreshPlan() {
  useLayerNames(slotLayerNames(S));
  try {
    S.plan = S.current ? macroPlan(S, D) : null;
  } catch (e) {
    console.warn(e);
    S.plan = { edits: {}, rows: [], errors: [e.message], links: {}, used: {} };
  }
}

function renderChrome() {
  refreshPlan();
  $("#topbar").innerHTML = V.topbar(S, D);
  const tabs = $("#tabs");
  tabs.innerHTML = V.tabs(S, D);
  tabs.hidden = !S.pad;
}

function render() {
  const active = document.activeElement;
  const focusSig = active && active !== document.body ? sig(active) : null;
  renderChrome();
  const view = $("#view");
  const bar = V.vaultBar(S);
  if (!S.pad) view.innerHTML = bar + V.connect(S);
  else if (!S.current) view.innerHTML = bar + loadingView();
  else view.innerHTML = bar + PAGES[S.tab](S, D);
  liveCache.clear();
  fitStages();
  syncLive();
  if (focusSig) {
    const el = document.querySelector(focusSig);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
  document.title = S.pad ? `${V.TABS.find((t) => t.id === S.tab)?.label} · Apex 6 Pro` : "Apex 6 Pro · ตั้งค่าจอย";
}

// Callout labels carry button and macro names of any length. Widen each photo stage's view, the
// same on both sides so the photo stays centred, until the longest label fits; on wide screens the
// photo column grows by the same factor (--stage-grow), so the photo keeps its size there.
function fitStages() {
  let grow = 1;
  for (const svg of document.querySelectorAll(".stage svg[data-view]")) {
    const [x, y, w, h] = svg.dataset.view.split(/\s+/).map(Number);
    let extra = 0;
    // D-pad arrows in a label: an 11px icon in the gap stage.js left, in the label's own colour.
    // Ghost labels (measured, never drawn) get none.
    for (const t of svg.querySelectorAll("text:not(.ghost) tspan.arw-gap")) {
      const e = t.getExtentOfChar(0), cx = e.x + e.width / 2, cy = e.y + e.height / 2;
      const d = { "↑": `M${cx} ${cy + 5.5}V${cy - 5.5}M${cx - 4.5} ${cy - 1}L${cx} ${cy - 5.5}L${cx + 4.5} ${cy - 1}`, "↓": `M${cx} ${cy - 5.5}V${cy + 5.5}M${cx - 4.5} ${cy + 1}L${cx} ${cy + 5.5}L${cx + 4.5} ${cy + 1}`, "←": `M${cx + 5.5} ${cy}H${cx - 5.5}M${cx - 1} ${cy - 4.5}L${cx - 5.5} ${cy}L${cx - 1} ${cy + 4.5}`, "→": `M${cx - 5.5} ${cy}H${cx + 5.5}M${cx + 1} ${cy - 4.5}L${cx + 5.5} ${cy}L${cx + 1} ${cy + 4.5}` }[t.dataset.arw];
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("class", "arw-svg");
      p.setAttribute("d", d);
      p.style.stroke = getComputedStyle(t).fill;
      t.closest("text").after(p);
    }
    // A highlighter stroke behind each label of a mapped button; SVG text has no background.
    for (const t of svg.querySelectorAll("text.mk")) {
      const b = t.getBBox();
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("class", "mk-bg");
      for (const [k, v] of Object.entries({ x: b.x - 4, y: b.y - 1, width: b.width + 8, height: b.height + 2, rx: 2 })) r.setAttribute(k, v.toFixed(1));
      t.before(r);
    }
    for (const t of svg.querySelectorAll("text")) {
      const b = t.getBBox();
      extra = Math.max(extra, x - (b.x - 8), b.x + b.width + 8 - (x + w));
    }
    // A page that keeps label room (Buttons) is that wide from the start on a wide screen.
    if (svg.dataset.room && matchMedia("(min-width: 1700px)").matches) extra = Math.max(extra, Number(svg.dataset.room));
    svg.setAttribute("viewBox", `${x - extra} ${y} ${w + 2 * extra} ${h}`);
    grow = Math.max(grow, (w + 2 * extra) / w);
  }
  $("#view").style.setProperty("--stage-grow", grow.toFixed(3));
}

// The label room (Buttons) applies only on a wide screen, so crossing that width draws the page again.
matchMedia("(min-width: 1700px)").addEventListener("change", () => render());

function sig(el) {
  for (const a of ["data-key", "data-pick", "data-act"]) {
    const v = el.getAttribute?.(a);
    if (v == null) continue;
    let s = `[${a}="${CSS.escape(v)}"]`;
    for (const b of ["data-val", "data-tab", "data-slot", "data-press", "data-type", "data-btn"]) {
      const w = el.getAttribute(b);
      if (w != null) s += `[${b}="${CSS.escape(w)}"]`;
    }
    return s;
  }
  return null;
}

function loadingView() {
  if (S.loadError) {
    return `<div style="max-width:620px;padding-top:60px"><div class="state fail"><h2>อ่านค่าจากจอยไม่สำเร็จ</h2>
      <p class="meta" style="font-size:14px;margin-top:6px">${esc(S.loadError)}</p>
      <p style="font-size:16px;line-height:24px">ยังไม่ได้แก้อะไรในจอย ลองเสียบสายใหม่ ปิดแอปอื่นที่จับจอยอยู่ แล้วอ่านอีกครั้ง</p>
      <div style="display:flex;gap:20px;align-items:center;margin-top:20px"><button class="btn primary" data-act="reload">อ่านค่าจากจอย</button><button class="link" data-act="disconnect">ตัดการเชื่อมต่อ</button></div></div></div>`;
  }
  return `<div style="padding-top:80px;max-width:520px"><div class="state"><h2>กำลังอ่านค่าจากจอย…</h2>
    <p class="meta" style="font-size:14px;margin-top:6px">${esc(S.loading ?? "")}</p></div></div>`;
}

// Small in-place updates while a slider is dragged, so the input keeps pointer capture.
function softUpdate(key) {
  for (const el of document.querySelectorAll(`[data-out="${CSS.escape(key)}"]`)) {
    const input = document.querySelector(`input[type=range][data-key="${CSS.escape(key)}"]`);
    const label = input?.closest(".slider")?.querySelector("b")?.textContent;
    el.textContent = outText(key, label);
    el.classList.toggle("pending", D.has(key));
  }
  for (const input of document.querySelectorAll(`input[data-key="${CSS.escape(key)}"]`)) {
    if (input.type === "range") {
      input.style.setProperty("--p", `${((input.value - input.min) / (input.max - input.min || 1)) * 100}%`);
      input.classList.toggle("pending", D.has(key));
    }
  }
  const [a, side] = key.split(".");
  if (a === "stick" || a === "trigger") {
    const sel = `[data-live-chart="${a}-${side}"]`;
    const box = document.querySelector(sel);
    if (box) box.innerHTML = chartFor(a, side);
    liveCache.delete(sel);
  }
  renderChrome();
}

function outText(key, label) {
  const v = D.get(key);
  if (key.startsWith("led.bright") || key.startsWith("screen.bright")) return `${v}%`;
  if (key === "led.speed") return meta(key, S).fmt(v);
  if (key.startsWith("gyro.")) return `${v}%`;
  if (key.startsWith("grip.") || key.startsWith("gripfb.")) return meta(key, S).fmt(v);
  return `${Math.round((v / 255) * 100)}%  ·  ${v}`;
}

// The curve as drawn: the one on the controller with any unwritten edits applied.
function curveFor(kind, side) {
  const base = S.current.cfg[`${kind === "stick" ? "joystick" : "trigger"}_${side}`].curve;
  const keys = kind === "stick" ? [`stick.${side}.deadzone`, `stick.${side}.max`] : [`trigger.${side}.start`, `trigger.${side}.end`];
  return V.effCurve(D, base, keys[0], keys[1]);
}

// live: how far the trigger is pressed (0–255), drawn as a dot on the curve.
function chartFor(kind, side, live = null) {
  const pend = D.pendingKeys(`${kind}.${side}.`).length > 0;
  return V.curveSvg(curveFor(kind, side), { pending: pend, live });
}

// ---------------- Toast ----------------

let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", err);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), err ? 7000 : 3500);
}

// ---------------- Device ----------------

function logPacket(dir, bytes) {
  // The 0xEF stick stream arrives many times a second and would push everything else out.
  if (dir === "in" && bytes[2] === 0xef) return;
  let n = bytes.length;
  while (n > 1 && bytes[n - 1] === 0) n--;
  const t = new Date().toLocaleTimeString("th-TH", { hour12: false });
  S.log.push({ dir, text: `${t}  ${dir === "out" ? "→" : "←"}  ${hex(bytes.slice(0, n)).toUpperCase()}` });
  // A full write (backup read, write, read-back) is about 800 lines; keep all of it.
  if (S.log.length > 2000) S.log.splice(0, S.log.length - 2000);
  scheduleLog();
}

let logQueued = false;
function scheduleLog() {
  if (logQueued) return;
  logQueued = true;
  requestAnimationFrame(() => {
    logQueued = false;
    const el = document.getElementById("log");
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    el.innerHTML = V.logHtml(S.log);
    if (atEnd) el.scrollTop = el.scrollHeight;
  });
}

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(e);
    return null;
  }
}

async function attach(p) {
  S.pad = p;
  S.connectError = null;
  p.onTraffic = logPacket;
  await loadAll();
}

async function loadAll() {
  S.loadError = null;
  S.loading = "ข้อมูลจอย";
  if (!S.current) render();
  const pad = S.pad;
  S.info = await safe(() => pad.getDeviceInfo());
  S.sku = await safe(() => pad.getSku());
  S.uuid = await safe(() => pad.getUuid());
  S.vers = await safe(() => pad.getConfigVersions());
  S.slots = await safe(() => pad.getSlotStatus());
  try {
    const { data, activeSlot } = await pad.readRam(RAM.MAPPING, (i, n) => {
      S.loading = `ค่าใน slot · ${i}/${n}`;
      if (!S.current) $("#view .meta") && ($("#view .meta").textContent = S.loading);
    });
    const { cfg } = unwrapMapping(data);
    S.current = { wrapped: data, cfg, slot: activeSlot };
    // Trigger feedback on/off lives in RAM 0x06; without it those switches stay drafts.
    S.motor = (await safe(() => pad.readRam(RAM.MOTOR)))?.data ?? null;
    await loadLight(activeSlot);
    // A name drafted for a slot that is no longer loaded can't be written now: keep it in the app.
    for (const k of D.pendingKeys("slot.")) {
      const i = Number(k.split(".")[1]);
      if (i === activeSlot) continue;
      S.names.put(S.uuid, `slot.${i}`, D.map.get(k), null);
      D.map.delete(k);
    }
    resolveNames(S);
    resolveMacros(S);
    if (!S.slots) S.slots = { activeSlot, slotCrc16: [0, 0, 0, 0] };
    S.readAt = new Date();
    D.prune();
    if (!layerList(S, D).some((l) => l.id === S.ui.layer)) S.ui.layer = 0;
  } catch (e) {
    console.warn(e);
    S.current = null;
    S.loadError = e.message;
  }
  S.loading = null;
  render();
}

// RGB lighting of the active slot (RAM 0x04). Without it the Lighting page stays drafts only.
async function loadLight(slot) {
  S.light = null;
  S.lightError = null;
  try {
    const { data, activeSlot } = await S.pad.readRam(RAM.LIGHTING);
    if (activeSlot !== slot) throw new Error(`จอยตอบไฟของ Slot ${activeSlot + 1} แทน Slot ${slot + 1}`);
    S.light = { wrapped: data, cfg: decodeLighting(data), slot };
  } catch (e) {
    console.warn(e);
    S.lightError = e.message;
  }
}

async function disconnect() {
  await stopLive();
  await S.pad?.close().catch(() => {});
  S.pad = null;
  S.current = null;
  S.info = S.sku = S.uuid = S.vers = S.slots = S.motor = S.light = null;
  D.clear();
  if (S.demo) {
    S.demo = false;
    history.replaceState(null, "", location.pathname + location.hash);
  }
  render();
}

async function connect() {
  try {
    await attach(await Apex6.request());
  } catch (e) {
    S.connectError = e.name === "NotFoundError" || /ไม่ได้เลือก/.test(e.message) ? "ยังไม่ได้เลือกจอย ลองกดเชื่อมต่ออีกครั้ง" : e.message;
    render();
  }
}

// Drafts of the loaded slot's settings (not slot names, which the app keeps per slot).
const slotDrafts = () => D.items().filter((x) => x.group === "slot" && !x.key.startsWith("slot."));

// Returns whether the controller now uses slot i (0xA2, verified on hardware). Switching changes
// nothing in the slots, so it only asks when drafts would be lost. asked: the caller already did.
async function switchSlot(i, { asked = false } = {}) {
  if (!S.pad || S.writing) return false;
  if (i === S.slots?.activeSlot) return true;
  const n = slotDrafts().length;
  if (!asked && n && !confirm(`สลับไป Slot ${i + 1}?\n\nร่างที่ยังไม่ได้เขียน ${n} จุดใน slot นี้จะหายไป`)) return false;
  try {
    await S.pad.switchSlot(i);
    for (const it of slotDrafts()) D.map.delete(it.key);
    S.current = null;
    await loadAll();
    toast(`จอยใช้ Slot ${i + 1} แล้ว`);
    return S.current?.slot === i;
  } catch (e) {
    toast(`สลับ slot ไม่สำเร็จ: ${e.message}`, true);
    await loadAll();
    return false;
  }
}

// ---------------- Profile library ----------------

// Gives a slot back the official app's defaults, so it can be set up again from scratch. keep:
// move the slot's profile into the library first ("ย้ายเข้าคลัง"); without it the profile is only in
// the backup file every write makes ("คืนค่าเริ่มต้น"). The profile is kept before the slot is
// written, so if the write fails the slot still holds it.
async function resetSlot(slot, { keep }) {
  if (!S.current || S.writing) return;
  const fresh = toWrite(DEFAULT_PROFILE);
  const verb = keep ? `ย้าย Slot ${slot + 1} เข้าคลัง` : `คืน Slot ${slot + 1} เป็นค่าเริ่มต้น`;
  if (slot !== S.current.slot) {
    const n = slotDrafts().length;
    const ask = [`${verb}?`, "", `แอปต้องสลับจอยไปใช้ Slot ${slot + 1} ก่อนเพื่ออ่านค่าในนั้น`];
    if (n) ask.push(`ร่างที่ยังไม่ได้เขียน ${n} จุดใน Slot ${S.current.slot + 1} จะหายไป`);
    if (!confirm(ask.join("\n"))) return;
    if (!(await switchSlot(slot, { asked: true }))) return;
  }
  const cur = S.current.wrapped;
  if (sameBytes(cur, fresh)) return toast(`Slot ${slot + 1} เป็นค่าเริ่มต้นอยู่แล้ว`);
  const held = S.profiles.holding(cur)[0];
  let name = "";
  if (keep) {
    name = prompt(`ชื่อ profile ที่จะเก็บในคลัง (ค่าทั้งหมดใน Slot ${slot + 1})`, held?.name ?? V.slotName(S, D, slot))?.trim();
    if (!name) return;
  }
  const n = slotDrafts().length;
  const lines = [
    keep ? `ย้าย “${name}” เข้าคลัง แล้วคืน Slot ${slot + 1} เป็นค่าเริ่มต้น?` : `คืน Slot ${slot + 1} (${V.slotName(S, D, slot)}) เป็นค่าเริ่มต้น?`,
    "",
    "ปุ่ม, layer, macro, stick, ไก, gyro และความแรงการสั่นใน slot นี้จะกลับเป็นค่าเริ่มต้นของแอปทางการ และ slot จะไม่มีชื่อ",
    "ไฟ และบีบไกแล้วด้ามสั่น (เปิด/ปิด) ไม่เปลี่ยน",
    keep ? "แอปจะสำรองค่าเดิมเป็นไฟล์ให้ก่อน" : held ? `“${held.name}” ยังอยู่ในคลัง · แอปจะสำรองค่าเดิมเป็นไฟล์ให้ก่อน` : "ค่าเดิมจะไม่อยู่ในคลัง แต่แอปจะสำรองเป็นไฟล์ให้ก่อน กู้คืนได้ที่ Device & backup",
    ...(n ? [`ร่างที่ยังไม่ได้เขียน ${n} จุดใน slot นี้จะหายไป`] : []),
  ];
  if (!confirm(lines.join("\n"))) return;
  if (keep) {
    try {
      if (held) S.profiles.rename(held.uid, name);
      else S.profiles.add(name, cur);
    } catch (e) {
      return toast(`เก็บเข้าคลังไม่สำเร็จ ยังไม่ได้แก้ slot: ${e.message}`, true);
    }
  }
  for (const it of slotDrafts()) D.map.delete(it.key);
  D.map.delete(`slot.${slot}.name`);
  runWrite({
    data: fresh,
    names: [[`slot.${slot}`, ""]],
    reason: keep ? `ก่อนย้าย “${name}” เข้าคลัง` : "ก่อนคืนค่าเริ่มต้น",
    title: `กำลังคืน Slot ${slot + 1} เป็นค่าเริ่มต้น`,
    doneTitle: keep ? `ย้าย “${name}” เข้าคลังแล้ว · Slot ${slot + 1} เป็นค่าเริ่มต้น` : `Slot ${slot + 1} เป็นค่าเริ่มต้นแล้ว`,
    failTitle: keep ? "คืนค่าเริ่มต้นไม่สำเร็จ · profile อยู่ในคลังแล้ว" : "คืนค่าเริ่มต้นไม่สำเร็จ",
  });
}

// A rename in the library renames the slot holding the profile too (a draft to write).
function renameProfile(p) {
  const name = prompt("ชื่อใหม่ของ profile", p.name)?.trim();
  if (!name || name === p.name) return;
  S.profiles.rename(p.uid, name);
  const slot = slotsOf(p, S.slots?.slotCrc16, S.current)[0];
  if (slot != null) {
    D.set(`slot.${slot}.name`, name);
    toast(slot === S.current?.slot ? `เปลี่ยนชื่อแล้ว · กดเขียนลงจอยเพื่อเปลี่ยนชื่อ Slot ${slot + 1} ด้วย` : `เปลี่ยนชื่อแล้ว · ชื่อ Slot ${slot + 1} จะเขียนลงจอยได้ตอนสลับไปใช้ slot นั้น`);
  }
  render();
}

// Copies a library profile into a slot: switches the controller to it first when it isn't the one
// in use, then writes like any other write (re-read, back up, write, read back). The controller
// keeps using that slot afterwards. A profile is in one slot at most, so one already in a slot
// can't go into another; the profile the slot held stays in the library.
async function applyProfile(p, slot) {
  if (!S.current || S.writing) return;
  const crcs = S.slots?.slotCrc16;
  const at = slotsOf(p, crcs, S.current);
  if (at.length) return toast(`“${p.name}” อยู่ใน Slot ${at[0] + 1} แล้ว · 1 profile อยู่ได้ slot เดียว`, true);
  let data;
  try {
    data = toWrite(named(S.profiles.data(p), p.name));
  } catch (e) {
    return toast(`ใส่ profile นี้ไม่ได้: ${e.message}`, true);
  }
  const other = slot !== S.current.slot;
  const n = slotDrafts().length;
  const out = S.profiles.list().find((q) => slotsOf(q, crcs, S.current).includes(slot));
  const lines = [
    `ใส่ "${p.name}" ลง Slot ${slot + 1} (${V.slotName(S, D, slot)})?`,
    "",
    "ค่าทั้งหมดใน slot นั้นจะถูกแทนที่ แอปจะสำรองค่าเดิมเป็นไฟล์ให้ก่อน",
    ...(out ? [`“${out.name}” จะออกจาก slot นี้ แต่ยังอยู่ในคลัง`] : []),
    ...(other ? [`แอปจะสลับจอยไปใช้ Slot ${slot + 1} ก่อน และจอยจะใช้ slot นั้นต่อหลังเขียนเสร็จ`] : []),
    ...(n ? [`ร่างที่ยังไม่ได้เขียน ${n} จุดใน Slot ${S.current.slot + 1} จะหายไป`] : []),
  ];
  if (!confirm(lines.join("\n"))) return;
  if (other && !(await switchSlot(slot, { asked: true }))) return;
  for (const it of slotDrafts()) D.map.delete(it.key);
  D.map.delete(`slot.${slot}.name`); // the profile brings its own name
  runWrite({ data, profile: p.uid, names: [[`slot.${slot}`, p.name]], reason: `ก่อนใส่ profile "${p.name}"`, title: `กำลังใส่ "${p.name}"`, doneTitle: "ใส่ profile เสร็จ ตรงกับจอยแล้ว", failTitle: "ใส่ profile ไม่สำเร็จ" });
}

// ---------------- Backups ----------------

const BK_KEY = "apex6.backups";
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function loadBackups() {
  let list = [];
  try {
    list = JSON.parse(STORE.getItem(BK_KEY) ?? "[]");
  } catch {}
  // Migrate the single-per-slot backups written by the first version of the app.
  for (let s = 0; s < 4; s++) {
    const k = `apex6.backup.mapping.slot${s}`;
    try {
      const b = JSON.parse(STORE.getItem(k) ?? "null");
      if (b && !list.some((x) => x.at === b.at)) list.push({ id: `m${b.at}`, at: b.at, slot: s, name: "", reason: "ก่อนเขียน", data: b.data });
      STORE.removeItem(k);
    } catch {}
  }
  S.backups = list.filter((b) => b && b.data).sort((a, b) => b.at - a.at);
  saveBackups();
}

function saveBackups() {
  while (S.backups.length) {
    try {
      STORE.setItem(BK_KEY, JSON.stringify(S.backups.slice(0, 16)));
      return;
    } catch {
      S.backups.pop();
    }
  }
}

function backup(data, slot, reason) {
  const at = Date.now();
  const d = new Date(at);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  download(data, `apex6-slot${slot + 1}-${stamp}.bin`);
  let name = "";
  try {
    name = unwrapMapping(data).cfg.name || "";
  } catch {}
  S.backups.unshift({ id: `b${at}`, at, slot, name, reason, data: b64(data) });
  saveBackups();
  return at;
}

function download(data, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- Write flow ----------------

const sheet = $("#sheet");
let W = null;

function showSheet(html) {
  sheet.innerHTML = html;
  if (!sheet.open) sheet.showModal();
}

sheet.addEventListener("cancel", (e) => {
  if (S.writing) e.preventDefault();
});
sheet.addEventListener("close", () => {
  W = null;
  render();
});

function openReview() {
  showSheet(V.review(S, D));
  // Focus the write button, but open at the title: a long list would otherwise scroll it away.
  sheet.querySelector(".btn.primary:not(:disabled)")?.focus({ preventScroll: true });
  sheet.scrollTop = 0;
}

// Every write: re-read and confirm nothing changed since display, back up, write, read back and compare.
// edits: for applyEdits; drafts: the draft keys they take care of; links: the macro links after the
// write (macroPlan), kept so each copy stays tied to its library macro; motor: trigger feedback
// switches (Drafts.motorCmds), sent with 0x53 once the profile is in.
// data: a whole profile written instead of edits; names: [id, full name] the app keeps once it is in;
// profile: the library profile data comes from, which takes the bytes read back.
async function runWrite({ edits = null, drafts = null, links = null, data = null, names = [], profile = null, motor = [], light = null, reason, title, doneTitle, failTitle }) {
  const slot = S.current.slot;
  const steps = ["สำรองไฟล์", `ส่งข้อมูล Slot ${slot + 1}`, "ตรวจ CRC กับจอย", ...(motor.length ? ["ตั้งบีบไกแล้วด้ามสั่น"] : []), ...(light ? ["ตั้งไฟ RGB"] : [])];
  W = { title, doneTitle, failTitle, slot, name: S.current.cfg.name || "", at: 0, steps, bytes: null };
  S.writing = true;
  showSheet(V.writing(W));
  await stopLive();
  let started = false;
  try {
    const fresh = await S.pad.readRam(RAM.MAPPING);
    if (fresh.activeSlot !== slot || !sameBytes(fresh.data, S.current.wrapped)) {
      throw new Error("ค่าในจอยไม่ตรงกับที่แสดงอยู่ (อาจสลับ slot หรือถูกแก้จากที่อื่น) อ่านค่าจากจอยใหม่แล้วลองอีกครั้ง");
    }
    // Lighting is checked and encoded before anything is sent, so a bad value stops the whole write.
    const lightNext = light && (await lightBefore(light, slot));
    const info = await S.pad.getRamInfo(RAM.MAPPING);
    if (info.status !== 0 || info.len !== fresh.data.length || info.crc32 !== crc32(fresh.data)) {
      throw new Error(`จอยรายงานความยาว/CRC ไม่ตรงกับที่อ่านได้ (status=${info.status}) ยกเลิกแล้ว ไม่ได้เขียนอะไร`);
    }
    // A whole profile (library, backup, file) goes through the same rules as an edit (toWrite).
    const next = edits ? applyEdits(fresh.data, edits) : toWrite(data);
    const sentNames = edits ? D.items().filter((i) => i.writable && i.key.endsWith(".name")) : [];
    // An edit to a slot that holds a library profile changes the profile too: the profile is what
    // the settings belong to, the slot only carries it. A whole-profile write (restore, import)
    // replaces what the slot holds instead, so it changes no profile.
    const linked = edits ? S.profiles.holding(fresh.data) : [];
    unwrapMapping(next);
    W.backupAt = backup(fresh.data, slot, reason);
    W.at = 1;
    showSheet(V.writing(W));
    if (!sameBytes(fresh.data, next)) {
      started = true;
      const ack = await S.pad.writeRam(RAM.MAPPING, next, (i, n) => {
        W.bytes = [Math.min(i * 16, next.length), next.length];
        showSheet(V.writing(W));
      });
      W.commitStatus = ack.status;
    }
    W.at = 2;
    W.bytes = null;
    showSheet(V.writing(W));
    const back = await S.pad.readRam(RAM.MAPPING);
    if (!sameBytes(back.data, next)) throw new Error("อ่านกลับแล้วไม่ตรงกับที่เขียน");
    W.crc = (back.data[2] | (back.data[3] << 8)).toString(16).padStart(4, "0").toUpperCase();
    // Any write numbers the layers again from 0 (normalizeLayers); what stays open follows.
    const moves = edits ? layerMoves(S, D) : [];
    // Layer names follow too; a whole-profile write keeps them by position, as far as it has layers.
    const nLayers = unwrapMapping(back.data).cfg.layers.length;
    const kept = edits ? layerList(S, D).filter((l) => !l.deleted).map((l) => l.id) : [...Array(nLayers).keys()];
    S.names.moveLayers(S.uuid, slot, kept.map((id) => [id, moves.find((m) => m.from === id)?.to ?? id]));
    if (edits) for (const k of drafts ?? Object.keys(edits)) D.map.delete(k);
    const moved = (id) => moves.find((m) => m.from === id)?.to ?? id;
    S.ui.layer = moved(S.ui.layer);
    if (S.ui.focus != null) S.ui.focus = moved(S.ui.focus);
    for (const [k, v] of [...D.map]) {
      const m = k.match(/^map\.(\d+)\.(.+)$/);
      if (!m || moved(Number(m[1])) === Number(m[1])) continue;
      D.map.delete(k);
      D.map.set(`map.${moved(Number(m[1]))}.${m[2]}`, v);
    }
    // The controller now holds what fits of each name; the app keeps the full one.
    for (const { key, value } of sentNames) S.names.put(S.uuid, nameId(key), value, fit(value));
    for (const [id, full] of names) S.names.put(S.uuid, id, full, fit(full));
    if (links) S.lib.setLinks(S.uuid, slot, links);
    const newName = sentNames.find((i) => i.key === `slot.${slot}.name`)?.value;
    for (const p of linked) S.profiles.update(p.uid, back.data, newName);
    if (profile) S.profiles.update(profile, back.data);
    W.profiles = linked.map((p) => p.name);
    S.current = { wrapped: back.data, cfg: unwrapMapping(back.data).cfg, slot: back.activeSlot };
    resolveNames(S);
    resolveMacros(S);
    S.readAt = new Date();
    S.slots = (await safe(() => S.pad.getSlotStatus())) ?? S.slots;
    if (motor.length) {
      W.at = 3;
      showSheet(V.writing(W));
      await writeMotor(motor, slot);
    }
    if (light) {
      W.at = steps.length - 1;
      showSheet(V.writing(W));
      await writeLight(light, lightNext, slot);
    }
    D.prune();
    W.left = D.count();
    S.writing = false;
    renderChrome();
    syncLive();
    showSheet(V.done(W));
    sheet.querySelector(".btn")?.focus();
  } catch (e) {
    console.warn(e);
    S.writing = false;
    W.error = started && W.bytes ? `จอยหยุดตอบหลังส่ง ${W.bytes[0]} / ${W.bytes[1]} B · ${e.message}` : e.message;
    W.unknown = started;
    W.restore = started ? W.backupAt : null;
    renderChrome();
    syncLive();
    showSheet(V.failed(W));
  }
}

// Trigger feedback on/off, one side at a time as the official app does: read RAM 0x06, send 0x53,
// read it back and check the side's mode. Each draft goes once the controller holds it.
async function writeMotor(list, slot) {
  const side = { left: "ซ้าย", right: "ขวา" };
  for (const m of list) {
    const cmd = motorCmd(m.side, m.on);
    const before = await S.pad.readRam(RAM.MOTOR);
    if (before.activeSlot !== slot) throw new Error(`จอยเปลี่ยนไปใช้ Slot ${before.activeSlot + 1} ระหว่างเขียน ยังไม่ได้ตั้งบีบไก${side[m.side]}แล้วด้ามสั่น`);
    await S.pad.setMotor(cmd);
    const after = await S.pad.readRam(RAM.MOTOR);
    S.motor = after.data;
    if (after.activeSlot !== slot) throw new Error(`จอยเปลี่ยน slot ระหว่างตั้งบีบไก${side[m.side]}แล้วด้ามสั่น อ่านค่าจากจอยใหม่แล้วลองอีกครั้ง`);
    if ((motorMode(after.data, m.side) === FEEDBACK_MODE) !== m.on) {
      throw new Error(`ส่งคำสั่งแล้ว แต่อ่านกลับมา บีบไก${side[m.side]}แล้วด้ามสั่น ยัง${m.on ? "ปิด" : "เปิด"}อยู่ (โหมด ${motorMode(after.data, m.side)}) ค่าอื่นในโปรไฟล์เขียนเสร็จแล้ว`);
    }
    D.map.delete(m.key);
  }
}

// Re-read the slot's lighting, check it is what the page shows, and encode the new one (checkLighting).
async function lightBefore({ light }, slot) {
  const fresh = await S.pad.readRam(RAM.LIGHTING);
  if (fresh.activeSlot !== slot || !S.light || !sameBytes(fresh.data, S.light.wrapped)) {
    throw new Error("ไฟในจอยไม่ตรงกับที่แสดงอยู่ (อาจสลับ slot หรือถูกแก้จากที่อื่น) อ่านค่าจากจอยใหม่แล้วลองอีกครั้ง");
  }
  return encodeLighting(light, { keptSpeed: S.light.cfg.speed });
}

// RGB lighting (RAM 0x04), after the profile: write, read back, compare every byte.
async function writeLight({ keys }, next, slot) {
  if (!sameBytes(next, S.light.wrapped)) await S.pad.writeRam(RAM.LIGHTING, next);
  const back = await S.pad.readRam(RAM.LIGHTING);
  if (back.activeSlot !== slot) throw new Error(`จอยเปลี่ยนไปใช้ Slot ${back.activeSlot + 1} ระหว่างตั้งไฟ RGB`);
  if (!sameBytes(back.data, next)) throw new Error("ตั้งไฟ RGB แล้ว อ่านกลับมาไม่ตรงกับที่เขียน ค่าอื่นในโปรไฟล์เขียนเสร็จแล้ว");
  S.light = { wrapped: back.data, cfg: decodeLighting(back.data), slot };
  for (const k of keys) D.map.delete(k);
}

// ---------------- Events ----------------

const CLAMP = {
  "stick.left.deadzone": (v) => Math.min(v, deadzoneMax(S.current.cfg.joystick_left)),
  "stick.right.deadzone": (v) => Math.min(v, deadzoneMax(S.current.cfg.joystick_right)),
  "stick.left.max": (v) => Math.max(v, curveEndMin(S.current.cfg.joystick_left.curve)),
  "stick.right.max": (v) => Math.max(v, curveEndMin(S.current.cfg.joystick_right.curve)),
  "trigger.left.start": (v) => Math.min(v, curveStartMax(S.current.cfg.trigger_left.curve)),
  "trigger.right.start": (v) => Math.min(v, curveStartMax(S.current.cfg.trigger_right.curve)),
  "trigger.left.end": (v) => Math.max(v, curveEndMin(S.current.cfg.trigger_left.curve)),
  "trigger.right.end": (v) => Math.max(v, curveEndMin(S.current.cfg.trigger_right.curve)),
};

// Gyro curve edits (one draft, "gyro.curve"). Points stay in order left to right, start ≤ mid
// points ≤ end, as in the official editor; the value is pushed back inside if it would cross.
// Returns the byte that was kept.
function setCurvePart(part, v, i = 0) {
  const c = structuredClone(D.get("gyro.curve"));
  const m = c.mid_points;
  const b = Math.max(0, Math.min(255, Math.round(v)));
  let kept = b;
  if (part === "start_x") kept = Math.min(b, ...m.map((p) => p.x), c.end_x);
  else if (part === "end_x") kept = Math.max(b, ...m.map((p) => p.x), c.start_x);
  else if (part === "mid_x") kept = Math.max(i ? m[i - 1].x : c.start_x, Math.min(b, m[i + 1]?.x ?? c.end_x));
  if (part === "mid_x") m[i].x = kept;
  else if (part === "mid_y") m[i].y = kept;
  else c[part] = kept;
  setDraft("gyro.curve", c);
  return kept;
}

// Picking a gyro mode sets the curve the way the official web app does: a stick mode keeps
// end_y at 255, mouse mode keeps end_x at 255. A slot that never had gyro set up (off, plain
// linear curve) gets the official defaults: end_x 145 for a stick, start_x 4 and end_y 51 for the
// mouse. An unwritten curve edit is dropped first.
function setGyroMode(mode) {
  const g = S.current.cfg.gyroscope;
  D.map.delete("gyro.curve");
  setDraft("gyro.mode", mode);
  if (mode === g.mode || mode === "disable") return;
  const c = structuredClone(g.curve);
  const fresh = g.mode === "disable" && c.start_x === 0 && c.start_y === 0 && c.end_x === 255 && c.end_y === 255 && !c.mid_points.length;
  if (mode === "mouse") {
    if (fresh) Object.assign(c, { start_x: 4, end_y: 51 });
    c.end_x = 255;
  } else {
    if (fresh) c.end_x = 145;
    c.end_y = 255;
  }
  setDraft("gyro.curve", c);
}

// One of the Gyro page's simple controls ("sens", "dead", "max" in percent, "accel" 0–3): the
// curve is rebuilt from all four. A hand-bent curve's mid points give way to the accel level
// (off when none matched). Returns the value as the rebuilt curve reads it.
function setGyroSimple(part, val) {
  const mode = D.get("gyro.mode");
  const c = D.get("gyro.curve");
  const v = gyroSimple(c, mode);
  v.accel ??= 0;
  v[part] = val;
  setDraft("gyro.curve", gyroFromSimple(v, mode, c.start_y));
  return gyroSimple(D.get("gyro.curve"), mode)[part];
}

// Gyro activation as the official Advanced page sets it: one hold/toggle for every button, a
// primary button and an optional secondary one. Slots past the second are kept as they are.
function setGyroButton(i, button) {
  const list = structuredClone(D.get("gyro.activation") ?? []);
  const activation = list[0]?.activation ?? "hold";
  if (button && list.some((a, k) => k !== i && a.button === button)) {
    toast("ปุ่มนี้ตั้งไว้แล้ว", true);
    return;
  }
  if (!button) list.splice(i, 1);
  else if (i < list.length) list[i] = { activation, button };
  else list.push({ activation, button });
  if (list.length) setDraft("gyro.activation", list);
}

// A picked color: the one color of solid, or the selected one of the breathing/gradient set.
function setLedColor(hex) {
  const mode = D.get("led.mode");
  if (mode !== "breathing" && mode !== "gradient") return setDraft("led.color", hex);
  const list = [...D.get("led.colors")];
  list[Math.min(S.ui.ledPick, list.length - 1)] = hex;
  setDraft("led.colors", list);
}

// The color the swatch row has picked: solid's, or the selected one of a color set.
function ledColorNow() {
  const mode = D.get("led.mode");
  if (mode === "solid") return D.get("led.color");
  if (mode !== "breathing" && mode !== "gradient") return null;
  const list = D.get("led.colors");
  return list[Math.min(S.ui.ledPick, list.length - 1)];
}

// ---------------- "สร้างสีเอง" ----------------

function closePicker() {
  S.ui.picker = null;
  render();
  document.querySelector('[data-act="color-new"]')?.focus();
}

// Use the picked color, and keep it in the row unless it is there already or the row is full.
function applyPicked() {
  const hex = hsvToHex(S.ui.picker);
  const kept = S.colors.add(hex);
  setLedColor(hex);
  S.ui.picker = null;
  render();
  if (kept === "full") toast(`ใช้สี ${hex} แล้ว แต่ไม่ได้เก็บไว้ในแถว เก็บได้ ${CUSTOM_MAX} สี ลบสีเก่าก่อน (กดค้างที่สี)`, true);
}

function deleteCustom(hex) {
  if (!confirm(`ลบสี ${hex} ออกจากสีที่สร้างเอง?

ไฟที่ตั้งเป็นสีนี้ไว้แล้วไม่เปลี่ยน`)) return;
  S.colors.remove(hex);
  render();
  toast(`ลบสี ${hex} แล้ว`);
}

// Moves the picker's handles, preview and code in place, so a drag keeps its pointer.
function drawPicker({ keepHex = false } = {}) {
  const P = S.ui.picker, box = document.querySelector("[data-picker]");
  if (!P || !box) return;
  const hex = hsvToHex(P), hue = `hsl(${Math.round(P.h)}, 100%, 50%)`;
  box.querySelector("[data-sv]").style.background = `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,${hue})`;
  Object.assign(box.querySelector("[data-sv-dot]").style, { left: `${P.s * 100}%`, top: `${(1 - P.v) * 100}%` });
  Object.assign(box.querySelector("[data-hue-dot]").style, { left: `${(P.h / 360) * 100}%`, background: hue });
  box.querySelector("[data-picker-prev]").style.background = hex;
  if (!keepHex) box.querySelector("[data-picker-hex]").value = hex.slice(1);
}

let pickDrag = null; // "sv" | "hue" while a picker handle is dragged
function pickAt(e) {
  const box = document.querySelector(pickDrag === "sv" ? "[data-sv]" : "[data-hue]");
  if (!box || !S.ui.picker) return;
  const r = box.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  if (pickDrag === "hue") S.ui.picker.h = Math.min(359.9, x * 360);
  else Object.assign(S.ui.picker, { s: x, v: 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) });
  drawPicker();
}

// Long press on a made color deletes it (also right click, or Delete on the focused swatch).
const pressed = { timer: null, fired: false };
function cancelPress() {
  clearTimeout(pressed.timer);
  pressed.timer = null;
}

function setDraft(key, v) {
  if (CLAMP[key]) v = CLAMP[key](v);
  D.set(key, v);
  return v;
}

function selectSource(src) {
  S.ui.sel = src;
  // A long or double press row added but left unused goes when the button changes (owner, 2026-10-23).
  S.ui.addedPress = [];
  S.ui.pressMenu = false;
  // Variant B: a newly picked button starts on its Base cell, never on the last layer used. With a
  // layer focused it starts in that layer, the only column the matrix shows.
  S.ui.layer = V.focusOf(S, D) ?? 0;
  S.ui.press = "simple";
  S.ui.outType = null;
}

function focusLayer(id) {
  S.ui.focus = S.ui.focus === id ? null : id;
  // Focusing lets go of the picked button, so the right-hand side shows every button of that layer
  // (owner, 2026-10-24; Buttons opens with M1 picked). A button picked next edits that layer.
  if (S.ui.focus != null) {
    S.ui.sel = null;
    S.ui.addedPress = [];
    S.ui.pressMenu = false;
    S.ui.outType = null;
    S.ui.layer = id;
    S.ui.press = "simple";
  }
  render();
  document.querySelector(`.layer-group[data-layer="${id}"]`)?.focus({ preventScroll: true });
}

function pick(id) {
  const ui = S.ui;
  selectSource(id === "DPAD" ? ui.dpad : V.ALL_SRC[id] ?? id);
  render();
  const ed = document.querySelector(".head-inset");
  ed?.scrollIntoView({ block: "nearest" });
}

function setOutput(el) {
  const { layer, sel, press } = S.ui;
  const key = `map.${layer}.${sel}.${press}`;
  const cur = D.get(key);
  const type = el.dataset.type;
  let v;
  if (type === "gamepad") v = { type: "btn_gamepad", button: el.dataset.btn };
  else if (type === "turbo") v = { type: "turbo_gamepad", button: el.dataset.btn, interval_ms: cur?.type === "turbo_gamepad" ? cur.interval_ms : 80 };
  else if (type === "mouse") v = { type: "btn_mouse", mouse: Number(el.dataset.mouse) };
  else if (type === "macro") v = { type: "macro", uid: el.dataset.uid };
  else if (type === "layer") v = { type: el.dataset.mode === "toggle" ? "layer_toggle" : "layer_hold", layer: Number(el.dataset.to) };
  else if (type === "none") v = { type: "none" };
  else if (type === "unset") v = undefined;
  const had = D.has(key) ? { v: D.map.get(key) } : null;
  if (v === undefined) {
    if (D.base(key) === undefined) D.map.delete(key);
    else D.map.set(key, undefined);
  } else D.set(key, v);
  // A layer holds MACRO_MAX macros: a pick that needs one more copy than that is undone.
  if (type === "macro") {
    const err = macroPlan(S, D).errors.find((e) => e.startsWith(LAYER_NAME(layer)));
    if (err) {
      if (had) D.map.set(key, had.v);
      else D.map.delete(key);
      return toast(err, true);
    }
  }
  S.ui.outType = type === "unset" ? null : type;
  render();
}

// Keyboard target (keys.js). The box listens only after a click and stops after one key or combo.
const kbKey = () => `map.${S.ui.layer}.${S.ui.sel}.${S.ui.press}`;
function setKeyboard(key, modifier) {
  D.set(kbKey(), { type: "btn_keyboard", key, modifier });
  S.ui.outType = "keyboard";
}
function kbStop(keep = false) {
  Object.assign(S.ui, { kbListen: false, kbHeld: 0, kbPeak: 0 });
  if (!keep) render();
}
function kbListen() {
  Object.assign(S.ui, { kbListen: true, kbHeld: 0, kbPeak: 0, kbList: false });
  render();
}
// keydown/keyup while listening. Every key is taken (Esc and Tab too): cancel is a click.
function kbCapture(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.type === "keydown" && e.repeat) return;
  const bit = MOD_CODE[e.code];
  if (bit) {
    if (e.type === "keydown") {
      S.ui.kbHeld |= bit;
      S.ui.kbPeak |= bit;
    } else {
      S.ui.kbHeld &= ~bit;
      // Modifiers pressed and let go with no other key: the modifier alone (key 0xFF).
      if (!S.ui.kbHeld && S.ui.kbPeak) {
        setKeyboard(MOD_ONLY, S.ui.kbPeak);
        return kbStop();
      }
    }
    return render();
  }
  if (e.type !== "keydown") return;
  const k = keyOfCode(e.code);
  if (!k) return toast(`คีย์ ${e.code || e.key} ไม่อยู่ในรายการที่จอยรับ เลือกคีย์อื่น หรือเลือกจากรายการ`, true);
  setKeyboard(k.key, modsOfEvent(e));
  kbStop();
}

const ACTIONS = {
  "kb-listen": kbListen,
  "kb-cancel": () => kbStop(),
  "kb-list": () => {
    S.ui.kbList = !S.ui.kbList;
    render();
  },
  "kb-pick": (el) => {
    const cur = D.get(kbKey());
    setKeyboard(Number(el.dataset.key), cur?.type === "btn_keyboard" ? cur.modifier ?? 0 : 0);
    render();
  },
  "kb-mod": (el) => {
    const cur = D.get(kbKey());
    const kb = cur?.type === "btn_keyboard" ? cur : null;
    const mod = (kb?.modifier ?? 0) ^ Number(el.dataset.bit);
    const key = kb?.key ?? MOD_ONLY;
    if (key === MOD_ONLY && !mod) return toast("ต้องมีคีย์อย่างน้อย 1 ตัว เลือกคีย์ก่อนแล้วค่อยเอา modifier ออก", true);
    setKeyboard(key, mod);
    render();
  },
  connect,
  disconnect,
  reload: () => loadAll(),
  tab: (el) => {
    S.tab = el.dataset.tab;
    // Leaving the page drops an added press row that is still unused.
    S.ui.addedPress = [];
    const p = S.ui.press;
    S.ui.press = "simple";
    if (S.ui.sel && V.pressRows(S, D).includes(p)) S.ui.press = p;
    history.replaceState(null, "", `#${S.tab}`);
    render();
    window.scrollTo(0, 0);
    $("#view").focus({ preventScroll: true });
  },
  slot: (el) => switchSlot(Number(el.dataset.slot)),
  discard: () => {
    if (!confirm(`ล้างการแก้ทั้งหมด ${D.count()} จุด? ค่าบนจอยไม่เปลี่ยน`)) return;
    D.clear();
    render();
  },
  review: openReview,
  "close-sheet": () => sheet.close(),
  write: () => {
    const plan = macroPlan(S, D);
    if (plan.errors.length) return toast(plan.errors[0], true);
    const { edits, drafts } = writeEdits(D, plan);
    runWrite({ edits, drafts, links: plan.links, motor: D.motorCmds(), light: D.lightWrite(), reason: "ก่อนเขียน", title: "กำลังเขียนลงจอย", doneTitle: "เขียนเสร็จ ตรงกับจอยแล้ว", failTitle: "เขียนไม่สำเร็จ" });
  },
  "see-log": () => {
    sheet.close();
    ACTIONS.tab({ dataset: { tab: "device" } });
  },
  "reload-close": async () => {
    sheet.close();
    await loadAll();
  },
  "restore-last": () => {
    const b = S.backups.find((x) => x.slot === S.current.slot);
    if (b) restoreBackup(b);
  },
  layer: (el) => {
    S.ui.layer = Number(el.dataset.layer);
    render();
  },
  // A click on a layer row focuses that layer (owner, 2026-10-24); a second click lets go.
  "layer-focus": (el) => focusLayer(Number(el.dataset.layer)),
  // Variant B: a matrix cell picks the layer and the kind of press together.
  cell: (el) => {
    S.ui.layer = Number(el.dataset.layer);
    S.ui.press = el.dataset.press;
    S.ui.outType = null;
    render();
  },
  "layer-new": () => {
    const id = nextLayerId(S, D);
    if (id === null) return toast("โปรไฟล์นี้มี layer ครบแล้ว", true);
    D.set(layerKey(id, "new"), true);
    // A name left from a layer that had this id and was never written doesn't carry over.
    S.names.put(S.uuid, layerNameId(S.current.slot, id), "", null);
    S.ui.layer = id;
    if (S.ui.focus != null) S.ui.focus = id;
    render();
    toast(`เพิ่ม ${LAYER_NAME(id)} แล้ว · ยังไม่ได้เขียนลงจอย`);
  },
  "press-menu": () => {
    S.ui.pressMenu = !S.ui.pressMenu;
    render();
    if (S.ui.pressMenu) document.querySelector(".menu [role=menuitem]:not(:disabled)")?.focus();
  },
  // Adds a long or double press row and opens its cell in the layer being edited.
  "press-add": (el) => {
    const p = el.dataset.press;
    S.ui.pressMenu = false;
    S.ui.addedPress = [...new Set([...S.ui.addedPress, p])];
    S.ui.press = p;
    S.ui.outType = null;
    render();
  },
  // Layer names live in the app (model.js LAYER_NAME), in a modal (views.js layerRename).
  "layer-rename": (el) => {
    S.ui.layerMenu = null;
    showSheet(V.layerRename(S, Number(el.dataset.layer)));
    const input = sheet.querySelector("[data-layer-name]");
    input?.focus();
    input?.select();
  },
  "layer-name-save": (el) => saveLayerName(Number(el.dataset.layer)),
  "layer-menu": (el) => {
    const id = Number(el.dataset.layer);
    S.ui.layerMenu = S.ui.layerMenu === id ? null : id;
    render();
    if (S.ui.layerMenu === id) document.querySelector(".menu [role=menuitem]:not(:disabled)")?.focus();
  },
  // Deleting a layer asks first (owner, 2026-10-23); once confirmed the layer is gone from the page.
  "layer-ask-delete": (el) => {
    S.ui.layerMenu = null;
    render();
    showSheet(V.layerDelete(S, D, Number(el.dataset.layer)));
    sheet.querySelector(".btn.danger")?.focus();
  },
  "layer-delete": (el) => {
    const id = Number(el.dataset.layer);
    if (!id) return;
    // Drafts in that layer go with it, and so do drafted presses that switch to it.
    D.clear(`map.${id}.`);
    for (const k of D.pendingKeys("map.")) {
      const v = D.map.get(k);
      if ((v?.type === "layer_hold" || v?.type === "layer_toggle") && v.layer === id) D.map.delete(k);
    }
    // What is on the controller is only marked; a layer that was never written is just dropped.
    const isNew = D.has(layerKey(id, "new"));
    if (isNew) D.map.delete(layerKey(id, "new"));
    else D.set(layerKey(id, "delete"), true);
    S.ui.layer = 0;
    S.ui.press = "simple";
    if (S.ui.focus === id) S.ui.focus = null;
    if (sheet.open) sheet.close();
    render();
    toast(isNew ? `เอา ${LAYER_NAME(id)} ออกแล้ว` : `ลบ ${LAYER_NAME(id)} แล้ว · ยังไม่ได้เขียนลงจอย`);
  },
  "layer-mode": (el) => {
    const key = `map.${S.ui.layer}.${S.ui.sel}.${S.ui.press}`;
    const cur = D.get(key);
    S.ui.layerMode = el.dataset.mode;
    if (cur?.type === "layer_hold" || cur?.type === "layer_toggle") D.set(key, { type: el.dataset.mode === "toggle" ? "layer_toggle" : "layer_hold", layer: cur.layer });
    render();
  },
  press: (el) => {
    S.ui.press = el.dataset.press;
    S.ui.outType = null;
    render();
  },
  outtype: (el) => {
    S.ui.outType = el.dataset.type;
    render();
  },
  out: setOutput,
  dpad: (el) => {
    S.ui.dpad = el.dataset.dir;
    selectSource(el.dataset.dir);
    render();
  },
  "revert-btn": () => {
    D.clear(`map.${S.ui.layer}.${S.ui.sel}.`);
    S.ui.outType = null;
    render();
  },
  // Back to the factory default, whatever the controller holds: a normal press of the button itself.
  "factory-btn": () => {
    const { layer, sel } = S.ui;
    D.set(`map.${layer}.${sel}.simple`, { type: "btn_gamepad", button: sel });
    for (const press of ["long", "double"]) {
      const key = `map.${layer}.${sel}.${press}`;
      if (D.base(key) === undefined) D.map.delete(key);
      else D.map.set(key, undefined);
    }
    S.ui.press = "simple";
    S.ui.outType = null;
    render();
  },
  "pick-src": (el) => {
    // In a row that isn't focused, a click anywhere, its mapped buttons included, focuses the layer
    // (owner, 2026-10-24: the whole row selects). Once focused, a mapped button picks that button.
    if (S.ui.focus !== Number(el.dataset.layer)) return focusLayer(Number(el.dataset.layer));
    const src = el.dataset.src;
    if (src.startsWith("D-pad")) S.ui.dpad = src;
    selectSource(src);
    S.ui.layer = Number(el.dataset.layer);
    // A button picked from another layer's row moves the focus there, so the matrix shows its cell.
    if (S.ui.focus != null) S.ui.focus = S.ui.layer;
    render();
  },
  "led-color": (el) => {
    // The click that ends a long press (which deletes a made color) doesn't pick it too.
    if (pressed.fired) {
      pressed.fired = false;
      return;
    }
    S.ui.picker = null;
    setLedColor(el.dataset.val);
    render();
  },
  "color-new": () => {
    S.ui.picker = S.ui.picker ? null : hexToHsv(ledColorNow() ?? GOLD);
    render();
    document.querySelector("[data-picker-hex]")?.focus();
  },
  "picker-cancel": () => closePicker(),
  "picker-apply": () => applyPicked(),
  "led-pick": (el) => {
    S.ui.ledPick = Number(el.dataset.i);
    render();
  },
  "led-add": () => {
    const list = D.get("led.colors");
    if (list.length >= LIGHT_COLORS_MAX) return toast(`ใส่ได้ไม่เกิน ${LIGHT_COLORS_MAX} สี`, true);
    setDraft("led.colors", [...list, list[list.length - 1]]);
    S.ui.ledPick = list.length;
    render();
  },
  "led-del": () => {
    const list = D.get("led.colors");
    if (list.length <= 1) return;
    setDraft("led.colors", list.filter((_, i) => i !== S.ui.ledPick));
    S.ui.ledPick = Math.max(0, S.ui.ledPick - 1);
    render();
  },
  set: (el) => {
    const v = "numval" in el.dataset ? Number(el.dataset.val) : el.dataset.val;
    if (el.dataset.key === "gyro.mode") {
      setGyroMode(v);
      render();
      return;
    }
    setDraft(el.dataset.key, v);
    render();
  },
  // Gyro activation buttons: the list is one draft value ("gyro.activation").
  "gyro-act-mode": (el) => {
    setDraft("gyro.activation", (D.get("gyro.activation") ?? []).map((a) => ({ ...a, activation: el.dataset.val })));
    render();
  },
  // Gyro curve: add a mid point halfway along the last segment, remove one, or go back to a straight line.
  "gyro-mid-add": () => {
    const c = structuredClone(D.get("gyro.curve"));
    if (c.mid_points.length >= GYRO_MIDS_MAX) return;
    const p = c.mid_points.at(-1) ?? { x: c.start_x, y: c.start_y };
    c.mid_points.push({ x: Math.round((p.x + c.end_x) / 2), y: Math.round((p.y + c.end_y) / 2) });
    setDraft("gyro.curve", c);
    render();
  },
  "gyro-mid-del": (el) => {
    const c = structuredClone(D.get("gyro.curve"));
    c.mid_points.splice(Number(el.dataset.i), 1);
    setDraft("gyro.curve", c);
    render();
  },
  "gyro-accel": (el) => {
    setGyroSimple("accel", Number(el.dataset.val));
    render();
  },
  // Gyro response tab: simple controls (0) or the curve itself (1).
  "gyro-view": (el) => {
    S.ui.gyroAdv = el.dataset.val === "1";
    render();
  },
  // Gyro axes: show the full selects instead of the Yaw / Roll choice.
  "gyro-axes": () => {
    S.ui.gyroAxes = true;
    render();
  },
  "gyro-curve-reset": () => {
    setDraft("gyro.curve", { start_x: 0, start_y: 0, end_x: 255, end_y: 255, mid_points: [] });
    render();
  },
  "aim-center": () => {
    AIM.x = AIM.y = 0;
  },
  "copy-side": (el) => {
    const { from, to } = el.dataset;
    const fields = from.startsWith("stick") ? ["deadzone", "max", "invertX", "invertY", "round", "preset"] : ["start", "end", "preset"];
    for (const f of fields) {
      try {
        setDraft(to + f, D.get(from + f));
      } catch {}
    }
    render();
    toast("คัดลอกแล้ว · ยังไม่ได้เขียนลงจอย");
  },
  rename: (el) => {
    const i = Number(el.dataset.slot);
    S.ui.renaming = i;
    // Other slots are renamed in the app straight away; keep the old name for Esc.
    S.ui.renameFrom = i === S.current?.slot ? null : { id: `slot.${i}`, e: S.names.entry(S.uuid, `slot.${i}`) };
    render();
    const input = document.querySelector(`[data-rename="${el.dataset.slot}"]`);
    input?.focus();
    input?.select();
  },
  macro: (el) => {
    S.ui.macro = el.dataset.uid;
    S.ui.step = 0;
    render();
  },
  step: (el) => {
    S.ui.step = Number(el.dataset.i);
    render();
  },
  "macro-new": () => {
    const names = new Set(S.lib.list().map((m) => m.name));
    let n = S.lib.list().length + 1;
    while (names.has(`Macro ${n}`)) n++;
    const m = S.lib.add({ name: `Macro ${n}`, mode: "press_once", actions: [] });
    S.ui.macro = m.uid;
    S.ui.macroQ = "";
    S.ui.step = 0;
    render();
    const name = document.querySelector("[data-name-field] input");
    name?.focus();
    name?.select();
  },
  "macro-copy": () => {
    const m = openMacro(S);
    if (!m) return;
    const c = S.lib.add({ ...structuredClone(m), name: `${m.name} (สำเนา)`.slice(0, 60), named: true });
    S.ui.macro = c.uid;
    render();
  },
  // Only from the library: a macro that a button of this slot still plays has to be unbound first.
  "macro-delete": () => {
    const m = openMacro(S);
    if (!m) return;
    const uses = macroUses(S, D, m.uid);
    if (uses.length) {
      const where = uses.map((u) => `${btnName(u.source)}${u.layer ? ` (${LAYER_NAME(u.layer)})` : ""}`);
      return toast(`ปุ่ม ${[...new Set(where)].join(", ")} ยังเล่น macro นี้อยู่ เปลี่ยนปุ่มนั้นที่หน้า Buttons ก่อน`, true);
    }
    if (!confirm(`ลบ "${m.name}" ออกจากคลัง?\n\nถ้ายังมีอยู่ใน slot อื่นของจอย แอปจะเอากลับเข้าคลังตอนเปิด slot นั้น`)) return;
    S.lib.remove(m.uid);
    S.ui.macro = null;
    render();
  },
  "macro-mode": (el) => {
    const m = openMacro(S);
    if (m) S.lib.update(m.uid, { mode: el.dataset.val });
    render();
  },
  // A step is a press and a release of one button. The next one starts after the gap.
  "step-add": (el) => {
    const m = openMacro(S);
    if (!m) return;
    const hold = Math.min(2000, Math.max(10, Math.round(S.ui.hold ?? 50)));
    const gap = Math.min(2000, Math.max(0, Math.round(S.ui.gap ?? 50)));
    const end = m.actions.reduce((t, a) => Math.max(t, a.at_ms), -1);
    const at = end < 0 ? 0 : end + gap;
    if (m.actions.length + 2 > MACRO_STEPS_MAX) return toast("macro ยาวเกินที่จอยเก็บได้", true);
    if (at + hold > 0xffff) return toast("macro นี้ยาวเกิน 65 วินาที", true);
    const target = { type: "btn_gamepad", button: el.dataset.btn };
    S.lib.update(m.uid, { actions: [...m.actions, { action: "press", target, at_ms: at }, { action: "release", target, at_ms: at + hold }] });
    S.ui.step = Infinity;
    render();
  },
  // Removes the step that starts last: its press and the release that ends it.
  "step-undo": () => {
    const m = openMacro(S);
    if (!m?.actions.length) return;
    const acts = m.actions;
    let p = -1;
    acts.forEach((a, i) => {
      if (a.action === "press" && (p < 0 || a.at_ms >= acts[p].at_ms)) p = i;
    });
    const k = p < 0 ? null : JSON.stringify(acts[p].target);
    const r = p < 0 ? acts.length - 1 : acts.findIndex((a, i) => i > p && a.action === "release" && JSON.stringify(a.target) === k);
    S.lib.update(m.uid, { actions: acts.filter((_, i) => i !== p && i !== r) });
    S.ui.step = 0;
    render();
  },
  "lib-export": () => {
    const data = new TextEncoder().encode(JSON.stringify(S.lib.export(), null, 2));
    download(data, `apex6-macros-${S.lib.list().length}.json`);
  },
  "lib-import": () => $("#lib-in").click(),
  "pf-apply": (el) => {
    const p = S.profiles.get(el.dataset.id);
    const slot = Number(document.querySelector(`[data-pf-slot="${el.dataset.id}"]`)?.value);
    if (p && slot >= 0 && slot < 4) applyProfile(p, slot);
  },
  "slot-menu": (el) => {
    const i = Number(el.dataset.slot);
    S.ui.slotMenu = S.ui.slotMenu === i ? null : i;
    render();
    if (S.ui.slotMenu === i) document.querySelector(".menu [role=menuitem]:not(:disabled)")?.focus();
  },
  "pf-move": (el) => {
    S.ui.slotMenu = null;
    render();
    resetSlot(Number(el.dataset.slot), { keep: true });
  },
  "pf-reset": (el) => {
    S.ui.slotMenu = null;
    render();
    resetSlot(Number(el.dataset.slot), { keep: false });
  },
  "pf-rename": (el) => {
    const p = S.profiles.get(el.dataset.id);
    if (p) renameProfile(p);
  },
  "pf-delete": (el) => {
    const p = S.profiles.get(el.dataset.id);
    if (!p || !confirm(`ลบ "${p.name}" ออกจากคลัง?\n\nslot บนจอยไม่เปลี่ยน`)) return;
    S.profiles.remove(p.uid);
    render();
  },
  "bk-dl": (el) => {
    const b = S.backups.find((x) => x.id === el.dataset.id);
    if (b) download(unb64(b.data), `apex6-slot${b.slot + 1}-${b.at}.bin`);
  },
  "bk-restore": (el) => {
    const b = S.backups.find((x) => x.id === el.dataset.id);
    if (b) restoreBackup(b);
  },
  "backup-now": async () => {
    try {
      const { data, activeSlot } = await S.pad.readRam(RAM.MAPPING);
      unwrapMapping(data);
      backup(data, activeSlot, "สำรองเอง");
      render();
      toast(`สำรอง Slot ${activeSlot + 1} แล้ว และดาวน์โหลดเป็นไฟล์`);
    } catch (e) {
      toast(`สำรองไม่สำเร็จ: ${e.message}`, true);
    }
  },
  import: () => $("#file-in").click(),
  // The app and the controller disagree on a name (names.js): take the app's as a draft to write,
  // or take the controller's and forget the app's.
  "name-use-app": (el) => {
    setDraft(el.dataset.key, el.dataset.full);
    render();
  },
  "name-use-dev": (el) => {
    const { key } = el.dataset;
    const dev = S.current.cfg.name ?? "";
    S.names.put(S.uuid, nameId(key), dev, dev);
    resolveNames(S);
    D.prune();
    render();
  },
  "names-export": () => {
    const data = new TextEncoder().encode(JSON.stringify(S.names.export(S.uuid), null, 2));
    download(data, `apex6-names-${(S.uuid ?? "unknown").slice(-6)}.json`);
  },
  "names-import": () => $("#names-in").click(),
  "vault-link": async () => {
    try {
      await folderResult(await S.folder.link());
    } catch (e) {
      if (e?.name !== "AbortError") toast(`ใช้โฟลเดอร์นี้ไม่ได้: ${e.message}`, true);
    }
  },
  "vault-allow": async () => {
    try {
      const res = await S.folder.allow();
      if (S.folder.state === "permission") return toast("เบราว์เซอร์ยังไม่อนุญาต กดอีกครั้งแล้วเลือก “อนุญาต”", true);
      await folderResult(res);
    } catch (e) {
      toast(`บันทึกลงโฟลเดอร์ไม่ได้: ${e.message}`, true);
    }
  },
  "vault-unlink": async () => {
    if (!confirm(`เลิกบันทึกลงโฟลเดอร์ "${S.folder.name}"?\n\nไฟล์ที่บันทึกไว้แล้วยังอยู่ในโฟลเดอร์ ข้อมูลในแอปยังอยู่ในเบราว์เซอร์นี้`)) return;
    await S.folder.unlink();
    toast("เลิกบันทึกลงโฟลเดอร์แล้ว ข้อมูลเก็บในเบราว์เซอร์นี้อย่างเดียว");
  },
  "vault-export": () => {
    downloadData("apex6-data");
    toast("ดาวน์โหลดไฟล์ข้อมูลแล้ว เก็บไว้ในที่ปลอดภัย เช่น Google Drive");
  },
  "vault-import": () => $("#vault-in").click(),
  "log-clear": () => {
    S.log = [];
    scheduleLog();
  },
  "log-copy": async () => {
    try {
      await navigator.clipboard.writeText(S.log.map((l) => l.text).join("\n"));
      toast("คัดลอก packet log แล้ว");
    } catch {
      toast("คัดลอกไม่ได้ ลองเลือกข้อความแล้วกด Ctrl+C", true);
    }
  },
  dump: async (el) => {
    const ram = Number(el.dataset.ram);
    try {
      const { data, activeSlot } = await S.pad.readRam(ram, (i, n) => {
        S.dumpStatus = `chunk ${i}/${n}`;
      });
      S.dump = { ram, data, text: hexdump(data) };
      S.dumpStatus = `RAM 0x${ram.toString(16).padStart(2, "0")} · ${data.length} bytes · slot ${activeSlot + 1}`;
    } catch (e) {
      S.dumpStatus = e.message;
    }
    render();
  },
  "dump-dl": () => S.dump && download(S.dump.data, `apex6-ram-0x${S.dump.ram.toString(16).padStart(2, "0")}-${Date.now()}.bin`),
};

function restoreBackup(b) {
  if (sheet.open) sheet.close();
  if (b.slot !== S.current.slot) return toast(`ไฟล์นี้เป็นของ Slot ${b.slot + 1} สลับไปใช้ slot นั้นก่อน`, true);
  if (!confirm(`กู้คืนไฟล์สำรองเมื่อ ${V.fmtWhen(b.at)} ลง Slot ${b.slot + 1}?\n\nค่าทั้งหมดใน slot นี้จะถูกแทนที่ แอปจะสำรองค่าปัจจุบันให้ก่อน`)) return;
  runWrite({ data: unb64(b.data), reason: "ก่อนกู้คืน", title: "กำลังกู้คืน", doneTitle: "กู้คืนเสร็จ ตรงกับจอยแล้ว", failTitle: "กู้คืนไม่สำเร็จ" });
}

function hexdump(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 16) {
    const row = b.slice(i, i + 16);
    const ascii = Array.from(row, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    s += `${i.toString(16).padStart(4, "0")}  ${hex(row).padEnd(47)}  ${ascii}\n`;
  }
  return s || "(ว่าง)";
}

document.addEventListener("click", (e) => {
  // A click anywhere but the listening key box stops it and keeps the key there was.
  if (S.ui.kbListen && !e.target.closest("[data-kb-box]")) {
    kbStop(true);
    if (!e.target.closest("[data-act]")) return render();
  }
  // A click outside the color picker closes it (the + button toggles it itself).
  if (S.ui.picker && !e.target.closest("[data-picker]") && !e.target.closest('[data-act="color-new"]')) {
    S.ui.picker = null;
    if (!e.target.closest("[data-act]")) return render();
  }
  let closed = false;
  if (S.ui.slotMenu != null && !e.target.closest(".menu-wrap")) {
    S.ui.slotMenu = null;
    closed = true;
    render();
  }
  if (S.ui.pressMenu && !e.target.closest(".menu-wrap")) {
    S.ui.pressMenu = false;
    closed = true;
    render();
  }
  if (S.ui.layerMenu != null && !e.target.closest(".menu-wrap")) {
    S.ui.layerMenu = null;
    closed = true;
    render();
  }
  const el = e.target.closest("[data-act]");
  if (el && !el.disabled) {
    const fn = ACTIONS[el.dataset.act];
    if (fn) {
      e.preventDefault();
      fn(el);
    }
    return;
  }
  const co = e.target.closest("[data-pick]");
  if (co) return pick(co.dataset.pick);
  // Buttons: a click on empty space lets go of the picked button. A click that only closed a menu
  // doesn't, and nothing in the right-hand panel or on any control does.
  if (!closed && isEmptyClick(e.target)) unpick();
});

const isEmptyClick = (t) =>
  S.tab === "buttons" && (S.ui.sel || V.focusOf(S, D) != null) && !sheet.open && t.isConnected !== false && !t.closest(".btn-panel, button, input, select, textarea, a, label, dialog, [contenteditable]");

// Lets go one step at a time: the picked button first, then the focused layer.
function unpick() {
  if (!S.ui.sel) {
    S.ui.focus = null;
    return render();
  }
  S.ui.sel = null;
  S.ui.addedPress = [];
  S.ui.pressMenu = false;
  S.ui.outType = null;
  render();
}

// Capture phase, so nothing else on the page sees a key meant for the controller.
window.addEventListener("keydown", (e) => S.ui.kbListen && kbCapture(e), true);
window.addEventListener("keyup", (e) => S.ui.kbListen && kbCapture(e), true);
window.addEventListener("blur", () => S.ui.kbListen && kbStop());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.ui.picker) return closePicker();
  if (e.key === "Enter" && e.target.matches?.("[data-picker-hex]")) {
    e.preventDefault();
    if (normHex(e.target.value)) applyPicked();
    else toast("รหัสสีต้องเป็นตัวเลขฐาน 16 หกตัว เช่น 00B8A9", true);
    return;
  }
  const own = e.target.closest?.("[data-custom]");
  if (own && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    return deleteCustom(own.dataset.custom);
  }
  if (e.key === "Escape" && S.ui.slotMenu != null) {
    const i = S.ui.slotMenu;
    S.ui.slotMenu = null;
    render();
    document.querySelector(`[data-act="slot-menu"][data-slot="${i}"]`)?.focus();
    return;
  }
  if (e.key === "Escape" && S.ui.pressMenu) {
    S.ui.pressMenu = false;
    render();
    document.querySelector('[data-act="press-menu"]')?.focus();
    return;
  }
  if (e.key === "Escape" && S.ui.layerMenu != null) {
    const id = S.ui.layerMenu;
    S.ui.layerMenu = null;
    render();
    document.querySelector(`[data-act="layer-menu"][data-layer="${id}"]`)?.focus();
    return;
  }
  if (e.key === "Escape" && S.tab === "buttons" && (S.ui.sel || V.focusOf(S, D) != null) && !sheet.open && !e.target.closest?.("input, select, textarea, [contenteditable]")) return unpick();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".layer-group[data-act=layer-focus]")) {
    e.preventDefault();
    return focusLayer(Number(e.target.dataset.layer));
  }
  const co = e.target.closest?.("[data-pick]");
  if (co && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    pick(co.dataset.pick);
  }
  const ln = e.target.closest?.("[data-layer-name]");
  if (ln && e.key === "Enter") {
    e.preventDefault();
    return saveLayerName(Number(ln.dataset.layerName));
  }
  const rn = e.target.closest?.("[data-rename]");
  if (rn && (e.key === "Enter" || e.key === "Escape")) {
    if (e.key === "Escape") {
      D.map.delete(rn.dataset.key);
      const from = S.ui.renameFrom;
      if (from) S.names.put(S.uuid, from.id, from.e?.full ?? "", from.e ? from.e.dev : null);
    }
    S.ui.renameFrom = null;
    S.ui.renaming = null;
    render();
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.matches?.("[data-picker-hex]")) {
    const hex = normHex(el.value);
    if (hex && S.ui.picker) {
      S.ui.picker = hexToHsv(hex);
      drawPicker({ keepHex: true });
    }
    return;
  }
  if (el.dataset.act === "turbo-iv") {
    const key = `map.${S.ui.layer}.${S.ui.sel}.${S.ui.press}`;
    const cur = D.get(key);
    if (cur?.type === "turbo_gamepad") D.set(key, { ...cur, interval_ms: Number(el.value) });
    el.style.setProperty("--p", `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
    el.closest(".slider").querySelector(".num").textContent = `${el.value} ms`;
    renderChrome();
    return;
  }
  if (el.dataset.curve) {
    // Gyro curve slider, in percent: keep the point in order, then update the label and chart in place.
    const p = gyroPct(setCurvePart(el.dataset.curve, gyroByte(Number(el.value))));
    if (p !== Number(el.value)) el.value = p;
    el.style.setProperty("--p", `${p}%`);
    el.closest(".slider").querySelector(".num").textContent = `${p}%`;
    const chart = document.querySelector("[data-gyro-chart]");
    if (chart) chart.innerHTML = V.gyroChart(D.get("gyro.curve"), D.has("gyro.curve"));
    renderChrome();
    return;
  }
  if (el.dataset.gsimple) {
    // Gyro simple slider: rebuild the curve, then update the label and the preview in place.
    const v = setGyroSimple(el.dataset.gsimple, Number(el.value));
    el.closest(".slider").querySelector(".num").textContent = `${v}%`;
    el.style.setProperty("--p", `${v}%`);
    const chart = document.querySelector("[data-gyro-preview]");
    if (chart) chart.innerHTML = V.gyroChart(D.get("gyro.curve"), D.has("gyro.curve"), true);
    renderChrome();
    return;
  }
  if (el.dataset.ui) {
    // Page settings that are not part of any draft (the macro step builder's timing).
    S.ui[el.dataset.ui] = Number(el.value);
    return;
  }
  if (el.dataset.filter) {
    // Macro list filters: redraw the page and put the caret back where it was.
    S.ui[el.dataset.filter] = el.value;
    const at = el.selectionStart;
    render();
    const f = document.querySelector(`[data-filter="${el.dataset.filter}"]`);
    f?.focus();
    f?.setSelectionRange(at, at);
    return;
  }
  if (el.dataset.libName != null) {
    // The app keeps a library macro's name straight away; copies on the controller follow on the next write.
    const m = openMacro(S);
    if (m) S.lib.update(m.uid, { name: el.value.trim() || el.dataset.default });
    const fitEl = el.closest("[data-name-field]")?.querySelector("[data-fit]");
    if (fitEl) fitEl.outerHTML = V.nameFit(el.value);
    renderChrome();
    return;
  }
  const key = el.dataset.key;
  if (!key || !S.current) return;
  if (el.type === "range") {
    const v = setDraft(key, Number(el.value));
    if (Number(el.value) !== v) el.value = v;
    softUpdate(key);
  } else if (el.type === "text" || el.tagName === "INPUT") {
    if ("num" in el.dataset || "hex" in el.dataset || el.type === "checkbox") return;
    const slot = key.match(/^slot\.(\d)\.name$/)?.[1];
    if (slot != null && Number(slot) !== S.current.slot) {
      // A slot that isn't loaded can't be written: its name is kept in the app until it is.
      S.names.put(S.uuid, `slot.${slot}`, el.value, null);
    } else {
      // A cleared macro name means "back to the default name", not a name that is empty.
      D.set(key, el.value === "" && el.dataset.default ? el.dataset.default : el.value);
      el.classList.toggle("pending", D.has(key));
    }
    const fitEl = el.closest("[data-name-field]")?.querySelector("[data-fit]");
    if (fitEl) fitEl.outerHTML = V.nameFit(el.value);
    renderChrome();
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "file-in") return importFile(el);
  if (el.id === "names-in") return importNames(el);
  if (el.id === "lib-in") return importLibrary(el);
  if (el.id === "vault-in") return importVault(el);
  if (el.dataset.libName != null) return render();
  if (el.dataset.curve || el.dataset.gsimple) return render();
  if (el.dataset.mid != null) {
    setCurvePart(`mid_${el.dataset.axis}`, Number(el.value) || 0, Number(el.dataset.mid));
    return render();
  }
  if (el.dataset.gyroBtn != null) {
    setGyroButton(Number(el.dataset.gyroBtn), el.value);
    return render();
  }
  const key = el.dataset.key;
  if (!key || !S.current) return;
  if (el.type === "checkbox") setDraft(key, el.checked);
  else if (el.tagName === "SELECT") setDraft(key, el.value);
  else if ("num" in el.dataset) {
    const v = Math.round(Number(el.value));
    const lo = Number(el.min), hi = Number(el.max);
    if (!Number.isFinite(v) || v < lo || v > hi) {
      toast(`ใส่ได้ ${lo}–${hi} ms`, true);
    } else setDraft(key, v);
  } else if ("hex" in el.dataset) {
    const m = el.value.trim().match(/^#?([0-9a-f]{6})$/i);
    if (m) setDraft(key, `#${m[1].toUpperCase()}`);
    else if (el.value.trim()) toast("รหัสสีต้องเป็น #RRGGBB", true);
  } else if (el.type === "range") {
    // already applied on input
  } else if ("rename" in el.dataset) {
    return;
  }
  render();
});

// Saves the name typed in the rename modal, trimmed; empty means the default name. Another layer's
// name is refused: two layers with one name can't be told apart in the matrix or the write review.
function saveLayerName(id) {
  const input = sheet.querySelector("[data-layer-name]");
  if (!input || !S.current) return;
  const name = input.value.trim();
  const clash = name && layerList(S, D).find((l) => !l.deleted && l.id !== id && LAYER_NAME(l.id).toLowerCase() === name.toLowerCase());
  if (clash) {
    sheet.querySelector("#layer-name-err").textContent = `มี layer ชื่อ "${name}" อยู่แล้ว ตั้งชื่ออื่น`;
    return input.focus();
  }
  S.names.put(S.uuid, layerNameId(S.current.slot, id), name, null);
  // The close event renders the page; then focus goes back to this layer's pencil.
  sheet.addEventListener("close", () => document.querySelector(`[data-act="layer-rename"][data-layer="${id}"]`)?.focus(), { once: true });
  sheet.close();
}

async function importNames(el) {
  const file = el.files[0];
  el.value = "";
  if (!file) return;
  try {
    const n = S.names.import(S.uuid, JSON.parse(await file.text()));
    resolveNames(S);
    D.prune();
    render();
    toast(`นำเข้า ${n} ชื่อแล้ว`);
  } catch (err) {
    toast(`ใช้ไฟล์นี้ไม่ได้: ${err.message}`, true);
  }
}

// ---------------- App data outside the browser (vault.js) ----------------

const AFTER_LOAD = "apex6.afterLoad"; // sessionStorage: a message for when the page is back

// The libraries read their data once, when the app starts, so new data needs the page loaded again.
function reloadWith(msg) {
  sessionStorage.setItem(AFTER_LOAD, msg);
  location.reload();
}

function downloadData(name) {
  const text = JSON.stringify(snapshot(localStorage), null, 1);
  download(new TextEncoder().encode(text), `${name}-${stamp(Date.now(), true)}.json`);
}

// Asks before data in the app is replaced. The data it replaces is downloaded first, as the slot
// backups are before a write.
// cancel: what Cancel does, when it does more than leave things as they are.
function okToReplace(lines, cancel = "ยกเลิก = ไม่เปลี่ยนอะไร") {
  if (S.writing) {
    toast("รอให้เขียนลงจอยเสร็จก่อน", true);
    return false;
  }
  const n = D.count();
  const ok = ["ตกลง = ใช้ข้อมูลนี้แทน ข้อมูลตอนนี้ในแอปดาวน์โหลดเก็บเป็นไฟล์ไว้ให้ก่อน แล้วหน้าจะโหลดใหม่", ...(n ? [`(การแก้ ${n} จุดที่ยังไม่ได้เขียนลงจอยจะหาย)`] : [])];
  if (!confirm([...lines, "", ...ok, cancel].join("\n"))) return false;
  if (hasData(localStorage)) downloadData("apex6-data-before");
  return true;
}

const savedOn = (t) => (t ? new Date(t).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "ไม่ทราบเวลา");

// What the folder found (Folder.sync): its data for a browser that has none, or a choice.
async function folderResult(res) {
  if (res?.restore) {
    if (D.count() && !okToReplace([`ดึงข้อมูลจากโฟลเดอร์ "${S.folder.name}": ${summary(res.restore)}`])) return render();
    replaceAll(localStorage, res.restore, { fromFolder: true });
    return reloadWith(`ดึงข้อมูลกลับจากโฟลเดอร์ ${S.folder.name} แล้ว: ${summary(res.restore)}`);
  }
  if (res?.ask) {
    const there = summary(res.ask), here = S.dataSummary();
    const take = okToReplace(
      [
        `โฟลเดอร์ "${S.folder.name}" มีข้อมูลที่ต่างจากในแอปตอนนี้ (อาจบันทึกจากเครื่องหรือเบราว์เซอร์อื่น) ใช้ข้อมูลจากโฟลเดอร์ไหม?`,
        "",
        `ในโฟลเดอร์ (บันทึก ${savedOn(res.ask.at)}): ${there}`,
        `ในแอปตอนนี้: ${here}`,
        ...(there === here ? ["จำนวนเท่ากัน แต่รายละเอียดข้างในไม่ตรงกัน"] : []),
      ],
      "ยกเลิก = ใช้ข้อมูลในแอปตอนนี้ และบันทึกทับไฟล์ในโฟลเดอร์ ข้อมูลเดิมในโฟลเดอร์เก็บแยกไว้เป็นไฟล์ apex6-data-before-…",
    );
    if (take) {
      replaceAll(localStorage, res.ask, { fromFolder: true });
      return reloadWith(`ใช้ข้อมูลจากโฟลเดอร์ ${S.folder.name} แล้ว`);
    }
    await S.folder.keepLocal(res.ask);
  }
  render();
}

async function importVault(el) {
  const file = el.files[0];
  el.value = "";
  if (!file) return;
  let snap;
  try {
    snap = parseSnapshot(await file.text());
  } catch (err) {
    return toast(`ใช้ไฟล์นี้ไม่ได้: ${err.message}`, true);
  }
  if (!okToReplace([`ใช้ข้อมูลจากไฟล์ "${file.name}" แทนข้อมูลทั้งหมดในแอปตอนนี้?`, "", `ในไฟล์ (บันทึก ${savedOn(snap.at)}): ${summary(snap)}`, `ในแอปตอนนี้: ${S.dataSummary()}`])) return;
  replaceAll(localStorage, snap);
  // The folder follows the app: it gets the file's data before the page loads again.
  if (S.folder.state === "ok") await S.folder.write();
  reloadWith(`นำเข้าข้อมูลจาก ${file.name} แล้ว: ${summary(snap)}`);
}

async function importLibrary(el) {
  const file = el.files[0];
  el.value = "";
  if (!file) return;
  try {
    const n = S.lib.import(JSON.parse(await file.text()));
    render();
    toast(n ? `นำเข้า ${n} macro แล้ว` : "macro ในไฟล์นี้มีอยู่ในคลังแล้วทั้งหมด");
  } catch (err) {
    toast(`ใช้ไฟล์นี้ไม่ได้: ${err.message}`, true);
  }
}

async function importFile(el) {
  const file = el.files[0];
  el.value = "";
  if (!file || !S.current) return;
  let data, cfg;
  try {
    data = new Uint8Array(await file.arrayBuffer());
    cfg = unwrapMapping(data).cfg;
  } catch (err) {
    return toast(`ใช้ไฟล์นี้ไม่ได้: ${err.message}`, true);
  }
  const slot = S.current.slot;
  if (!confirm(`เขียน "${file.name}"${cfg.name ? ` (${cfg.name})` : ""} ลง Slot ${slot + 1}?\n\nค่าทั้งหมดใน slot นี้จะถูกแทนที่ แอปจะสำรองค่าปัจจุบันให้ก่อน`)) return;
  runWrite({ data, reason: "ก่อนนำเข้าไฟล์", title: "กำลังเขียนไฟล์ลงจอย", doneTitle: "เขียนเสร็จ ตรงกับจอยแล้ว", failTitle: "เขียนไม่สำเร็จ" });
}

window.addEventListener("hashchange", () => {
  const t = tabFromHash();
  if (t !== S.tab) {
    S.tab = t;
    render();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (S.writing || D.count()) e.preventDefault();
});

// Gyro curve chart: drag a point, or press on the line to add a mid point there and drag it. The
// chart is redrawn in place while dragging and the page once the pointer is let go.
let gyroDrag = null;

// Pointer position on the chart as curve bytes (0–255 on both axes).
function chartPos(box, e) {
  const svg = box.querySelector("svg");
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  const b = (v) => Math.max(0, Math.min(255, Math.round((v / 300) * 255)));
  return { x: b(q.x), y: b(300 - q.y) };
}

// Moves one point ("start", "end", "mid0", "mid1"); x stays between its neighbours.
function moveCurvePoint(pt, { x, y }) {
  const c = structuredClone(D.get("gyro.curve"));
  const m = c.mid_points;
  if (pt === "start") Object.assign(c, { start_x: Math.min(x, m[0]?.x ?? c.end_x), start_y: y });
  else if (pt === "end") Object.assign(c, { end_x: Math.max(x, m.at(-1)?.x ?? c.start_x), end_y: y });
  else {
    const i = Number(pt.slice(3));
    m[i] = { x: Math.max(i ? m[i - 1].x : c.start_x, Math.min(x, m[i + 1]?.x ?? c.end_x)), y };
  }
  setDraft("gyro.curve", c);
}

// Adds a mid point at the pointer, in order by x. Returns its index, or null when there are two.
function addMidAt({ x, y }) {
  const c = structuredClone(D.get("gyro.curve"));
  const m = c.mid_points;
  if (m.length >= GYRO_MIDS_MAX) return null;
  const i = m.filter((p) => p.x < x).length;
  m.splice(i, 0, { x: Math.max(i ? m[i - 1].x : c.start_x, Math.min(x, m[i]?.x ?? c.end_x)), y });
  setDraft("gyro.curve", c);
  return i;
}

function redrawGyroChart(box) {
  box.innerHTML = V.gyroChart(D.get("gyro.curve"), D.has("gyro.curve"));
  renderChrome();
}

document.addEventListener("pointerdown", (e) => {
  pressed.fired = false;
  const area = e.target.closest?.("[data-sv], [data-hue]");
  if (area && e.button === 0) {
    e.preventDefault();
    pickDrag = "sv" in area.dataset ? "sv" : "hue";
    try {
      area.setPointerCapture(e.pointerId);
    } catch {}
    pickAt(e);
    return;
  }
  const own = e.target.closest?.("[data-custom]");
  if (own && e.button === 0) {
    cancelPress();
    pressed.timer = setTimeout(() => {
      pressed.timer = null;
      pressed.fired = true;
      deleteCustom(own.dataset.custom);
    }, 600);
  }
});
document.addEventListener("pointermove", (e) => {
  if (pickDrag) pickAt(e);
  // Sliding off the swatch is not a long press.
  if (pressed.timer && !e.target.closest?.("[data-custom]")) cancelPress();
});
for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, () => {
  cancelPress();
  pickDrag = null;
});
document.addEventListener("contextmenu", (e) => {
  const own = e.target.closest?.("[data-custom]");
  if (!own) return;
  e.preventDefault();
  // A touch long press fires this too, after the timer already asked.
  if (pressed.fired) return;
  cancelPress();
  deleteCustom(own.dataset.custom);
});

document.addEventListener("pointerdown", (e) => {
  const box = e.target.closest?.("[data-gyro-chart]");
  if (!box || !S.current || e.button !== 0) return;
  const pos = chartPos(box, e);
  const pt = e.target.closest("[data-pt]")?.dataset.pt;
  if (pt) gyroDrag = pt;
  else if (e.target.closest("[data-gyro-line]")) {
    const i = addMidAt(pos);
    if (i == null) return;
    gyroDrag = `mid${i}`;
  } else return;
  e.preventDefault();
  // Keeps the drag going outside the chart; it throws if the pointer is already gone.
  try {
    box.setPointerCapture(e.pointerId);
  } catch {}
  moveCurvePoint(gyroDrag, pos);
  redrawGyroChart(box);
});
document.addEventListener("pointermove", (e) => {
  if (!gyroDrag) return;
  const box = document.querySelector("[data-gyro-chart]");
  if (!box) return;
  moveCurvePoint(gyroDrag, chartPos(box, e));
  redrawGyroChart(box);
});
for (const type of ["pointerup", "pointercancel"]) {
  document.addEventListener(type, () => {
    if (!gyroDrag) return;
    gyroDrag = null;
    render();
  });
}

// ---------------- Live input ----------------
// On Sticks, Triggers and Gyro, the app asks the controller itself for its stick stream (0xEF) and key
// events (0x21), so testing works even when the browser does not see a gamepad. Elsewhere it
// falls back to the Gamepad API.

const LIVE = { on: false, stop: null, stick: null, keys: new Set(), imu: null };

// Gyro page: 0xEF bytes 17..28 as six i16. 1–3 are rotation rates (1 yaw, 2 pitch, 3 roll, found on
// hardware), 4–6 look like the accelerometer. move: smoothed size of each frame-to-frame change;
// peak: largest |value| seen, for the bar scale.
function trackImu(imu) {
  const t = (LIVE.imu ??= { last: imu, move: imu.map(() => 0), peak: imu.map(() => 1000) });
  imu.forEach((x, i) => {
    t.move[i] = t.move[i] * 0.85 + Math.abs(x - t.last[i]) * 0.15;
    t.peak[i] = Math.max(t.peak[i], Math.abs(x));
  });
  t.last = imu;
}

// Gyro page aim dot: the turn added up while the gyro is on, so it moves and stays like a
// crosshair. Rates assumed ±2000 °/s full scale (16.4 per °/s); a 30° turn reaches the edge.
// Small rates are dropped so the resting offset (≈5) does not creep.
const AIM = { x: 0, y: 0, t: 0, toggled: new Set() };
const AIM_LSB = 16.4, AIM_DEG = 30, AIM_DEAD = 40;
// Profile button → name in the controller's key events. LM/RM names are not known yet.
const KEY_EVENT = {
  A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", Back: "SELECT", Start: "START", LS: "THL", RS: "THR",
  "D-pad ↑": "DPAD_UP", "D-pad ↓": "DPAD_DOWN", "D-pad ←": "DPAD_LEFT", "D-pad →": "DPAD_RIGHT",
  C: "C", Z: "Z", M1: "M1", M2: "M2", M3: "M3", M4: "M4", "LT (active)": "LT", "RT (active)": "RT",
};

// Whether the gyro would be on now: never with the mode off on the controller; no activation
// buttons = always; otherwise any hold button held or toggle button switched on. A button whose
// event name is unknown counts as on.
function gyroOn() {
  const g = S.current?.cfg.gyroscope;
  if (!g || g.mode === "disable") return false;
  const acts = g.activation ?? [];
  if (!acts.length) return true;
  return acts.some((a) => {
    const k = KEY_EVENT[a.button];
    if (!k) return true;
    return a.activation === "hold" ? LIVE.keys.has(k) : AIM.toggled.has(k);
  });
}

function trackAim(imu) {
  const now = performance.now();
  const dt = AIM.t ? Math.min(0.1, (now - AIM.t) / 1000) : 0;
  AIM.t = now;
  if (!gyroOn()) return;
  const step = (r) => (Math.abs(r) < AIM_DEAD ? 0 : (r / AIM_LSB) * dt / AIM_DEG);
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  // Yaw right is positive; pitch up is positive, and the SVG is positive down (found on hardware).
  // Roll also aims sideways: in joy.cpl it moved the right stick across. Right grip down is positive.
  AIM.x = clamp(AIM.x + step(imu[0]) + step(imu[2]));
  AIM.y = clamp(AIM.y - step(imu[1]));
}

async function startLive() {
  const pad = S.pad;
  LIVE.on = true;
  LIVE.stick = null;
  LIVE.keys.clear();
  LIVE.imu = null;
  Object.assign(AIM, { x: 0, y: 0, t: 0 });
  AIM.toggled.clear();
  const offStick = pad.onStick((s) => {
    LIVE.stick = s;
    trackImu(s.imu);
    trackAim(s.imu);
  });
  const offEvent = pad.onEvent((text) => {
    const [type, name = ""] = text.split(/\s+/);
    const key = name.replace(/^GP_/, "");
    if (type === "KEY_DOWN") {
      if (!LIVE.keys.has(key)) AIM.toggled.has(key) ? AIM.toggled.delete(key) : AIM.toggled.add(key);
      LIVE.keys.add(key);
    }
    else if (type === "KEY_UP") LIVE.keys.delete(key);
  });
  LIVE.stop = async () => {
    offStick();
    offEvent();
    await safe(() => pad.textCommand("DISABLE_KEY_EVENT"));
    await safe(() => pad.setInputModes({ dinput: 0 }));
  };
  await safe(() => pad.setInputModes({ dinput: 1 }));
  await safe(() => pad.textCommand("ENABLE_KEY_EVENT"));
}

async function stopLive() {
  const stop = LIVE.stop;
  LIVE.on = false;
  LIVE.stop = null;
  LIVE.stick = null;
  LIVE.keys.clear();
  await stop?.();
}

const LIVE_TABS = new Set(["sticks", "triggers", "gyro"]);
function syncLive() {
  const want = !!(S.pad && S.current && LIVE_TABS.has(S.tab) && !S.writing && !document.hidden);
  if (want !== LIVE.on) (want ? startLive : stopLive)();
}
document.addEventListener("visibilitychange", syncLive);
window.addEventListener("pagehide", () => stopLive());

const liveCache = new Map();
function setLive(sel, html) {
  if (liveCache.get(sel) === html) return;
  liveCache.set(sel, html);
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
}

function tick() {
  if (S.current && S.tab === "gyro") {
    const st = LIVE.stick;
    const mode = S.current.cfg.gyroscope?.mode;
    setLive(`[data-live="turn"]`, V.liveAim(S.current.cfg.gyroscope, st && { x: AIM.x, y: AIM.y, on: gyroOn() }));
    setLive(`[data-live="imu"]`, V.liveImu(st && LIVE.imu && { imu: st.imu, tail: st.tail, move: LIVE.imu.move, peak: LIVE.imu.peak }));
    // What the gyro drives. 0xEF carries the physical sticks only (found on hardware), so this reads
    // the XInput pad Windows sees, where the gyro's part is mixed in. Standard mapping: axes 0/1 left, 2/3 right.
    // With the gyro off it shows the right stick, to see that tilting no longer moves it.
    if (mode === "left_joystick" || mode === "right_joystick" || mode === "disable") {
      const gp = Array.from(navigator.getGamepads?.() ?? []).find((g) => g?.mapping === "standard");
      const ax = mode === "left_joystick" ? 0 : 2;
      const v = gp && { x: Number((gp.axes[ax] ?? 0).toFixed(2)), y: Number((gp.axes[ax + 1] ?? 0).toFixed(2)) };
      setLive(`[data-live="gyro-out"]`, V.gyroStick(S.current.cfg.gyroscope, v));
    }
    setLive(`[data-live="keys"]`, V.liveKeys(LIVE.on ? [...LIVE.keys] : null));
  } else if (S.current && (S.tab === "sticks" || S.tab === "triggers")) {
    const gp = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
    const st = LIVE.stick;
    const cfg = S.current.cfg;
    if (S.tab === "sticks") {
      for (const [side, ax] of [["left", 0], ["right", 2]]) {
        if (!cfg[`joystick_${side}`]) continue;
        let v = null;
        // 0xEF Y is positive up (XInput style); the Gamepad API and the SVG are positive down.
        if (st) v = side === "left" ? { x: st.lx / 32767, y: -st.ly / 32767 } : { x: st.rx / 32767, y: -st.ry / 32767 };
        else if (gp) v = { x: gp.axes[ax] ?? 0, y: gp.axes[ax + 1] ?? 0 };
        setLive(`[data-live="stick-${side}"]`, V.liveStick(v && { x: Number(v.x.toFixed(2)), y: Number(v.y.toFixed(2)) }));
      }
      setLive(`[data-live="keys"]`, V.liveKeys(LIVE.on ? [...LIVE.keys] : null));
    } else {
      // Buttons 6/7 are LT/RT only in the standard mapping; other pads (a USB mic showed up as one) are skipped.
      const std = gp?.mapping === "standard";
      for (const [side, bi, k] of [["left", 6, "lt"], ["right", 7, "rt"]]) {
        if (!cfg[`trigger_${side}`]) continue;
        // 0xEF LT/RT is how far the trigger is pressed, before the curve (half press reads 50% even
        // with the end point at 50%). The output is worked out from the curve as drawn.
        let v = null;
        if (st) {
          const press = st[k];
          v = { press: press / 255, out: evalCurve(curveFor("trigger", side), press) / 255 };
          setLive(`[data-live-chart="trigger-${side}"]`, chartFor("trigger", side, press));
        } else if (std) v = gp.buttons[bi]?.value ?? 0;
        setLive(`[data-live="trigger-${side}"]`, V.liveTrigger(v));
      }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------- Boot ----------------

loadBackups();
render();

// Asks the browser not to clear the app's data on its own when the disk runs low.
navigator.storage?.persist?.().catch(() => {});
const afterLoad = sessionStorage.getItem(AFTER_LOAD);
if (afterLoad) {
  sessionStorage.removeItem(AFTER_LOAD);
  toast(afterLoad);
}
S.folder.init().then(folderResult).catch((e) => console.warn(e));

if (S.demo) {
  import("./mock-device.js")
    .then(async ({ createMockDevice }) => attach(await Apex6.open(await createMockDevice())))
    .catch((e) => {
      S.connectError = `เปิดตัวอย่างไม่ได้: ${e.message}`;
      render();
    });
} else if (S.hid) {
  navigator.hid.addEventListener("disconnect", (e) => {
    if (S.pad && e.device === S.pad.device) {
      disconnect();
      toast("จอยหลุดการเชื่อมต่อ การแก้ที่ยังไม่ได้เขียนหายไปแล้ว", true);
    }
  });
  Apex6.reconnect().then((p) => p && attach(p)).catch(() => {});
}
