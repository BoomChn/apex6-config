# Apex 6 Config

An unofficial web app for reading the configuration of a Flydigi Apex 6 Pro controller over WebHID.

> **Unofficial.** This project is not affiliated with or endorsed by Flydigi. "Flydigi" and "Apex" are trademarks of their owner. The protocol notes in `PROTOCOL.md` were written independently for interoperability; no Flydigi code is included. The controller photos in `assets/` are retailer press shots (MaxGaming) used to label the buttons.

## Status

The UI follows the v2 "Manual" design: a real photo of the controller with numbered leader lines, ink for values already on the controller and cobalt for edits not yet written.

- Read: device info, the 4 slots, the active slot (sticks, triggers, gyro, vibration motors, remaps, macros), live stick and trigger input, RAM dump, packet log.
- Write to the active slot: stick deadzone, max range, invert X/Y and round edge; trigger start and end; gyro mode and invert; motor on/off and max strength; long-press and double-press timing. Restore from a backup or an imported `.bin`.
- Every write re-reads the slot, downloads a backup, writes, and reads back to compare byte for byte.
- Everything else (button remaps, macros, curve presets, lighting, the on-controller screen, input mode) can be edited on screen but stays a draft. The write review lists those drafts separately as "ยังเขียนลงจอยไม่ได้" and never sends them.
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
