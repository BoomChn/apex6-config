# Apex 6 Pro config app

The owner is Thai-speaking and non-technical, and tests on their own controller. Reply in Thai.
Read PROTOCOL.md before touching anything that writes to the controller.

## Before every merge or update (required)

The owner hit the same layer bug twice: the second time, a fact already in PROTOCOL.md had only
been half applied. So every change that can reach the controller goes through these steps:

1. **Hardware facts are code, not only notes.** For each fact in PROTOCOL.md the change touches,
   check that `checkProfile()` in mapping-edit.js enforces it. When the hardware teaches us
   something new, add a rule to `checkProfile()` and a test that breaks it, in the same change.
   Then think through the edge cases of the fact itself, not only the case that was reported
   (example: "layers are found by position" also means no gaps in layer ids, not only sorted).
2. **Run the tests:** `ELECTRON_RUN_AS_NODE=1 "$LOCALAPPDATA/Programs/cursor/Cursor.exe" test.mjs`
   (there is no node on PATH). The pre-push hook in `.githooks/` runs them too; it needs
   `git config core.hooksPath .githooks` once per clone.
3. **Try the flow in the demo** (`?demo`, mock controller) through the real UI: make the edit,
   open the write review, write, and check what the app shows after the read-back.
4. **Tell the owner what was not tried on the real controller**, and give click-by-click steps to
   try it (joy.cpl for buttons). Fields confirmed on hardware go into `HW_TESTED`, nothing else.
5. Don't ask the owner for data on something PROTOCOL.md already answers.
