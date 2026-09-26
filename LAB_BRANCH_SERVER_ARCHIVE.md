# LAB MATRIX · shared Branch archive v1.8.0

The authoritative Branch archive is `branch-archive-top3.json` in GitHub `main`.

- Browser no longer reads/writes `pozitron.lab.branch.archive.v1`.
- GitHub Actions recalculates every 5 minutes and on `top3-live.json` updates.
- Pending server frozen is immutable: prediction/source/D/S/savedAt are not rewritten after the target fact arrives.
- When the fact appears, only fact/result/matched/closedAt are appended.
- The same JSON archive is loaded by phone and desktop.
- Browser may show a non-persistent preview while waiting for the next server freeze; previews are never added to the archive.
- UI preferences remain local; archive data does not.
