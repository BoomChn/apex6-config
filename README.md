# Apex 6 Config

An unofficial web app for reading the configuration of a Flydigi Apex 6 Pro controller over WebHID.

> **Unofficial.** This project is not affiliated with or endorsed by Flydigi. "Flydigi" and "Apex" are trademarks of their owner. The protocol notes in `PROTOCOL.md` were written independently for interoperability; no Flydigi code is included. The controller photos in `assets/` are retailer press shots (MaxGaming) used to label the buttons.

## Status

The UI follows the v2 "Manual" design: a real photo of the controller with numbered leader lines, ink for values already on the controller and cobalt for edits not yet written.

- Read: device info, the 4 slots, the active slot (sticks, triggers, gyro, vibration motors, remaps, macros), live stick and trigger input, RAM dump, packet log.
- Write to the active slot: stick deadzone, max range, invert X/Y and round edge; trigger start and end; gyro mode and invert; grip vibration on/off and level 1–5; trigger-bound grip feedback strength (profile) and on/off (0x53, RAM 0x06); long-press and double-press timing; the profile name (TLV 0x20, v1.9 profiles); button maps in every layer, keyboard keys included (a box takes the key you press, `keys.js`); macros from the library (below); RGB lighting of the slot (RAM 0x04: mode, colors, brightness, speed, vibration sync); colors made with "สร้างสีเอง" (picker + hex) are kept in the browser for every slot, up to 6, deleted with a long press, right click or Delete, written after the profile and read back. A write of lighting alone leaves the profile as it is. Restore from a backup or an imported `.bin`.
- Names: the app keeps the full name per controller (by UUID) in the browser and writes the part that fits (40 bytes, our own cap) to the controller. Other slots can be renamed in the app and written once they are in use. If the controller's name changes elsewhere, the app shows it and offers its own name back instead of overwriting. Names can be exported and imported as JSON on Device & backup (`names.js`).
- Macros: the app keeps one macro library in the browser for all slots (`macros.js`), and a button in any layer can play any of them. A write puts a copy of each macro into every layer whose buttons play it (8 at most per layer, the controller's limit), updates copies of macros edited since, and removes copies no button plays any more (they stay in the library). Copies on the controller are linked back to the library by their bytes; macros the controller has that the library lacks are taken into it when a slot is read. The library can be exported and imported as JSON on the Macros page.
- Every write re-reads the slot, downloads a backup, writes, and reads back to compare byte for byte.
- Everything else (curve presets, the on-controller screen, input mode) can be edited on screen but stays a draft. The write review lists those drafts separately as "ยังเขียนลงจอยไม่ได้" and never sends them.
- Slot switching uses 0xA2, which is not yet tested on hardware. The app asks before it sends it.
- Experimental: the write path is tested against a mock device. Keep the backup files.

## Use

Open the GitHub Pages site in Chrome or Edge (WebHID requires a Chromium browser), click connect, and pick the controller.

Add `?demo` to the URL to try the whole app without a controller. It runs an in-memory mock (`mock-device.js`) that serves a real slot capture, so writes, backups and slot switching all work there and never touch hardware.

## Develop

No build step. Serve the folder over localhost:

```sh
python -m http.server 5178
```

Then open <http://localhost:5178>. Run tests with `node test.mjs`.
