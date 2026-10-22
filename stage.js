// Photo stages: the real Apex 6 Pro press photo with manual-style leader lines.
// Coordinates come from the Paper v2 artboards (1440×900), so every stage keeps that geometry.

export const PHOTO = { front: "./assets/apex6pro-front.jpg", back: "./assets/apex6pro-back.jpg", w: 1600, h: 1280 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Back view: photo at (2, 98) scale 0.56. Seen from the back, the left of the image is the right hand.
export const BACK = {
  view: "0 196 900 500",
  img: { x: 2, y: 98, w: 896, h: 717 },
  callouts: [
    { id: "RB", side: "l", y: 244, d: "M134 244 H230 L252 266", pt: [252, 266] },
    { id: "RM", side: "l", y: 288, d: "M134 288 H330 L352 280", pt: [352, 280] },
    { id: "RT", side: "l", y: 334, d: "M134 334 H266 L284 316", pt: [284, 316] },
    { id: "M1", side: "l", y: 470, d: "M134 470 H282 L300 481", pt: [307, 484] },
    { id: "M3", side: "l", y: 540, d: "M134 540 H300 L322 524", pt: [322, 524] },
    { id: "LB", side: "r", y: 244, d: "M766 244 H665 L643 268", pt: [643, 268] },
    { id: "LM", side: "r", y: 288, d: "M766 288 H560 L538 280", pt: [538, 280] },
    { id: "LT", side: "r", y: 334, d: "M766 334 H629 L611 316", pt: [611, 316] },
    { id: "M2", side: "r", y: 470, d: "M766 470 H640 L601 496", pt: [601, 496] },
    { id: "M4", side: "r", y: 540, d: "M766 540 H620 L579 524", pt: [579, 524] },
  ],
  keyX: { l: 124, r: 776 },
  labelX: { l: 108, r: 792 },
};

// Front view: photo at (53, 143) scale 0.5. Labels are one line: name + value.
export const FRONT = {
  view: "0 214 900 500",
  img: { x: 53, y: 143, w: 800, h: 640 },
  callouts: [
    { id: "Back", side: "l", y: 262, d: "M140 262 H366 V266", pt: [366, 266] },
    { id: "LS", side: "l", y: 330, d: "M140 330 H290", pt: [290, 330] },
    { id: "DPAD", side: "l", y: 447, d: "M140 447 H330 L352 412", pt: [352, 412] },
    { id: "Start", side: "r", y: 250, d: "M764 250 H560 L532 266", pt: [532, 266] },
    { id: "Y", side: "r", y: 284, d: "M764 284 H640 L624 291", pt: [613, 293] },
    { id: "X", side: "r", y: 318, d: "M764 318 H700 V306 H592 L573 330", pt: [573, 330] },
    { id: "B", side: "r", y: 352, d: "M764 352 H680 L663 336", pt: [663, 336] },
    { id: "A", side: "r", y: 386, d: "M764 386 H640 L618 372", pt: [618, 372] },
    { id: "RS", side: "r", y: 440, d: "M764 440 H580 L536 422", pt: [536, 422] },
  ],
  keyX: { l: 128, r: 776 },
  labelX: { l: 112, r: 792 },
  inline: true,
};

// items: { [id]: { name, value, state: "default"|"set"|"pend"|"nomap", sel } }
export function stageSvg(def, items, { kind = "back", label = "" } = {}) {
  let n = 0;
  const groups = def.callouts
    .map((c) => {
      const it = items[c.id];
      if (!it) return "";
      n++;
      const cls = ["co", def.inline ? "front" : "", it.state || "", it.sel ? "sel" : ""].join(" ");
      const left = c.side === "l";
      const lx = def.labelX[c.side], kx = def.keyX[c.side];
      const anchor = left ? "end" : "start";
      const text = def.inline
        ? `<text x="${lx}" y="${c.y + 4.5}" text-anchor="${anchor}"><tspan class="name">${esc(it.name)}</tspan><tspan class="val" dx="6">${esc(it.value)}</tspan></text>`
        : `<text class="name" x="${lx}" y="${c.y - 6}" text-anchor="${anchor}">${esc(it.name)}</text>
           <text class="val" x="${lx}" y="${c.y + 13}" text-anchor="${anchor}">${esc(it.value)}</text>`;
      const hitX = left ? 0 : kx - 12, hitW = left ? kx + 12 : 900 - (kx - 12);
      return `<g class="${cls}" data-pick="${c.id}" tabindex="0" role="button" aria-label="${esc(`${it.name}: ${it.value}`)}">
        <rect class="hit" x="${hitX}" y="${c.y - 22}" width="${hitW}" height="44"/>
        <path class="line" d="${c.d}"/>
        <circle class="ring" cx="${c.pt[0]}" cy="${c.pt[1]}" r="11"/>
        <circle class="pt" cx="${c.pt[0]}" cy="${c.pt[1]}" r="${it.sel ? 4.5 : 3.5}"/>
        <circle class="key-bg" cx="${kx}" cy="${c.y}" r="10"/>
        <text class="key-n" x="${kx}" y="${c.y + 4}" text-anchor="middle">${n}</text>
        ${text}
      </g>`;
    })
    .join("");
  const { x, y, w, h } = def.img;
  return `<div class="stage"><svg viewBox="${def.view}" role="group" aria-label="${esc(label || (kind === "back" ? "ภาพจอยด้านหลัง" : "ภาพจอยด้านหน้า"))}">
    <image href="${kind === "back" ? PHOTO.back : PHOTO.front}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>
    ${groups}
  </svg></div>`;
}

// A rectangular crop of a photo, as a CSS background. (cx, cy, cw, ch) are photo pixels.
export function insetStyle(which, [cx, cy, cw, ch], boxW, boxH) {
  const s = Math.max(boxW / cw, boxH / ch);
  const ox = cx - (boxW / s - cw) / 2, oy = cy - (boxH / s - ch) / 2;
  return `background-image:url(${PHOTO[which]});background-size:${PHOTO.w * s}px ${PHOTO.h * s}px;background-position:${-ox * s}px ${-oy * s}px`;
}

// Photo-pixel crops for insets. Triggers and the label are on the back photo; the rest on the front.
export const CROPS = {
  stickL: ["front", [234, 254, 480, 240]],
  stickR: ["front", [726, 438, 480, 240]],
  trigR: ["back", [380, 220, 587, 293]], // back view: RT on the image's left
  trigL: ["back", [633, 220, 587, 293]],
  motorL: ["front", [114, 714, 360, 240]],
  motorR: ["front", [1134, 714, 360, 240]],
  label: ["back", [650, 340, 440, 200]],
};
// Marker positions inside the trigger crops (box 176×88).
export const TRIG_MARK = { trigR: [37, 50], trigL: [146, 48] };

export function inset(key, { w = 176, h = 88, mark = null, title = "" } = {}) {
  const [which, crop] = CROPS[key];
  const m = mark
    ? `<svg width="${w}" height="${h}" aria-hidden="true"><circle cx="${mark[0]}" cy="${mark[1]}" r="10" fill="none" stroke="#111" stroke-width="1.5"/><circle cx="${mark[0]}" cy="${mark[1]}" r="3.5" fill="#111"/></svg>`
    : "";
  return `<div class="inset" style="width:${w}px;height:${h}px;${insetStyle(which, crop, w, h)}" role="img" aria-label="${esc(title)}">${m}</div>`;
}

// LED light bar along the lower face, in front-photo pixels.
export const LED_PATH = "M311 929 C338 827,404 787,511 782 L1033 782 C1147 787,1218 827,1249 929";
