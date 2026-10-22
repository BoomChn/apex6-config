// Screen renderers for the v2 "Manual" design. Each returns an HTML string; app.js wires events
// through data-* attributes (data-act, data-key, data-pick, data-live).

import { BACK, FRONT, ALL, stageSvg, inset, TRIG_MARK, PHOTO, LED_PATH } from "./stage.js";
import {
  esc, pct, same, btnName, PRESS, GYRO_MODE, LED_MODE, LAYER_NAME, PRESET, TPRESET, GPRESET, AXIS, MACRO_MODE, TIMEOUT,
  labelTarget, baseTarget, isIdentity, evalCurve, macroSteps, macroUses, macroList, openMacro,
  layerList, nextLayerId, layerSwitches, layerKey, meta, gripPart, lraGrip,
} from "./model.js";
import { BUTTONS, decodeMapping } from "./mapping.js";
import { isWritable, HW_TESTED, NAME_MAX, nameBytes, MACRO_MAX, gyroPct, GYRO_MIDS_MAX, VIB_LEVELS, gripEndY, motorMode, FEEDBACK_MODE } from "./mapping-edit.js";
import { fit, APP_NAME_MAX } from "./names.js";
import { slotsOf, crcOf } from "./profiles.js";
import { DEFAULT_PROFILE } from "./defaults.js";

export const TABS = [
  { id: "profiles", label: "Profiles" },
  { id: "buttons", label: "Buttons" },
  { id: "macros", label: "Macros" },
  { id: "sticks", label: "Sticks" },
  { id: "triggers", label: "Triggers" },
  { id: "gyro", label: "Gyro" },
  { id: "vibration", label: "Vibration" },
  { id: "lighting", label: "Lighting & screen", device: true },
  { id: "device", label: "Device & backup" },
];

const ICON = {
  chev: `<svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  pencil: `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L5 14H2v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  dots: `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>`,
  file: `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 1.5h7l3 3v12H4z M7 7h5 M7 10h5 M7 13h3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
  warn: `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2l7.5 13h-15z M9 7v4 M9 12.6v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  check: `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="15" fill="#1F8A4C"/><path d="M8.5 15.5l4.2 4.2 8.8-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  checkSm: `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="11" fill="#1F8A4C"/><path d="M6.5 11.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bang: `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="15" fill="#C0262D"/><path d="M15 8v9" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="15" cy="21.5" r="1.8" fill="#fff"/></svg>`,
  play: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>`,
  x: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg>`,
};

const UNSUP = `<span class="tag unsup">ยังเขียนลงจอยไม่ได้ · เก็บเป็นร่างในหน้านี้</span>`;
// Writable, but only tried against the mock so far.
const UNTESTED = `<span class="tag untested" title="เขียนได้แล้ว แต่ยังไม่เคยลองกับจอยจริง ทุกครั้งที่เขียนจะสำรองไฟล์ให้ก่อน">ยังไม่ทดสอบกับจอยจริง</span>`;
const untested = (key) => (isWritable(key) && !HW_TESTED.has(key) ? UNTESTED : "");
const pendCls = (on) => (on ? " pending" : "");

// ---------------- Top bar & tabs ----------------

export function topbar(S, D) {
  const connected = !!S.pad;
  const info = S.info;
  const line = !connected
    ? `<span class="dot off"></span>ยังไม่ได้เชื่อมต่อ`
    : S.demo
      ? `<span class="dot"></span>ตัวอย่าง · ไม่ได้ต่อจอยจริง`
      : `<span class="dot"></span>${info ? `แบต ระดับ <span class="num">${info.batteryLevel}</span>${info.chargingStatus ? " · ชาร์จ" : ""} · FW <span class="num">${fw(info.fw.main)}</span>` : "เชื่อมต่อแล้ว"}`;
  const device = `<div class="device"><div class="device-name">Apex 6 Pro</div><div class="device-line">${line}</div></div>`;
  if (!connected) {
    return `${device}<div class="slots"></div><div class="sync">${
      S.hid ? `<button class="btn primary" data-act="connect">เชื่อมต่อจอย</button>` : ""
    }</div>`;
  }
  const slots = [0, 1, 2, 3]
    .map((i) => {
      const on = S.slots?.activeSlot === i;
      const name = slotName(S, D, i);
      const pending = D.count() > 0;
      return `<button class="slot-tab${on ? " active" : ""}" data-act="slot" data-slot="${i}" ${on ? 'aria-current="true"' : ""}>
        <span class="n">${i + 1}</span>
        ${on ? `<span><span class="t">${esc(name)}</span><span class="s">ใช้อยู่บนจอย${pending ? " · กำลังแก้" : ""}</span></span>` : `<span class="t">${esc(name)}</span>`}
      </button>`;
    })
    .join("");
  const n = D.count();
  const when = S.readAt ? S.readAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—";
  const sync = n
    ? `<div class="sync-text"><b class="pending">แก้ ${n} จุด ยังไม่ได้เขียนลงจอย</b><span>อ่านจากจอยล่าสุด ${when}</span></div>
       <button class="link" data-act="discard">ยกเลิกการแก้</button>`
    : `<div class="sync-text"><b class="ok">ตรงกับจอย ไม่มีอะไรค้างเขียน</b><span>อ่านจากจอยล่าสุด ${when}</span></div>`;
  return `${device}<div class="slots" role="group" aria-label="Slot บนตัวจอย">${slots}</div>
    <div class="sync">${sync}<button class="btn primary" data-act="review" ${n ? "" : "disabled"}>เขียนลงจอย <span class="count">${n}</span></button></div>`;
}

export function tabs(S, D) {
  if (!S.pad) return "";
  return TABS.map((t) => {
    const n = D.count(t.id);
    let extra = n ? `<span class="badge">${n}</span>` : "";
    if (t.id === "gyro" && S.current) {
      const mode = D.get("gyro.mode");
      extra = `<span class="inline${D.has("gyro.mode") ? "" : " off"}">${esc(GYRO_MODE[mode] ?? "—")}</span>${n > 1 ? `<span class="badge">${n}</span>` : ""}`;
    }
    const pre = t.device ? `<span class="tab-div"></span><span class="tab-scope" style="align-self:center">ทั้งเครื่อง</span>` : "";
    return `${pre}<button class="tab${S.tab === t.id ? " active" : ""}" data-act="tab" data-tab="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ""}>${t.label}${extra}</button>`;
  }).join("");
}

export const fw = (v) => (v ? `0x${v.toString(16).padStart(4, "0").toUpperCase()}` : "—");

// Under a name field: what the controller will hold. The app always keeps the whole name.
export function nameFit(v) {
  const n = nameBytes(v ?? "");
  return n <= NAME_MAX
    ? `<span class="meta mono" data-fit>${n}/${NAME_MAX} ไบต์บนจอย</span>`
    : `<span class="meta" data-fit>บนจอยเก็บได้แค่ “${esc(fit(v))}” · ชื่อเต็มเก็บไว้ในแอป</span>`;
}

// When the app and the controller disagree on a name, show both and let the user pick.
function nameClash(key, other) {
  if (!other) return "";
  const why = other.unsent ? "ยังไม่ได้เขียนลงจอย" : "ไม่ตรงกับบนจอย อาจถูกแก้จากแอปอื่นหรือกู้คืนไฟล์";
  return `<p class="meta" style="margin:6px 0 0">ชื่อในแอป “${esc(other.full)}” ${why} ·
    <button class="link" data-act="name-use-app" data-key="${key}" data-full="${esc(other.full)}">ใช้ชื่อในแอป</button> ·
    <button class="link muted" data-act="name-use-dev" data-key="${key}">ใช้ชื่อบนจอย</button></p>`;
}

export function slotName(S, D, i) {
  const v = D.get(`slot.${i}.name`);
  if (v) return v;
  return heldName(S, i) || `Slot ${i + 1}`;
}

// A slot not in use can't be read: its name is the one it had when last read, while its CRC16 says it
// still holds the same thing, else the name of the library profile it holds.
function heldName(S, i) {
  if (i === S.current?.slot) return "";
  const seen = S.seen?.name(S.uuid, i, S.slots?.slotCrc16[i]);
  return seen !== undefined ? seen : libName(S, i);
}

function libName(S, i) {
  if (!S.profiles) return "";
  return S.profiles.list().find((p) => slotsOf(p, S.slots?.slotCrc16, S.current).includes(i))?.name ?? "";
}

function head(title, sub, right = "") {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>${right}</div>`;
}

// ---------------- Connect ----------------

export function connect(S) {
  const steps = [
    "เสียบ Apex 6 Pro เข้าคอมด้วยสาย USB (หรือตัวรับ)",
    "ปิดแอปอื่นที่จับจอยอยู่ เช่น Space Station",
    "กด “เชื่อมต่อจอย” แล้วเลือก Apex 6 Pro ในหน้าต่างของเบราว์เซอร์",
  ];
  const body = S.hid
    ? `<ol>${steps.map((s, i) => `<li><span class="num">${i + 1}</span><span>${s}</span></li>`).join("")}</ol>
       <div style="display:flex;gap:24px;align-items:center">
         <button class="btn primary" style="height:48px;padding:0 26px" data-act="connect">เชื่อมต่อจอย</button>
         <a class="link" href="?demo">ลองดูตัวอย่าง ไม่ต้องมีจอย</a>
       </div>`
    : `<p class="sub" style="margin-top:20px;font-size:16px;line-height:24px;color:var(--error)">เบราว์เซอร์นี้ไม่รองรับ WebHID ใช้ Chrome หรือ Edge บนเดสก์ท็อป และเปิดผ่าน https หรือ localhost</p>
       <p style="margin-top:20px"><a class="link" href="?demo">ลองดูตัวอย่าง ไม่ต้องมีจอย</a></p>`;
  return `<div class="connect">
    <div class="stage"><img src="${PHOTO.front}" alt="Flydigi Apex 6 Pro ด้านหน้า" style="width:100%;display:block"></div>
    <div>
      <h1>ตั้งค่า Apex 6 Pro<br>ตรงจากตัวจอย</h1>
      <p class="sub" style="font-size:16px;line-height:24px;margin-top:12px">แก้ 4 slot บนจอยโดยตรง สำรองค่าเดิมเป็นไฟล์ก่อนเขียน และอ่านกลับมาตรวจทุกครั้ง</p>
      ${body}
      ${S.connectError ? `<p class="err" style="margin-top:20px;font-size:14px">${esc(S.connectError)}</p>` : ""}
      <p class="meta" style="margin-top:40px">แอปนี้ไม่ใช่ของ Flydigi และไม่อัปเดต firmware</p>
    </div>
  </div>`;
}

// ---------------- 00 Profiles ----------------

export function profiles(S, D) {
  const cfg = S.current?.cfg;
  const active = S.slots?.activeSlot;
  const rows = [0, 1, 2, 3]
    .map((i) => {
      const on = i === active;
      const key = `slot.${i}.name`;
      const name = D.get(key);
      const pend = D.has(key);
      const renaming = S.ui.renaming === i;
      const crc = S.slots?.slotCrc16[i];
      // The slot in use gets a draft to write; other slots can't be read, so their names live in the app.
      const loaded = cfg && i === S.current.slot;
      const nameHtml = renaming
        ? `<div data-name-field><div style="display:flex;align-items:center;gap:16px"><input class="field pending" style="max-width:340px;font-size:20px;height:48px" data-key="${key}" data-rename="${i}" value="${esc(name ?? "")}" maxlength="${APP_NAME_MAX}" placeholder="Slot ${i + 1}" aria-label="ชื่อ slot ${i + 1}"><span class="meta">Enter บันทึก · Esc ยกเลิก</span></div>
             <div style="margin-top:6px">${nameFit(name)}${loaded ? "" : `<span class="meta"> · slot นี้ไม่ได้ใช้อยู่ ชื่อจะเก็บในแอปก่อน แล้วเขียนลงจอยได้ตอนสลับมาใช้</span>`}</div></div>`
        : `<div class="slot-name"><span class="${pend ? "pending" : name || heldName(S, i) ? "" : "faint"}">${esc(name || heldName(S, i) || `Slot ${i + 1}`)}</span>
             ${cfg ? `<button class="icon-btn" data-act="rename" data-slot="${i}" aria-label="เปลี่ยนชื่อ slot ${i + 1}">${ICON.pencil}</button>` : ""}</div>
           ${loaded && !pend ? nameClash(key, cfg.shown?.profile.other) : ""}`;
      const held = S.profiles.list().filter((p) => slotsOf(p, S.slots?.slotCrc16, S.current).includes(i));
      const sum = (on && cfg ? slotSummary(cfg) : `<span class="mono" style="font-weight:500">crc16 ${crc?.toString(16).padStart(4, "0").toUpperCase() ?? "—"}</span> · สลับไปใช้เพื่ออ่านค่าใน slot นี้`) +
        (held.length ? `<br>profile ในคลัง: ${held.map((p) => `“${esc(p.name)}”`).join(", ")}` : "");
      // A slot that still holds the defaults (the slot in use by its bytes, others by CRC16) has
      // nothing to move or reset: the menu stays, its items are disabled.
      const atDefault = loaded ? same([...S.current.wrapped], [...DEFAULT_PROFILE]) : crc === crcOf(DEFAULT_PROFILE);
      const move = cfg ? slotMenu(S, i, atDefault) : "";
      const acts = on
        ? `<span class="ok" style="font-weight:700">ใช้อยู่บนจอย</span><button class="btn ink" data-act="tab" data-tab="buttons">แก้</button>${move}`
        : `<button class="btn" data-act="slot" data-slot="${i}">ใช้ slot นี้</button>${move}`;
      return `<div class="slot-row">
        <div>${on ? `<div class="slot-num on">${i + 1}</div>` : `<div class="slot-num">${i + 1}</div>`}</div>
        <div>${nameHtml}<div class="slot-sum">${sum}</div></div>
        <div class="slot-acts">${acts}</div>
      </div>`;
    })
    .join("");
  const renamePending = D.pendingKeys("slot.").length;
  return `${head("Profiles", "4 slot บนตัวจอย แก้ที่ slot ตรงๆ · คลังเก็บสำเนาไว้ใส่ slot ไหนก็ได้ ใส่แล้วไม่สร้างของซ้ำ")}
  <div class="split wide-right" style="grid-template-columns:minmax(0,640px) minmax(0,1fr)">
    <div>${frontFigure(S, D, { screen: `แสดงชื่อ slot ที่ใช้อยู่: ${slotName(S, D, active)}`, screenSub: "เขียนชื่อลงจอได้ไหม ยังไม่ยืนยัน" })}</div>
    <div>
      <div class="rule-head" style="display:grid;grid-template-columns:112px 1fr auto"><span class="label">Slot</span><span class="label">ชื่อและสิ่งที่ตั้งไว้</span><span class="label">จัดการ</span></div>
      ${rows}
      <p class="meta" style="margin-top:12px">สลับ slot ใช้คำสั่ง 0xA2 · ${UNTESTED} · แอปจะถามก่อนส่ง</p>
      ${renamePending ? `<p class="meta" style="margin-top:12px">${untested("profile.name")} · กดเขียนลงจอยเพื่อบันทึกชื่อ slot ที่ใช้อยู่</p>` : ""}
      ${profileLibrary(S, D, cfg, active)}
    </div>
  </div>`;
}

// The profile library (profiles.js): settings belong to a profile, a slot carries one at most.
function profileLibrary(S, D, cfg, active) {
  const list = S.profiles.list();
  const crcs = S.slots?.slotCrc16 ?? [];
  const where = new Map(list.map((p) => [p.uid, slotsOf(p, crcs, S.current)]));
  const heldIn = (i) => list.find((p) => where.get(p.uid).includes(i));
  const busy = !cfg || S.writing;
  const slotOpts = [0, 1, 2, 3]
    .map((i) => {
      const q = heldIn(i);
      return `<option value="${i}">Slot ${i + 1}${q ? ` · แทน “${esc(q.name)}”` : ` · ${esc(slotName(S, D, i))}`}</option>`;
    })
    .join("");
  const rows = list
    .map((p) => {
      let sum = "";
      try {
        sum = slotSummary(decodeMapping(S.profiles.data(p).subarray(4)));
      } catch {
        sum = "อ่านไฟล์นี้ไม่ได้";
      }
      const at = where.get(p.uid);
      // A profile in two slots was put there before the one-slot rule, or copied by the official app.
      const put = at.length > 1
        ? `<span class="notice">${ICON.warn}<span>อยู่ใน Slot ${at.map((i) => i + 1).join(" และ ")} · 1 profile ควรอยู่ slot เดียว ใส่ profile อื่นทับ slot ที่เกินได้</span></span>`
        : at.length
        ? `<span class="ok" style="font-weight:700">อยู่ใน Slot ${at[0] + 1}</span>`
        : `<select class="field" style="max-width:300px;height:40px" data-pf-slot="${p.uid}" aria-label="slot ที่จะใส่ ${esc(p.name)}" ${busy ? "disabled" : ""}>${slotOpts}</select>
           <button class="btn" data-act="pf-apply" data-id="${p.uid}" ${busy ? "disabled" : ""}>ใส่ลง slot</button>`;
      return `<div class="row flush" style="display:block;padding:18px 0">
        <div style="display:flex;align-items:baseline;gap:16px;justify-content:space-between">
          <span style="font-size:18px;font-weight:600">${esc(p.name)}</span>
          <span style="display:flex;gap:16px;white-space:nowrap"><button class="link muted" data-act="pf-rename" data-id="${p.uid}">เปลี่ยนชื่อ</button><button class="link muted" data-act="pf-delete" data-id="${p.uid}">ลบ</button></span>
        </div>
        <div class="meta" style="margin-top:4px">${sum} · บันทึกล่าสุด ${fmtWhen(p.at)}</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:12px">${put}</div>
      </div>`;
    })
    .join("");
  return `<section style="margin-top:56px">
    <div class="rule-head top" style="align-items:flex-end"><div><h2>คลัง profile</h2><span class="meta">เก็บในเบราว์เซอร์นี้ · ค่าทุกอย่างอยู่กับ profile slot เป็นแค่ช่องบนจอย · แก้ค่าใน slot แล้วเขียนลงจอย profile ใน slot นั้นจะอัปเดตตาม</span></div></div>
    ${rows || `<p class="empty-note">ยังไม่มี profile ในคลัง · กด ⋯ ที่แถว slot แล้วเลือก “ย้ายเข้าคลัง”</p>`}
    <p class="meta" style="margin-top:12px">ใส่ลง slot อื่นต้องสลับ slot ด้วยคำสั่ง 0xA2 ก่อน · ${UNTESTED}</p>
  </section>`;
}

// The ⋯ menu of a slot row: move the slot's profile to the library, or reset the slot. Both give the
// slot back the defaults, so neither applies to a slot that has them.
function slotMenu(S, i, atDefault) {
  const open = S.ui.slotMenu === i;
  const off = atDefault || S.writing;
  const why = atDefault ? `<span class="menu-why">Slot ${i + 1} เป็นค่าเริ่มต้นอยู่แล้ว</span>` : "";
  const item = (act, label, sub) => `<button role="menuitem" data-act="${act}" data-slot="${i}" ${off ? "disabled" : ""}><b>${label}</b><span>${sub}</span></button>`;
  return `<span class="menu-wrap">
    <button class="icon-btn" data-act="slot-menu" data-slot="${i}" aria-haspopup="menu" aria-expanded="${open}" aria-label="จัดการ Slot ${i + 1}">${ICON.dots}</button>
    ${open ? `<span class="menu" role="menu" aria-label="จัดการ Slot ${i + 1}">${why}
      ${item("pf-move", "ย้ายเข้าคลัง", "เก็บค่าใน slot เข้าคลัง profile แล้วคืนค่าเริ่มต้น")}
      ${item("pf-reset", "คืนค่าเริ่มต้น", "ไม่เก็บค่าเดิม · มีไฟล์สำรองให้")}
    </span>` : ""}
  </span>`;
}

function slotSummary(cfg) {
  const maps = cfg.layers.flatMap((l) => l.mappings.filter((m) => !m.identity)).length;
  const macros = cfg.layers.reduce((n, l) => n + l.macros.length, 0);
  const gyro = cfg.gyroscope?.mode && cfg.gyroscope.mode !== "disable" ? `gyro ${GYRO_MODE[cfg.gyroscope.mode]}` : "gyro ปิด";
  return `${maps ? `${maps} ปุ่มแก้` : "ปุ่มค่าเดิม"} · ${macros} macro · ${gyro}`;
}

// Front photo with the on-controller screen and LED callouts (Profiles, Lighting).
function frontFigure(S, D, { screen, screenSub, led = null, ledLabel = "ไฟ RGB", ledValue = "ค่าบนจอยยังอ่านไม่ได้", ledPending = false }) {
  const color = led?.color;
  const bright = (led?.bright ?? 70) / 100;
  const glow = color
    ? `<g style="mix-blend-mode:multiply"><path d="${LED_PATH}" fill="none" stroke="${color}" stroke-opacity="${0.5 * bright + 0.15}" stroke-width="52" stroke-linecap="round" filter="url(#ledglow)"/>
       <path d="${LED_PATH}" fill="none" stroke="${color}" stroke-opacity="${0.35 * bright + 0.1}" stroke-width="22" stroke-linecap="round"/>
       <path d="${LED_PATH}" fill="none" stroke="${color}" stroke-opacity="${0.85}" stroke-width="5" stroke-linecap="round"/></g>`
    : "";
  const cob = ledPending ? "#2140D9" : "#111111";
  return `<div class="stage">
    <svg viewBox="80 150 1440 1330" aria-label="ภาพจอยด้านหน้า พร้อมจุดของจอและไฟ">
      <defs><filter id="ledglow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="13"/></filter></defs>
      <image href="${PHOTO.front}" x="0" y="0" width="1600" height="1280"/>
      ${glow}
      <path d="M320 640 V1300" stroke="#111" stroke-width="2" fill="none"/>
      <circle cx="320" cy="640" r="7" fill="#111"/>
      <circle cx="320" cy="1320" r="20" fill="#111"/><text x="320" y="1329" text-anchor="middle" fill="#fff" style="font:700 22px var(--mono)">1</text>
      <path d="M1000 786 V1300" stroke="${cob}" stroke-width="2" fill="none"/>
      <circle cx="1000" cy="786" r="7" fill="${cob}"/>
      <circle cx="1000" cy="1320" r="20" fill="${cob}"/><text x="1000" y="1329" text-anchor="middle" fill="#fff" style="font:700 22px var(--mono)">2</text>
    </svg>
    <div style="position:relative;height:84px;margin-top:-36px">
      <div style="position:absolute;left:${((320 - 80) / 1440) * 100 - 1.4}%;top:0">
        <div style="font-size:13px;font-weight:700;line-height:16px">จอบนตัวจอย</div>
        <div style="font-size:15px;font-weight:600;line-height:20px">${esc(screen)}</div>
        <div class="meta">${esc(screenSub)}</div>
      </div>
      <div style="position:absolute;left:${((1000 - 80) / 1440) * 100 - 1.4}%;top:0" class="${ledPending ? "pending" : ""}">
        <div style="font-size:13px;font-weight:700;line-height:16px">${esc(ledLabel)}</div>
        <div style="font-size:15px;font-weight:${ledPending ? 700 : 600};line-height:20px">${esc(ledValue)}</div>
        ${ledPending ? "" : `<button class="link" style="font-size:13px" data-act="tab" data-tab="lighting">ตั้งค่าใน Lighting &amp; screen</button>`}
      </div>
    </div>
  </div>`;
}

// ---------------- 01 Buttons ----------------

export const BACK_SRC = { RB: "RB", RT: "RT (active)", M1: "M1", M3: "M3", LB: "LB", LT: "LT (active)", M2: "M2", M4: "M4", RM: "M6", LM: "M5" };
export const FRONT_SRC = { Back: "Back", Start: "Start", LS: "LS", RS: "RS", Y: "Y", X: "X", B: "B", A: "A", DPAD: "D-pad ↑" };
// Buttons tab: callout id → source, front and back together.
export const ALL_SRC = { ...BACK_SRC, ...FRONT_SRC };
const BTN_TITLE = {
  M1: "ปุ่มหลัง มือขวา · บน", M3: "ปุ่มหลัง มือขวา · ล่าง", M2: "ปุ่มหลัง มือซ้าย · บน", M4: "ปุ่มหลัง มือซ้าย · ล่าง",
  LB: "ไหล่ซ้าย", RB: "ไหล่ขวา", "LT (active)": "ไกซ้าย · ส่งเป็นปุ่ม", "RT (active)": "ไกขวา · ส่งเป็นปุ่ม",
  M5: "ปุ่มข้างไกซ้าย (LM)", M6: "ปุ่มข้างไกขวา (RM)",
  A: "ปุ่ม A", B: "ปุ่ม B", X: "ปุ่ม X", Y: "ปุ่ม Y", Back: "ปุ่ม View", Start: "ปุ่ม Menu", LS: "กด stick ซ้าย", RS: "กด stick ขวา",
  "D-pad ↑": "D-pad ขึ้น", "D-pad ↓": "D-pad ลง", "D-pad ←": "D-pad ซ้าย", "D-pad →": "D-pad ขวา",
};

function mapKey(layer, src, press) {
  return `map.${layer}.${src}.${press}`;
}

function buttonState(S, D, layer, src) {
  const cfg = S.current.cfg;
  const pend = PRESS.some((p) => D.has(mapKey(layer, src, p.id)));
  const simple = D.get(mapKey(layer, src, "simple"));
  const extra = PRESS.slice(1).some((p) => D.get(mapKey(layer, src, p.id)) !== undefined);
  const changed = !isIdentity(simple, src) || extra;
  let value = changed ? labelTarget(simple, cfg) : "ค่าเดิม";
  if (changed && isIdentity(simple, src) && extra) value = "กดค้าง/ดับเบิลตั้งไว้";
  return { pend, changed, value };
}

export function buttons(S, D) {
  const cfg = S.current.cfg;
  const ui = S.ui;
  const layer = ui.layer;
  const def = ALL;
  const items = {};
  for (const [id, src0] of Object.entries(ALL_SRC)) {
    const src = id === "DPAD" ? ui.dpad : src0;
    const name = id === "DPAD" ? "D-pad" : btnName(id === "Back" ? "Back" : id === "Start" ? "Start" : id);
    if (!src) {
      items[id] = { name: id, value: "ยังไม่รู้ ID", state: "nomap", sel: ui.sel === id };
      continue;
    }
    const st = buttonState(S, D, layer, src);
    items[id] = { name, value: st.value, state: st.pend ? "pend" : st.changed ? "set" : "", sel: ui.sel === src || (id === "DPAD" && ui.sel?.startsWith("D-pad")) };
  }
  const list = layerList(S, D);
  const layers = list
    .map((l) => {
      const cls = `utab${l.id === layer ? " on" : ""}${l.isNew || l.deleted ? " pending" : ""}${l.deleted ? " gone" : ""}`;
      const title = l.isNew ? "เพิ่มใหม่ · ยังไม่ได้เขียนลงจอย" : l.deleted ? "จะถูกลบตอนเขียนลงจอย" : "";
      return `<button class="${cls}" style="font-size:13px;padding-bottom:4px"${title ? ` title="${title}"` : ""} data-act="layer" data-layer="${l.id}">${LAYER_NAME(l.id)}</button>`;
    })
    .join("");
  const add = nextLayerId(S, D) !== null
    ? `<button class="link" style="font-size:13px;white-space:nowrap" data-act="layer-new">+ เพิ่ม layer</button>`
    : `<span class="meta faint" style="white-space:nowrap">ครบ ${list.length} layer แล้ว</span>`;
  const right = `<div style="display:grid;justify-items:end;gap:10px;padding-top:6px">
      <div style="display:flex;gap:16px;align-items:center">${layers}${add}</div>
    </div>`;
  const sub = "คลิกปุ่มบนตัวจอย หรือชื่อปลายเส้นชี้ · เส้นประ = ปุ่มด้านหลังและไก ซ่อนอยู่หลังตัวจอย";
  return `<div class="split">
    <div>
      <div class="page-head" style="margin-bottom:8px"><div><h1>Buttons</h1><p class="sub">${sub}</p></div>${right}</div>
      ${layerBar(S, D, list)}
      ${stageSvg(def, items, { kind: "front" })}
      ${changedList(S, D)}
    </div>
    <div>${buttonEditor(S, D)}${timing(S, D)}</div>
  </div>`;
}

// How to reach each layer, the current layer's delete, and a warning when a toggle leads into a
// layer that has no way back out.
function layerBar(S, D, list) {
  const cur = S.ui.layer;
  if (list.length < 2) return "";
  const sw = layerSwitches(S, D, (s) => s.to !== s.layer);
  const how = (to) => {
    const ways = sw.filter((s) => s.to === to).map((s) => {
      const where = s.layer !== cur ? ` ใน ${LAYER_NAME(s.layer)}` : "";
      const press = s.press !== "simple" ? ` (${PRESS.find((p) => p.id === s.press).label})` : "";
      return `<b>${esc(btnName(s.source))}</b>${where} ${s.type === "layer_hold" ? "กดค้าง" : "สลับ"}${press}`;
    });
    return ways.length ? ways.join(", ") : `<span class="muted">ยังไม่มีปุ่มพาไป</span>`;
  };
  const live = list.filter((l) => !l.deleted);
  let text;
  let act = "";
  let warn = "";
  if (cur === 0) {
    text = `เข้า layer อื่นด้วย · ${live.filter((l) => l.id !== 0).map((l) => `${LAYER_NAME(l.id)}: ${how(l.id)}`).join(" · ")}`;
  } else {
    const l = list.find((x) => x.id === cur);
    text = `เข้า ${LAYER_NAME(cur)} ด้วย: ${how(cur)}`;
    act = l?.deleted
      ? `<span class="pending">จะถูกลบตอนเขียนลงจอย</span> · <button class="link" data-act="layer-undelete" data-layer="${cur}">ยกเลิกการลบ</button>`
      : `<button class="link err" data-act="layer-delete" data-layer="${cur}">${l?.isNew ? "เอา layer นี้ออก" : "ลบ layer นี้"}</button>`;
    const trapped = sw.some((s) => s.to === cur && s.type === "layer_toggle") && !sw.some((s) => s.layer === cur);
    if (trapped && !l?.deleted) warn = `<p class="notice" style="margin:8px 0 0;color:var(--ink)">${ICON.warn}<span>ปุ่มที่สลับเข้ามา layer นี้จะค้างอยู่ที่นี่ ตั้งปุ่มใน ${LAYER_NAME(cur)} ให้สลับกลับ ${LAYER_NAME(0)} ด้วย ไม่งั้นจะกลับไม่ได้</span></p>`;
  }
  return `<div style="margin:0 0 8px">
    <div class="meta" style="display:flex;gap:16px;justify-content:space-between;align-items:baseline;line-height:20px"><span>${text}</span>${act ? `<span style="white-space:nowrap">${act}</span>` : ""}</div>
    ${warn}
  </div>`;
}

function changedList(S, D) {
  const cfg = S.current.cfg;
  const set = new Map();
  for (const l of cfg.layers) for (const m of l.mappings) if (!m.identity) set.set(`${l.layer_id}|${m.source}`, { layer: l.layer_id, src: m.source });
  for (const k of D.pendingKeys("map.")) {
    const p = k.split(".");
    const layer = Number(p[1]), src = p.slice(2, -1).join(".");
    set.set(`${layer}|${src}`, { layer, src });
  }
  const list = [...set.values()]
    .map(({ layer, src }) => {
      const st = buttonState(S, D, layer, src);
      const lay = layer ? LAYER_NAME(layer) : "";
      return `<button class="list-row" style="border:0;background:none;padding:0;text-align:left;width:260px;gap:12px" data-act="pick-src" data-src="${esc(src)}" data-layer="${layer}">
        <span class="keytag${st.pend ? " pending" : ""}${st.pend && S.ui.sel === src ? " fill" : ""}">${esc(btnName(src))}</span>
        <span><span style="display:block;font-weight:700" class="${st.pend ? "pending" : ""}">${esc(st.value)}</span>${lay ? `<span class="small muted">${lay}</span>` : ""}</span>
      </button>`;
    })
    .join("");
  return `<section style="margin-top:8px">
    <div class="rule-head top"><h2>ปุ่มที่แก้ใน slot นี้</h2><span class="meta">สีน้ำเงิน = ยังไม่ได้เขียนลงจอย · สีดำ = อยู่บนจอยแล้ว</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:16px 0;padding-top:16px">${list || `<p class="empty-note">ทุกปุ่มเป็นค่าเดิม</p>`}</div>
  </section>`;
}

const OUT_KEYS = ["A", "B", "X", "Y", "LB", "RB", "LT (active)", "RT (active)", "LS", "RS", "Back", "Start", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →", "M1", "M2", "M3", "M4", "M5", "M6"];
const MOUSE = ["คลิกซ้าย", "คลิกขวา", "คลิกกลาง", "ปุ่มเมาส์ 4", "ปุ่มเมาส์ 5"];
const OUT_TYPES = [
  { id: "gamepad", label: "ปุ่มจอย" },
  { id: "keyboard", label: "คีย์บอร์ด" },
  { id: "mouse", label: "เมาส์" },
  { id: "turbo", label: "Turbo" },
  { id: "macro", label: "Macro" },
  { id: "layer", label: "สลับ layer" },
  { id: "none", label: "ปิดปุ่ม" },
];
const typeOf = (t) =>
  !t ? "gamepad" : t.type === "btn_gamepad" ? "gamepad" : t.type === "btn_keyboard" ? "keyboard" : t.type === "btn_mouse" ? "mouse" : t.type === "turbo_gamepad" ? "turbo" : t.type === "macro" ? "macro" : t.type === "layer_hold" || t.type === "layer_toggle" ? "layer" : t.type === "none" ? "none" : "other";

// Hold works for a normal or long press; a double press can only toggle (as in the official app).
export const layerMode = (S, cur) => (S.ui.press === "double" ? "toggle" : cur?.type === "layer_toggle" ? "toggle" : cur?.type === "layer_hold" ? "hold" : S.ui.layerMode ?? "hold");

function layerPicker(S, D, cur) {
  const layer = S.ui.layer;
  const others = layerList(S, D).filter((l) => !l.deleted && l.id !== layer);
  if (!others.length) return `<p class="empty-note">โปรไฟล์นี้มี layer เดียว · กด "+ เพิ่ม layer" ด้านบนก่อน</p>`;
  const mode = layerMode(S, cur);
  const dbl = S.ui.press === "double";
  const on = (id) => (cur?.type === "layer_hold" || cur?.type === "layer_toggle") && cur.layer === id;
  const name = (id) => LAYER_NAME(id);
  return `<div class="seg" style="justify-self:start"><button class="${mode === "hold" ? "on" : ""}" data-act="layer-mode" data-mode="hold"${dbl ? ` disabled title="ดับเบิลคลิกใช้ได้แค่แบบสลับ"` : ""}>กดค้าง</button><button class="${mode === "toggle" ? "on" : ""}" data-act="layer-mode" data-mode="toggle">สลับ</button></div>
    <p class="meta" style="margin:0;line-height:20px">${mode === "hold" ? "กดค้างไว้ ปุ่มอื่นจะทำตาม layer ที่เลือก ปล่อยแล้วกลับมา layer นี้" : `กดแล้วอยู่ใน layer ที่เลือกต่อไปเรื่อย ๆ ต้องมีปุ่มใน layer นั้นที่สลับกลับมา`}</p>
    <div>${others.map(
      (l) => `<button class="row" data-act="out" data-type="layer" data-mode="${mode}" data-to="${l.id}"><span class="v" style="font-weight:700${on(l.id) ? ";color:var(--cobalt)" : ""}">${esc(name(l.id))}${l.isNew ? ` <span class="small muted" style="font-weight:500">· เพิ่มใหม่</span>` : ""}</span>${ICON.chev}</button>`,
    ).join("")}</div>`;
}

function buttonEditor(S, D) {
  const cfg = S.current.cfg;
  const ui = S.ui;
  const layer = ui.layer;
  const src = ui.sel;
  const press = ui.press;
  const pend = PRESS.some((p) => D.has(mapKey(layer, src, p.id)));
  // Factory default: a normal press sends the button itself, with no long or double press.
  const isFactory = isIdentity(D.get(mapKey(layer, src, "simple")), src) && PRESS.slice(1).every((p) => D.get(mapKey(layer, src, p.id)) === undefined);
  const base = baseTarget(cfg, layer, src, "simple");
  const rows = PRESS.map((p) => {
    const k = mapKey(layer, src, p.id);
    const v = D.get(k);
    const on = press === p.id;
    return `<button class="row${on ? " sel" : ""}" data-act="press" data-press="${p.id}">
      <span class="k${D.has(k) ? " pending" : ""}">${p.label}</span>
      <span class="v ${v === undefined ? "muted" : ""}${D.has(k) ? " pending" : ""}" style="font-weight:${v === undefined ? 500 : 700}">${esc(labelTarget(v, cfg))}</span>
      <span style="color:${on ? "var(--cobalt)" : "var(--ink)"}">${ICON.chev}</span>
    </button>`;
  }).join("");
  const k = mapKey(layer, src, press);
  const cur = D.get(k);
  const type = ui.outType ?? typeOf(cur);
  const pl = PRESS.find((p) => p.id === press).label;
  const types = [...OUT_TYPES, ...(press !== "simple" ? [{ id: "unset", label: "ไม่ใช้" }] : [])]
    .map((t) => `<button class="utab${t.id === type || (t.id === "unset" && cur === undefined && !ui.outType) ? " on" : ""}" data-act="outtype" data-type="${t.id}">${t.label}</button>`)
    .join("");
  let body = "";
  if (type === "gamepad" || type === "turbo") {
    const selBtn = cur?.button;
    body = `<div class="keys" style="margin-top:16px">${OUT_KEYS.map(
      (b) => `<button class="key${selBtn === b && typeOf(cur) === type ? " on" : ""}" data-act="out" data-type="${type}" data-btn="${esc(b)}">${esc(btnName(b))}</button>`,
    ).join("")}</div>`;
    if (type === "turbo") {
      const iv = cur?.type === "turbo_gamepad" ? cur.interval_ms : 80;
      body += `<div class="slider" style="margin-top:24px"><div class="slider-head"><b>รอบละ</b><span class="num${pendCls(D.has(k))}">${iv} ms</span></div>
        <input type="range" min="20" max="300" step="10" value="${iv}" data-act="turbo-iv" style="--p:${((iv - 20) / 280) * 100}%" aria-label="Turbo รอบละ" ${cur?.type === "turbo_gamepad" ? "" : "disabled"}>
        <div class="slider-head small muted mono" style="font-weight:500"><span>20 ms</span><span>300 ms</span></div></div>`;
    }
  } else if (type === "mouse") {
    body = `<div class="keys" style="margin-top:16px">${MOUSE.map(
      (m, i) => `<button class="key" style="width:auto;padding:0 14px${cur?.type === "btn_mouse" && cur.mouse === i ? ";background:var(--cobalt);color:#fff;border-color:var(--cobalt)" : ""}" data-act="out" data-type="mouse" data-mouse="${i}">${m}</button>`,
    ).join("")}</div>`;
  } else if (type === "macro") {
    // Any macro of the library: the write puts a copy into this layer (macros.js).
    const all = S.lib.list();
    const q = (ui.pickQ ?? "").trim().toLowerCase();
    const list = q ? all.filter((m) => m.name.toLowerCase().includes(q)) : all;
    const used = S.plan?.used?.[layer] ?? 0;
    body = all.length
      ? `<div style="display:flex;gap:16px;align-items:center;margin-top:12px">${all.length > 6 ? `<input class="field" type="search" style="flex:1;height:40px" placeholder="ค้นหา macro" value="${esc(ui.pickQ ?? "")}" data-filter="pickQ" aria-label="ค้นหา macro">` : ""}<span class="meta">${esc(LAYER_NAME(layer))} ใช้ macro ${used}/${MACRO_MAX} ตัว</span></div>
        <div style="margin-top:8px;max-height:360px;overflow:auto">${list.map(
          (m) => `<button class="row" data-act="out" data-type="macro" data-uid="${esc(m.uid)}" ${m.actions.length ? "" : 'disabled title="ยังไม่มีขั้น เพิ่มที่หน้า Macros ก่อน"'}><span class="v" style="font-weight:700${cur?.type === "macro" && cur.uid === m.uid ? ";color:var(--cobalt)" : ""}">${esc(m.name)} <span class="small muted" style="font-weight:500">· ${m.actions.length ? `${macroSteps(m.actions)} ขั้น` : "ยังไม่มีขั้น"}</span></span>${ICON.chev}</button>`,
        ).join("") || `<p class="empty-note">ไม่มี macro ที่ตรงกับที่ค้น</p>`}</div>`
      : `<p class="empty-note">คลังยังไม่มี macro · สร้างได้ที่หน้า Macros</p>`;
  } else if (type === "layer") {
    body = layerPicker(S, D, cur);
  } else if (type === "keyboard") {
    body = `<p class="meta" style="margin-top:16px;line-height:22px">${cur?.type === "btn_keyboard" ? `ค่าบนจอย: ${esc(labelTarget(cur, cfg))}<br>` : ""}ตาราง keycode ของจอยยังไม่ยืนยัน จึงยังเลือกคีย์จากหน้านี้ไม่ได้</p>`;
  } else if (type === "none") {
    body = `<p class="meta" style="margin-top:16px">กดปุ่มนี้แล้วจะไม่ส่งอะไรออกไป</p>
      <button class="btn${cur?.type === "none" ? " ink" : ""}" style="margin-top:12px" data-act="out" data-type="none">ปิดปุ่มนี้</button>`;
  } else if (type === "unset") {
    body = `<p class="meta" style="margin-top:16px">${pl}จะไม่ทำอะไรเพิ่ม</p>
      <button class="btn" style="margin-top:12px" data-act="out" data-type="unset">ไม่ใช้${pl}</button>`;
  }
  return `<div class="head-inset">
      <span class="keytag${pend ? " fill" : " ink"}" style="height:52px;min-width:52px;font-size:20px;border-radius:8px">${esc(btnName(src))}</span>
      <div class="t"><h2>${esc(BTN_TITLE[src] ?? btnName(src))}</h2>
        <div class="status${pend ? " pending" : ""}">${pend ? `แก้แล้ว · ค่าบนจอย: ${esc(labelTarget(base, cfg))}` : `ค่าบนจอย: ${esc(labelTarget(base, cfg))}`}</div></div>
      <span style="display:grid;justify-items:end;gap:6px;white-space:nowrap">
        ${pend ? `<button class="link" data-act="revert-btn" title="ยกเลิกที่แก้ กลับไปเป็นค่าที่อยู่บนจอยตอนนี้">คืนค่าบนจอย</button>` : ""}
        ${isFactory ? "" : `<button class="link" data-act="factory-btn" title="กดปกติส่ง ${esc(btnName(src))} เอง ไม่มีกดค้างหรือดับเบิลคลิก">ตั้งเป็นค่าเริ่มต้น</button>`}
      </span>
    </div>
    ${src.startsWith("D-pad") ? `<div class="seg" style="margin-top:16px">${["D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →"].map((d) => `<button class="${src === d ? "on" : ""}" data-act="dpad" data-dir="${esc(d)}">${btnName(d)}</button>`).join("")}</div>` : ""}
    <div style="padding-top:20px"><div class="label" style="padding-bottom:8px">เมื่อกด ${esc(btnName(src))} แบบ…</div>${rows}</div>
    <div style="padding-top:28px;display:grid;gap:14px">
      <div class="label">${pl} ส่งเป็น</div>
      <div class="utabs" style="gap:20px">${types}</div>
      ${body}
      ${pend ? `<p style="margin:0">${untested(k) || UNSUP}</p>` : ""}
    </div>`;
}

function timing(S, D) {
  const ruled = (key, label) => {
    const v = D.get(key);
    return `<div class="ruled" style="flex:1"><label for="f-${key}">${label}</label><input id="f-${key}" class="${D.has(key) ? "pending" : ""}" type="number" inputmode="numeric" min="50" max="${key.endsWith("long") ? 2000 : 1000}" step="10" value="${v}" data-key="${key}" data-num><span class="unit">ms</span></div>`;
  };
  return `<section style="margin-top:40px">
    <div class="rule-head top"><h2>เวลาตัดสินการกด</h2><span class="meta">ใช้กับทุกปุ่มใน slot ${S.slots.activeSlot + 1} ${untested("runtime.long")}</span></div>
    <div style="display:flex;gap:24px;margin-top:14px">${ruled("runtime.long", "กดค้าง")}${ruled("runtime.double", "ดับเบิลคลิก")}</div>
  </section>`;
}

// ---------------- 02 Sticks ----------------

export function effCurve(D, base, startKey, endKey) {
  const c = { ...base, mid_points: base.mid_points };
  if (startKey) c.start_x = D.get(startKey);
  if (endKey) c.end_x = D.get(endKey);
  return c;
}

export function curveSvg(c, { pending = false, live = null, flat = true } = {}) {
  const S = 300;
  const X = (x) => (x / 255) * S, Y = (y) => S - (y / 255) * S;
  const pts = [[c.start_x, c.start_y], ...c.mid_points.map((m) => [m.x, m.y]), [c.end_x, c.end_y]];
  const line = [...(flat ? [[0, 0]] : []), ...pts, [255, c.end_y]].map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
  const ink = pending ? "#2140D9" : "#111111";
  let lv = "";
  if (live != null) {
    const ox = X(live), oy = Y(evalCurve(c, live));
    lv = `<path d="M0 ${oy} H${ox} V${S}" stroke="#111" stroke-dasharray="2 3" fill="none"/><circle cx="${ox}" cy="${oy}" r="5" fill="#111"/>`;
  }
  return `<svg viewBox="0 0 ${S} ${S}" aria-hidden="true">
    <rect x="0" y="0" width="${X(c.start_x)}" height="${S}" fill="${pending ? "#EDF0FC" : "#F2F2F2"}"/>
    <rect x="${X(c.end_x)}" y="0" width="${S - X(c.end_x)}" height="${S}" fill="#F2F2F2"/>
    ${[1, 2, 3].map((i) => `<path d="M${(S / 4) * i} 0 V${S} M0 ${(S / 4) * i} H${S}" stroke="#E2E2E2"/>`).join("")}
    <path d="M0 ${S} L${S} 0" stroke="#BDBDBD" stroke-dasharray="4 4"/>
    <polyline points="${line}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    ${lv}
    <circle cx="${X(c.start_x)}" cy="${Y(c.start_y)}" r="6" fill="#fff" stroke="${ink}" stroke-width="1.5"/>
    <circle cx="${X(c.end_x)}" cy="${Y(c.end_y)}" r="6" fill="#fff" stroke="${ink}" stroke-width="1.5"/>
  </svg>`;
}

export function slider(key, label, D, { min = 0, max = 255, disabled = false, fmt = null, tag = true } = {}) {
  const v = D.get(key);
  const p = D.has(key);
  const shown = fmt ? fmt(v) : `${pct(v)}  ·  ${v}`;
  return `<div class="slider"><div class="slider-head"><span><b>${label}</b>${tag && untested(key) ? ` ${untested(key)}` : ""}</span><span class="num${pendCls(p)}" data-out="${key}">${shown}</span></div>
    <input type="range" min="${min}" max="${max}" value="${v ?? min}" data-key="${key}" class="${p ? "pending" : ""}" style="--p:${(((v ?? min) - min) / (max - min || 1)) * 100}%" aria-label="${label}" ${disabled ? "disabled" : ""}></div>`;
}

function check(key, label, D, { disabled = false } = {}) {
  const v = !!D.get(key);
  return `<label class="check"><input type="checkbox" data-key="${key}" ${v ? "checked" : ""} class="${D.has(key) ? "pending" : ""}" ${disabled ? "disabled" : ""}>${label}</label>`;
}

// One tag for a row of checkboxes that are all writable but untested.
const checksTag = (...keys) => (keys.some((k) => untested(k)) ? `<span style="align-self:center">${UNTESTED}</span>` : "");

function presetTabs(key, names, D) {
  const v = D.get(key);
  const p = D.has(key);
  return `<div class="utabs">${Object.entries(names)
    .map(([id, l]) => `<button class="utab${v === id ? " on" : ""}${v === id && p ? " pending" : ""}" data-act="set" data-key="${key}" data-val="${id}">${l}</button>`)
    .join("")}</div>${p ? `<p style="margin:10px 0 0">${UNSUP}</p>` : ""}`;
}

export function sticks(S, D) {
  const cfg = S.current.cfg;
  const col = (side) => {
    const s = cfg[`joystick_${side}`];
    if (!s) return `<div><p class="empty-note">โปรไฟล์นี้ไม่มีค่า stick ${side === "left" ? "ซ้าย" : "ขวา"}</p></div>`;
    const keys = ["deadzone", "max", "invertX", "invertY", "round", "preset"].map((k) => `stick.${side}.${k}`);
    const pend = keys.some((k) => D.has(k));
    const other = side === "left" ? "ขวา" : "ซ้าย";
    const c = effCurve(D, s.curve, `stick.${side}.deadzone`, `stick.${side}.max`);
    const linear = !s.curve.mid_points.length;
    return `<div>
      <div class="head-inset">${inset(side === "left" ? "stickL" : "stickR", { title: `Stick ${side === "left" ? "ซ้าย" : "ขวา"}` })}
        <div class="t"><h2>Stick ${side === "left" ? "ซ้าย" : "ขวา"}</h2><div class="status${pend ? " pending" : ""}">${pend ? "แก้แล้ว" : "ค่าบนจอย"} · ${linear ? "Linear" : "curve กำหนดเอง"}</div></div>
        <button class="link" data-act="copy-side" data-from="stick.${side}." data-to="stick.${side === "left" ? "right" : "left"}.">คัดลอกไป${other}</button></div>
      <div class="charts">
        <div class="curve-box"><div data-live-chart="stick-${side}">${curveSvg(c, { pending: pend })}</div><div class="cap">แนวนอน = ระยะที่ดัน · แนวตั้ง = ค่าที่ส่งออก</div></div>
        <div class="live" data-live="stick-${side}">${liveStick(null)}</div>
      </div>
      <div class="controls">
        ${presetTabs(`stick.${side}.preset`, PRESET, D)}
        ${slider(`stick.${side}.deadzone`, "Deadzone ด้านใน", D, { max: 127 })}
        ${slider(`stick.${side}.max`, "ระยะสูงสุด", D, { min: 128 })}
        <div class="checks">${check(`stick.${side}.invertX`, "กลับแกน X", D)}${check(`stick.${side}.invertY`, "กลับแกน Y", D)}${check(`stick.${side}.round`, "ขอบวงกลม", D)}${checksTag(`stick.${side}.invertX`)}</div>
      </div>
    </div>`;
  };
  return `${head("Sticks", "ขยับ stick บนจอยเพื่อดูค่าที่จอยส่งออกจริง หลังผ่าน curve ที่เขียนไว้แล้ว")}<div class="cols-2">${col("left")}${col("right")}</div>
    <section style="margin-top:40px"><div class="rule-head"><h2>ปุ่มที่กดอยู่</h2><span class="meta">อ่านจากจอยโดยตรง · ใช้ดูชื่อปุ่ม LM/RM ได้</span></div>
      <div data-live="keys" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;min-height:56px;padding-top:12px">${liveKeys(null)}</div></section>`;
}

// v: what the controller sends out (after its own curve), x/y in -1..1, y positive down.
// Like joy.cpl: the square is the full range, so a stick that reaches 100% touches its edge.
export function liveStick(v, idle = "ขยับ stick บนจอยเพื่อดูค่า") {
  const R = 100;
  const frame = `<rect x="-100" y="-100" width="200" height="200" fill="none" stroke="#111"/><path d="M-100 0H100M0 -100V100" stroke="#E2E2E2"/>`;
  if (!v) {
    return `<svg width="200" height="200" viewBox="-102 -102 204 204" aria-hidden="true">${frame}</svg>
      <div class="readout muted" style="font-size:16px;text-align:center">${idle}</div>`;
  }
  const { x, y } = v;
  const mag = Math.min(1, Math.hypot(x, y));
  const atEdge = Math.max(Math.abs(x), Math.abs(y)) >= 0.99;
  return `<svg width="200" height="200" viewBox="-102 -102 204 204" aria-hidden="true">${frame}
      <circle cx="${x * R}" cy="${y * R}" r="7" fill="#111"/></svg>
    <div class="readout">${mag < 0.02 ? "ไม่ได้ขยับ" : `ส่งออก ${Math.round(mag * 100)}%${atEdge ? " · ชนขอบ" : ""}`}</div>
    <div class="meta mono">X ${x.toFixed(2)} · Y ${(-y).toFixed(2)}</div>`;
}

// Buttons held now, from the controller's key events. Names are what the controller reports.
export function liveKeys(keys) {
  if (!keys) return "";
  return keys.length
    ? keys.map((k) => `<span class="keytag" style="height:36px;padding:0 12px">${esc(k)}</span>`).join("")
    : `<span class="muted">กดปุ่มบนจอยเพื่อดูชื่อปุ่ม</span>`;
}

// ---------------- 03 Triggers ----------------

export function triggers(S, D) {
  const cfg = S.current.cfg;
  const col = (side) => {
    const t = cfg[`trigger_${side}`];
    if (!t) return `<div><p class="empty-note">โปรไฟล์นี้ไม่มีค่าไก${side === "left" ? "ซ้าย" : "ขวา"}</p></div>`;
    const keys = ["start", "end", "preset"].map((k) => `trigger.${side}.${k}`);
    const pend = keys.some((k) => D.has(k));
    const c = effCurve(D, t.curve, `trigger.${side}.start`, `trigger.${side}.end`);
    const ik = side === "left" ? "trigL" : "trigR";
    const zones = cfg.layers[0]?.[`trigger_zones_${side}`];
    const name = side === "left" ? "ไกซ้าย (LT)" : "ไกขวา (RT)";
    const zoneHtml = zones
      ? `<div style="display:flex;border:1px solid var(--ink);border-radius:6px;overflow:hidden;height:56px">${zones
          .map((z, i) => `<div style="flex:${Math.max(1, z.stop - z.start)};display:flex;align-items:center;padding:0 16px;${i % 2 ? "background:var(--ink);color:#fff" : ""}" class="mono">${pct(z.start)}–${pct(z.stop)} · ${esc(labelTarget(z.target, cfg))}</div>`)
          .join("")}</div>`
      : `<div style="display:flex;align-items:center;height:56px;padding:0 16px;border:1px dashed var(--keycap);border-radius:6px" class="meta">ยังไม่แบ่ง · ทั้งไกเป็น ${side === "left" ? "LT" : "RT"} ตามปกติ</div>`;
    return `<div>
      <div class="head-inset">${inset(ik, { mark: TRIG_MARK[ik], title: `${name} มองจากด้านหลัง` })}
        <div class="t"><h2>${name}</h2><div class="status${pend ? " pending" : ""}">${pend ? "แก้แล้ว" : "ค่าบนจอย"} · ${t.curve.mid_points.length ? "curve กำหนดเอง" : "Linear"}</div></div>
        <button class="link" data-act="copy-side" data-from="trigger.${side}." data-to="trigger.${side === "left" ? "right" : "left"}.">คัดลอกไป${side === "left" ? "ขวา" : "ซ้าย"}</button></div>
      <div class="charts">
        <div class="curve-box"><div data-live-chart="trigger-${side}">${curveSvg(c, { pending: pend })}</div><div class="cap">แนวนอน = ระยะที่กด · แนวตั้ง = ค่าที่ส่งออก</div></div>
        <div class="live" data-live="trigger-${side}">${liveTrigger(null)}</div>
      </div>
      <div class="controls">
        ${presetTabs(`trigger.${side}.preset`, TPRESET, D)}
        ${slider(`trigger.${side}.start`, "จุดเริ่มทำงาน", D, { max: 127 })}
        ${slider(`trigger.${side}.end`, "จุดกดสุด (100%)", D, { min: 128 })}
        <div style="display:grid;gap:12px"><div class="slider-head"><b>แบ่งช่วงไกเป็นปุ่ม</b><span class="meta faint" title="ยังเขียนลงจอยไม่ได้">+ เพิ่มช่วง</span></div>${zoneHtml}</div>
      </div>
    </div>`;
  };
  return `${head("Triggers", "กดไกบนจอยเพื่อดูระยะจริง · ภาพไกมองจากด้านหลังจอย")}<div class="cols-2">${col("left")}${col("right")}</div>`;
}

// v: { press, out } (0..1) from the controller's own stream, a number for what a standard
// gamepad reports (the output), or null when nothing reports the trigger.
export function liveTrigger(v) {
  const bar = (h, color) => `<div style="width:40px;height:200px;border:1px solid #111;position:relative"><div style="position:absolute;left:0;right:0;bottom:0;height:${h * 100}%;background:${color}"></div></div>`;
  if (v === null) return `${bar(0)}<div class="readout muted" style="font-size:16px">เบราว์เซอร์ยังไม่เห็นจอย<br>ทดสอบไกด้วย joy.cpl ไปก่อน</div>`;
  if (typeof v === "object") {
    const pc = (x) => Math.round(x * 100);
    if (v.press < 0.01) return `${bar(0)}<div class="readout muted" style="font-size:16px">ไม่ได้กด</div>`;
    return `${bar(v.press, "#111")}<div class="readout">กด ${pc(v.press)}%${v.press >= 0.99 ? " · สุด" : ""}</div><div class="meta">ส่งออก ${pc(v.out)}% ตาม curve ในกราฟ</div>`;
  }
  if (v < 0.01) return `${bar(0)}<div class="readout muted" style="font-size:16px">ไม่ได้กด</div>`;
  return `${bar(v, "#111")}<div class="readout">ส่งออก ${Math.round(v * 100)}%${v >= 0.99 ? " · เต็ม" : ""}</div>`;
}

// ---------------- 04 Macros ----------------

// One library for every slot (macros.js). The controller gets a copy of a macro in each layer
// whose buttons play it, at the next write.
export function macros(S, D) {
  const lib = S.lib.list();
  const plan = S.plan ?? { rows: [], errors: [], used: {} };
  const q = (S.ui.macroQ ?? "").trim().toLowerCase();
  const list = macroList(S);
  const sel = openMacro(S);
  const stale = (uid) => plan.rows.some((r) => r.uid === uid && r.kind === "update");
  const dur = (m) => m.actions.reduce((t, a) => Math.max(t, a.at_ms), 0);
  const row = (m) => {
    const on = sel?.uid === m.uid;
    const srcs = [...new Set(macroUses(S, D, m.uid).map((u) => u.source))];
    const state = stale(m.uid)
      ? `<span class="meta pending">แก้แล้ว · ยังไม่ได้เขียน</span>`
      : srcs.length
        ? `<span style="display:flex;gap:4px;align-items:center">${srcs.slice(0, 3).map((s) => `<span class="keytag ink">${esc(btnName(s))}</span>`).join("")}${srcs.length > 3 ? `<span class="meta">+${srcs.length - 3}</span>` : ""}</span>`
        : `<span class="meta">${m.actions.length ? "ยังไม่ได้ใช้" : "ยังไม่มีขั้น"}</span>`;
    return `<button class="list-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left;justify-content:space-between" data-act="macro" data-uid="${esc(m.uid)}">
      <span><span style="display:block;font-size:17px;font-weight:${on ? 700 : 600}">${esc(m.name)}</span>
      <span class="muted" style="font-size:14px">${macroSteps(m.actions)} ขั้น · ${dur(m)} ms · ${esc(MACRO_MODE[m.mode] ?? "")}${on ? " · กำลังเปิดดู" : ""}</span></span>
      ${state}
    </button>`;
  };
  const usage = layerList(S, D)
    .filter((l) => !l.deleted)
    .map((l) => `${esc(LAYER_NAME(l.id))} <span class="mono">${plan.used[l.id] ?? 0}/${MACRO_MAX}</span>`)
    .join(" · ");
  const uses = sel ? macroUses(S, D, sel.uid) : [];
  const left = `<div>
    <div style="display:flex;gap:12px;align-items:center">
      <input class="field" type="search" style="flex:1;height:44px" placeholder="ค้นหา macro" value="${esc(S.ui.macroQ ?? "")}" data-filter="macroQ" aria-label="ค้นหา macro">
      <button class="btn" data-act="macro-new">+ Macro ใหม่</button>
    </div>
    <div class="rule-head" style="margin-top:20px"><h2>คลัง macro</h2><span class="meta">${lib.length} ตัว${q ? ` · ตรงกับที่ค้น ${list.length}` : ""}</span></div>
    ${list.map(row).join("") || `<p class="empty-note">${lib.length ? "ไม่มี macro ที่ตรงกับที่ค้น" : "ยังไม่มี macro · กด + Macro ใหม่"}</p>`}
    <p class="meta" style="margin-top:20px;line-height:20px">จอยจะมีเฉพาะ macro ที่ผูกกับปุ่ม เก็บได้ ${MACRO_MAX} ตัวต่อ layer · Slot ${S.slots.activeSlot + 1} ใช้อยู่ ${usage}</p>
    <p class="meta" style="margin-top:8px;line-height:20px">คลังเก็บในเบราว์เซอร์นี้ ใช้ได้กับทุก slot · <button class="link" data-act="lib-export">ส่งออก</button> · <button class="link" data-act="lib-import">นำเข้า</button></p>
    ${uses[0] ? boundFigure(uses[0].source, sel.name) : ""}
  </div>`;
  const sub = "macro ทั้งหมดอยู่ในคลังเดียว ปุ่มใน layer ไหนก็เลือกใช้ได้";
  if (!sel) return `${head("Macros", sub)}<div style="max-width:440px">${left}</div>`;
  const m = sel;
  const bars = macroBars(m);
  const total = Math.max(100, dur(m));
  const scaleMax = Math.ceil(total / 100) * 100;
  const ticks = Array.from({ length: scaleMax / 100 + 1 }, (_, i) => i * 100);
  const selStep = Math.min(S.ui.step ?? 0, bars.length - 1);
  const rows = groupRows(bars)
    .map(({ label, items }) => {
      const isSel = items.some((b) => b.i === selStep);
      return `<div class="tl-row${isSel ? " sel" : ""}"><b>${esc(label)}</b><div class="tl-track">${items
        .map((b) => `<button class="tl-bar${b.i === selStep ? " sel" : ""}" style="left:${(b.from / scaleMax) * 100}%;width:${((b.to - b.from) / scaleMax) * 100}%" data-act="step" data-i="${b.i}">${b.from}-${b.to}</button>`)
        .join("")}</div></div>`;
    })
    .join("");
  const st = bars[selStep];
  const where = (u) => `${btnName(u.source)}${u.layer ? ` (${LAYER_NAME(u.layer)})` : ""}`;
  const notice = stale(m.uid)
    ? `<p class="notice" style="margin:0 0 20px;font-size:15px;color:var(--ink)">${ICON.warn}<span><b>แก้แล้ว ยังไม่ได้เขียนลงจอย</b> · ปุ่ม ${esc([...new Set(uses.map(where))].join(", "))} ยังเล่นแบบเดิมจนกว่าจะเขียน</span></p>`
    : "";
  const modes = `<div class="utabs">${Object.entries(MACRO_MODE)
    .map(([id, l]) => `<button class="utab${m.mode === id ? " on" : ""}" data-act="macro-mode" data-val="${id}">${l}</button>`)
    .join("")}</div>`;
  const stepCount = macroSteps(m.actions);
  const tool = `<div style="border-top:3px solid var(--ink);margin:28px 0 24px;padding-top:16px">
      <span class="label" style="display:block;margin-bottom:8px">เพิ่มขั้น · กดปุ่มที่ macro จะกด ตามลำดับ</span>
      <div class="keys">${MACRO_PAD.map((p) => `<button class="key" style="width:auto;min-width:56px;padding:0 12px" data-act="step-add" data-btn="${esc(p)}">${esc(btnName(p))}</button>`).join("")}</div>
      <div style="display:flex;align-items:end;gap:24px;margin-top:16px">
        <label><span class="label" style="display:block;margin-bottom:6px">กดค้างขั้นละ (ms)</span><input class="field" type="number" min="10" max="2000" step="10" style="width:120px" value="${S.ui.hold ?? 50}" data-ui="hold"></label>
        <label><span class="label" style="display:block;margin-bottom:6px">เว้นก่อนขั้นถัดไป (ms)</span><input class="field" type="number" min="0" max="2000" step="10" style="width:120px" value="${S.ui.gap ?? 50}" data-ui="gap"></label>
        <span style="flex:1"></span>
        <span class="muted">${stepCount} ขั้น · รวม ${dur(m)} ms</span>
        <button class="link" data-act="step-undo" ${stepCount ? "" : "disabled"}>ลบขั้นล่าสุด</button>
      </div></div>`;
  const right = `<div>
    ${notice}
    <div style="display:grid;grid-template-columns:1fr 300px;gap:28px">
      <div data-name-field><label><span class="label" style="display:block;margin-bottom:8px">ชื่อ macro</span>
        <input class="field" style="height:52px;font-size:20px" value="${esc(m.name)}" data-lib-name data-default="Macro" maxlength="${APP_NAME_MAX}"></label>
        <div style="margin-top:6px">${nameFit(m.name)}</div></div>
      <div><span class="label" style="display:block;margin-bottom:8px">ใช้กับปุ่ม · Slot ${S.slots.activeSlot + 1}</span>
        <div class="field" style="min-height:52px;height:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:8px;padding-bottom:8px;color:${uses.length ? "inherit" : "var(--ink-2)"}">${uses.length ? uses.map((u) => `<span class="keytag">${esc(btnName(u.source))}</span><span class="small muted">${esc(u.layer ? LAYER_NAME(u.layer) : "")}${u.press === "simple" ? "" : ` ${esc(PRESS.find((p) => p.id === u.press).label)}`}</span>`).join("") : "ยังไม่ได้ใช้ · เลือกได้ที่หน้า Buttons → Macro"}</div>
        ${uses.length ? `<div style="margin-top:6px">${UNTESTED}</div>` : ""}</div>
    </div>
    <div style="margin-top:24px"><span class="label" style="display:block;margin-bottom:8px">เล่นแบบ</span>${modes}</div>
    ${tool}
    <div class="timeline">
      <div class="tl-scale"><div></div><div>${ticks.map((t) => `<span style="left:${(t / scaleMax) * 100}%">${t}${t === scaleMax ? " ms" : ""}</span>`).join("")}</div></div>
      ${rows || `<p class="empty-note">ยังไม่มีขั้น · กดปุ่มด้านบนเพื่อเพิ่ม</p>`}
    </div>
    ${st ? `<div style="display:grid;grid-template-columns:300px 200px 200px;gap:24px;align-items:end;margin-top:28px">
      <label><span class="label" style="display:block;margin-bottom:8px">ขั้นที่เลือก</span><div class="field" style="display:flex;align-items:center">${esc(st.label)}</div></label>
      <div><span class="label" style="display:block;margin-bottom:8px">กดที่</span><div class="ruled"><label></label><span class="num" style="font-size:18px">${st.from}</span><span class="unit">ms</span></div></div>
      <div><span class="label" style="display:block;margin-bottom:8px">ปล่อยที่</span><div class="ruled"><label></label><span class="num" style="font-size:18px">${st.to}</span><span class="unit">ms</span></div></div>
    </div>` : ""}
    <div style="display:flex;gap:16px;align-items:center;margin-top:32px">
      <button class="btn" disabled title="ยังไม่รองรับ"><span style="width:12px;height:12px;border-radius:6px;background:var(--error);display:inline-block"></span>อัดจากจอย</button>
      <button class="btn ink" disabled title="คำสั่งเล่น macro บนจอยยังไม่ยืนยัน">${ICON.play} ลองเล่นบนจอย</button>
      <span style="flex:1"></span>
      <button class="link" data-act="macro-copy">ทำสำเนา</button>
      <button class="btn err sm" data-act="macro-delete">ลบออกจากคลัง</button>
    </div>
  </div>`;
  return `${head("Macros", sub)}<div style="display:grid;grid-template-columns:440px minmax(0,1fr);gap:56px">${left}${right}</div>`;
}

// Buttons a new macro can press: the face, shoulder, trigger and stick buttons (not M1–M6).
const MACRO_PAD = ["A", "B", "X", "Y", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →", "LB", "RB", "LT (active)", "RT (active)", "Back", "Start", "LS", "RS", "C", "Z"];

function macroBars(m) {
  const open = new Map();
  const bars = [];
  for (const a of m.actions) {
    const k = JSON.stringify(a.target);
    if (a.action === "press") open.set(k, a);
    else if (open.has(k)) {
      const p = open.get(k);
      bars.push({ label: labelTarget(p.target), from: p.at_ms, to: a.at_ms });
      open.delete(k);
    }
  }
  for (const p of open.values()) bars.push({ label: labelTarget(p.target), from: p.at_ms, to: p.at_ms + 10 });
  return bars.sort((a, b) => a.from - b.from).map((b, i) => ({ ...b, i }));
}

function groupRows(bars) {
  const rows = [];
  for (const b of bars) {
    const r = rows.find((x) => x.label === b.label);
    if (r) r.items.push(b);
    else rows.push({ label: b.label, items: [b] });
  }
  return rows;
}

function boundFigure(src, name) {
  const id = { "RT (active)": "RT", "LT (active)": "LT" }[src] ?? src;
  const def = BACK.callouts.some((c) => c.id === id) ? BACK : FRONT.callouts.some((c) => c.id === id) ? FRONT : null;
  if (!def) return "";
  return `<section style="margin-top:28px"><div class="rule-head top"><h2>ปุ่มที่ผูกอยู่ · ${esc(btnName(src))}</h2></div>
    ${stageSvg(def, { [id]: { name: btnName(src), value: name, state: "set", sel: true } }, { kind: def === BACK ? "back" : "front" })}
    <p class="meta" style="margin-top:4px">${def === BACK ? "มองจากด้านหลัง · ซ้ายของภาพคือมือขวา" : "มองจากด้านหน้า"}</p></section>`;
}

// ---------------- 05 Vibration ----------------
// As the official Vibration page: grip vibration (both motors, TLV 8/9) and, per trigger, grip
// feedback when the trigger is pressed (on/off in RAM 0x06, strength in TLV 6/7). Levels 1–5.

export function vibration(S, D) {
  const cfg = S.current.cfg;
  const grip = gripPart(cfg);
  const lra = lraGrip(S);
  const gripPct = (l) => Math.round((gripEndY(l, lra) / 255) * 100);
  const rows = [];
  if (grip) {
    const on = !!D.get("grip.enabled");
    const custom = grip.curve.mid_points.length > 0 && !D.has("grip.level");
    rows.push(vibRow(S, D, {
      key: "grip", inset: "motorL", on,
      title: "ด้ามสั่นตามเกม", en: "Native Grip Vibration",
      desc: "การสั่นปกติเวลาเกมสั่งให้จอยสั่น เช่น โดนยิง ระเบิด หรือรถชน มอเตอร์ในด้ามซ้ายและขวาใช้ค่าเดียวกัน ถ้าปิด ด้ามจะไม่สั่นตามเกมเลย",
      level: `ระดับ 5 สั่นเต็มแรงตามที่เกมสั่ง · ระดับ 1 เหลือ ${gripPct(1)}%`,
      notes: [
        custom ? `ตอนนี้ด้ามใช้ curve ที่ตั้งไว้เอง (ใกล้ระดับ ${D.get("grip.level")}) ถ้าเลื่อนระดับ จะกลายเป็นเส้นตรงแบบเดียวกับแอป Flydigi` : "",
        S.info ? "" : "อ่านรุ่นมอเตอร์จากจอยไม่ได้ ระดับความแรงจะยังเขียนลงจอยไม่ได้",
      ],
      tags: [untested("motor.left.enabled"), untested("motor.left.curve")],
      levelDisabled: !on || !S.info,
    }));
  }
  for (const side of ["left", "right"]) {
    const t = cfg[`vibration_trigger_${side}`];
    if (!t) continue;
    const tn = side === "left" ? "LT" : "RT";
    const mode = motorMode(S.motor, side);
    const known = mode !== undefined;
    const on = !!D.get(`gripfb.${side}.enabled`);
    const haptic = known && mode !== 0 && mode !== FEEDBACK_MODE;
    rows.push(vibRow(S, D, {
      key: `gripfb.${side}`, inset: side === "left" ? "trigL" : "trigR", on, switchDisabled: !known,
      title: `บีบไก${side === "left" ? "ซ้าย" : "ขวา"} (${tn}) แล้วด้ามสั่น`, en: `${side === "left" ? "Left" : "Right"} Trigger-Bound Grip Feedback`,
      desc: `บีบไก ${tn} เมื่อไหร่ ด้ามจับจะสั่นเองทันทีโดยไม่ต้องรอเกมสั่ง ช่วยให้รู้สึกตอนยิงหรือเหยียบเบรก (ในไกไม่มีมอเตอร์ ตัวที่สั่นคือด้ามจับ)`,
      level: "ระดับ 5 สั่นแรงสุดตอนบีบไกจนสุด · ระดับ 1 เบาที่สุด",
      notes: [
        known ? "" : "อ่านสถานะเปิด/ปิดจากจอยไม่ได้ ลองกดอ่านค่าจากจอยใหม่",
        haptic && (on || !D.has(`gripfb.${side}.enabled`)) ? `ตอนนี้ไก ${tn} ใช้เอฟเฟกต์ X-Haptics ที่ตั้งในแอป Flydigi อยู่ ถ้าเปิดตัวนี้ เอฟเฟกต์นั้นจะถูกปิด` : "",
      ],
      tags: [untested(`gripfb.${side}.enabled`), untested(`vibtrig.${side}.curve`)],
      levelDisabled: !on,
    }));
  }
  return `${head("Vibration", "ตั้งการสั่นของด้ามจับ ความแรงเลือกได้ 5 ระดับ แบบเดียวกับหน้า Vibration ในแอป Flydigi")}
    <div class="vib-head"><span style="font-size:20px;color:var(--ink)">การสั่น</span><span></span><span>เปิด</span><span>ความแรง</span></div>
    ${rows.join("")}
    <section style="margin-top:48px;display:grid;grid-template-columns:minmax(0,560px) minmax(0,1fr);gap:80px;border-top:3px solid var(--ink);padding-top:24px">
      <div><h2 class="title" style="font-size:20px">ลองยังไงว่าตั้งแล้วได้ผล</h2><p class="muted" style="margin:8px 0 0;line-height:22px">หน้านี้ยังไม่มีปุ่มทดสอบ ปุ่ม Test Vibration ในเว็บ Flydigi ไม่ได้สั่งจอยตรงๆ แต่ให้เบราว์เซอร์สั่งจอยสั่น ซึ่ง Chrome บนเครื่องนี้มองไม่เห็นจอย ปุ่มนั้นจึงไม่มีผลอะไร</p></div>
      <ol style="margin:0;padding:0;list-style:none;display:grid;gap:14px">
        <li style="display:grid;grid-template-columns:48px 1fr"><span class="num">1</span>บีบไกแล้วด้ามสั่น: เขียนลงจอยแล้วบีบไก LT หรือ RT ได้เลย ไม่ต้องเปิดเกม</li>
        <li style="display:grid;grid-template-columns:48px 1fr"><span class="num">2</span>ด้ามสั่นตามเกม: เปิดเกมที่มีการสั่น แล้วเทียบความแรงก่อนและหลังเปลี่ยนระดับ</li>
        <li style="display:grid;grid-template-columns:48px 1fr"><span class="num">3</span>ถ้าเปิด X-Haptics ไว้ในแอป Flydigi เอฟเฟกต์ X-Haptics จะสั่นแทนค่าในหน้านี้</li>
      </ol>
    </section>`;
}

// One vibration row: photo, what it does, on/off, level 1–5.
function vibRow(S, D, r) {
  const en = `${r.key}.enabled`, lv = `${r.key}.level`;
  const pend = D.has(en) || D.has(lv);
  const notes = r.notes.filter(Boolean).map((n) => `<p class="notice" style="margin:6px 0 0">${ICON.warn}<span>${n}</span></p>`).join("");
  const tags = [...new Set(r.tags.filter(Boolean))].join(" ");
  return `<div class="vib-row${r.on ? "" : " off"}">
    ${inset(r.inset, { w: 136, h: 88, mark: r.inset.startsWith("trig") ? [TRIG_MARK[r.inset][0] - 20, TRIG_MARK[r.inset][1]] : null, title: r.title })}
    <div><h3 class="${pend ? "pending" : ""}">${r.title}</h3><div class="meta">${r.en} ในแอป Flydigi</div>
      <p class="vib-desc">${r.desc}</p>${tags ? `<div style="margin-top:6px">${tags}</div>` : ""}${notes}</div>
    <div>${check(en, `<span class="sr">เปิด ${r.title}</span>`, D, { disabled: r.switchDisabled })}</div>
    <div>${slider(lv, "ความแรง", D, { min: 1, max: VIB_LEVELS, disabled: r.levelDisabled, fmt: meta(lv, S).fmt, tag: false })}
      <div class="vib-ticks" aria-hidden="true">${Array.from({ length: VIB_LEVELS }, (_, i) => `<span>${i + 1}</span>`).join("")}</div>
      <p class="vib-desc">${r.on ? r.level : "เปิดก่อนจึงจะปรับความแรงได้"}</p></div>
  </div>`;
}

// ---------------- 06 Gyro ----------------

export function gyro(S, D) {
  const g = S.current.cfg.gyroscope;
  if (!g) return `${head("Gyro", "")}<p class="empty-note">โปรไฟล์นี้ไม่มีค่า gyro</p>`;
  const mode = D.get("gyro.mode");
  const pm = D.has("gyro.mode");
  const sub = { disable: "ไม่ใช้ gyro", left_joystick: "เดิน / ขับรถ", right_joystick: "เล็งในเกมจอย", mouse: "เกม PC ที่ใช้เมาส์" };
  const modes = Object.entries(GYRO_MODE)
    .map(([id, l]) => {
      const on = mode === id;
      const base = g.mode === id;
      return `<button class="utab big${on ? " on" : ""}${on && pm ? " pending" : ""}" data-act="set" data-key="gyro.mode" data-val="${id}" style="${on && pm ? "color:var(--cobalt)" : ""}">${l}<small class="${on && pm ? "pending" : ""}">${on && pm ? `${sub[id]} · แก้แล้ว` : base ? "ค่าบนจอยตอนนี้" : sub[id]}</small></button>`;
    })
    .join("");
  const sel = (key, opts) => `<select class="field${D.has(key) ? " pending" : ""}" data-key="${key}" style="height:52px;font-size:16px;width:100%">${Object.entries(opts).map(([v, l]) => `<option value="${v}" ${D.get(key) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const ink = pm ? "#2140D9" : "#111";
  return `${head("Gyro", `เอียงจอยเพื่อเล็ง · ${g.mode === "disable" ? "เดิมปิดอยู่ใน slot นี้" : `ค่าบนจอย: ${GYRO_MODE[g.mode]}`}`)}
  <div class="split wide-right">
    <div>
      <div class="stage"><svg viewBox="40 170 1560 1060" aria-label="ภาพจอยด้านหน้า พร้อมแกนหมุนของ gyro">
        <image href="${PHOTO.front}" x="0" y="0" width="1600" height="1280"/>
        <path d="M180 760 H1420 M800 360 V1060" stroke="${ink}" stroke-width="2.5" stroke-dasharray="10 9" fill="none"/>
        <path d="M200 1010 C 420 1160, 1180 1160, 1400 1010" stroke="${ink}" stroke-width="3.5" fill="none"/>
        <path d="M200 1010 l-6 -34 M200 1010 l32 -12 M1400 1010 l6 -34 M1400 1010 l-32 -12" stroke="${ink}" stroke-width="3.5" fill="none"/>
        <path d="M1500 420 C 1560 560, 1560 900, 1500 1060" stroke="${ink}" stroke-width="3.5" fill="none"/>
        <path d="M1500 420 l-30 14 M1500 420 l2 34 M1500 1060 l-30 -14 M1500 1060 l2 -34" stroke="${ink}" stroke-width="3.5" fill="none"/>
        <text x="800" y="1185" text-anchor="middle" fill="${ink}" style="font:700 30px var(--sans)">หมุนแบบพวงมาลัย (X) → เล็งซ้าย–ขวา</text>
        <text x="1500" y="395" text-anchor="end" fill="${ink}" style="font:700 30px var(--sans)">ก้ม–เงย (Y) → เล็งบน–ล่าง</text>
      </svg></div>
      <section style="margin-top:28px;border-top:1px solid var(--ink-2);padding-top:24px">
        <div class="rule-head"><h2>ผลบนจอยตอนนี้</h2><span class="meta">ตามค่าที่เขียนอยู่บนจอย${pm ? " · ที่แก้ไว้ยังไม่ได้เขียน" : ""}</span></div>
        ${gyroOut(g)}
        <div data-live="keys" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;min-height:48px;padding-top:8px">${liveKeys(null)}</div>
      </section>
      <section style="margin-top:28px;border-top:1px solid var(--ink-2);padding-top:24px">
        <div class="rule-head"><h2>ค่าเซนเซอร์สด</h2><span class="meta">อ่านจากจอยโดยตรง ไม่ขึ้นกับการตั้งค่า</span></div>
        <div data-live="turn" style="display:flex;gap:28px;align-items:center;margin:16px 0 24px">${liveAim(g, null)}</div>
        <p style="margin:-12px 0 24px"><button class="link" data-act="aim-center">ให้จุดกลับกลาง</button></p>
        <div data-live="imu">${liveImu(null)}</div>
      </section>
    </div>
    <div>
      ${gyroSettings(S, D, g, modes, sel)}
    </div>
  </div>`;
}

// The settings column: every value in the profile's gyro block, laid out like the official web
// app's Advanced Motion Control page (English names from there in small type, to match it up).
function gyroSettings(S, D, g, modes, sel) {
  const mode = D.get("gyro.mode");
  const off = mode === "disable";
  const group = (n, title, en, note, body, { dim = false, tag = "" } = {}) => `<section style="margin-top:${n === 1 ? 0 : 40}px${dim ? ";opacity:.55" : ""}">
      <div class="rule-head"><h2>${n}. ${title} <span class="meta" style="font-weight:400">${en}</span></h2>${tag}</div>
      <p class="muted" style="margin:8px 0 16px;line-height:22px">${note}</p>${body}</section>`;
  const hint = (t) => `<p class="meta" style="margin:6px 0 0;line-height:20px">${t}</p>`;
  const sub = (t, en, tag = "") => `<div class="slider-head" style="margin-top:24px"><b>${t} <span class="meta" style="font-weight:400">${en}</span></b>${tag}</div>`;

  // 1. Mode and activation: one hold/toggle for all buttons, a primary and an optional secondary.
  const acts = D.get("gyro.activation") ?? [];
  const pa = D.has("gyro.activation");
  const how = acts[0]?.activation ?? "hold";
  const btnSel = (i) => {
    const cur = acts[i]?.button ?? "";
    const opts = BUTTONS.filter((b) => b === cur || !acts.some((a) => a.button === b));
    return `<select class="field${pa ? " pending" : ""}" data-gyro-btn="${i}" style="height:44px;width:100%" aria-label="${i ? "ปุ่มรอง" : "ปุ่มหลัก"}">
      ${i ? `<option value="" ${cur ? "" : "selected"}>ไม่ตั้ง</option>` : ""}${opts.map((b) => `<option value="${esc(b)}" ${b === cur ? "selected" : ""}>${esc(btnName(b))}</option>`).join("")}</select>`;
  };
  const g1 = group(1, "โหมด", "Motion Control Mode", "เอียงจอยแล้วให้ไปขยับอะไร",
    `<div class="utabs" style="gap:28px">${modes}</div>
    ${sub("แบบการกด", "Activation Mode", untested("gyro.activation"))}
    <div class="utabs" style="margin-top:10px">${[["hold", "กดค้าง"], ["toggle", "กดสลับ"]].map(([id, l]) => `<button class="utab${how === id ? " on" : ""}${how === id && pa ? " pending" : ""}" data-act="gyro-act-mode" data-val="${id}">${l}</button>`).join("")}</div>
    ${hint("กดค้าง = gyro ทำงานเฉพาะตอนกดปุ่มค้าง · กดสลับ = กดครั้งแรกเปิด กดอีกครั้งปิด")}
    ${sub("ปุ่มเปิด gyro", "Activation Buttons")}
    <div style="display:grid;grid-template-columns:56px 1fr;gap:10px;align-items:center;margin-top:10px">
      <span class="meta">หลัก</span>${btnSel(0)}<span class="meta">รอง</span>${btnSel(1)}</div>
    ${hint("กดปุ่มไหนก็ได้ใน 2 ปุ่มนี้ gyro ก็ทำงาน")}
    ${acts.length > 2 ? hint(`โปรไฟล์นี้มีปุ่มเปิดเพิ่มอีก: ${esc(acts.slice(2).map((a) => btnName(a.button)).join(", "))} (คงไว้ตามเดิม)`) : ""}`,
    { tag: untested("gyro.mode") });

  // 2. Which motion aims where (not on the official page; it resets these on a mode change).
  const g2 = group(2, "เล็งด้วยท่าไหน", "Axis", `ท่าไหนพาเป้าไปซ้าย–ขวา ท่าไหนพาไปบน–ล่าง · ปกติไม่ต้องแก้${off ? " · มีผลเมื่อเปิด gyro" : ""}`,
    `<div style="display:grid;gap:16px">
      <label><span class="slider-head"><b>เล็งซ้าย–ขวาด้วย</b></span><span style="display:block;margin-top:8px">${sel("gyro.axisX", AXIS)}</span></label>
      <label><span class="slider-head"><b>เล็งบน–ล่างด้วย</b></span><span style="display:block;margin-top:8px">${sel("gyro.axisY", AXIS)}</span></label>
      <div><b>กลับทิศ <span class="meta" style="font-weight:400">Direction Inversion</span></b>
        <div class="checks" style="margin-top:10px">${check("gyro.invertX", "กลับซ้าย–ขวา", D)}${check("gyro.invertY", "กลับบน–ล่าง", D)}</div></div></div>`,
    { dim: off, tag: untested("gyro.axisX") });

  // 3. The response curve, as on the official Advanced page.
  const c = D.get("gyro.curve");
  const pc = D.has("gyro.curve");
  const curveSlider = (part, label, en, note) => {
    const p = gyroPct(c[part]);
    return `<div class="slider" style="margin-top:20px"><div class="slider-head"><span><b>${label}</b> <span class="meta">${en}</span></span><span class="num${pc ? " pending" : ""}">${p}%</span></div>
      <p class="meta" style="margin:2px 0 8px;line-height:20px">${note}</p>
      <input type="range" min="0" max="100" value="${p}" data-curve="${part}" class="${pc ? "pending" : ""}" style="--p:${p}%" aria-label="${label}"></div>`;
  };
  const mids = c.mid_points
    .map((m, i) => `<div style="display:grid;grid-template-columns:28px 1fr 1fr 40px;gap:8px;align-items:center;margin-top:8px">
      <span class="meta">#${i + 1}</span>
      <label class="meta">x <input class="field${pc ? " pending" : ""}" type="number" min="0" max="255" value="${m.x}" data-mid="${i}" data-axis="x" style="width:70px;height:40px" aria-label="จุดกลาง ${i + 1} x"></label>
      <label class="meta">y <input class="field${pc ? " pending" : ""}" type="number" min="0" max="255" value="${m.y}" data-mid="${i}" data-axis="y" style="width:70px;height:40px" aria-label="จุดกลาง ${i + 1} y"></label>
      <button class="link" data-act="gyro-mid-del" data-i="${i}" aria-label="ลบจุดกลาง ${i + 1}">ลบ</button></div>`)
    .join("");
  const g3 = group(3, "Response Curve", "", `หมุนจอยเร็วแค่ไหน (แนวนอน) แล้วสติ๊กไปแค่ไหน (แนวตั้ง)${off ? " · มีผลเมื่อเปิด gyro" : ""}`,
    `<div class="curve-box" data-gyro-chart>${gyroChart(c, pc)}</div>
    <div class="cap">แนวนอน = ความเร็วที่หมุนจอย · แนวตั้ง = ค่าที่ส่งออก${mode === "mouse" ? " (ความเร็วเมาส์)" : " (ระยะสติ๊ก)"}</div>
    ${curveSlider("start_x", "Deadzone", "Curve Dead Zone", "หมุนช้ากว่านี้ไม่นับ กันเป้าไหลตอนวางจอยนิ่ง")}
    ${curveSlider("start_y", "ชดเชย Deadzone", "Dead Zone Compensation", "พอเริ่มนับ สติ๊กกระโดดไปที่ค่านี้ทันที ใช้ข้าม deadzone ของสติ๊กในเกม")}
    ${curveSlider("end_x", "จุดที่ได้ค่าสูงสุด", "Maximum Output Start", "หมุนเร็วถึงค่านี้แล้วได้ค่าสูงสุด · ยิ่งน้อย ยิ่งไว")}
    ${curveSlider("end_y", "ค่าสูงสุด", "Maximum Output", "ค่าที่ส่งออกได้มากที่สุด")}
    ${sub("จุดกลาง", `Midpoints ${c.mid_points.length}/${GYRO_MIDS_MAX}`)}
    ${mids || hint("ไม่มีจุดกลาง · เส้นตรงจากจุดเริ่มถึงจุดสุด")}
    <div style="display:flex;gap:20px;margin-top:12px">${c.mid_points.length < GYRO_MIDS_MAX ? `<button class="link" data-act="gyro-mid-add">+ เพิ่มจุด</button>` : ""}<button class="link" data-act="gyro-curve-reset">รีเซ็ตเป็นเส้นตรง</button></div>
    ${hint("ลากจุดในกราฟได้ · กดบนเส้นเพื่อเพิ่มจุดกลาง · x, y เป็นค่า 0–255 แบบเดียวกับในเว็บ Flydigi")}`,
    { dim: off, tag: untested("gyro.curve") });

  // 4. Mouse mode only.
  const g4 = mode === "mouse" || g.mode === "mouse"
    ? group(4, "โหมดเมาส์", "Mouse", "ใช้เฉพาะตอน gyro ทำหน้าที่เป็นเมาส์",
        `${slider("gyro.mouseRadius", "Deadzone เมาส์", D, { min: 0, max: 100, fmt: (v) => `${v}%`, tag: false })}
        ${hint("Mouse Dead Zone ในเว็บ Flydigi · ปรับช่วงที่เมาส์ตอบสนอง")}`, { tag: untested("gyro.mouseRadius") })
    : "";
  return g1 + g2 + g3 + g4;
}

// The gyro curve chart. Points can be dragged and a click on the line adds a mid point, as on
// the official Advanced page (app.js handles the pointer). Inputs are 0–255 on both axes.
export function gyroChart(c, pending) {
  const S = 300;
  const X = (x) => ((x / 255) * S).toFixed(1), Y = (y) => (S - (y / 255) * S).toFixed(1);
  const ink = pending ? "#2140D9" : "#111111";
  const pts = [["start", c.start_x, c.start_y], ...c.mid_points.map((m, i) => [`mid${i}`, m.x, m.y]), ["end", c.end_x, c.end_y]];
  const line = [[0, 0], ...pts.map(([, x, y]) => [x, y]), [255, c.end_y]].map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  const full = c.mid_points.length >= GYRO_MIDS_MAX;
  return `<svg viewBox="-14 -14 ${S + 28} ${S + 28}" style="touch-action:none;cursor:${full ? "default" : "copy"}" aria-label="กราฟ Response Curve ลากจุดได้">
    <rect x="0" y="0" width="${S}" height="${S}" fill="#fff" stroke="#E2E2E2"/>
    ${[1, 2, 3].map((i) => `<path d="M${(S / 4) * i} 0 V${S} M0 ${(S / 4) * i} H${S}" stroke="#E2E2E2"/>`).join("")}
    <path d="M0 ${S} L${S} 0" stroke="#BDBDBD" stroke-dasharray="4 4"/>
    <polyline points="${line}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    ${full ? "" : `<polyline points="${line}" fill="none" stroke="transparent" stroke-width="18" data-gyro-line/>`}
    ${pts.map(([id, x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="9" fill="#fff" stroke="${ink}" stroke-width="2" data-pt="${id}" style="cursor:grab"><title>${id === "start" ? "จุดเริ่ม" : id === "end" ? "จุดสุด" : `จุดกลาง ${Number(id.slice(3)) + 1}`} (${x}, ${y})</title></circle>`).join("")}
  </svg>`;
}

// What the gyro drives with the mode on the controller now (not a pending edit), read from the
// XInput pad because 0xEF has the physical sticks only.
function gyroOut(g) {
  const act = g.activation[0];
  const when = act ? `${act.activation === "hold" ? "กดค้าง" : "กดสลับ"} ${esc(btnName(act.button))} แล้ว` : "";
  if (g.mode === "disable") return `<p class="muted" style="margin:12px 0 0">gyro ปิดอยู่บนจอย · เลือกหน้าที่ด้านขวา แล้วเขียนลงจอยก่อน จึงจะเห็นผลตรงนี้</p>`;
  if (g.mode === "mouse") return `<p style="margin:12px 0 0"><b>${when}เอียงจอย แล้วดูว่าเคอร์เซอร์บนจอขยับตาม</b></p>`;
  return `<div data-live="gyro-out" style="margin-top:12px">${gyroStick(g, null)}</div>`;
}

// The stick the gyro drives, as Windows sees it (v from the standard-mapping pad), or null when
// Chrome lists no such pad. On the owner's PC Chrome lists none, so joy.cpl is the way to look.
export function gyroStick(g, v) {
  const act = g.activation[0];
  const when = act ? `${act.activation === "hold" ? "กดค้าง" : "กดสลับ"} ${esc(btnName(act.button))} แล้ว` : "";
  const axes = g.mode === "left_joystick" ? "X Axis / Y Axis (เครื่องหมาย +)" : "X Rotation / Y Rotation";
  if (!v) return `<p style="margin:0"><b style="font-size:18px">${when}เอียงจอย แล้วดูใน joy.cpl</b></p>
    <p class="muted" style="margin:4px 0 0">Win+R → joy.cpl → เลือกจอย → Properties · ${esc(GYRO_MODE[g.mode])} คือแกน ${axes}</p>
    <p class="meta" style="margin:4px 0 0">แอปแสดงตำแหน่งสติ๊กที่ gyro ขยับให้ไม่ได้ เพราะ Chrome ในเครื่องนี้มองไม่เห็นจอยแบบเกมแพด และค่าที่อ่านจากจอยโดยตรงมีแค่สติ๊กที่นิ้วโยก</p>`;
  return `<div style="display:flex;gap:28px;align-items:center">
    <div class="live" style="flex:none;padding-top:0">${liveStick(v)}</div>
    <div><b style="font-size:18px">${when}เอียงจอย</b>
      <p class="muted" style="margin:4px 0 0">จุดคือ ${esc(GYRO_MODE[g.mode])} ที่ Windows เห็น รวมส่วนที่ gyro ขยับให้แล้ว</p></div>
  </div>`;
}

// Where the gyro would aim: the turn added up while the gyro is on (app.js AIM), yaw across and
// pitch up and down. a: { x, y } in -1..1 and on, or null before the first frame.
export function liveAim(g, a) {
  const frame = `<rect x="-100" y="-100" width="200" height="200" fill="none" stroke="#111"/><path d="M-100 0H100M0 -100V100" stroke="#E2E2E2"/>`;
  const acts = g?.activation ?? [];
  const how = acts.map((x) => `${x.activation === "hold" ? "กดค้าง" : "กดสลับ"} ${esc(btnName(x.button))}`).join(" หรือ ");
  const dot = a ? `<circle cx="${Math.round(a.x * 100)}" cy="${Math.round(a.y * 100)}" r="7" fill="${a.on ? "#2140D9" : "#BDBDBD"}"/>` : "";
  const title = !a ? "ยังไม่ได้รับค่าจากจอย" : a.on ? "gyro ทำงาน · เอียงจอยเพื่อเล็ง" : `gyro ยังไม่ทำงาน · ${how}`;
  return `<svg width="200" height="200" viewBox="-102 -102 204 204" style="flex:none" aria-hidden="true">${frame}${dot}</svg>
    <div><b style="font-size:18px">${title}</b>
      <p class="muted" style="margin:4px 0 0">จุดคือทิศที่เล็ง · หมุนแบบพวงมาลัย หรือ เอียงซ้าย–ขวา = ซ้าย–ขวา · ก้ม–เงย = บน–ล่าง${acts.length ? ` · จุดขยับเฉพาะตอน${how}` : " · ไม่ได้ตั้งปุ่ม จึงทำงานตลอด"}</p>
      <p class="meta" style="margin:4px 0 0">คำนวณจาก gyro ในแอป ใช้ดูว่าเซนเซอร์กับปุ่มเปิดทำงาน ความไวไม่ตรงกับในเกม</p></div>`;
}

const IMU_NAME = ["หมุนแบบพวงมาลัย", "ก้ม–เงย", "เอียงซ้าย–ขวา", "ความเอียง 1", "ความเอียง 2", "ความเอียง 3"];

// v: { imu: six i16 from 0xEF bytes 17..28, tail: bytes 29/30, move: how much each moves now,
// peak: largest |value| seen } or null before the first frame.
export function liveImu(v) {
  if (!v) return `<p class="muted" style="margin:0">ยังไม่ได้รับค่าจากจอย</p>`;
  const top = v.move.indexOf(Math.max(...v.move));
  const rows = v.imu.map((x, i) => {
    const on = i === top && v.move[i] > 30;
    const w = (Math.abs(x) / v.peak[i]) * 50;
    const color = on ? "#2140D9" : "#111";
    return `<div style="display:grid;grid-template-columns:200px 1fr 90px;gap:16px;align-items:center;height:32px${on ? ";color:#2140D9;font-weight:700" : ""}">
      <span>${IMU_NAME[i]} <span class="meta">ไบต์ ${17 + i * 2}</span></span>
      <div style="position:relative;height:14px;border:1px solid #111"><div style="position:absolute;top:0;bottom:0;left:50%;border-left:1px solid #BDBDBD"></div>
        <div style="position:absolute;top:0;bottom:0;${x < 0 ? `right:50%` : `left:50%`};width:${w}%;background:${color}"></div></div>
      <span class="mono" style="text-align:right">${x}</span></div>`;
  });
  return `${rows.join("")}<p class="meta mono" style="margin:10px 0 0">ไบต์ 29–30: ${v.tail.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ")}</p>`;
}

// ---------------- 07 Lighting & screen ----------------

const SWATCHES = ["#FF5A1F", "#E0303A", "#F2C230", "#38B26B", "#2F7BEA", "#7A4BE0", "#FFFFFF"];

export function lighting(S, D) {
  const mode = D.get("led.mode");
  const color = D.get("led.color");
  const bright = D.get("led.bright") ?? 70;
  const pend = D.pendingKeys("led.").length > 0;
  const showColor = mode && mode !== "off" ? color : null;
  const ledValue = !pend ? "ค่าบนจอยยังอ่านไม่ได้" : mode === "off" ? "ปิดไฟ" : `${LED_MODE[mode] ?? "—"}${color ? ` ${color.toUpperCase()}` : ""} · ${bright}%`;
  const modes = Object.entries(LED_MODE)
    .map(([id, l]) => `<button class="utab${mode === id ? " on pending" : ""}" style="${mode === id ? "color:var(--cobalt)" : ""}" data-act="set" data-key="led.mode" data-val="${id}">${l}</button>`)
    .join("");
  const sw = SWATCHES.map(
    (c) => `<button aria-label="สี ${c}" data-act="set" data-key="led.color" data-val="${c}" style="width:34px;height:34px;border-radius:17px;border:${color === c ? "2px solid #111" : c === "#FFFFFF" ? "1px solid #CFCFCF" : "0"};background:${c};box-shadow:${color === c ? "inset 0 0 0 3px #fff" : "none"};padding:0"></button>`,
  ).join("");
  const timeout = D.get("screen.timeout");
  return `${head("Lighting & screen", "ทั้งเครื่อง · ใช้กับทุก slot")}
  <div class="split wide-right" style="grid-template-columns:minmax(0,740px) minmax(0,1fr)">
    <div>${frontFigure(S, D, {
      screen: `ชื่อ slot และแบต`, screenSub: "รูปแบบจริงยังไม่ยืนยัน",
      led: showColor ? { color: showColor, bright } : null, ledLabel: pend ? "ไฟ RGB · แก้แล้ว" : "ไฟ RGB", ledValue, ledPending: pend,
    })}</div>
    <div>
      <section>
        <div class="rule-head"><h2>ไฟ RGB</h2><span class="meta">แถบไฟใต้ตัวจอย</span></div>
        <div class="utabs" style="margin-top:20px">${modes}</div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:22px;flex-wrap:wrap">${sw}
          <label class="field" style="width:auto;display:inline-flex;align-items:center;gap:8px;height:36px;margin-left:12px;padding:0 10px">
            <span style="width:14px;height:14px;background:${color ?? "#fff"};border:1px solid #CFCFCF"></span>
            <input data-key="led.color" data-hex value="${esc((color ?? "").toUpperCase())}" placeholder="#RRGGBB" maxlength="7" style="border:0;width:84px;font:600 14px var(--mono);padding:0;outline:none" aria-label="รหัสสี"></label>
        </div>
        <div style="margin-top:24px">${slider("led.bright", "ความสว่าง", D, { min: 0, max: 100, fmt: (v) => (v == null ? "ยังอ่านไม่ได้" : `${v}%`) })}</div>
        <p class="meta" style="margin-top:16px">ภาพจอยด้านซ้ายแสดงสีที่ตั้งค้างไว้ ยังไม่รู้ว่าแสดงผลบนจอยทันทีได้ไหม · ${UNSUP}</p>
      </section>
      <section style="margin-top:40px">
        <div class="rule-head"><h2>จอบนตัวจอย</h2><span class="meta">ตัวอย่าง · รูปแบบจริงยังไม่ยืนยัน</span></div>
        <div style="display:grid;grid-template-columns:200px 1fr;gap:24px;margin-top:18px;align-items:center">
          <div style="background:#111;color:#fff;padding:14px;height:64px;display:flex;flex-direction:column;justify-content:space-between">
            <div style="display:flex;justify-content:space-between" class="mono small"><span>SLOT ${S.slots.activeSlot + 1}</span><span>${S.info ? `L${S.info.batteryLevel}` : ""}</span></div>
            <b style="font-size:17px;line-height:20px">${esc(slotName(S, D, S.slots.activeSlot))}</b>
          </div>
          ${slider("screen.bright", "ความสว่างจอ", D, { min: 0, max: 100, fmt: (v) => (v == null ? "ยังอ่านไม่ได้" : `${v}%`) })}
        </div>
        <div style="margin-top:20px"><b style="display:block;margin-bottom:10px">ปิดจออัตโนมัติหลัง</b>
          <div class="seg">${Object.entries(TIMEOUT).map(([v, l]) => `<button class="${String(timeout) === v ? "on" : ""}" data-act="set" data-key="screen.timeout" data-val="${v}" data-numval>${l}</button>`).join("")}</div></div>
      </section>
    </div>
  </div>`;
}

// ---------------- 08 Device & backup ----------------

export function device(S, D) {
  const info = S.info;
  const rows = [
    ["รุ่น (SKU)", esc(S.sku?.name || S.pad?.device.productName || "—"), false],
    ["USB PID", `0x${S.pad?.device.productId.toString(16)}`, true],
    ["การเชื่อมต่อ", info ? `mode ${info.connectionMode}` : "—", true],
    ["แบตเตอรี่", info ? `ระดับ ${info.batteryLevel}${info.chargingStatus ? " · กำลังชาร์จ" : ""}` : "—", false],
    ["Firmware หลัก / ตัวรับ", info ? `${fw(info.fw.main)} / ${fw(info.fw.receiver)}` : "—", true],
    ["Firmware ไก / จอ", info ? `${fw(info.fw.trigger)} / ${fw(info.fw.screen)}` : "—", true],
    ["MAC", info?.macAddr ?? "—", true],
    ["UUID", S.uuid ? `${S.uuid.slice(0, 4).toUpperCase()}…${S.uuid.slice(-4).toUpperCase()}` : "—", true],
    ["เวอร์ชันค่าตั้ง", S.vers ? `global ${S.vers.globalConfigVer} · mapping ${S.vers.mappingVer} · LED ${S.vers.ledVer}` : "—", true],
  ]
    .map(([k, v, mono]) => `<div class="kv"><span class="k">${k}</span><span class="v${mono ? " mono" : ""}">${v}</span></div>`)
    .join("");
  const backups = S.backups
    .map(
      (b) => `<div class="row flush" style="min-height:72px;gap:24px">
      <span class="mono" style="width:150px;font-size:16px">${fmtWhen(b.at)}</span>
      <span class="v" style="font-size:16px">Slot ${b.slot + 1}${b.name ? ` · ${esc(b.name)}` : ""} · ${esc(b.reason)}</span>
      <button class="link muted" data-act="bk-dl" data-id="${b.id}">ดาวน์โหลด</button>
      <button class="link" style="font-weight:700;margin-left:16px" data-act="bk-restore" data-id="${b.id}" ${b.slot === S.slots.activeSlot ? "" : `disabled title="สลับไปใช้ slot ${b.slot + 1} ก่อน"`}>กู้คืน</button>
    </div>`,
    )
    .join("");
  const mode = D.get("input.mode") ?? "xinput";
  return `${head("Device & backup", "ทั้งเครื่อง · ข้อมูลจอย ไฟล์สำรอง และ packet log", `<button class="link" style="margin-top:12px" data-act="disconnect">ตัดการเชื่อมต่อ</button>`)}
  <div class="cols-2" style="grid-template-columns:minmax(0,780px) minmax(0,1fr)">
    <div>
      <section>
        <div class="rule-head"><h2>ข้อมูลจอย</h2><button class="link" data-act="reload">อ่านค่าจากจอยอีกครั้ง</button></div>
        <div style="display:flex;align-items:center;gap:24px;padding:20px 0;border-bottom:1px solid var(--hairline)">
          ${inset("label", { w: 332, h: 120, title: "ป้ายใต้ตัวจอย" })}
          <span class="muted" style="font-size:15px">ป้ายใต้ตัวจอย ใช้เทียบรุ่นและ CMIIT ID กับค่าที่อ่านได้</span>
        </div>
        ${rows}
        <p class="meta" style="margin-top:14px">แอปนี้ไม่อัปเดต firmware ใช้แอปทางการสำหรับเรื่องนั้น · รูปแบบเลข firmware และแบตยังไม่ยืนยัน</p>
      </section>
      <section style="margin-top:40px">
        <div class="rule-head"><h2>จอยส่งสัญญาณเป็น</h2><span class="meta">คำสั่ง 0x11 ไม่มีการตอบรับ จึงยังไม่ส่ง</span></div>
        <div class="seg" style="margin-top:18px">${["XInput", "DInput"].map((m) => `<button class="${mode === m.toLowerCase() ? "on" : ""}" data-act="set" data-key="input.mode" data-val="${m.toLowerCase()}">${m}</button>`).join("")}</div>
        <div class="checks" style="margin-top:16px">${check("input.keyboard", "ส่งคีย์บอร์ด", D)}${check("input.mouse", "ส่งเมาส์", D)}${check("input.third", "ให้แอปอื่นคุม", D)}</div>
        ${D.pendingKeys("input.").length ? `<p style="margin:12px 0 0">${UNSUP}</p>` : ""}
      </section>
    </div>
    <div>
      <section>
        <div class="rule-head" style="align-items:flex-end"><div><h2>ไฟล์สำรอง</h2><span class="meta">สำรองอัตโนมัติทุกครั้งก่อนเขียนลงจอย · เก็บในเบราว์เซอร์นี้และดาวน์โหลดเป็นไฟล์</span></div>
          <span style="display:flex;gap:20px;white-space:nowrap"><button class="link" data-act="import">นำเข้าไฟล์</button><button class="link" data-act="backup-now">สำรอง slot ${S.slots.activeSlot + 1} ตอนนี้</button></span></div>
        ${backups || `<p class="empty-note">ยังไม่มีไฟล์สำรองในเบราว์เซอร์นี้ · จะสร้างให้อัตโนมัติก่อนเขียนครั้งแรก</p>`}
        <p class="meta" style="margin-top:12px">กู้คืนได้เฉพาะ slot ที่ใช้อยู่บนจอย · นำเข้าไฟล์จะเขียนลง slot ${S.slots.activeSlot + 1}</p>
      </section>
      <section style="margin-top:40px">
        <div class="rule-head" style="align-items:flex-end"><div><h2>ชื่อที่เก็บในแอป</h2><span class="meta">ชื่อเต็มของ slot ของจอยตัวนี้ จอยเก็บได้แค่ ${NAME_MAX} ไบต์ต่อชื่อ · ไฟล์ .bin ไม่มีชื่อเหล่านี้ · ชื่อ macro อยู่ในคลังที่หน้า Macros</span></div>
          <span style="display:flex;gap:20px;white-space:nowrap"><button class="link" data-act="names-import">นำเข้าชื่อ</button><button class="link" data-act="names-export">ส่งออกชื่อ</button></span></div>
        <p class="meta" style="margin-top:12px">${Object.keys(S.names.export(S.uuid).names).length} ชื่อเก็บในเบราว์เซอร์นี้ · ส่งออกไว้ถ้าจะใช้แอปบนเครื่องอื่น</p>
      </section>
      <section style="margin-top:40px">
        <div class="rule-head" style="align-items:flex-end"><div><h2>Packet log</h2><span class="meta">คัดลอกไปวางตอนแจ้งปัญหา</span></div>
          <span style="display:flex;gap:20px"><button class="link" data-act="log-clear">ล้าง</button><button class="link" data-act="log-copy">คัดลอก log</button></span></div>
        <pre class="log" id="log" style="margin-top:18px" tabindex="0" aria-label="Packet log">${logHtml(S.log)}</pre>
      </section>
      <section style="margin-top:40px">
        <div class="rule-head"><h2>ข้อมูลดิบ (RAM dump)</h2><span class="meta">อ่านอย่างเดียวด้วย 0xA3</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
          ${[[1, "Global 0x01"], [5, "Mapping 0x05"], [4, "0x04"], [6, "0x06"]].map(([r, l]) => `<button class="btn sm" data-act="dump" data-ram="${r}">${l}</button>`).join("")}
          <button class="btn sm" data-act="dump-dl" ${S.dump ? "" : "disabled"}>ดาวน์โหลด .bin</button>
          <span class="meta" style="align-self:center">${esc(S.dumpStatus ?? "")}</span>
        </div>
        ${S.dump ? `<pre class="hexdump">${esc(S.dump.text)}</pre>` : ""}
      </section>
    </div>
  </div>`;
}

export function logHtml(lines) {
  if (!lines.length) return `<span style="color:#8a8a8a">ยังไม่มี packet</span>`;
  return lines.map((l) => `<span class="${l.dir}">${esc(l.text)}</span>`).join("\n");
}

export const fmtWhen = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---------------- 09 Review & 10 write states ----------------

// Shown when nothing pending can be written. Keep in step with FIELDS in mapping-edit.js.
const WRITABLE_NOW = [
  { label: "Stick", what: "deadzone · ระยะสูงสุด · กลับแกน X/Y · ขอบกลม" },
  { label: "Trigger", what: "จุดเริ่ม · จุดสุด" },
  { label: "Gyro", what: "โหมด · กลับแกน X/Y" },
  { label: "มอเตอร์สั่น", what: "เปิด/ปิด · แรงสูงสุด" },
  { label: "เวลาตัดสินการกด", what: "กดค้าง · ดับเบิลคลิก" },
  { label: "ชื่อ profile", what: "เฉพาะ slot ที่ใช้อยู่" },
  { label: "Macro", what: "จากคลัง ใส่ลงทุก layer ที่ปุ่มเลือกใช้ · ไม่เกิน 8 ตัวต่อ layer" },
  { label: "ปุ่ม", what: "ปุ่มจอย · เมาส์ · Turbo · Macro · สลับ layer · ปิดปุ่ม · ทุก layer" },
  { label: "เพิ่ม / ลบ layer", what: "ไม่เกิน 4 layer ต่อ slot" },
];

export function review(S, D) {
  const items = D.items();
  const slotItems = items.filter((i) => i.group === "slot" && i.writable);
  const unsup = items.filter((i) => !i.writable);
  const plan = S.plan ?? { rows: [], errors: [] };
  // Library macros edited since they were written count on their own; adding and removing copies
  // comes with a button that was changed.
  const moves = plan.moves ?? [];
  const nW = slotItems.length + plan.rows.filter((r) => r.kind === "update" || r.kind === "rename").length + moves.length;
  const errors = plan.errors;
  const row = (i) => `<div class="diff-row${i.writable ? "" : " unsup"}"><b>${esc(i.label)}${untested(i.editKey) ? `<br>${untested(i.editKey)}` : ""}</b><span class="old">${esc(i.baseText ?? (i.base === undefined ? "ไม่ทราบ" : i.fmt(i.base)))}</span><span>→</span>
    <span class="new">${i.key === "led.color" ? `<span class="swatch-dot" style="background:${esc(i.value)}"></span>` : ""}${esc(i.fmt(i.value))}${i.writable && i.key.endsWith(".name") && fit(i.value) !== i.value ? `<br><span class="meta">บนจอยจะเป็น “${esc(fit(i.value))}” · ชื่อเต็มเก็บในแอป</span>` : ""}</span></div>`;
  const slot = S.slots.activeSlot;
  const linked = S.current ? S.profiles.holding(S.current.wrapped) : [];
  const steps = (uid) => {
    const m = S.lib.get(uid);
    return m ? `${macroSteps(m.actions)} ขั้น · ${MACRO_MODE[m.mode] ?? m.mode}` : "";
  };
  const diff = (label, old, nw) => `<div class="diff-row"><b>${esc(label)}<br>${UNTESTED}</b><span class="old">${esc(old)}</span><span>→</span><span class="new">${esc(nw)}</span></div>`;
  const macroRow = (r) => {
    const L = LAYER_NAME(r.layer);
    if (r.kind === "add") return diff(`ใส่ ${r.name} ลง ${L}`, "ไม่มีในจอย", steps(r.uid));
    if (r.kind === "update") return diff(`อัปเดต ${r.name} · ${L}`, "แบบเดิมในจอย", steps(r.uid));
    if (r.kind === "remove") return diff(`เอา ${r.name} ออกจาก ${L}`, "อยู่ในจอย", "ไม่มีปุ่มเล่นแล้ว · ยังอยู่ในคลัง");
    if (r.kind === "rename") return diff(`ชื่อ macro · ${L}`, "ชื่อเดิมในจอย", r.name || "ไม่มีชื่อ");
    return diff("ชื่อ macro บนจอย", `ไม่เกิน ${NAME_MAX} ไบต์`, r.cap ? `ตัดเหลือ ${r.cap} ไบต์ต่อชื่อ ให้พอที่เก็บชื่อ 255 ไบต์` : "ไม่ใส่ชื่อ ที่เก็บชื่อ 255 ไบต์ไม่พอ");
  };
  // Every pending edit is draft-only: say which ones, and what can be written today.
  const stuck = [...new Set(unsup.map((i) => i.label.split(" · ")[0]))].join(", ");
  const sub = errors.length ? esc(errors.join(" · ")) : nW ? "ตรวจก่อนเขียน · อย่าถอดสายระหว่างเขียน" : `${esc(stuck)} ยังเขียนลงจอยไม่ได้ เลยเก็บเป็นร่างไว้ในหน้านี้ · ค่าบนจอยยังเหมือนเดิม`;
  return `<h2 class="d-title" id="sheet-title">${nW ? `เขียน ${nW} การเปลี่ยนแปลงลงจอย` : "ยังไม่มีอะไรที่เขียนลงจอยได้"}</h2>
    <p class="d-sub">${sub}</p>
    ${nW ? `<div class="d-group"><div class="rule-head"><h2>Slot ${slot + 1}${D.get(`slot.${slot}.name`) ? ` · ${esc(D.get(`slot.${slot}.name`))}` : ""}</h2><span class="meta">ค่าบนจอย → ค่าใหม่</span></div>${slotItems.map(row).join("")}${plan.rows.map(macroRow).join("")}${moves.map((m) => diff(`เลข layer · ${LAYER_NAME(m.from)}`, LAYER_NAME(m.from), `${LAYER_NAME(m.to)} · จอยหา layer จากลำดับ เลขต้องต่อกัน`)).join("")}</div>` : ""}
    ${unsup.length ? `<div class="d-group"><div class="rule-head"><h2>ยังเขียนลงจอยไม่ได้</h2><span class="meta">เก็บเป็นร่างในหน้านี้ ไม่ส่งลงจอย</span></div>${unsup.map(row).join("")}</div>` : ""}
    ${nW ? "" : `<div class="d-group"><div class="rule-head thin"><h2>ที่เขียนลงจอยได้ตอนนี้</h2>${UNTESTED}</div>${WRITABLE_NOW.map((g) => `<div class="can-row"><b>${g.label}</b><span>${g.what}</span></div>`).join("")}</div>`}
    ${nW ? `<p class="notice" style="margin-top:24px;font-size:15px;color:var(--ink)">${ICON.file}<span><b>สำรองค่าบนจอยเป็นไฟล์อัตโนมัติก่อนเขียนทุกครั้ง</b> <span class="muted">· กู้คืนได้ที่ Device &amp; backup</span></span></p>` : ""}
    ${nW && linked.length ? `<p class="notice" style="margin-top:12px;font-size:15px;color:var(--ink)">${ICON.file}<span><b>อัปเดต profile ${linked.map((p) => `“${esc(p.name)}”`).join(", ")} ในคลังด้วย</b> <span class="muted">· slot นี้มาจาก profile นั้น ค่าที่แก้จึงติดไปกับ profile</span></span></p>` : ""}
    <div class="d-actions"><button class="link" style="font-size:17px" data-act="close-sheet">กลับไปแก้</button>
      <button class="btn primary" data-act="write" ${nW && !errors.length ? "" : "disabled"}>เขียนลงจอย</button></div>`;
}

export function writing(W) {
  const steps = W.steps
    .map((s, i) => {
      const st = i < W.at ? "done" : i === W.at ? "now" : "";
      const icon = st === "done" ? ICON.checkSm : st === "now" ? `<span class="spin"></span>` : `<span class="ringo"></span>`;
      return `<div class="step ${st}">${icon}<span>${esc(s)}</span>${i === W.at && W.bytes ? `<span class="num">${W.bytes[0]} / ${W.bytes[1]} B</span>` : ""}</div>`;
    })
    .join("");
  const p = W.bytes ? (W.at + W.bytes[0] / W.bytes[1]) / W.steps.length : W.at / W.steps.length;
  return `<div class="state"><h2 id="sheet-title">${esc(W.title)}…</h2><p class="meta" style="font-size:14px;margin:6px 0 0">อย่าถอดสาย · ปิดหน้านี้ไม่ได้จนกว่าจะเสร็จ</p>
    <div class="steps">${steps}</div><div class="progress"><i style="transform:scaleX(${p.toFixed(3)})"></i></div></div>`;
}

export function done(W) {
  return `<div class="state"><h2 id="sheet-title">${ICON.check}${esc(W.doneTitle)}</h2>
    <p class="meta" style="font-size:14px;margin:6px 0 0 44px">อ่านกลับมาเทียบทุกไบต์แล้วตรงกัน</p>
    <div style="margin-top:20px">
      <div class="kv"><span class="k">Slot ${W.slot + 1}${W.name ? ` · ${esc(W.name)}` : ""}</span><span class="v mono">crc16 ${W.crc}</span></div>
      ${W.profiles?.length ? `<div class="kv"><span class="k">อัปเดต profile ในคลัง</span><span class="v">${W.profiles.map((n) => `“${esc(n)}”`).join(", ")}</span></div>` : ""}
      ${W.backupAt ? `<div class="kv"><span class="k">ไฟล์สำรอง</span><span class="v">${fmtWhen(W.backupAt)} · กู้คืนได้</span></div>` : ""}
      ${W.commitStatus ? `<div class="kv"><span class="k">จอยตอบตอนยืนยัน</span><span class="v mono">status ${W.commitStatus}</span></div><p class="notice" style="margin:12px 0 0;color:var(--ink)">${ICON.warn}<span>จอยเก็บข้อมูลครบแล้ว แต่ไม่ได้ตอบว่าสำเร็จ (status ไม่ใช่ 0) อาจยังไม่ได้นำไปใช้ ลองกดปุ่มจริงเพื่อเช็ก</span></p>` : ""}
      ${W.left ? `<div class="kv"><span class="k">ยังเป็นร่างในหน้านี้</span><span class="v">${W.left} จุด · ยังเขียนลงจอยไม่ได้</span></div>` : ""}
    </div>
    <div class="d-actions"><button class="btn ink" data-act="close-sheet">เสร็จ</button></div></div>`;
}

export function failed(W) {
  return `<div class="state fail"><h2 id="sheet-title">${ICON.bang}${esc(W.failTitle)}</h2>
    <p class="meta" style="font-size:14px;margin:6px 0 0 44px">${esc(W.error)}</p>
    <p style="font-size:16px;line-height:24px;margin:20px 0 0">${W.unknown ? "ยังไม่รู้ว่าค่าบนจอยตอนนี้เป็นอะไร อาจได้รับข้อมูลไปบางส่วน การแก้ของคุณยังอยู่ในหน้านี้ เสียบสายใหม่ แล้วอ่านค่าจากจอยก่อนเขียนอีกครั้ง" : "ยังไม่ได้เขียนอะไรลงจอย การแก้ของคุณยังอยู่ในหน้านี้"}</p>
    <div class="d-actions" style="justify-content:space-between">
      <span style="display:flex;gap:20px"><button class="link" data-act="see-log">ดู packet log</button>
      ${W.restore ? `<button class="link" data-act="restore-last">กู้คืนจากสำรอง ${fmtWhen(W.restore)}</button>` : ""}</span>
      <span style="display:flex;gap:20px;align-items:center"><button class="link" data-act="close-sheet">ปิด</button><button class="btn primary" data-act="reload-close">อ่านค่าจากจอย</button></span>
    </div></div>`;
}
