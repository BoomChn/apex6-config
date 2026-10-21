import { Apex6, RAM, hex, crc32 } from "./protocol.js";
import { decodeMapping } from "./mapping.js";
import { renderProfile } from "./profile-view.js";
import { unwrapMapping, withStickDeadzones, deadzoneMax, sameBytes } from "./mapping-edit.js";

const $ = (s) => document.querySelector(s);
let pad = null;
let lastDump = null;
// Mapping buffer as last read from the device: { wrapped, cfg, slot }. Edits are made against this.
let current = null;
let busy = false;

const BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "↑", "↓", "←", "→", "Home"];

function setStatus(text, on = false) {
  $("#status").textContent = text;
  $("#status").classList.toggle("on", on);
}

function enable(on) {
  $("#refresh").disabled = !on;
  document.querySelectorAll(".dump").forEach((b) => (b.disabled = !on));
  $("#connect").textContent = on ? "ตัดการเชื่อมต่อ" : "เชื่อมต่อจอย";
}

function logPacket(dir, bytes) {
  const el = $("#log");
  const line = document.createElement("span");
  line.className = dir;
  const t = new Date().toLocaleTimeString("th-TH", { hour12: false });
  line.textContent = `${t} ${dir === "out" ? "→" : "←"} ${hex(trimZeros(bytes))}\n`;
  el.prepend(line);
  while (el.childNodes.length > 300) el.lastChild.remove();
}

function trimZeros(b) {
  let n = b.length;
  while (n > 0 && b[n - 1] === 0) n--;
  return b.slice(0, Math.max(n, 1));
}

// Raw u16 as the official client stores it; display scheme is not yet known.
const fwVer = (v) => (v ? `0x${v.toString(16).padStart(4, "0")}` : "—");

function dl(rows) {
  return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

// Each read is independent so one unsupported command doesn't blank the panel.
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(e);
    return null;
  }
}

async function loadAll() {
  setStatus("กำลังอ่านข้อมูล…", true);
  const info = await safe(() => pad.getDeviceInfo());
  const sku = await safe(() => pad.getSku());
  const uuid = await safe(() => pad.getUuid());
  const vers = await safe(() => pad.getConfigVersions());
  const slots = await safe(() => pad.getSlotStatus());

  const rows = [
    ["รุ่น", sku?.name || pad.device.productName || "—"],
    ["USB PID", `0x${pad.device.productId.toString(16)}`],
  ];
  if (info) {
    rows.push(
      ["การเชื่อมต่อ", `mode ${info.connectionMode}`],
      ["แบตเตอรี่", `ระดับ ${info.batteryLevel}${info.chargingStatus ? " · กำลังชาร์จ" : ""}`],
      ["เฟิร์มแวร์หลัก", fwVer(info.fw.main)],
      ["รีซีฟเวอร์", fwVer(info.fw.receiver)],
      ["ทริกเกอร์", fwVer(info.fw.trigger)],
      ["จอ", fwVer(info.fw.screen)],
      ["MAC", info.macAddr],
    );
  }
  if (uuid) rows.push(["UUID", `<code>${uuid}</code>`]);
  let html = dl(rows);
  if (info) {
    const names = { imu: "Gyro", led: "ไฟ", switch: "Switch", screen: "จอ", triggerHaptic: "Trigger haptic", triggerVibrate: "Trigger สั่น", audio: "เสียง", haptic: "Haptic" };
    html += `<div class="chips" style="margin-top:14px">${Object.entries(info.features)
      .map(([k, v]) => `<span class="chip ${v ? "on" : ""}">${names[k]}</span>`)
      .join("")}</div>`;
  }
  if (!info && !sku) html = `<span class="empty">อ่านข้อมูลไม่สำเร็จ — ดู Packet log ด้านล่าง</span>`;
  $("#device").innerHTML = html;
  $("#device").classList.remove("empty");

  if (slots) {
    $("#profiles").innerHTML =
      `<div class="slots">${slots.slotCrc16
        .map(
          (crc, i) =>
            `<div class="slot ${slots.activeSlot === i ? "active" : ""}"><b>${i + 1}</b><small>${crc.toString(16).padStart(4, "0")}</small></div>`,
        )
        .join("")}</div>` +
      (vers
        ? `<p class="note">เวอร์ชันค่าตั้ง: global ${vers.globalConfigVer} · mapping ${vers.mappingVer} · LED ${vers.ledVer}</p>`
        : "") +
      `<p class="note">ตัวเลขใต้แต่ละช่องคือ CRC ของโปรไฟล์ — ถ้าเปลี่ยนแปลว่าค่าในโปรไฟล์นั้นถูกแก้</p>`;
    $("#profiles").classList.remove("empty");
  } else {
    $("#profiles").textContent = "อ่านสถานะโปรไฟล์ไม่สำเร็จ";
  }
  setStatus(`เชื่อมต่อแล้ว · ${pad.device.productName}`, true);
  await loadMapping();
}

async function loadMapping() {
  const status = $("#mapstatus");
  status.textContent = "กำลังอ่าน…";
  try {
    const { data, activeSlot } = await pad.readRam(RAM.MAPPING, (i, n) => (status.textContent = `กำลังอ่าน ${i}/${n}`));
    const cfg = decodeMapping(data);
    $("#mapping").innerHTML = renderProfile(cfg);
    $("#mapping").classList.remove("empty");
    status.textContent = `โปรไฟล์ ${activeSlot + 1} · v${cfg.version} · ${data.length} bytes`;
    // Editing needs the wrapped form with a valid CRC16; otherwise stay read-only.
    current = { wrapped: data, cfg: unwrapMapping(data).cfg, slot: activeSlot };
  } catch (e) {
    console.warn(e);
    status.textContent = "";
    $("#mapping").textContent = `อ่านหรือถอดค่าโปรไฟล์ไม่สำเร็จ: ${e.message}`;
    current = null;
  }
  renderEditor();
}

// --- Deadzone editor and restore ---

const DZ = { left: "joystick_left", right: "joystick_right" };
const pctOf = (v) => `${((v / 255) * 100).toFixed(1)}%`;

function writeStatus(text, kind = "") {
  const el = $("#writestatus");
  el.textContent = text;
  el.className = `note ${kind}`;
}

function renderEditor() {
  const ready = !!(pad && current) && !busy;
  for (const [side, key] of Object.entries(DZ)) {
    const input = $(`#dz-${side}`);
    const stick = current?.cfg[key];
    input.disabled = !ready || !stick;
    if (stick) {
      input.max = deadzoneMax(stick);
      if (!busy) input.value = stick.curve.start_x;
    }
    updateDzLabel(side);
  }
  $("#dz-reset").disabled = !ready;
  $("#restore-file").disabled = !ready;
  $("#restore-file-btn").classList.toggle("disabled", !ready);
  $("#restore-last").disabled = !ready || !loadLastBackup(current?.slot);
  updateSaveButton();
}

function updateDzLabel(side) {
  const input = $(`#dz-${side}`);
  const out = $(`#dz-${side}-v`);
  const orig = current?.cfg[DZ[side]]?.curve.start_x;
  if (orig == null) {
    out.textContent = "—";
    return;
  }
  const v = Number(input.value);
  out.textContent = `${pctOf(v)} (${v})`;
  out.classList.toggle("changed", v !== orig);
}

function dzValues() {
  const vals = {};
  for (const [side, key] of Object.entries(DZ)) if (current?.cfg[key]) vals[side] = Number($(`#dz-${side}`).value);
  return vals;
}

function updateSaveButton() {
  const changed = !!current && Object.entries(dzValues()).some(([s, v]) => v !== current.cfg[DZ[s]].curve.start_x);
  $("#dz-save").disabled = !pad || !current || busy || !changed;
}

for (const side of Object.keys(DZ)) {
  $(`#dz-${side}`).addEventListener("input", () => {
    updateDzLabel(side);
    updateSaveButton();
  });
}

$("#dz-reset").addEventListener("click", () => {
  renderEditor();
  writeStatus("");
});

$("#dz-save").addEventListener("click", async () => {
  const vals = dzValues();
  let next;
  try {
    next = withStickDeadzones(current.wrapped, vals);
  } catch (e) {
    return writeStatus(e.message, "err");
  }
  const lines = Object.entries(vals)
    .map(([s, v]) => `สติ๊ก${s === "left" ? "ซ้าย" : "ขวา"}: ${pctOf(current.cfg[DZ[s]].curve.start_x)} → ${pctOf(v)}`)
    .join("\n");
  if (!confirm(`เขียน deadzone ลงโปรไฟล์ ${current.slot + 1}?\n\n${lines}\n\nแอปจะดาวน์โหลดไฟล์ backup ของค่าเดิมให้ก่อนเขียน`)) return;
  await writeMapping(next);
});

$("#restore-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data, cfg;
  try {
    data = new Uint8Array(await file.arrayBuffer());
    cfg = unwrapMapping(data).cfg;
  } catch (err) {
    return writeStatus(`ใช้ไฟล์นี้ไม่ได้: ${err.message}`, "err");
  }
  if (!confirm(`กู้คืน "${file.name}"${cfg.name ? ` (${cfg.name})` : ""} ลงโปรไฟล์ ${current.slot + 1}?\n\nค่าทั้งหมดในโปรไฟล์นี้จะถูกแทนที่ด้วยค่าในไฟล์`)) return;
  await writeMapping(data);
});

$("#restore-last").addEventListener("click", async () => {
  const b = loadLastBackup(current.slot);
  if (!b) return;
  const when = new Date(b.at).toLocaleString("th-TH");
  if (!confirm(`กู้คืน backup ของโปรไฟล์ ${current.slot + 1} ที่บันทึกไว้เมื่อ ${when}?`)) return;
  await writeMapping(b.data);
});

// Every write: re-read and confirm nothing changed since display, back up, write, read back and compare.
async function writeMapping(next) {
  busy = true;
  renderEditor();
  try {
    writeStatus("กำลังตรวจค่าล่าสุดในจอย…");
    const fresh = await pad.readRam(RAM.MAPPING);
    if (fresh.activeSlot !== current.slot || !sameBytes(fresh.data, current.wrapped)) {
      throw new Error("ค่าในจอยไม่ตรงกับที่แสดงอยู่ (อาจสลับโปรไฟล์หรือถูกแก้จากที่อื่น) — กดรีเฟรชแล้วลองใหม่");
    }
    const info = await pad.getRamInfo(RAM.MAPPING);
    if (info.status !== 0 || info.len !== fresh.data.length || info.crc32 !== crc32(fresh.data)) {
      throw new Error(`จอยรายงาน len/CRC ไม่ตรงกับที่อ่านได้ (status=${info.status}) — ยกเลิก ไม่ได้เขียนอะไร`);
    }
    if (sameBytes(fresh.data, next)) {
      writeStatus("ค่าในจอยตรงกับที่จะเขียนอยู่แล้ว ไม่ต้องเขียน", "ok");
      return;
    }

    backup(fresh.data, fresh.activeSlot);

    await pad.writeRam(RAM.MAPPING, next, (i, n) => writeStatus(`กำลังเขียน ${i}/${n}`));

    writeStatus("กำลังอ่านกลับมาตรวจ…");
    const back = await pad.readRam(RAM.MAPPING);
    if (!sameBytes(back.data, next)) {
      throw new Error("อ่านกลับแล้วไม่ตรงกับที่เขียน — กด \"กู้คืน backup ล่าสุด\" เพื่อคืนค่าเดิม");
    }
    busy = false;
    await loadAll();
    writeStatus(`บันทึกลงโปรไฟล์ ${back.activeSlot + 1} แล้ว และอ่านกลับมาตรงทุกไบต์`, "ok");
  } catch (e) {
    console.warn(e);
    writeStatus(e.message, "err");
  } finally {
    busy = false;
    renderEditor();
  }
}

const BACKUP_KEY = (slot) => `apex6.backup.mapping.slot${slot}`;

function backup(data, slot) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  download(data, `apex6-profile${slot + 1}-backup-${stamp}.bin`);
  try {
    localStorage.setItem(BACKUP_KEY(slot), JSON.stringify({ at: Date.now(), data: btoa(String.fromCharCode(...data)) }));
  } catch (e) {
    console.warn("backup to localStorage failed", e);
  }
}

function loadLastBackup(slot) {
  if (slot == null) return null;
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY(slot)) ?? "null");
    if (!b) return null;
    const data = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0));
    unwrapMapping(data);
    return { at: b.at, data };
  } catch {
    return null;
  }
}

function download(data, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function attach(p) {
  pad = p;
  pad.onTraffic = logPacket;
  enable(true);
  await loadAll();
}

async function disconnect() {
  await pad?.close();
  pad = null;
  current = null;
  enable(false);
  renderEditor();
  setStatus("ยังไม่ได้เชื่อมต่อ");
}

$("#connect").addEventListener("click", async () => {
  if (pad) return disconnect();
  try {
    await attach(await Apex6.request());
  } catch (e) {
    setStatus(e.message);
  }
});

$("#refresh").addEventListener("click", () => pad && loadAll());
$("#clearlog").addEventListener("click", () => ($("#log").textContent = ""));

document.querySelectorAll(".dump").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const ram = Number(btn.dataset.ram);
    const status = $("#dumpstatus");
    try {
      const { data, activeSlot } = await pad.readRam(ram, (i, n) => (status.textContent = `chunk ${i}/${n}`));
      lastDump = { ram, data };
      status.textContent = `${data.length} bytes · active slot ${activeSlot + 1}`;
      $("#dump").textContent = hexdump(data);
      $("#download").disabled = false;
    } catch (e) {
      status.textContent = e.message;
    }
  }),
);

$("#download").addEventListener("click", () => {
  if (!lastDump) return;
  download(lastDump.data, `apex6-ram-0x${lastDump.ram.toString(16).padStart(2, "0")}-${Date.now()}.bin`);
});

function hexdump(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 16) {
    const row = b.slice(i, i + 16);
    const ascii = Array.from(row, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    s += `${i.toString(16).padStart(4, "0")}  ${hex(row).padEnd(47)}  ${ascii}\n`;
  }
  return s || "(ว่าง)";
}

// Live input through the standard Gamepad API — independent of the HID config channel.
const btnEls = BUTTON_NAMES.map((n) => {
  const s = document.createElement("span");
  s.textContent = n;
  $("#btns").append(s);
  return s;
});

function moveDot(el, label, x, y) {
  el.style.transform = `translate(${x * 53}px, ${y * 53}px)`;
  label.textContent = `${x.toFixed(2)}, ${y.toFixed(2)}`;
}

function tick() {
  const gp = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
  if (gp) {
    $("#padnote").textContent = `Gamepad API: ${gp.id}`;
    moveDot($("#ls"), $("#lsv"), gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    moveDot($("#rs"), $("#rsv"), gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    $("#lt").style.height = `${(gp.buttons[6]?.value ?? 0) * 100}%`;
    $("#rt").style.height = `${(gp.buttons[7]?.value ?? 0) * 100}%`;
    btnEls.forEach((el, i) => el.classList.toggle("on", !!gp.buttons[i]?.pressed));
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

renderEditor();

if (!("hid" in navigator)) {
  $("#nohid").style.display = "block";
  $("#connect").disabled = true;
} else {
  navigator.hid.addEventListener("disconnect", (e) => {
    if (pad && e.device === pad.device) disconnect();
  });
  Apex6.reconnect().then((p) => p && attach(p)).catch(() => {});
}

// ?demo renders a captured profile without a controller attached.
if (new URLSearchParams(location.search).has("demo")) {
  fetch("./samples/mapping_slot2.bin")
    .then((r) => r.arrayBuffer())
    .then((b) => {
      $("#mapping").innerHTML = renderProfile(decodeMapping(new Uint8Array(b)));
      $("#mapping").classList.remove("empty");
      $("#mapstatus").textContent = "ตัวอย่างจากจอยจริง (โปรไฟล์ 2)";
    });
}
