# Import conflict prompts bypassed by native file drops

> Date: 2026-10-13
> Branch: `dev`
> Status: implementation complete; focused verification and user acceptance passed.

## Report

The user reported that imports with duplicate content no longer showed a conflict dialog, although Settings showed no remembered default. The remembered preference was not the cause: the import dialog is bypassed earlier for some native file drops.

## Root cause

Commit `39ec904b` added `asset.resolve-dropped-paths.request` and used it in the canvas and sidebar drop handlers. The Worker maps exact managed or linked asset paths to asset IDs. Callers treated any returned ID as proof that the drop was a Serpent internal drag, then consumed the drop as a move, collection assignment, or trash action instead of calling the import pipeline. That conflated file path identity with drag origin.

As a result, dropping an already indexed file path from Finder/Explorer could skip name/content conflict detection. In batches, the resolver returns only matched IDs; checking only for a non-empty result could also consume or partially apply the batch and discard unmatched files.

Commit `835984c7` later added an internal drag phase to suppress the external-import overlay while Serpent's OS-native drag is active. The phase was not connected to the path resolver branches, so external and internal native file drops remained indistinguishable there.

## Change

- Gate path resolution on the active Serpent-initiated asset-drag phase in the canvas and sidebar targets.
- Defer clearing the drag phase until after React's bubbling `drop` handlers have observed it.
- Consume a resolved native drop as an internal drag only when every dropped file maps to an asset. Partial matches continue through import handling.
- Keep external drops on managed folders, linked folders, and collections on their import paths; external drops on trash do not move assets to trash.
- Rename the Settings entry to “记住的默认行为” / “Remembered defaults” and update its hint and empty state.
- Update `IMPORT-007` and `IMPORT-008` to await retest and add `IMPORT-DROP-001` for external versus internal native drag behavior.

## Verification

- `npx vitest run --config vitest.config.ts tests/unit/external-import-transfer.test.ts tests/unit/navigation-sidebar.test.ts` — 2 files, 39 tests passed.
- `npx eslint src/renderer/external-import-transfer.ts src/renderer/use-external-import-handlers.ts src/renderer/NavigationSidebar.tsx src/renderer/App.tsx src/renderer/i18n/catalogs/en.ts src/renderer/i18n/catalogs/zh-CN.ts tests/unit/external-import-transfer.test.ts tests/unit/navigation-sidebar.test.ts` — no errors; two exhaustive-deps warnings in unrelated `App.tsx` hooks.
- `npx tsc --noEmit` — passed.
- User acceptance on 2026-10-13 — passed for duplicate-content and same-name conflict behavior after the `39ec904b` regression fix (`IMPORT-007`, `IMPORT-008`, `IMPORT-DROP-001`).
