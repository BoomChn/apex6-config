# Apex 6 Config

An unofficial web app for reading the configuration of a Flydigi Apex 6 Pro controller over WebHID.

> **Unofficial.** This project is not affiliated with or endorsed by Flydigi. "Flydigi" and "Apex" are trademarks of their owner. The protocol notes in `PROTOCOL.md` were written independently for interoperability; no Flydigi code or assets are included.

## Status

- Read: device info, profile slots, the current profile (sticks, triggers, gyro, remaps, macros), live input, RAM dump.
- Write: stick deadzone of the active profile, plus restoring a profile from a backup `.bin`. Every write re-reads the profile first, downloads a backup, and reads the result back to compare byte-for-byte.
- Experimental: the write path is tested against a mock device. Keep the backup files.

## Use

Open the GitHub Pages site in Chrome or Edge (WebHID requires a Chromium browser), click connect, and pick the controller.

Add `?demo` to the URL to view a sample profile without a controller.

## Develop

No build step. Serve the folder over localhost:

```sh
python -m http.server 5178
```

Then open <http://localhost:5178>. Run tests with `node test.mjs`.
