// Keyboard targets (target type 1): key = USB HID usage (keyboard page), modifier = HID bit mask
// Ctrl 1, Shift 2, Alt 4, Win 8 (right-hand ones 16–128). A modifier alone is key 0xFF with its bits.
// The keys offered are the ones the official site's picker offers (PROTOCOL.md "Keyboard targets"),
// plus F13–F24, which the official picker doesn't offer and which are not tried on the controller yet.

export const MOD_ONLY = 0xff;
export const MODS = [
  { bit: 1, label: "Ctrl" },
  { bit: 2, label: "Shift" },
  { bit: 4, label: "Alt" },
  { bit: 8, label: "Win" },
];
// Right-hand modifiers come from a profile made elsewhere; this app writes the left bits only.
const MODS_R = [
  { bit: 16, label: "R Ctrl" },
  { bit: 32, label: "R Shift" },
  { bit: 64, label: "R Alt" },
  { bit: 128, label: "R Win" },
];

// [event.code, HID usage, label], grouped as the list picker shows them.
const ROWS = [
  ["ฟังก์ชัน", [["Escape", 41, "Esc"], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 58 + i, `F${i + 1}`])]],
  ["F13–F24", Array.from({ length: 12 }, (_, i) => [`F${i + 13}`, 104 + i, `F${i + 13}`])],
  ["ตัวเลข", [["Backquote", 53, "`"], ...Array.from({ length: 9 }, (_, i) => [`Digit${i + 1}`, 30 + i, `${i + 1}`]), ["Digit0", 39, "0"], ["Minus", 45, "-"], ["Equal", 46, "="], ["Backspace", 42, "Backspace"]]],
  ["ตัวอักษร", [
    ...[..."QWERTYUIOP"].map((c) => [`Key${c}`, 4 + c.charCodeAt(0) - 65, c]),
    ["BracketLeft", 47, "["], ["BracketRight", 48, "]"], ["Backslash", 49, "\\"],
    ...[..."ASDFGHJKL"].map((c) => [`Key${c}`, 4 + c.charCodeAt(0) - 65, c]),
    ["Semicolon", 51, ";"], ["Quote", 52, "'"],
    ...[..."ZXCVBNM"].map((c) => [`Key${c}`, 4 + c.charCodeAt(0) - 65, c]),
    ["Comma", 54, ","], ["Period", 55, "."], ["Slash", 56, "/"],
  ]],
  ["ควบคุม", [["Tab", 43, "Tab"], ["CapsLock", 57, "Caps Lock"], ["Enter", 40, "Enter"], ["Space", 44, "Space"],
    ["Insert", 73, "Insert"], ["Delete", 76, "Delete"], ["Home", 74, "Home"], ["End", 77, "End"], ["PageUp", 75, "Page Up"], ["PageDown", 78, "Page Down"]]],
  ["ลูกศร", [["ArrowUp", 82, "Up"], ["ArrowDown", 81, "Down"], ["ArrowLeft", 80, "Left"], ["ArrowRight", 79, "Right"]]],
  ["Numpad", [["NumLock", 83, "Num Lock"], ["NumpadDivide", 84, "Num /"], ["NumpadMultiply", 85, "Num *"], ["NumpadSubtract", 86, "Num -"], ["NumpadAdd", 87, "Num +"],
    ...Array.from({ length: 9 }, (_, i) => [`Numpad${i + 1}`, 89 + i, `Num ${i + 1}`])]],
];

export const KEY_GROUPS = ROWS.map(([name, keys]) => ({ name, keys: keys.map(([code, key, label]) => ({ code, key, label })) }));
const ALL = KEY_GROUPS.flatMap((g) => g.keys);
const BY_CODE = new Map(ALL.map((k) => [k.code, k]));
const BY_KEY = new Map(ALL.map((k) => [k.key, k]));

// event.code of a modifier → its (left) bit.
export const MOD_CODE = {
  ControlLeft: 1, ControlRight: 1, ShiftLeft: 2, ShiftRight: 2,
  AltLeft: 4, AltRight: 4, MetaLeft: 8, MetaRight: 8, OSLeft: 8, OSRight: 8,
};

// F13–F24 (HID 104–115): outside the official picker, not confirmed on hardware.
export const isExtraKey = (key) => key >= 104 && key <= 115;

export const keyOfCode = (code) => BY_CODE.get(code) ?? null;
export const modsOfEvent = (e) => (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);

// The keycaps of a keyboard target, e.g. ["Ctrl", "Shift", "M"].
export function keyCaps(key, modifier = 0) {
  const caps = [...MODS, ...MODS_R].filter((m) => modifier & m.bit).map((m) => m.label);
  if (key !== MOD_ONLY) caps.push(BY_KEY.get(key)?.label ?? `คีย์ 0x${key.toString(16).toUpperCase().padStart(2, "0")}`);
  return caps;
}
export const keyLabel = (key, modifier) => keyCaps(key, modifier).join(" + ");

// What the firmware is given: a key in the HID keyboard range, or a modifier alone.
export function keyProblem(key, modifier = 0) {
  if (key === MOD_ONLY) return modifier ? null : "คีย์ 0xFF ต้องมี Ctrl, Shift, Alt หรือ Win อย่างน้อย 1 ตัว";
  if (!(key >= 4 && key <= 0xe7)) return `คีย์ 0x${key.toString(16)} ไม่ใช่คีย์บอร์ด`;
  return null;
}
