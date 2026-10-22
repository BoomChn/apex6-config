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
| 0xEF | (input) live stick stream | 32-byte frame: `5A A5 EF`, LX LY RX RY i16le, buttons u32le (bit order unknown), LT u8 at byte 15, RT u8 at byte 16 (0 released, 0xFF full; physical travel before the trigger curve: half press reads 0x80 even with the end point at 128; found on hardware 2026-10-22, the official site ignores them), bytes 17..30 unknown, sum8 of bytes 2..30 at byte 31. The official site turns it on with 0x11 dinput=1 (others 0xFF) and off with dinput=0. |

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
  6/7 trigger vibration (12B: pad + curve11), 8/9 motor (12B: enabled + curve11)
  0x20 metadata (v1.9): u8 nameLen name u8 n, n × (layer, macro, len, name)
curve11 = start_x start_y end_x end_y mid_count (x,y)×2 pad2   (0..255 scale)
Macros are per layer: ids 0–7 repeat across layers, and a macro target (type 30) in a layer's button map means the macro of that same layer. Adding or removing one changes the blob length (macro_count, the entries, and the 0x20 name entry); ids are not renumbered. mapping-edit.js does it with `macro.<layer>.<id>.new` / `.delete`.
Layers: layer_count is 1–4 (u8 at blob offset 24). Layer 0 is the base. The official app gives a new layer the first free id of 1–3, appends it after the last layer (12 bytes: id, pad, 0 maps, 0 macros, pad2, four zone blocks with present=0), and can delete any layer except 0. A layer_hold target works on a simple or timing_long activator; timing_double can only use layer_toggle. mapping-edit.js does it with `layer.<id>.new` / `.delete`, and writes button maps with `map.<layer>.<button>.<simple|long|double>`. Deleting a layer also drops the presses in other layers that switched to it. **Verified on hardware 2026-10-22: the firmware finds a layer target by its position in the blob, not by layer_id.** A slot the official app had left as 0, 2, 3, 1 sent "hold → layer 2" to layer 3; after storing the sections as 0, 1, 2, 3 it reached layer 2. mapping-edit.js sorts the layers by id on every write that touches buttons or layers.
target[4] = type + 3 bytes (0 gamepad btn, 1 key, 2 mouse, 3 consumer, 10 turbo, 20/21 layer hold/toggle, 30 macro, 40–46 simulate)
Button IDs: A B X Y LB RB Back Start LS RS Up Down Left Right C Z M1–M6 LT RT (0..23), 0xFF = none. On the Apex 6 Pro, M5 = LM and M6 = RM: Flydigi Space Station's key-name table maps ControllerKey_M5 to "LM" and M6 to "RM". Confirmed on hardware 2026-10-22: remapping LM/RM works.
```
