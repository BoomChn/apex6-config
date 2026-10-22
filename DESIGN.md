---
name: Apex 6 Pro Config
description: A personal WebHID config app for the Flydigi Apex 6 Pro, laid out like the controls page of a console instruction manual.
colors:
  ground: "#FFFFFF"
  ink: "#111111"
  ink-secondary: "#5C5C5C"
  ink-tertiary: "#8A8A8A"
  hairline: "#E2E2E2"
  keycap-border: "#CFCFCF"
  cobalt: "#2140D9"
  cobalt-tint: "#EDF0FC"
  cobalt-tint-faint: "#F5F7FE"
  ok: "#1F8A4C"
  error: "#C0262D"
  warn: "#9A4A06"
  disabled-fill: "#E6E6E6"
  disabled-fill-soft: "#EEEEEE"
  disabled-text: "#6B6B6B"
  log-ground: "#111111"
  log-text: "#E8E8E8"
  scrim: "rgba(17,17,17,0.55)"
typography:
  display:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: "40px"
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "22px"
    fontWeight: 700
  title:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  numeral-row:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "56px"
    fontWeight: 700
    letterSpacing: "-0.03em"
  numeral-tab:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "30px"
    fontWeight: 700
  tab:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  body:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  label:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  meta:
    fontFamily: "Bai Jamjuree, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 600
rounded:
  none: "0px"
  control: "6px"
  dialog: "10px"
spacing:
  gutter: "40px"
  editor-column: "460px"
  top-bar: "64px"
  tab-row: "49px"
  row: "52px"
  row-slot: "100px"
  row-vibration: "104px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "40px"
  button-disabled:
    backgroundColor: "{colors.disabled-fill}"
    textColor: "{colors.disabled-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
  slot-tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.numeral-tab}"
    rounded: "{rounded.none}"
    height: "{spacing.top-bar}"
  keycap:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    width: "70px"
    height: "44px"
  keycap-selected:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.ground}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    width: "70px"
    height: "44px"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
  inset:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.none}"
    width: "96px"
    height: "64px"
  dialog:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
  packet-log:
    backgroundColor: "{colors.log-ground}"
    textColor: "{colors.log-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
---

# Design System: Apex 6 Pro Config

## Overview

**Creative North Star: "The Controls Spread"**

Each screen reads like the "Controls" page of a console instruction manual. A real Apex 6 Pro press photo sits on the page's own white ground, and thin ink leader lines run from each physical button out to a label saying what that button does on this slot. Everything around the photo is set in two-colour print: ink for what is already on the controller, one cobalt spot ink for what has changed and has not been written yet.

Information sits on ruled pages, not on panels. Heavy 3px ink rules open sections, hairlines separate rows, and tables and lists replace card grids. The density is that of a reference manual: compact rows of 52px, tabular mono values aligned right, and short Thai labels with the English control names (LB, RT, M1) kept as they are moulded on the shell.

The system is light only. It is a desktop tool used at a desk between play sessions, and pure white matches the press photo backgrounds, so the photo has no visible edge.

**Key Characteristics:**
- Pure white ground shared with the product photos.
- Ink #111 type, 1px leader lines, 3px section rules.
- One cobalt spot ink, reserved for pending edits, the selection being edited, and the action that talks to the controller.
- Ruled lists and tables, never cards.
- Bai Jamjuree for words, JetBrains Mono for values.
- Square insets and rectangles; small 6px radius only on things you press or type into.

## Colors

A two-colour print palette: ink on white, plus one cobalt spot ink and three small status inks.

### Primary
- **Cobalt Spot Ink** (`cobalt`): the only accent. It marks pending edits that have not reached the controller (callout labels, row values, tab badge counts, the "→ new value" side of the write review), the item currently being edited (the selected keycap, the selected callout's 2px line and ring, a focused input's border), and the filled button for the action that talks to the controller now: "เขียนลงจอย", read-back after a failed write, and a running vibration test.
- **Cobalt Wash** (`cobalt-tint`, `cobalt-tint-faint`): very light cobalt grounds, used sparingly behind a selected timeline track and the deadzone band of a curve being edited. Never a panel fill.

### Neutral
- **Page White** (`ground`): every surface, including the dialog. It is the photo's own background.
- **Manual Ink** (`ink`): text, 1px leader lines, 3px section rules, the 3px active-tab underline, the active slot block, checked checkboxes, and slider fills.
- **Secondary Grey** (`ink-secondary`): subtitles, descriptions, the "old value" column.
- **Tertiary Grey** (`ink-tertiary`): inactive slot numerals, disabled values, placeholders.
- **Hairline** (`hairline`): row separators, slider tracks, curve grids.
- **Keycap Edge** (`keycap-border`): the 1px border of unselected keycaps and small buttons.
- **Disabled** (`disabled-fill`, `disabled-fill-soft`, `disabled-text`): the write button when nothing is pending, and a test button whose channel is off.
- **Packet Log** (`log-ground`, `log-text`): the only dark surface, for raw packet logs.
- **Scrim** (`scrim`): behind the write review dialog.

### Status
- **Synced Green** (`ok`): "ตรงกับจอย" sync text, the USB connection dot, done-state check, "ใช้อยู่บนจอย".
- **Fault Red** (`error`): failed write top rule and icon, a vibration test with no ack, its retry outline.
- **Warn Umber** (`warn`): warning text such as "Slot 4 จะถูกเขียนทับ".

The LED swatch colours (#FF5A1F, #E0303A, #F2C230, #38B26B, #2F7BEA, #7A4BE0) are device data the user picks. They are not UI tokens and must never style the interface.

### Named Rules
**The Two-Colour Print Rule.** Ink means "on the controller". Cobalt means "changed here, not written yet", "being edited", or "talks to the controller now". If a cobalt element is none of these, it is wrong.

**The Photo Ground Rule.** The page is pure white because the photo is. Do not tint the ground or put the photo on a panel.

## Typography

**Display Font:** Bai Jamjuree (with sans-serif)
**Body Font:** Bai Jamjuree (with sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, monospace)

**Character:** Bai Jamjuree's squared Thai and Latin forms read like printed manual headings and keep one voice across both scripts. JetBrains Mono at 600 carries every number the controller reports, so values line up and read as data.

### Hierarchy
- **Display** (700, 34px, 40px line, -0.02em): the page title of each section ("Buttons", "Sticks").
- **Headline** (700, 22px): the editor title in the right column, such as "ปุ่มหลัง มือขวา · บน", and dialog titles.
- **Title** (700, 16px): section heads that sit on a 3px rule.
- **Numeral, row** (700, 56px, -0.03em): slot numbers in the Profiles slot table.
- **Numeral, tab** (700, 30px): slot numbers in the top bar.
- **Tab** (15px, 500 inactive, 700 active): section tabs and underline choice tabs.
- **Body / label** (500 to 700, 14 to 15px): row labels, callout values, button text.
- **Meta** (500, 12 to 13px): hints, legends, timestamps in prose, callout names (13px bold).
- **Mono** (600, 12 to 16px): values, units, hex, firmware, timestamps, packet log, CRC.

### Named Rules
**The Values Are Mono Rule.** Any number or code that came from or goes to the controller is set in JetBrains Mono. Words are never set in mono.

## Layout

The desktop frame is 1440×900 with 40px gutters. A 64px top bar holds device status, the four slot tabs, sync status and the write button. Under it, a 49px section tab row ends in a 1px ink rule. Feature sections that pair a photo with an editor put the photo stage on the left (about 60%, photo around 760px) and a 460px editor column at x=940. Row heights are 52px for editor rows, 100px for slot rows and 104px for vibration channel rows.

Sections open with a 3px solid ink rule under a title, with a right-aligned meta note on the same line. Tables use column heads in meta type above the rule.

- Gap: no responsive spec exists below 1280px.

## Elevation & Depth

The system is flat. Depth comes from rules, ink weight and the photo itself. The one lifted surface is the write review dialog, which sits on the scrim with a soft shadow. Its exact shadow value is not yet specified. Nothing else casts a shadow.

### Named Rules
**The One Modal Rule.** The write review is the only modal in the app and the only lifted surface. Everything else edits in place.

## Shapes

Small, firm corners (6px `control`) appear only on things you press or type into: buttons, inputs, selects, keycaps, segmented controls. The dialog uses 10px `dialog`. Photo insets, the slot block, the screen preview and the packet log are square (0px) rectangles. Strokes are 1px ink for structure, 2px cobalt for focus and selection, and 3px ink for section rules and active underlines. The only circles are callout dots and rings, slider thumbs, status icons and LED colour swatches. Photos are never masked to circles.

## Components

### Buttons
- **Shape:** gently squared (6px), 40 to 44px tall, label type.
- **Primary (cobalt):** cobalt fill, white text. Used for the action that talks to the controller: "เขียนลงจอย" with a white count badge holding the pending count in cobalt mono, read-back after a failure, and a running vibration test ("กำลังสั่น · หยุด").
- **Ink:** ink fill, white text, for local confirmations such as "เสร็จ", "คัดลอกไป Slot 4", and "แก้" on the active slot.
- **Outline:** white with a 1px border, ink text, for secondary row actions ("ใช้ slot นี้", "ทดสอบ 2 วิ", "···"). The error variant uses a red border and red text for retry.
- **Disabled:** grey fill and grey text, used for the write button when nothing is pending.
- **Text links:** underlined ink text for low-weight actions ("ยกเลิกการแก้", "คืนค่าเดิม", "กลับไปแก้").

### Top bar
Device name, a green USB dot with battery and firmware in mono, then four slot tabs with large numerals. The active slot is a solid ink block with white text and a status line ("ใช้อยู่บนจอย · กำลังแก้"). Sync status sits right: cobalt when edits are pending ("แก้ 5 จุด ยังไม่ได้เขียนลงจอย"), green when synced.

### Navigation (section tabs)
An underline tab row. The active tab is bold with a 3px ink underline. Pending counts follow the label as cobalt mono badges. Gyro shows its current value inline (cobalt when pending, grey "ปิด" when off). A small "ทั้งเครื่อง" label and a divider separate device-wide sections from per-slot ones.

### Choice tabs and segmented control
- **Underline tabs** are the default for modes and presets (curve presets, mapping type, lighting mode, layers). The active choice has a 3px ink underline, or cobalt text and underline when that choice is pending.
- **Segmented control** is used for a two-way view switch (ด้านหน้า / ด้านหลัง) and short value steps (screen timeout). It is a 1px ink outline with 6px corners. The selected segment is filled ink.

### Photo stage and callouts (signature)
A real Apex 6 Pro press photo, front or back, on white, never a drawing. Callouts are 1px ink leader lines ending in a 3.5px ink dot on the physical control, with a label pair in the margin: 13px bold name over the value. The selected or pending callout switches to a 2px cobalt line with a ring at the control and cobalt label text.
- Gap: no live LED preview on the photo.
- Gap: no side-view raster exists.

### Insets
Rectangular 96×64 photo crops with a 1px ink border and square corners. They identify a stick, trigger or motor next to its editor.
- Gap: on Sticks, Triggers and Vibration the insets have no leader back to a full photo.

### Keycap grid
70×44 keys with 6px corners and a 1px keycap-edge border. The selected key is filled cobalt with white text.

### Inputs / Fields
- **Style:** white, 1px ink border, 6px corners, body type. Selects carry a chevron.
- **Focus / pending:** 2px cobalt border.
- **Numeric fields:** ruled rather than boxed: label left, mono value and unit right, over a hairline.

### Slider and checkbox
- **Slider:** 2px hairline track with ink fill, 16px white thumb with a 2px ink border, mono value right-aligned above.
- **Checkbox:** 18px square, 1px ink outline, ink fill with a white tick when checked.

### Lists and tables
Ruled rows with hairline separators under a 3px ink head rule. No cards, no tinted panels.

### Write review dialog
The only modal. 10px corners on the scrim. Rows are grouped by slot and "ทั้งเครื่อง", each reading "ค่าบนจอย → ค่าใหม่": old value in secondary grey, arrow, new value in cobalt. Backup is shown as a fixed step, not an option. Actions are a text link "กลับไปแก้" and the cobalt "เขียนลงจอย".

### Write states
Each state opens on a 3px rule.
- **Writing:** checklist of steps (green check done, cobalt spinner current, grey ring pending) with byte progress in mono, and a cobalt progress bar on a hairline track.
- **Done:** green check, the CRC readback in mono, backup timestamp, ink "เสร็จ" button.
- **Failed:** red top rule and icon, a plain statement that the controller state is unknown, read-back as the cobalt primary, plus "ดู packet log" and restore-from-backup links.

## Do's and Don'ts

### Do:
- **Do** put the real Apex 6 Pro press photo on the pure white ground and point at controls with 1px ink leaders ending in a 3.5px dot.
- **Do** use cobalt only for pending edits, the item being edited, and the action that talks to the controller.
- **Do** open every section with a 3px ink rule and separate rows with hairlines.
- **Do** set every controller value, unit, hex code, firmware string, timestamp and CRC in JetBrains Mono 600.
- **Do** label unconfirmed protocol facts "ยังไม่ยืนยัน" in place, next to the value they qualify.
- **Do** show only back buttons M1 to M4. Seen from the back, the left of the image is the right hand.
- **Do** keep English control names (LB, RT, M1) in the Thai UI.

### Don't:
- **Don't** add a sidebar, card grids or tinted rounded panels.
- **Don't** draw a controller; use the press photo.
- **Don't** mask photos or avatars to circles.
- **Don't** add M5/M6 or C/Z buttons.
- **Don't** use LED swatch colours, or any colour other than the status inks, as UI accents.
- **Don't** add a second modal; edit in place.
- **Don't** add a dark theme; the system is light only.
