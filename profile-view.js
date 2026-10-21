// Renders a decoded mapping config (see mapping.js) as readable HTML.

const pct = (v) => `${Math.round((v / 255) * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function curveSvg(c, { flatStart = true } = {}) {
  const S = 96;
  const p = (x, y) => `${((x / 255) * S).toFixed(1)},${(S - (y / 255) * S).toFixed(1)}`;
  const pts = [];
  if (flatStart) pts.push(p(0, 0));
  pts.push(p(c.start_x, c.start_y), ...c.mid_points.map((m) => p(m.x, m.y)), p(c.end_x, c.end_y), p(255, c.end_y));
  return `<svg viewBox="-2 -2 ${S + 4} ${S + 4}" width="${S}" height="${S}" class="curve" aria-hidden="true">
    <rect x="0" y="0" width="${S}" height="${S}" />
    <line x1="0" y1="${S}" x2="${S}" y2="0" class="diag" />
    <polyline points="${pts.join(" ")}" />
  </svg>`;
}

function card(title, svg, rows) {
  return `<div class="pcard">${svg}<div><h3>${title}</h3>${rows
    .map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`)
    .join("")}</div></div>`;
}

function stick(name, s) {
  if (!s) return "";
  return card(name, curveSvg(s.curve), [
    ["Deadzone", pct(s.curve.start_x)],
    ["ระยะสูงสุด", pct(s.curve.end_x)],
    ["จุดโค้ง", s.curve.mid_points.length || "เส้นตรง"],
    ["รูปทรง", s.is_round ? "วงกลม" : "สี่เหลี่ยม"],
    ["กลับแกน", [s.invert_x && "X", s.invert_y && "Y"].filter(Boolean).join(" + ") || "—"],
  ]);
}

function trigger(name, t) {
  if (!t) return "";
  return card(name, curveSvg(t.curve), [
    ["เริ่มทำงานที่", pct(t.curve.start_x)],
    ["สุดที่", pct(t.curve.end_x)],
    ["จุดโค้ง", t.curve.mid_points.length || "เส้นตรง"],
  ]);
}

function motor(name, m) {
  if (!m) return "";
  return card(name, curveSvg(m.curve, { flatStart: false }), [
    ["สถานะ", m.enabled === false ? "ปิด" : "เปิด"],
    ["แรงต่ำสุด", pct(m.curve.start_y)],
    ["แรงสูงสุด", pct(m.curve.end_y)],
  ]);
}

const GYRO_MODE = { disable: "ปิด", left_joystick: "สติ๊กซ้าย", right_joystick: "สติ๊กขวา", mouse: "เมาส์" };

function gyro(g) {
  if (!g) return "";
  return card("Gyro", curveSvg(g.curve), [
    ["โหมด", GYRO_MODE[g.mode] ?? g.mode],
    ["เปิดใช้ด้วย", g.activation.map((a) => `${a.button} (${a.activation === "hold" ? "กดค้าง" : "กดสลับ"})`).join(", ") || "ตลอดเวลา"],
    ["แกน", `${g.axis_x} / ${g.axis_y}`],
    ["ปลายเส้นโค้ง", `อินพุต ${pct(g.curve.end_x)} → เอาต์พุต ${pct(g.curve.end_y)}`],
  ]);
}

export function targetLabel(t) {
  switch (t.type) {
    case "btn_gamepad": return t.button;
    case "btn_keyboard": return `คีย์บอร์ด 0x${t.key.toString(16)}${t.modifier ? ` +mod 0x${t.modifier.toString(16)}` : ""}`;
    case "btn_mouse": return ["คลิกซ้าย", "คลิกขวา", "คลิกกลาง", "ปุ่มเมาส์ 4", "ปุ่มเมาส์ 5"][t.mouse] ?? `เมาส์ ${t.mouse}`;
    case "btn_consumer": return `มีเดีย 0x${t.consumer.toString(16)}`;
    case "turbo_gamepad": return `Turbo ${t.button} ทุก ${t.interval_ms}ms`;
    case "layer_hold": return `กดค้างเปลี่ยนเลเยอร์ ${t.layer}`;
    case "layer_toggle": return `สลับเลเยอร์ ${t.layer}`;
    case "macro": return `มาโคร #${t.macro + 1}`;
    case "mouse_move": return `ขยับเมาส์ ${t.dx},${t.dy}`;
    case "mouse_wheel": return `ล้อเมาส์ ${t.delta}`;
    default: return t.type;
  }
}

const ACT = { simple: "กด", timing_single: "แตะครั้งเดียว", timing_long: "กดค้าง", timing_double: "ดับเบิลคลิก", pulse_press: "ตอนกด", pulse_release: "ตอนปล่อย", toggle: "สลับ" };

function layers(cfg) {
  return cfg.layers
    .map((l) => {
      const maps = l.mappings.filter((m) => !m.identity);
      const mapHtml = maps.length
        ? `<table class="maps">${maps
            .map(
              (m) =>
                `<tr><td>${esc(m.source)}</td><td>→</td><td>${m.activators
                  .map((a) => `${a.type === "simple" ? "" : `<span class="chip">${ACT[a.type] ?? a.type}</span> `}${esc(targetLabel(a.target))}`)
                  .join("<br>") || "<span class=empty>ปิดปุ่ม</span>"}</td></tr>`,
            )
            .join("")}</table>`
        : `<p class="empty">ปุ่มทั้งหมดเป็นค่าเริ่มต้น</p>`;
      const macroHtml = l.macros
        .map((m) => {
          const name = cfg.macro_names?.find((n) => n.layerId === l.layer_id && n.macroId === m.macro_id)?.name;
          const presses = m.actions.filter((a) => a.action === "press");
          const dur = m.actions.at(-1)?.at_ms ?? 0;
          return `<div class="macro"><b>${esc(name || `มาโคร #${m.macro_id + 1}`)}</b>
            <span class="seq">${presses.map((a) => `<span class="key">${esc(targetLabel(a.target))}</span>`).join("")}</span>
            <small>${dur}ms · ${m.trigger_mode}</small></div>`;
        })
        .join("");
      const zones = ["trigger_zones_left", "trigger_zones_right", "stick_zones_left", "stick_zones_right"].filter((k) => l[k]);
      return `<div class="layer"><h3>เลเยอร์ ${l.layer_id}${l.layer_id === 0 ? " (หลัก)" : ""}</h3>${mapHtml}${
        macroHtml ? `<h4>มาโคร</h4>${macroHtml}` : ""
      }${zones.length ? `<p class="note">มีการตั้งโซน: ${zones.join(", ")}</p>` : ""}</div>`;
    })
    .join("");
}

export function renderProfile(cfg) {
  return `
    ${cfg.name ? `<p class="pname">${esc(cfg.name)}</p>` : ""}
    <h3 class="group">สติ๊กและทริกเกอร์</h3>
    <div class="pgrid">
      ${stick("สติ๊กซ้าย", cfg.joystick_left)}${stick("สติ๊กขวา", cfg.joystick_right)}
      ${trigger("LT", cfg.trigger_left)}${trigger("RT", cfg.trigger_right)}
    </div>
    <h3 class="group">Gyro และการสั่น</h3>
    <div class="pgrid">
      ${gyro(cfg.gyroscope)}${motor("มอเตอร์ซ้าย", cfg.vibration_motor_left)}${motor("มอเตอร์ขวา", cfg.vibration_motor_right)}
    </div>
    <h3 class="group">ปุ่มและมาโคร</h3>
    <p class="note">กดค้าง = ${cfg.runtime.long_press_ms}ms · ดับเบิลคลิก = ${cfg.runtime.double_press_ms}ms</p>
    <div class="layers">${layers(cfg)}</div>
  `;
}
