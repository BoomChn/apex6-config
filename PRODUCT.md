# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person: the owner of a Flydigi Apex 6 Pro (SKU "GPA6 Pro"). They sit at a desktop PC, plug the controller in over USB, and change settings between gaming sessions in Chrome or Edge (WebHID). They test on their own hardware and read packet logs when something goes wrong.

## Product Purpose
A personal replacement for the official setup site (space_station.flydigi.com). It reads and writes the controller's 4 on-device profile slots and its global settings. Success means the owner can change a setting, write it to the controller, and trust that what is on the controller matches what the screen shows.

## Positioning
It fixes three failures of the official site:
1. Macros and profiles can be renamed.
2. There is no separate config library, so applying a config never duplicates it. The 4 device slots are edited directly.
3. The vibration test waits for the controller's ack and shows an error when the ack doesn't arrive.

It also keeps the sync state visible at all times and verifies every write with a CRC check.

## Operating Context
- Desktop browser only (Chromium, https or localhost). The controller is connected over USB.
- Setup sessions are short and happen between play sessions.
- The owner keeps file backups of the profile blob before each write.

## Capabilities and Constraints
- The protocol is documented in PROTOCOL.md. Read paths are verified on hardware. The stick deadzone write, with backup, verify and restore, is implemented (commit a77df7e).
- Physical buttons: the Apex 6 Pro has 4 back buttons, M1–M4. It has no M5/M6 and no C/Z (the owner confirmed this on 2026-10-21). Seen from the back, the left of the image is the right hand: M1 is upper right, M3 lower right, M2 upper left, M4 lower left. This matches the k6 back hotspots in the official site bundle and the M1/M3 and M2/M4 labels moulded on the shell. It also has LM and RM (owner confirmed 2026-10-22): the small blocks on the shoulders just inboard of each trigger, with RM/LM moulded on the shell. Their protocol IDs are not yet known. C/Z in the official visualizer are not on this controller. `mapping.js` still lists the generic protocol IDs.
- The design covers these feature areas: profiles (4 slots), buttons, macros, sticks, triggers, gyro, vibration, lighting and the on-controller screen, device info and backups, and the write review.
- Firmware update must never be implemented.
- Do not redistribute Flydigi's code. Using product photos is acceptable in personal design mocks. Treat Flydigi assets in the shipped app as a decision the owner makes.
- Open protocol questions are listed in the Paper spec sheets.

## Brand Commitments
None beyond the product name "Apex 6 Pro". The UI copy is mostly Thai, and English control names (LB, RT, M1…) are kept.

## Evidence on Hand
- A real profile sample: `samples/mapping_slot2.bin`. It is slot 2 of the owner's controller: deadzone 13/255, gyro off, 2 macros.
- Product photos, as references:
  - From the official site bundle: `main-ClMfBJqU.png`, `back-CqOGHF41.png` (492×340, transparent).
  - Retailer press shots from MaxGaming: front, back and side at 1600×1280 on white.

## Product Principles
1. What the screen shows must match the controller. Pending edits and sync state are never hidden.
2. Edit the device directly. Don't add a library layer between the user and the slots.
3. Every write is reversible: back up, verify, restore.
4. Make every action respond. A control that can't confirm its effect says so.
