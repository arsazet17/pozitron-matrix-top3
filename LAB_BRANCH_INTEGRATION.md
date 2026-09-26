# LAB MATRIX — Branch v1.7.1

Integrated as an isolated LAB MATRIX module.

- Primary engine: D1–D7, S−2…S+2.
- Strict invariant: D determines source date; S determines source time.
- Frozen record is written before the target draw and is never rewritten after the fact.
- Fact closure records 0/2, 1/2, 2/2 and matched digits.
- Separate localStorage namespace: `pozitron.lab.branch.archive.v1`.
- Arrow view is optional and off unless the user opens it.
- Slots are reserved for `Steps` and `Three columns`; no shared engine/archive state.
- D8–D14 is observation-only as an extended thread and does not replace the primary D1–D7 forecast.
- Legacy LAB runtime remains hidden in DOM only for compatibility with existing app code.

Control command: `node test-lab-branch.mjs`.
