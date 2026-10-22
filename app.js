import { Apex6, RAM, hex, crc32 } from "./protocol.js";
import { decodeMapping } from "./mapping.js";
import { unwrapMapping, applyEdits, sameBytes, deadzoneMax, curveEndMin, curveStartMax, motorMaxMin } from "./mapping-edit.js";
import { Drafts, evalCurve, esc } from "./model.js";
import * as V from "./views.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const S = {
  pad: null,
  demo: params.has("demo"),
  hid: "hid" in navigator,
  info: null, sku: null, uuid: null, vers: null, slots: null,
  current: null, // { wrapped, cfg, slot } as last read from the controller
  readAt: null,
  loading: null,
  loadError: null,
  connectError: null,
  tab: tabFromHash(),
  ui: { side: "back", layer: 0, sel: "M1", press: "simple", outType: null, dpad: "D-pad ↑", renaming: null, macro: null, step: 0 },
  log: [],
  backups: [],
  dump: null,
  dumpStatus: "",
  writing: false,
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

function renderChrome() {
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
  if (!S.pad) view.innerHTML = V.connect(S);
  else if (!S.current) view.innerHTML = loadingView();
  else view.innerHTML = PAGES[S.tab](S, D);
  liveCache.clear();
  if (focusSig) {
    const el = document.querySelector(focusSig);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
  document.title = S.pad ? `${V.TABS.find((t) => t.id === S.tab)?.label} · Apex 6 Pro` : "Apex 6 Pro · ตั้งค่าจอย";
}

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
    const box = document.querySelector(`[data-live-chart="${a}-${side}"]`);
    if (box) box.innerHTML = chartFor(a, side, null);
  }
  renderChrome();
}

function outText(key, label) {
  const v = D.get(key);
  if (key.startsWith("led.bright") || key.startsWith("screen.bright") || key === "gyro.sens") return `${v}%`;
  if (key.startsWith("motor.") || key.startsWith("vibtrig.")) return `${Math.round((v / 255) * 100)}%`;
  return `${Math.round((v / 255) * 100)}%  ·  ${v}`;
}

function chartFor(kind, side, liveX) {
  const cfg = S.current.cfg;
  const base = cfg[`${kind === "stick" ? "joystick" : "trigger"}_${side}`].curve;
  const keys = kind === "stick" ? [`stick.${side}.deadzone`, `stick.${side}.max`] : [`trigger.${side}.start`, `trigger.${side}.end`];
  const c = V.effCurve(D, base, keys[0], keys[1]);
  const pend = D.pendingKeys(`${kind}.${side}.`).length > 0;
  return V.curveSvg(c, { pending: pend, live: liveX });
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
  let n = bytes.length;
  while (n > 1 && bytes[n - 1] === 0) n--;
  const t = new Date().toLocaleTimeString("th-TH", { hour12: false });
  S.log.push({ dir, text: `${t}  ${dir === "out" ? "→" : "←"}  ${hex(bytes.slice(0, n)).toUpperCase()}` });
  if (S.log.length > 300) S.log.splice(0, S.log.length - 300);
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
    if (!S.slots) S.slots = { activeSlot, slotCrc16: [0, 0, 0, 0] };
    S.readAt = new Date();
    D.prune();
    if (!cfg.layers.some((l) => l.layer_id === S.ui.layer)) S.ui.layer = 0;
  } catch (e) {
    console.warn(e);
    S.current = null;
    S.loadError = e.message;
  }
  S.loading = null;
  render();
}

async function disconnect() {
  await S.pad?.close().catch(() => {});
  S.pad = null;
  S.current = null;
  S.info = S.sku = S.uuid = S.vers = S.slots = null;
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

async function switchSlot(i) {
  if (!S.pad || i === S.slots?.activeSlot || S.writing) return;
  const slotDrafts = D.items().filter((x) => x.group === "slot" && !x.key.startsWith("slot.")).length;
  if (slotDrafts && !confirm(`สลับไป Slot ${i + 1}?\n\nร่างที่ยังไม่ได้เขียน ${slotDrafts} จุดใน slot นี้จะหายไป`)) return;
  if (!S.demo && !confirm(`สลับจอยไปใช้ Slot ${i + 1}?\n\nคำสั่งสลับ slot (0xA2) ยังไม่ได้ทดสอบกับจอยจริง ถ้าไม่สลับ แอปจะแจ้งและไม่แก้อะไร`)) return;
  try {
    await S.pad.switchSlot(i);
    for (const it of D.items()) if (it.group === "slot" && !it.key.startsWith("slot.")) D.map.delete(it.key);
    S.current = null;
    await loadAll();
    toast(`จอยใช้ Slot ${i + 1} แล้ว`);
  } catch (e) {
    toast(`สลับ slot ไม่สำเร็จ: ${e.message}`, true);
    await loadAll();
  }
}

// ---------------- Backups ----------------

const BK_KEY = "apex6.backups";
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function loadBackups() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(BK_KEY) ?? "[]");
  } catch {}
  // Migrate the single-per-slot backups written by the first version of the app.
  for (let s = 0; s < 4; s++) {
    const k = `apex6.backup.mapping.slot${s}`;
    try {
      const b = JSON.parse(localStorage.getItem(k) ?? "null");
      if (b && !list.some((x) => x.at === b.at)) list.push({ id: `m${b.at}`, at: b.at, slot: s, name: "", reason: "ก่อนเขียน", data: b.data });
      localStorage.removeItem(k);
    } catch {}
  }
  S.backups = list.filter((b) => b && b.data).sort((a, b) => b.at - a.at);
  saveBackups();
}

function saveBackups() {
  while (S.backups.length) {
    try {
      localStorage.setItem(BK_KEY, JSON.stringify(S.backups.slice(0, 16)));
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
  sheet.querySelector(".btn.primary:not(:disabled)")?.focus();
}

// Every write: re-read and confirm nothing changed since display, back up, write, read back and compare.
async function runWrite({ edits = null, data = null, reason, title, doneTitle, failTitle }) {
  const slot = S.current.slot;
  W = { title, doneTitle, failTitle, slot, name: S.current.cfg.name || "", at: 0, steps: ["สำรองไฟล์", `ส่งข้อมูล Slot ${slot + 1}`, "ตรวจ CRC กับจอย"], bytes: null };
  S.writing = true;
  showSheet(V.writing(W));
  let started = false;
  try {
    const fresh = await S.pad.readRam(RAM.MAPPING);
    if (fresh.activeSlot !== slot || !sameBytes(fresh.data, S.current.wrapped)) {
      throw new Error("ค่าในจอยไม่ตรงกับที่แสดงอยู่ (อาจสลับ slot หรือถูกแก้จากที่อื่น) อ่านค่าจากจอยใหม่แล้วลองอีกครั้ง");
    }
    const info = await S.pad.getRamInfo(RAM.MAPPING);
    if (info.status !== 0 || info.len !== fresh.data.length || info.crc32 !== crc32(fresh.data)) {
      throw new Error(`จอยรายงานความยาว/CRC ไม่ตรงกับที่อ่านได้ (status=${info.status}) ยกเลิกแล้ว ไม่ได้เขียนอะไร`);
    }
    const next = edits ? applyEdits(fresh.data, edits) : data;
    unwrapMapping(next);
    W.backupAt = backup(fresh.data, slot, reason);
    W.at = 1;
    showSheet(V.writing(W));
    if (!sameBytes(fresh.data, next)) {
      started = true;
      await S.pad.writeRam(RAM.MAPPING, next, (i, n) => {
        W.bytes = [Math.min(i * 16, next.length), next.length];
        showSheet(V.writing(W));
      });
    }
    W.at = 2;
    W.bytes = null;
    showSheet(V.writing(W));
    const back = await S.pad.readRam(RAM.MAPPING);
    if (!sameBytes(back.data, next)) throw new Error("อ่านกลับแล้วไม่ตรงกับที่เขียน");
    W.crc = (back.data[2] | (back.data[3] << 8)).toString(16).padStart(4, "0").toUpperCase();
    if (edits) for (const k of Object.keys(edits)) D.map.delete(k);
    S.current = { wrapped: back.data, cfg: unwrapMapping(back.data).cfg, slot: back.activeSlot };
    S.readAt = new Date();
    S.slots = (await safe(() => S.pad.getSlotStatus())) ?? S.slots;
    D.prune();
    W.left = D.count();
    S.writing = false;
    renderChrome();
    showSheet(V.done(W));
    sheet.querySelector(".btn")?.focus();
  } catch (e) {
    console.warn(e);
    S.writing = false;
    W.error = started && W.bytes ? `จอยหยุดตอบหลังส่ง ${W.bytes[0]} / ${W.bytes[1]} B · ${e.message}` : e.message;
    W.unknown = started;
    W.restore = started ? W.backupAt : null;
    renderChrome();
    showSheet(V.failed(W));
  }
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
  "motor.left.max": (v) => Math.max(v, motorMaxMin(S.current.cfg.vibration_motor_left.curve)),
  "motor.right.max": (v) => Math.max(v, motorMaxMin(S.current.cfg.vibration_motor_right.curve)),
};

function setDraft(key, v) {
  if (CLAMP[key]) v = CLAMP[key](v);
  D.set(key, v);
  return v;
}

function selectSource(src) {
  S.ui.sel = src;
  S.ui.press = "simple";
  S.ui.outType = null;
}

function pick(id) {
  const ui = S.ui;
  if (ui.side === "back") selectSource(V.BACK_SRC[id] ?? id);
  else selectSource(id === "DPAD" ? ui.dpad : V.FRONT_SRC[id]);
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
  else if (type === "macro") v = { type: "macro", macro: Number(el.dataset.macro) };
  else if (type === "none") v = { type: "none" };
  else if (type === "unset") v = undefined;
  if (v === undefined) {
    if (D.base(key) === undefined) D.map.delete(key);
    else D.map.set(key, undefined);
  } else D.set(key, v);
  S.ui.outType = type === "unset" ? null : type;
  render();
}

const ACTIONS = {
  connect,
  disconnect,
  reload: () => loadAll(),
  tab: (el) => {
    S.tab = el.dataset.tab;
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
  write: () => runWrite({ edits: D.writable(), reason: "ก่อนเขียน", title: "กำลังเขียนลงจอย", doneTitle: "เขียนเสร็จ ตรงกับจอยแล้ว", failTitle: "เขียนไม่สำเร็จ" }),
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
  side: (el) => {
    S.ui.side = el.dataset.side;
    const onBack = ["M1", "M2", "M3", "M4", "LB", "RB", "LT (active)", "RT (active)", "LM", "RM"].includes(S.ui.sel);
    if (S.ui.side === "back" && !onBack) selectSource("M1");
    if (S.ui.side === "front" && onBack) selectSource("A");
    render();
  },
  layer: (el) => {
    S.ui.layer = Number(el.dataset.layer);
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
  "pick-src": (el) => {
    const src = el.dataset.src;
    S.ui.layer = Number(el.dataset.layer);
    const back = ["M1", "M2", "M3", "M4", "LB", "RB", "LT (active)", "RT (active)"].includes(src);
    S.ui.side = back ? "back" : "front";
    if (src.startsWith("D-pad")) S.ui.dpad = src;
    selectSource(src);
    render();
  },
  set: (el) => {
    const v = "numval" in el.dataset ? Number(el.dataset.val) : el.dataset.val;
    setDraft(el.dataset.key, v);
    render();
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
    S.ui.renaming = Number(el.dataset.slot);
    render();
    const input = document.querySelector(`[data-rename="${el.dataset.slot}"]`);
    input?.focus();
    input?.select();
  },
  macro: (el) => {
    S.ui.macro = { layer: Number(el.dataset.layer), id: Number(el.dataset.id) };
    S.ui.step = 0;
    render();
  },
  step: (el) => {
    S.ui.step = Number(el.dataset.i);
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
  if (co) pick(co.dataset.pick);
});

document.addEventListener("keydown", (e) => {
  const co = e.target.closest?.("[data-pick]");
  if (co && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    pick(co.dataset.pick);
  }
  const rn = e.target.closest?.("[data-rename]");
  if (rn && (e.key === "Enter" || e.key === "Escape")) {
    if (e.key === "Escape") D.map.delete(rn.dataset.key);
    S.ui.renaming = null;
    render();
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.act === "turbo-iv") {
    const key = `map.${S.ui.layer}.${S.ui.sel}.${S.ui.press}`;
    const cur = D.get(key);
    if (cur?.type === "turbo_gamepad") D.set(key, { ...cur, interval_ms: Number(el.value) });
    el.style.setProperty("--p", `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
    el.closest(".slider").querySelector(".num").textContent = `${el.value} ms`;
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
    D.set(key, el.value);
    el.classList.toggle("pending", D.has(key));
    const bytes = el.parentElement.querySelector("[data-bytes]");
    if (bytes) bytes.textContent = `${new TextEncoder().encode(el.value).length} ไบต์`;
    renderChrome();
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "file-in") return importFile(el);
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

// ---------------- Live input (Gamepad API) ----------------

const liveCache = new Map();
function setLive(sel, html) {
  if (liveCache.get(sel) === html) return;
  liveCache.set(sel, html);
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
}

function tick() {
  if (S.current && (S.tab === "sticks" || S.tab === "triggers")) {
    const gp = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
    const cfg = S.current.cfg;
    if (S.tab === "sticks") {
      for (const [side, ax] of [["left", 0], ["right", 2]]) {
        const s = cfg[`joystick_${side}`];
        if (!s) continue;
        let v = null;
        if (gp) {
          const x = gp.axes[ax] ?? 0, y = gp.axes[ax + 1] ?? 0;
          const mag = Math.min(1, Math.hypot(x, y));
          const c = V.effCurve(D, s.curve, `stick.${side}.deadzone`, `stick.${side}.max`);
          v = { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), out: Number((evalCurve(c, mag * 255) / 255).toFixed(2)) };
          setLive(`[data-live-chart="stick-${side}"]`, chartFor("stick", side, mag > 0.02 ? Math.round(mag * 255) : null));
        }
        setLive(`[data-live="stick-${side}"]`, V.liveStick(gp ? v : null));
      }
    } else {
      for (const [side, bi] of [["left", 6], ["right", 7]]) {
        const t = cfg[`trigger_${side}`];
        if (!t) continue;
        let v = null;
        if (gp) {
          const raw = Number((gp.buttons[bi]?.value ?? 0).toFixed(2));
          const c = V.effCurve(D, t.curve, `trigger.${side}.start`, `trigger.${side}.end`);
          v = { raw, out: Number((evalCurve(c, raw * 255) / 255).toFixed(2)) };
          setLive(`[data-live-chart="trigger-${side}"]`, chartFor("trigger", side, raw > 0.01 ? Math.round(raw * 255) : null));
        }
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
