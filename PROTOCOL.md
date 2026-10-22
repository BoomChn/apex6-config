# Flydigi Apex 6 Pro (GPA6) — HID protocol notes

Source: `vendor-gpa6-core-*.js` and `vendor-gpa6-codec-*.js` from space_station.flydigi.com (2026-10-21). Read-path verified on a real Apex 6 Pro (SKU "GPA6 Pro") on 2026-10-21.

## Transport
- WebHID filter: VID `0x37D7`, PID `0x2502` or `0x2401`, usagePage `0xFFA0`.
- Output: report ID and size are taken from the first output report of the `0xFFA0` collection (default ID 0, 63 bytes). Frame is zero-padded.
- Max frame 32 bytes. Request/response is serialized; timeout 1500 ms, 3 retries.

## Framing
Request: `5A A5 <cmd> <len=payload+2> <payload…> <sum>`
`sum` = byte sum of bytes from `cmd` through the last payload byte, mod 256.

Reply v1: `5A A5 <cmd> <pkgCount> <pkgIndex> <payload…> <sum>`. `pkgCount == 0` means error and `payload[0]` is the error code.
Reply v2.1 (for 0xA3/0xA4): `5A A5 <cmd> <payload…> <sum>`.
Replies are zero-padded, so find the end by scanning for a valid checksum.

## Commands
| cmd | name | payload → reply |
|---|---|---|
| 0x01 | device info | → deviceId u8, connMode u8, mac u32le, battery(lo4)/charging(hi4), chipMain/Recv nibbles, gyroType, pad, 7× fw u16**be** (main, recv, si, trigger, screen, adc, sstar), feature flags u8 (imu, led, switch, screen, trigHaptic, trigVibrate, audio, haptic) |
| 0x04 | UUID | → 16 bytes |
| 0x07 | config versions | → global u16le, mapping u16le, led u16le |
| 0x0F | SKU | → u8 value, 20-byte name |
| 0x10 | third-party takeover status | → `[0]` active, `[4]` allowThirdparty |
| 0x11 | set input modes (no ack) | xinput, dinput, keyboard, mouse, allowThirdparty (0xFF = unchanged) + 22 zero bytes |
| 0x20 | text command | ASCII |
| 0x21 | (input) log line | ASCII, NUL-terminated |
| 0x53 | effect test? | area, target, mode, params… |
| 0xA0 | set device config field | fieldId, data… → status (0 ok, 1 ERR, 2 ERR_LEN, 3 ERR_UNKNOWN). Known field IDs: 0x01 0x14 0x17 0x19 0x20 0x21 0x22 0x25 0x26 |
| 0xA1 | slot status | → activeSlot u8, 4× slot crc16, global crc16 |
| 0xA2 | switch profile | cfgId → same layout as 0xA1 |
| 0xA3 | RAM read (v2.1) | op 0 READ_CHUNK `[0, ramId, idx, size=16]` → `[0, status, ramId, activeSlot, totalLen u16, idx, size, data…]`; op 1 INFO `[1, ramId]` → status, ramId, slot, len u16, crc32 |
| 0xA4 | RAM write (v2.1) | all LE. op 0 FULL_BEGIN `[0, ramId, len u16, crc32 u32]`; 1 CHUNK `[1, offset u16 (bytes), n, data…]` (client uses n=16, no ramId); 2 COMMIT `[2, len u16, crc32 u32]` (no ramId); 3 ABORT `[3]`; 0x10 DELTA_BEGIN, 0x11 DELTA_SPLICE. Reply `[op, status, ramId, …]`, matched on op + ramId; COMMIT reply adds activeSlot, len u16, crc32 u32 and counts as success when len+crc match. |
| 0xA7 | apply/commit config | `[1, cfgId]`. Not sent by the official client after a write (debug only); a COMMIT takes effect on its own. |
| 0xAC / 0xAD | LCD settings get / set | |
| 0xAF | ? per cfgId | |
| 0xEF | (input) live stick stream | 32-byte frame: `5A A5 EF`, LX LY RX RY i16le, buttons u32le (bit order unknown), LT u8 at byte 15, RT u8 at byte 16 (0 released, 0xFF full; physical travel before the trigger curve: half press reads 0x80 even with the end point at 128; found on hardware 2026-10-22, the official site ignores them), bytes 17..30 unknown, sum8 of bytes 2..30 at byte 31. The sticks here are the physical sticks only: with gyro → right stick, tilting moved Rx/Ry in joy.cpl but not RX/RY here (hardware, 2026-10-22). The gyro's effect shows on the XInput pad (joy.cpl), but Chrome's Gamepad API lists no pad at all on the owner's PC (2026-10-22), so the app cannot show it. Bytes 17..28 are six i16le. 17–18 yaw rate (steering-wheel turn), 19–20 pitch rate, 21–22 roll rate: each motion put 67–87% of its 3 s total on its channel (hardware, 2026-10-22). Rates sit near 0 at rest. Signs (hardware, 2026-10-22): yaw positive turning right, pitch positive tilting up, roll positive with the right grip going down. 23–28 look like the accelerometer: 27–28 reads ≈4600 lying flat, and the reading moves to 25–26 when tilted. The official site turns it on with 0x11 dinput=1 (others 0xFF) and off with dinput=0. |

Key events: 0x20 `"ENABLE_KEY_EVENT"` / `"DISABLE_KEY_EVENT"`. The controller then sends 0x21 lines such as `KEY_DOWN GP_A` and `KEY_UP GP_A`. Other lines: `SLOT_CHANGED n`, `CAL_BEGIN`, `CAL_END`, `STICK_L_READY`, `TRIG_L_READY`, `MACRO_REC_START`, `PAIR_CLEARED`. Key names in the official table: DPAD_UP/RIGHT/DOWN/LEFT, A, B, X, Y, SELECT, START, LB, RB, LT, RT, THL, THR, C, Z, M1–M6, MENU, MODE, BACK, HOME, KEYW/A/S/D. The names LM/RM report are not yet known.
| 0xFE | ? | value u8 → u8 |

## RAM regions
- `0x01` global config. The official client uses bytes `[2, 82)`.
- `0x05` mapping (active slot). Wrapped as `len u16le` (whole buffer incl. this 4-byte header), `crc16 u16le` (CCITT-FALSE: poly 0x1021, init 0xFFFF, over the blob only), blob. Writes send the wrapped form. Blob magic is `XMUL`, versions 1.7, 1.8 and 1.9. The codec is in `vendor-gpa6-codec-*.js`.
- `0x04`, `0x06` are still unknown. One of them is probably lighting (magic `LGHT`).
- Write CRC is CRC-32 (IEEE) over the whole wrapped buffer. 0xA3 INFO `[1, ramId]` returns the same len + crc32 for the current buffer.

## Verified on hardware (2026-10-21)
- 0x01, 0x04, 0x07, 0x0F, 0xA1, and 0xA3 reads for RAM 0x01 and 0x05 all reply as documented.
- The 0xA1 per-slot CRC16 equals the CRC16 in the RAM 0x05 wrapper for the active slot. The CRC can tell you whether a slot changed without reading it.
- RAM 0x01 (82 bytes) contains the ASCII strings "Flydigi" and " APEX 6 Pro" plus a few settings bytes.

## Mapping blob (XMUL)
```
"XMUL" u32 version(8|9) u8 slot_count=1 pad3
u16 long_ms u16 double_ms pad4
pad4 u8 layer_count pad3
layer × layer_count:
  u8 layer_id pad1 u16 map_count u16 macro_count pad2
  map × map_count: u8 src_btn u8 n pad2, n × (u8 activator_type, target[4])
  macro × macro_count: u8 id u8 trigger_mode u16 loop_ms u8 n pad1, n × (u8 press/release, target[4], u16 t_ms)
  trigger_zones L/R: u8 present [u8 n, n × (start, stop, target[4])]
  stick_zones L/R:   u8 present [u8 angle_mode, u8 n, 8 × (start, stop, dir, target[4])]
TLV until (0xFF,0x00):
  1/2 stick (12B: curve11 + flags invX|invY|round)
  3/4 trigger (curve11)
  5 gyro (24B: curve11, flags, mode, 4×(activation, btn), axis_x, axis_y, mouse_radius)
    axis values 0 none, 1 imu_x, 2 imu_y, 3 imu_z. imu_x = yaw (steering-wheel turn), imu_y = pitch: with axis_x=imu_x, axis_y=imu_y
    and gyro → right stick, yaw moved only Rx and pitch only Ry in joy.cpl (hardware, 2026-10-22). Roll moved both, so the
    firmware may mix roll in; imu_z = roll is inferred, not tested. Same order as the 0xEF rate channels.
    Offsets in the 24 bytes: curve 0–10 (start_x 0, end_x 2), flags 11, mode 12, activation 13–20 as 4 × (0 hold | 1 toggle,
    button id), an empty slot is (0, 0xFF), axis_x 21, axis_y 22, mouse_window_radius 23 (sample profile: 32). The app writes all
    of them; only mode is confirmed on hardware.
    The official web app (GyroBody-*.js, 2026-10-22) shows these as percents, p = round(byte / 2.55), byte = round(p * 2.55):
    stick modes: sensitivity = 100 − end_x%, dead zone = start_x% (start_y set to 0), end_y kept at 255;
    mouse mode: sensitivity = end_y%, "Mouse Dead Zone" = mouse_window_radius%, end_x kept at 255.
    Picking a mode from "off" on an untouched linear curve gives end_x 145 (stick) or start_x 4, end_y 51 (mouse); picking a
    mode also resets axis_x/axis_y to imu_x/imu_y there. Its schema needs 1–4 activation slots (default: hold A).
    Its Advanced page edits the gyro curve directly: Curve Dead Zone = start_x, Dead Zone Compensation = start_y, Maximum
    Output Start = end_x, Maximum Output = end_y (each as %), up to 2 mid points as raw x/y; one hold/toggle for all slots,
    a primary and a secondary button. The owner's slot 2 (2026-10-22): 1%, 1%, 100%, 100%, mid point (29, 230), so output
    is ~90% by input 29 and the Basic sensitivity (end_x) barely changes anything.
  6/7 trigger vibration (12B: pad + curve11), 8/9 motor (12B: enabled + curve11)
  0x20 metadata (v1.9): u8 nameLen name u8 n, n × (layer, macro, len, name)
curve11 = start_x start_y end_x end_y mid_count (x,y)×2 pad2   (0..255 scale)
Macros are per layer: ids 0–7 repeat across layers, and a macro target (type 30) in a layer's button map means the macro of that same layer. Adding or removing one changes the blob length (macro_count, the entries, and the 0x20 name entry); ids are not renumbered. mapping-edit.js does it with `macro.<layer>.<id>.set` (add, or replace in place) / `.delete`. The app keeps its own macro library and copies a macro into each layer that plays it (macros.js).
Layers: layer_count is 1–4 (u8 at blob offset 24). Layer 0 is the base. The official app gives a new layer the first free id of 1–3, appends it after the last layer (12 bytes: id, pad, 0 maps, 0 macros, pad2, four zone blocks with present=0), and can delete any layer except 0. A layer_hold target works on a simple or timing_long activator; timing_double can only use layer_toggle. mapping-edit.js does it with `layer.<id>.new` / `.delete`, and writes button maps with `map.<layer>.<button>.<simple|long|double>`. Deleting a layer also drops the presses in other layers that switched to it. **Verified on hardware 2026-10-22: the firmware finds a layer target by its position in the blob, not by layer_id.** A slot the official app had left as 0, 2, 3, 1 sent "hold → layer 2" to layer 3; after storing the sections as 0, 1, 2, 3 it reached layer 2. So ids must also run 0, 1, 2, … with no gap: in a profile with layers 0, 2, 3, "layer 2" is the third section, layer 3. mapping-edit.js (normalizeLayers) sorts the layers and numbers them again from 0 on every write, moving the layer of each hold/toggle and of each macro name along.
target[4] = type + 3 bytes (0 gamepad btn, 1 key, 2 mouse, 3 consumer, 10 turbo, 20/21 layer hold/toggle, 30 macro, 40–46 simulate)
Button IDs: A B X Y LB RB Back Start LS RS Up Down Left Right C Z M1–M6 LT RT (0..23), 0xFF = none. On the Apex 6 Pro, M5 = LM and M6 = RM: Flydigi Space Station's key-name table maps ControllerKey_M5 to "LM" and M6 to "RM". Confirmed on hardware 2026-10-22: remapping LM/RM works.
```
