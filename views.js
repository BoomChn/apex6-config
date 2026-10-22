// Screen renderers for the v2 "Manual" design. Each returns an HTML string; app.js wires events
// through data-* attributes (data-act, data-key, data-pick, data-live).

import { BACK, FRONT, stageSvg, inset, TRIG_MARK, PHOTO, LED_PATH } from "./stage.js";
import {
  esc, pct, same, btnName, PRESS, GYRO_MODE, LED_MODE, LAYER_NAME, PRESET, TPRESET, GPRESET, AXIS, MACRO_MODE, TIMEOUT,
  labelTarget, macroName, baseTarget, isIdentity, evalCurve,
} from "./model.js";
import { BUTTONS } from "./mapping.js";
import { WRITABLE } from "./mapping-edit.js";

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

export function slotName(S, D, i) {
  const v = D.get(`slot.${i}.name`);
  if (v) return v;
  return `Slot ${i + 1}`;
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
      const nameHtml = renaming
        ? `<div style="display:flex;align-items:center;gap:16px"><input class="field pending" style="max-width:340px;font-size:20px;height:48px" data-key="${key}" data-rename="${i}" value="${esc(name ?? "")}" placeholder="Slot ${i + 1}" aria-label="ชื่อ slot ${i + 1}"><span class="meta">Enter บันทึก · Esc ยกเลิก</span></div>`
        : `<div class="slot-name"><span class="${pend ? "pending" : name ? "" : "faint"}">${esc(name || `Slot ${i + 1}`)}</span>
             <button class="icon-btn" data-act="rename" data-slot="${i}" aria-label="เปลี่ยนชื่อ slot ${i + 1}">${ICON.pencil}</button></div>`;
      const sum = on && cfg ? slotSummary(cfg) : `<span class="mono" style="font-weight:500">crc16 ${crc?.toString(16).padStart(4, "0").toUpperCase() ?? "—"}</span> · สลับไปใช้เพื่ออ่านค่าใน slot นี้`;
      const acts = on
        ? `<span class="ok" style="font-weight:700">ใช้อยู่บนจอย</span><button class="btn ink" data-act="tab" data-tab="buttons">แก้</button>`
        : `<button class="btn" data-act="slot" data-slot="${i}">ใช้ slot นี้</button>`;
      return `<div class="slot-row">
        <div>${on ? `<div class="slot-num on">${i + 1}</div>` : `<div class="slot-num">${i + 1}</div>`}</div>
        <div>${nameHtml}<div class="slot-sum">${sum}</div></div>
        <div class="slot-acts">${acts}</div>
      </div>`;
    })
    .join("");
  const renamePending = D.pendingKeys("slot.").length;
  const opts = (sel) => [0, 1, 2, 3].map((i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${i + 1} · ${esc(slotName(S, D, i))}</option>`).join("");
  return `${head("Profiles", "4 slot บนตัวจอย แก้ที่ slot ตรงๆ ไม่มีคลัง config แยก จึงไม่เกิดของซ้ำ")}
  <div class="split wide-right" style="grid-template-columns:minmax(0,640px) minmax(0,1fr)">
    <div>${frontFigure(S, D, { screen: `แสดงชื่อ slot ที่ใช้อยู่: ${slotName(S, D, active)}`, screenSub: "เขียนชื่อลงจอได้ไหม ยังไม่ยืนยัน" })}</div>
    <div>
      <div class="rule-head" style="display:grid;grid-template-columns:112px 1fr auto"><span class="label">Slot</span><span class="label">ชื่อและสิ่งที่ตั้งไว้</span><span class="label">จัดการ</span></div>
      ${rows}
      ${renamePending ? `<p class="meta" style="margin-top:12px">${UNSUP} · ชื่อ profile ผ่าน TLV 0x20 ยังไม่ได้ยืนยัน</p>` : ""}
      <section style="margin-top:56px">
        <div class="rule-head top"><h2>คัดลอก slot</h2><span class="meta">เลือกต้นทางและปลายทางชัดเจน ไม่สร้าง config ลอยๆ</span></div>
        <div style="display:grid;grid-template-columns:1fr 40px 1fr;gap:12px;align-items:end;margin-top:18px">
          <label><span class="label" style="display:block;margin-bottom:8px">จาก</span><select class="field" disabled>${opts(active === 0 ? 1 : 0)}</select></label>
          <span style="text-align:center;padding-bottom:10px">→</span>
          <label><span class="label" style="display:block;margin-bottom:8px">ไปที่</span><select class="field" disabled>${opts(active ?? 0)}</select></label>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;gap:20px">
          <span class="notice">${ICON.warn}<span>ยังคัดลอกไม่ได้: ต้องสลับไปอ่าน slot ต้นทางก่อน และคำสั่งสลับ slot ยังไม่ได้ทดสอบกับจอยจริง</span></span>
          <button class="btn ink" disabled>คัดลอก</button>
        </div>
      </section>
    </div>
  </div>`;
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

export const BACK_SRC = { RB: "RB", RT: "RT (active)", M1: "M1", M3: "M3", LB: "LB", LT: "LT (active)", M2: "M2", M4: "M4", RM: null, LM: null };
export const FRONT_SRC = { Back: "Back", Start: "Start", LS: "LS", RS: "RS", Y: "Y", X: "X", B: "B", A: "A", DPAD: "D-pad ↑" };
const BTN_TITLE = {
  M1: "ปุ่มหลัง มือขวา · บน", M3: "ปุ่มหลัง มือขวา · ล่าง", M2: "ปุ่มหลัง มือซ้าย · บน", M4: "ปุ่มหลัง มือซ้าย · ล่าง",
  LB: "ไหล่ซ้าย", RB: "ไหล่ขวา", "LT (active)": "ไกซ้าย · ส่งเป็นปุ่ม", "RT (active)": "ไกขวา · ส่งเป็นปุ่ม",
  LM: "ปุ่มข้างไกซ้าย (LM)", RM: "ปุ่มข้างไกขวา (RM)",
  A: "ปุ่ม A", B: "ปุ่ม B", X: "ปุ่ม X", Y: "ปุ่ม Y", Back: "ปุ่ม View", Start: "ปุ่ม Menu", LS: "กด stick ซ้าย", RS: "กด stick ขวา",
  "D-pad ↑": "D-pad ขึ้น", "D-pad ↓": "D-pad ลง", "D-pad ←": "D-pad ซ้าย", "D-pad →": "D-pad ขวา",
};
const BACK_IDS = new Set(["M1", "M2", "M3", "M4", "LB", "RB", "LT (active)", "RT (active)"]);

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
  const side = ui.side;
  const def = side === "back" ? BACK : FRONT;
  const srcMap = side === "back" ? BACK_SRC : FRONT_SRC;
  const items = {};
  for (const [id, src0] of Object.entries(srcMap)) {
    const src = id === "DPAD" ? ui.dpad : src0;
    const name = id === "DPAD" ? "D-pad" : btnName(id === "Back" ? "Back" : id === "Start" ? "Start" : id);
    if (!src) {
      items[id] = { name: id, value: "ยังไม่รู้ ID", state: "nomap", sel: ui.sel === id };
      continue;
    }
    const st = buttonState(S, D, layer, src);
    const pendName = st.pend ? `${name} · แก้แล้ว` : name;
    items[id] = { name: def.inline ? name : pendName, value: st.value, state: st.pend ? "pend" : st.changed ? "set" : "", sel: ui.sel === src || (id === "DPAD" && ui.sel?.startsWith("D-pad")) };
  }
  const layers = cfg.layers.map((l) => `<button class="utab${l.layer_id === layer ? " on" : ""}" style="font-size:13px;padding-bottom:4px" data-act="layer" data-layer="${l.layer_id}">${LAYER_NAME(l.layer_id)}</button>`).join("");
  const right = `<div style="display:grid;justify-items:end;gap:10px;padding-top:6px">
      <div class="seg"><button class="${side === "front" ? "on" : ""}" data-act="side" data-side="front">ด้านหน้า</button><button class="${side === "back" ? "on" : ""}" data-act="side" data-side="back">ด้านหลัง</button></div>
      <div style="display:flex;gap:16px;align-items:center">${layers}<span class="meta faint" style="white-space:nowrap" title="เพิ่ม layer ยังเขียนลงจอยไม่ได้">+ เพิ่ม layer</span></div>
    </div>`;
  const sub = side === "back" ? "คลิกปุ่มบนตัวจอย หรือชื่อปลายเส้นชี้ · มองจากด้านหลัง ซ้ายของภาพคือมือขวา" : "คลิกปุ่มบนตัวจอย หรือชื่อปลายเส้นชี้ · มองจากด้านหน้า";
  return `<div class="split">
    <div>
      <div class="page-head" style="margin-bottom:8px"><div><h1>Buttons</h1><p class="sub">${sub}</p></div>${right}</div>
      ${stageSvg(def, items, { kind: side })}
      ${changedList(S, D)}
    </div>
    <div>${buttonEditor(S, D)}${timing(S, D)}</div>
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
      const where = BACK_IDS.has(src) !== (S.ui.side === "back") ? (BACK_IDS.has(src) ? "ดูที่ด้านหลัง" : "ดูที่ด้านหน้า") : "";
      const lay = layer ? ` · ${LAYER_NAME(layer)}` : "";
      return `<button class="list-row" style="border:0;background:none;padding:0;text-align:left;width:260px;gap:12px" data-act="pick-src" data-src="${esc(src)}" data-layer="${layer}">
        <span class="keytag${st.pend ? " pending" : ""}${st.pend && S.ui.sel === src ? " fill" : ""}">${esc(btnName(src))}</span>
        <span><span style="display:block;font-weight:700" class="${st.pend ? "pending" : ""}">${esc(st.value)}</span>${where || lay ? `<span class="small muted">${where}${lay}</span>` : ""}</span>
      </button>`;
    })
    .join("");
  return `<section style="margin-top:8px">
    <div class="rule-head top"><h2>ปุ่มที่แก้ใน slot นี้</h2><span class="meta">สีน้ำเงิน = ยังไม่ได้เขียนลงจอย · สีดำ = อยู่บนจอยแล้ว</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:16px 0;padding-top:16px">${list || `<p class="empty-note">ทุกปุ่มเป็นค่าเดิม</p>`}</div>
  </section>`;
}

const OUT_KEYS = ["A", "B", "X", "Y", "LB", "RB", "LT (active)", "RT (active)", "LS", "RS", "Back", "Start", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →"];
const MOUSE = ["คลิกซ้าย", "คลิกขวา", "คลิกกลาง", "ปุ่มเมาส์ 4", "ปุ่มเมาส์ 5"];
const OUT_TYPES = [
  { id: "gamepad", label: "ปุ่มจอย" },
  { id: "keyboard", label: "คีย์บอร์ด" },
  { id: "mouse", label: "เมาส์" },
  { id: "turbo", label: "Turbo" },
  { id: "macro", label: "Macro" },
  { id: "none", label: "ปิดปุ่ม" },
];
const typeOf = (t) =>
  !t ? "gamepad" : t.type === "btn_gamepad" ? "gamepad" : t.type === "btn_keyboard" ? "keyboard" : t.type === "btn_mouse" ? "mouse" : t.type === "turbo_gamepad" ? "turbo" : t.type === "macro" ? "macro" : t.type === "none" ? "none" : "other";

function buttonEditor(S, D) {
  const cfg = S.current.cfg;
  const ui = S.ui;
  const layer = ui.layer;
  const src = ui.sel;
  if (src === "LM" || src === "RM") {
    return `<div class="head-inset" style="border-bottom-width:3px"><span class="keytag" style="height:52px;min-width:52px;font-size:20px;border-radius:8px">${src}</span>
      <div class="t"><h2>${BTN_TITLE[src]}</h2><div class="status">มีบนตัวจอย แต่ยังไม่รู้ ID ใน protocol</div></div></div>
      <p class="meta" style="margin-top:20px;line-height:22px">ปุ่ม ${src} ยังไม่อยู่ในรายการปุ่มของ mapping ที่ถอดได้ (mapping.js) จึงยังแสดงหรือแก้ค่าไม่ได้ ถ้าลองกด ${src} บนจอยแล้วดู packet log ในหน้า Device &amp; backup จะช่วยหา ID ได้</p>`;
  }
  const press = ui.press;
  const pend = PRESS.some((p) => D.has(mapKey(layer, src, p.id)));
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
    const macros = cfg.layers.flatMap((l) => l.macros.map((m) => ({ layer: l.layer_id, id: m.macro_id })));
    body = macros.length
      ? `<div style="margin-top:8px">${macros.map(
          (m) => `<button class="row" data-act="out" data-type="macro" data-macro="${m.id}"><span class="v" style="font-weight:700${cur?.type === "macro" && cur.macro === m.id ? ";color:var(--cobalt)" : ""}">${esc(macroName(cfg, m.layer, m.id))}</span>${ICON.chev}</button>`,
        ).join("")}</div>`
      : `<p class="empty-note">slot นี้ยังไม่มี macro · สร้างได้ที่หน้า Macros</p>`;
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
      ${pend ? `<button class="link" data-act="revert-btn">คืนค่าเดิม</button>` : ""}
    </div>
    ${src.startsWith("D-pad") ? `<div class="seg" style="margin-top:16px">${["D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →"].map((d) => `<button class="${src === d ? "on" : ""}" data-act="dpad" data-dir="${esc(d)}">${btnName(d)}</button>`).join("")}</div>` : ""}
    <div style="padding-top:20px"><div class="label" style="padding-bottom:8px">เมื่อกด ${esc(btnName(src))} แบบ…</div>${rows}</div>
    <div style="padding-top:28px;display:grid;gap:14px">
      <div class="label">${pl} ส่งเป็น</div>
      <div class="utabs" style="gap:20px">${types}</div>
      ${body}
      ${pend ? `<p style="margin:0">${UNSUP}</p>` : ""}
    </div>`;
}

function timing(S, D) {
  const ruled = (key, label) => {
    const v = D.get(key);
    return `<div class="ruled" style="flex:1"><label for="f-${key}">${label}</label><input id="f-${key}" class="${D.has(key) ? "pending" : ""}" type="number" inputmode="numeric" min="50" max="${key.endsWith("long") ? 2000 : 1000}" step="10" value="${v}" data-key="${key}" data-num><span class="unit">ms</span></div>`;
  };
  return `<section style="margin-top:40px">
    <div class="rule-head top"><h2>เวลาตัดสินการกด</h2><span class="meta">ใช้กับทุกปุ่มใน slot ${S.slots.activeSlot + 1}</span></div>
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

export function slider(key, label, D, { min = 0, max = 255, disabled = false, fmt = null } = {}) {
  const v = D.get(key);
  const p = D.has(key);
  const shown = fmt ? fmt(v) : `${pct(v)}  ·  ${v}`;
  return `<div class="slider"><div class="slider-head"><b>${label}</b><span class="num${pendCls(p)}" data-out="${key}">${shown}</span></div>
    <input type="range" min="${min}" max="${max}" value="${v ?? min}" data-key="${key}" class="${p ? "pending" : ""}" style="--p:${(((v ?? min) - min) / (max - min || 1)) * 100}%" aria-label="${label}" ${disabled ? "disabled" : ""}></div>`;
}

function check(key, label, D, { disabled = false } = {}) {
  const v = !!D.get(key);
  return `<label class="check"><input type="checkbox" data-key="${key}" ${v ? "checked" : ""} class="${D.has(key) ? "pending" : ""}" ${disabled ? "disabled" : ""}>${label}</label>`;
}

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
        <div class="checks">${check(`stick.${side}.invertX`, "กลับแกน X", D)}${check(`stick.${side}.invertY`, "กลับแกน Y", D)}${check(`stick.${side}.round`, "ขอบวงกลม", D)}</div>
      </div>
    </div>`;
  };
  return `${head("Sticks", "ขยับ stick บนจอยเพื่อดูค่าจริงบนกราฟ")}<div class="cols-2">${col("left")}${col("right")}</div>`;
}

export function liveStick(v) {
  const R = 100;
  if (!v) {
    return `<svg width="200" height="200" viewBox="-102 -102 204 204" aria-hidden="true"><circle r="100" fill="none" stroke="#111"/><path d="M-100 0H100M0 -100V100" stroke="#E2E2E2"/><circle r="6" fill="none" stroke="#2140D9" stroke-width="1.5"/></svg>
      <div class="readout muted" style="font-size:16px">${v === null ? "ขยับ stick บนจอยเพื่อดูค่า" : "ไม่ได้ขยับ"}</div>`;
  }
  const { x, y, out } = v;
  const mag = Math.hypot(x, y);
  const k = mag ? out / mag : 0;
  return `<svg width="200" height="200" viewBox="-102 -102 204 204" aria-hidden="true"><circle r="100" fill="none" stroke="#111"/><path d="M-100 0H100M0 -100V100" stroke="#E2E2E2"/>
      <circle r="6" fill="none" stroke="#2140D9" stroke-width="1.5"/>
      <circle cx="${x * R}" cy="${y * R}" r="8" fill="#111"/><circle cx="${x * k * R}" cy="${y * k * R}" r="6.5" fill="#2140D9"/></svg>
    <div class="readout">${mag < 0.02 ? "ไม่ได้ขยับ" : `ดิบ ${Math.round(Math.min(1, mag) * 100)}% → ออก ${Math.round(out * 100)}%`}</div>
    <div class="legend"><span><i></i>ค่าดิบ</span><span><i class="c"></i>หลัง curve</span></div>`;
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

export function liveTrigger(v) {
  const bar = (h, color) => `<div style="width:40px;height:200px;border:1px solid #111;position:relative"><div style="position:absolute;left:0;right:0;bottom:0;height:${h * 100}%;background:${color}"></div></div>`;
  if (!v || v.raw < 0.01) {
    return `<div style="display:flex;gap:24px">${bar(0)}${bar(0)}</div><div class="readout muted" style="font-size:16px">${v ? "ไม่ได้กด" : "กดไกบนจอยเพื่อดูค่า"}</div>`;
  }
  return `<div style="display:flex;gap:24px">${bar(v.raw, "#111")}${bar(v.out, "#2140D9")}</div>
    <div class="readout">ดิบ ${Math.round(v.raw * 100)}% → ออก ${Math.round(v.out * 100)}%</div>
    <div class="legend"><span><i></i>ค่าดิบ</span><span><i class="c"></i>หลัง curve</span></div>`;
}

// ---------------- 04 Macros ----------------

export function macros(S, D) {
  const cfg = S.current.cfg;
  const all = cfg.layers.flatMap((l) => l.macros.map((m) => ({ layer: l.layer_id, m })));
  const sel = all.find((x) => x.layer === S.ui.macro?.layer && x.m.macro_id === S.ui.macro?.id) ?? all[0];
  const boundTo = (layer, id) => {
    for (const l of cfg.layers)
      for (const mp of l.mappings) if (mp.activators.some((a) => a.target.type === "macro" && a.target.macro === id)) return mp.source;
    for (const k of D.pendingKeys("map.")) {
      const v = D.get(k);
      if (v?.type === "macro" && v.macro === id) return k.split(".").slice(2, -1).join(".");
    }
    return null;
  };
  const list = all
    .map(({ layer, m }) => {
      const on = sel && sel.layer === layer && sel.m.macro_id === m.macro_id;
      const nk = `macro.${layer}.${m.macro_id}.name`;
      const name = D.get(nk);
      const dur = m.actions.at(-1)?.at_ms ?? 0;
      const steps = m.actions.filter((a) => a.action === "press").length;
      const b = boundTo(layer, m.macro_id);
      return `<button class="list-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left;justify-content:space-between" data-act="macro" data-layer="${layer}" data-id="${m.macro_id}">
        <span><span style="display:block;font-size:17px;font-weight:${on ? 700 : 600}" class="${D.has(nk) ? "pending" : ""}">${esc(name)}</span>
        <span class="muted" style="font-size:14px">${steps} ขั้น · ${dur} ms · ${esc(MACRO_MODE[D.get(`macro.${layer}.${m.macro_id}.mode`)] ?? "")}${on ? " · กำลังเปิดดู" : ""}</span></span>
        ${b ? `<span class="keytag ink">${esc(btnName(b))}</span>` : `<span class="meta">ยังไม่ผูกปุ่ม</span>`}
      </button>`;
    })
    .join("");
  const left = `<div>
    <div class="rule-head"><h2>Macro ใน slot ${S.slots.activeSlot + 1}</h2><span class="meta">${all.length} รายการ</span></div>
    ${list || `<p class="empty-note">slot นี้ยังไม่มี macro</p>`}
    <p style="margin:20px 0 0"><span class="meta faint" title="ยังเขียนลงจอยไม่ได้">+ Macro ใหม่ · ยังสร้างลงจอยไม่ได้</span></p>
    <p class="meta" style="margin-top:28px">ยังไม่รู้ว่าจอยรับ macro ได้กี่ชิ้นและยาวสุดเท่าไร จะแสดงเพดานเมื่อยืนยันจาก protocol</p>
    ${sel && boundTo(sel.layer, sel.m.macro_id) ? boundFigure(boundTo(sel.layer, sel.m.macro_id), D.get(`macro.${sel.layer}.${sel.m.macro_id}.name`)) : ""}
  </div>`;
  if (!sel) return `${head("Macros", "ตั้งชื่อได้ · ดูขั้นตอนบน timeline")}<div style="max-width:440px">${left}</div>`;
  const { layer, m } = sel;
  const nk = `macro.${layer}.${m.macro_id}.name`;
  const mk = `macro.${layer}.${m.macro_id}.mode`;
  const name = D.get(nk);
  const bytes = new TextEncoder().encode(name).length;
  const bars = macroBars(m);
  const total = Math.max(100, m.actions.at(-1)?.at_ms ?? 0);
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
  const b = boundTo(layer, m.macro_id);
  const right = `<div>
    <div style="display:grid;grid-template-columns:1fr 300px;gap:28px">
      <label><span class="label" style="display:block;margin-bottom:8px">ชื่อ macro</span>
        <span style="position:relative;display:block"><input class="field${D.has(nk) ? " pending" : ""}" style="height:52px;font-size:20px;padding-right:90px" value="${esc(name)}" data-key="${nk}" maxlength="40">
        <span class="mono muted" style="position:absolute;right:16px;top:16px;font-weight:500;font-size:14px" data-bytes>${bytes} ไบต์</span></span></label>
      <label><span class="label" style="display:block;margin-bottom:8px">ผูกกับปุ่ม</span>
        <div class="field" style="height:52px;display:flex;align-items:center;gap:12px;color:${b ? "inherit" : "var(--ink-2)"}">${b ? `<span class="keytag">${esc(btnName(b))}</span>${esc(BTN_TITLE[b] ?? "")}` : "ยังไม่ผูก · ผูกได้ที่หน้า Buttons → Macro"}</div></label>
    </div>
    <div style="margin-top:24px"><span class="label" style="display:block;margin-bottom:8px">เล่นแบบ</span>${presetTabs(mk, MACRO_MODE, D)}</div>
    ${D.has(nk) && !D.has(mk) ? `<p style="margin:10px 0 0">${UNSUP}</p>` : ""}
    <div style="border-top:3px solid var(--ink);margin-top:28px;padding-top:16px;display:flex;align-items:center;gap:16px">
      <button class="btn" disabled title="ยังไม่รองรับ"><span style="width:12px;height:12px;border-radius:6px;background:var(--error);display:inline-block"></span>อัดจากจอย</button>
      <button class="btn" disabled title="ยังไม่รองรับ">+ เพิ่มขั้น</button>
      <span style="flex:1"></span><span class="muted">รวม ${m.actions.at(-1)?.at_ms ?? 0} ms</span>
      <button class="btn ink" disabled title="คำสั่งเล่น macro บนจอยยังไม่ยืนยัน">${ICON.play} ลองเล่นบนจอย</button>
    </div>
    <div class="timeline">
      <div class="tl-scale"><div></div><div>${ticks.map((t) => `<span style="left:${(t / scaleMax) * 100}%">${t}${t === scaleMax ? " ms" : ""}</span>`).join("")}</div></div>
      ${rows || `<p class="empty-note">macro นี้ไม่มีขั้น</p>`}
    </div>
    ${st ? `<div style="display:grid;grid-template-columns:300px 200px 200px;gap:24px;align-items:end;margin-top:28px">
      <label><span class="label" style="display:block;margin-bottom:8px">ขั้นที่เลือก</span><div class="field" style="display:flex;align-items:center">${esc(st.label)}</div></label>
      <div><span class="label" style="display:block;margin-bottom:8px">กดที่</span><div class="ruled"><label></label><span class="num" style="font-size:18px">${st.from}</span><span class="unit">ms</span></div></div>
      <div><span class="label" style="display:block;margin-bottom:8px">ปล่อยที่</span><div class="ruled"><label></label><span class="num" style="font-size:18px">${st.to}</span><span class="unit">ms</span></div></div>
    </div><p class="meta" style="margin-top:12px">แก้เวลาแต่ละขั้น อัดใหม่ และเพิ่มขั้น ยังเขียนลงจอยไม่ได้</p>` : ""}
  </div>`;
  return `${head("Macros", "ตั้งชื่อได้ · ดูขั้นตอนบน timeline")}<div style="display:grid;grid-template-columns:440px minmax(0,1fr);gap:56px">${left}${right}</div>`;
}

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

export function vibration(S, D) {
  const cfg = S.current.cfg;
  const rows = [
    { k: "motor.left", part: cfg.vibration_motor_left, name: "มอเตอร์ซ้าย", sub: "X-Haptics ด้ามซ้าย · สั่นหนัก ความถี่ต่ำ", inset: "motorL" },
    { k: "motor.right", part: cfg.vibration_motor_right, name: "มอเตอร์ขวา", sub: "X-Haptics ด้ามขวา · สั่นเบา ความถี่สูง", inset: "motorR" },
    { k: "vibtrig.left", part: cfg.vibration_trigger_left, name: "ไกซ้าย (LT)", sub: "มอเตอร์ในไก", inset: "trigL" },
    { k: "vibtrig.right", part: cfg.vibration_trigger_right, name: "ไกขวา (RT)", sub: "มอเตอร์ในไก", inset: "trigR" },
  ]
    .map((r) => {
      if (!r.part) return "";
      const en = D.get(`${r.k}.enabled`);
      const mx = D.get(`${r.k}.max`);
      const curve = { ...r.part.curve, end_y: mx };
      const pend = D.has(`${r.k}.enabled`) || D.has(`${r.k}.max`);
      const mini = miniCurve(curve, en, pend);
      const writable = WRITABLE.has(`${r.k}.max`);
      return `<div class="vib-row${en ? "" : " off"}">
        ${inset(r.inset, { w: 136, h: 88, mark: r.inset.startsWith("trig") ? [TRIG_MARK[r.inset][0] - 20, TRIG_MARK[r.inset][1]] : null, title: r.name })}
        <div><h3 class="${pend ? "pending" : ""}">${r.name}</h3><div class="muted" style="font-size:15px">${r.sub}${en ? "" : " · ปิดอยู่"}</div>${!writable && pend ? `<div style="margin-top:4px">${UNSUP}</div>` : ""}</div>
        <div>${check(`${r.k}.enabled`, `<span class="sr">เปิด ${r.name}</span>`, D)}</div>
        <div>${mini}</div>
        <div style="display:flex;align-items:center;gap:16px">
          <input type="range" min="${writable ? 0 : 0}" max="255" value="${mx}" data-key="${r.k}.max" class="${D.has(`${r.k}.max`) ? "pending" : ""}" style="--p:${(mx / 255) * 100}%" aria-label="ความแรงสูงสุด ${r.name}" ${en ? "" : "disabled"}>
          <span class="num${pendCls(D.has(`${r.k}.max`))}" style="width:52px;font-size:15px" data-out="${r.k}.max">${en ? pct(mx) : "–"}</span>
        </div>
        <div class="vib-test"><button class="btn" disabled>ทดสอบ 2 วิ</button><span class="small muted">${en ? "คำสั่งทดสอบยังไม่ยืนยัน" : "เปิดช่องนี้ก่อนทดสอบ"}</span></div>
      </div>`;
    })
    .join("");
  return `${head("Vibration", "ความแรงที่เกมสั่ง → ความแรงที่จอยสั่นจริง · ปุ่มทดสอบจะรอจอยตอบรับทุกครั้ง")}
    <div class="vib-head"><span style="font-size:20px;color:var(--ink)">4 ช่องสั่น</span><span></span><span>เปิด</span><span>Curve</span><span>ความแรงสูงสุด</span><span style="text-align:right">ทดสอบ</span></div>
    ${rows}
    <section style="margin-top:48px;display:grid;grid-template-columns:minmax(0,560px) minmax(0,1fr);gap:80px;border-top:3px solid var(--ink);padding-top:24px">
      <div><h2 class="title" style="font-size:20px">ทำไมยังทดสอบไม่ได้?</h2><p class="muted" style="margin:8px 0 0;line-height:22px">ปุ่มทดสอบต้องรอให้จอยตอบรับ ถ้าไม่ตอบจะขึ้นสีแดงพร้อมเหตุผล ไม่เงียบหายไปเฉยๆ แต่คำสั่งทดสอบ (0x53) ยังถอดไม่ครบ จึงปิดไว้ก่อน</p></div>
      <ol style="margin:0;padding:0;list-style:none;display:grid;gap:14px">
        <li style="display:grid;grid-template-columns:48px 1fr"><span class="num">1</span>เปิด/ปิด และความแรงสูงสุดของมอเตอร์ซ้าย/ขวา เขียนลงจอยได้แล้ว</li>
        <li style="display:grid;grid-template-columns:48px 1fr"><span class="num">2</span>ไก LT/RT ยังเก็บเป็นร่างในหน้านี้ เพราะยังไม่รู้ว่าเปิด/ปิดอยู่ที่ไบต์ไหน</li>
        <li style="display:grid;grid-template-columns:48px 1fr"><span class="num">3</span>ถ้าเขียนแล้วรู้สึกไม่ต่าง ให้คัดลอก packet log ในหน้า Device &amp; backup มาดูต่อ</li>
      </ol>
    </section>`;
}

function miniCurve(c, on, pend) {
  const W = 218, H = 76;
  const pts = [[c.start_x, c.start_y], ...c.mid_points.map((m) => [m.x, m.y]), [c.end_x, c.end_y]];
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${((x / 255) * (W - 12) + 6).toFixed(1)} ${(H - 6 - (y / 255) * (H - 12)).toFixed(1)}`).join(" ");
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${!on ? "#BDBDBD" : pend ? "#2140D9" : "#111"}" stroke-width="2"/></svg>`;
}

// ---------------- 06 Gyro ----------------

export function gyro(S, D) {
  const g = S.current.cfg.gyroscope;
  if (!g) return `${head("Gyro", "")}<p class="empty-note">โปรไฟล์นี้ไม่มีค่า gyro</p>`;
  const mode = D.get("gyro.mode");
  const pm = D.has("gyro.mode");
  const sub = { disable: "ค่าบนจอยตอนนี้", left_joystick: "เดิน / ขับรถ", right_joystick: "เล็งในเกมจอย", mouse: "เกม PC ที่ใช้เมาส์" };
  const modes = Object.entries(GYRO_MODE)
    .map(([id, l]) => {
      const on = mode === id;
      const base = g.mode === id;
      return `<button class="utab big${on ? " on" : ""}${on && pm ? " pending" : ""}" data-act="set" data-key="gyro.mode" data-val="${id}" style="${on && pm ? "color:var(--cobalt)" : ""}">${l}<small class="${on && pm ? "pending" : ""}">${on && pm ? `${sub[id]} · แก้แล้ว` : base ? "ค่าบนจอยตอนนี้" : sub[id]}</small></button>`;
    })
    .join("");
  const acts = g.activation.length
    ? g.activation.map((a) => `<span class="keytag" style="height:48px;padding:0 16px;font-size:16px;gap:12px">${a.activation === "hold" ? "กดค้าง" : "กดสลับ"} ${esc(btnName(a.button))}</span>`).join("")
    : `<span class="meta">ไม่ได้ตั้ง · ทำงานตลอด</span>`;
  const sel = (key, opts) => `<select class="field${D.has(key) ? " pending" : ""}" data-key="${key}" style="height:56px;font-size:16px">${Object.entries(opts).map(([v, l]) => `<option value="${v}" ${D.get(key) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const anyUnsup = ["gyro.sens", "gyro.preset", "gyro.axisX", "gyro.axisY"].some((k) => D.has(k));
  const ink = pm ? "#2140D9" : "#111";
  const act = g.activation[0];
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
        <text x="800" y="1185" text-anchor="middle" fill="${ink}" style="font:700 30px var(--sans)">หมุนซ้าย–ขวา (Z) → เล็งซ้าย–ขวา</text>
        <text x="1500" y="395" text-anchor="end" fill="${ink}" style="font:700 30px var(--sans)">ก้ม–เงย (X) → เล็งบน–ล่าง</text>
      </svg></div>
      <section style="margin-top:28px;display:flex;gap:28px;align-items:center;border-top:1px solid var(--ink-2);padding-top:24px">
        <svg width="120" height="120" viewBox="-62 -62 124 124" aria-hidden="true"><circle r="60" fill="none" stroke="#111"/><path d="M-60 0H60M0 -60V60" stroke="#E2E2E2"/><path d="M0 0 C 10 -4, 18 -14, 24 -24" stroke="#2140D9" stroke-width="2" fill="none"/><circle cx="24" cy="-24" r="8" fill="#2140D9"/><circle r="4" fill="#111"/></svg>
        <div><b style="font-size:18px">${mode === "disable" ? "gyro ปิดอยู่" : `${act ? `${act.activation === "hold" ? "กดค้าง" : "กดสลับ"} ${esc(btnName(act.button))} แล้ว` : ""}เอียงจอย`}</b>
          <p class="muted" style="margin:4px 0 0">${mode === "disable" ? "เลือกหน้าที่ด้านขวาเพื่อเปิด" : `จุดน้ำเงินคือ ${esc(GYRO_MODE[mode])} ที่ gyro สร้างขึ้น`}</p>
          <p class="meta" style="margin:2px 0 0">ความหมายของแกนยังไม่ยืนยันกับจอยจริง · ดูค่าสดยังไม่ได้เพราะ Gamepad API ไม่ส่งค่า gyro</p></div>
      </section>
    </div>
    <div>
      <div class="rule-head"><h2>Gyro ทำหน้าที่เป็น</h2></div>
      <div class="utabs" style="margin-top:16px;gap:40px">${modes}</div>
      <div style="margin-top:28px;display:grid;gap:14px">
        <div><b style="font-size:16px">ทำงานเมื่อ</b> <span class="meta">ตั้งได้สูงสุด 4 ปุ่ม · ไม่ตั้ง = ทำงานตลอด</span></div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">${acts}<span class="keytag" style="height:48px;padding:0 16px;border-style:dashed;color:var(--ink-3);border-color:var(--keycap)" title="ยังเขียนลงจอยไม่ได้">+ เพิ่มปุ่ม</span></div>
      </div>
      <div style="margin-top:32px">${slider("gyro.sens", "ความไว", D, { min: 0, max: 100, fmt: (v) => (v == null ? "ยังอ่านไม่ได้" : `${v}%`) })}</div>
      <div style="margin-top:28px">${presetTabs("gyro.preset", GPRESET, D)}</div>
      <div style="margin-top:36px;display:grid;gap:14px">
        <b style="font-size:16px">แกน</b>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <label><span class="meta" style="display:block;margin-bottom:6px">ซ้าย–ขวา ใช้</span>${sel("gyro.axisX", AXIS)}</label>
          <label><span class="meta" style="display:block;margin-bottom:6px">บน–ล่าง ใช้</span>${sel("gyro.axisY", AXIS)}</label>
        </div>
        <div class="checks">${check("gyro.invertX", "กลับซ้าย–ขวา", D)}${check("gyro.invertY", "กลับบน–ล่าง", D)}</div>
        ${anyUnsup ? `<p style="margin:0">${UNSUP}</p>` : ""}
      </div>
    </div>
  </div>`;
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

export function review(S, D) {
  const items = D.items();
  const slotItems = items.filter((i) => i.group === "slot" && i.writable);
  const unsup = items.filter((i) => !i.writable);
  const nW = slotItems.length;
  const row = (i) => `<div class="diff-row${i.writable ? "" : " unsup"}"><b>${esc(i.label)}</b><span class="old">${esc(i.base === undefined ? "ไม่ทราบ" : i.fmt(i.base))}</span><span>→</span>
    <span class="new">${i.key === "led.color" ? `<span class="swatch-dot" style="background:${esc(i.value)}"></span>` : ""}${esc(i.fmt(i.value))}</span></div>`;
  const slot = S.slots.activeSlot;
  return `<h2 class="d-title" id="sheet-title">${nW ? `เขียน ${nW} การเปลี่ยนแปลงลงจอย` : "ยังไม่มีอะไรที่เขียนลงจอยได้"}</h2>
    <p class="d-sub">ตรวจก่อนเขียน · อย่าถอดสายระหว่างเขียน</p>
    ${nW ? `<div class="d-group"><div class="rule-head"><h2>Slot ${slot + 1}${D.get(`slot.${slot}.name`) ? ` · ${esc(D.get(`slot.${slot}.name`))}` : ""}</h2><span class="meta">ค่าบนจอย → ค่าใหม่</span></div>${slotItems.map(row).join("")}</div>` : ""}
    ${unsup.length ? `<div class="d-group"><div class="rule-head"><h2>ยังเขียนลงจอยไม่ได้</h2><span class="meta">เก็บเป็นร่างในหน้านี้ ไม่ส่งลงจอย</span></div>${unsup.map(row).join("")}</div>` : ""}
    ${nW ? `<p class="notice" style="margin-top:24px;font-size:15px;color:var(--ink)">${ICON.file}<span><b>สำรองค่าบนจอยเป็นไฟล์อัตโนมัติก่อนเขียนทุกครั้ง</b> <span class="muted">· กู้คืนได้ที่ Device &amp; backup</span></span></p>` : ""}
    <div class="d-actions"><button class="link" style="font-size:17px" data-act="close-sheet">กลับไปแก้</button>
      <button class="btn primary" data-act="write" ${nW ? "" : "disabled"}>เขียนลงจอย</button></div>`;
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
      ${W.backupAt ? `<div class="kv"><span class="k">ไฟล์สำรอง</span><span class="v">${fmtWhen(W.backupAt)} · กู้คืนได้</span></div>` : ""}
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
