# Semantic SQLite Index Development Log

- Spec: `docs/internal/implementation/2026-10-13-semantic-index-sqlite-plan.md`
- Ticket: `Serpent-424d7b`
- Branch: `dev`
- Baseline: `b9604ac0` (local dev merged with `origin/dev` `6a9f8449`)
- Started: 2026-10-13
- Status: implementing; no acceptance claim

## Scope and current baseline

The local and HTTP indexers are currently Main-owned in-memory maps backed by
per-library JSON files under application data. Each encoded entry rewrites the
whole JSON file; searches copy the full map into JavaScript and sort cosine
scores in Main. Both indexers already keep profile/revision keys and use the
existing provider and permission flows. Current media preparation also reads
asset files in Main (HTTP images and local model image/audio input), which this
work must move behind bounded Worker-owned preparation.

The intended store is a separate library-relative
`.serpent/semantic/index.sqlite`, owned only by Library Worker. It uses normal
SQLite tables, little-endian Float32 BLOBs, versioned profile/revision identity,
jobs, and idempotent legacy import metadata. Query correctness remains exact
raw cosine with all matching results available to the existing progressive
browser. sqlite-vec 0.1.9 scalar functions are the intended primary query path;
an exact chunked Float32 fallback must preserve correctness if extension loading
fails, while such a fallback does not establish the latency target.

## Implementation stages

1. Add bounded, validated Worker commands and an isolated semantic database
   service; preserve the core catalog if the sidecar is missing or unusable.
2. Move local and HTTP vector persistence/ranking to the Worker. Main retains
   inference, provider credentials, grants, and model lifecycle, but no longer
   stores or ranks the corpus.
3. Move bounded text/image/audio source preparation into Worker-owned code;
   reject writes whose profile, library generation, asset, or source revision
   changed while inference ran. Add cancellation and bounded transaction tests.
4. Add legacy JSON migration, lifecycle recovery, and isolated 10k/20k+ query
   performance characterization. Keep full-media, provider, packaged, Windows,
   Computer Use, and core library-availability evidence distinct.

## Decisions and evidence

- Reuse the existing provider interfaces and raw-cosine ranking semantics.
- Keep the vector sidecar independent from `library.db`; no cross-database
  atomicity is assumed.
- Root agent owns ticket, proposal/ADR, review, QA report, and human checklist.
  This log and implementation/test changes belong to this implementation lane.
- Do not edit `.beads/issues.jsonl`, the proposal/research, or foreign
  untracked workspace content.

## Validation log

- `git pull --ff-only`: no updates; baseline remains `b9604ac0`.
- Required repository docs, the implementation plan, research, and ticket were
  read before implementation.
- Earlier focused store/provider/search run: 127 tests passed across five files
  (recorded by the implementation agent before this continuation).
- `node scripts/run-vitest-with-electron.mjs tests/unit/embedding-http-index.test.ts tests/worker/semantic-index-store.test.ts --reporter=verbose`:
  12 tests passed across two files after adding a library-generation handoff
  regression. An initial run exposed that the corrupt-sidecar mock also failed
  the deliberate close request; the mock was narrowed to fail only opening.
- 10,000-asset direct Worker retrieval benchmark, with real catalog entries,
  controlled precomputed vectors, and provider inference/IPC/UI excluded:
  768D first query 156.51 ms; candidate IDs 12.08 ms, source projection
  76.92 ms, vector scan 53.39 ms, score sort 12.72 ms; eight warm queries
  p50 111.66 ms, p95/max 137.52 ms; filtered 5,000-asset query 53.28 ms.
  `nativeCosineAvailable=true`.
- The same run at 4096D measured 205.16 ms first query; eight warm queries
  p50 197.87 ms, p95/max 205.24 ms; filtered 5,000-asset query 100.42 ms.
  Session-reopened first query was 110.54 ms at 768D. Reopening a semantic
  session is not a process restart, and these retrieval measurements exclude
  embedding, IPC, UI, and provider latency.
- Command for the most recent 10k run:
  `SERPENT_RUN_SEMANTIC_PERF=1 node scripts/run-vitest-with-electron.mjs tests/worker/semantic-index-performance.test.ts --reporter=verbose --silent=false`
- `shasum -a 256` matched the pinned macOS arm64 sqlite-vec manifest hash;
  `codesign --verify --verbose=2` reported the dylib valid on disk and meeting
  its designated requirement. This verifies the installed resource only, not
  the packaged Electron Worker.
- `npm run typecheck`: passed after async stop-hook integration, claim-token
  fencing, and bounded source reads moved outside scheduler admission.
- `node scripts/run-vitest-with-electron.mjs tests/unit/embedding-http-index.test.ts tests/worker/semantic-index-store.test.ts tests/worker/semantic-index-handler.test.ts tests/worker/search.test.ts --reporter=verbose`:
  107 tests passed across four files. This includes filtered candidate
  pagination, preferred thumbnail source parity, HTTP response reordering,
  store claim/restart tests, and a scheduler/handler seam proving a yielded
  search can be cancelled while an interactive browse request runs. It is not
  a UtilityProcess end-to-end test.
- `node scripts/run-vitest-with-electron.mjs tests/worker/semantic-index-store.test.ts --reporter=verbose`:
  10 tests passed, including running-job restart recovery, claim fencing,
  native/fallback cosine equivalence, unknown-storage journaling, and symlink
  rejection.
- `node scripts/run-vitest-with-electron.mjs tests/worker/semantic-index-handler.test.ts --reporter=verbose`:
  1 test passed. It opens/reopens the Worker-owned sidecar and confirms a stale
  claim is reported only as rejected and does not persist a vector.
- `node scripts/run-vitest-with-electron.mjs tests/worker/semantic-index-handler.test.ts tests/unit/legacy-semantic-cache.test.ts tests/worker/semantic-index-store.test.ts tests/unit/embedding-http-index.test.ts tests/unit/embedding-library-binding.test.ts --reporter=verbose`:
  24 tests passed across five files after adding the bounded legacy parser,
  current-revision legacy vector import/reopen checks, and provider request
  ordering coverage. Text vectors from the prior revision format are rejected
  because their historical title input cannot be proven.
- Legacy JSON migration now runs in the Library Worker from a Main-injected
  application cache root. It accepts only regular files under the two known
  legacy cache directories, validates schema/profile/current source revision
  and dimensions, parses entries incrementally under a 256 MiB total limit,
  records a SHA-256 import marker, and removes the owned cache file only after
  the next Main process session confirms the same completed digest. Malformed
  or incompatible caches remain in place for provider re-encoding.
- `npm run typecheck`: passed after migration protocol, schema v3, and persisted
  failed-job progress reporting were added.
- Hidden E2E command `node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`:
  1 test passed after rebuilding. With a mock HTTP provider, it indexed two
  text assets, verified the semantic UI showed both in cosine order, exercised
  filtered search and find-similar, closed and relaunched the full Electron
  process, and confirmed the reopened library reported 2/2 ready without
  additional corpus embedding requests before searching again. Earlier failed
  attempts were test assumptions: the first expected one card despite raw
  cosine returning both; later attempts used the wrong recent-library API and
  accessible-name selector. The final trace and screenshot show both result
  cards; no product search failure remained.
- `node scripts/run-vitest-with-electron.mjs tests/worker/semantic-index-handler.test.ts tests/unit/legacy-semantic-cache.test.ts tests/unit/embedding-http-index.test.ts tests/unit/semantic-cleanup-notice.test.ts --reporter=dot`:
  13 tests passed across four files. The migration test forces a 128-row batch
  flush before malformed trailing bytes and confirms an existing valid vector
  remains unchanged.
- `npm run typecheck`: passed after the migration rollback guard and restart
  E2E corrections. `npm run lint`: passed with zero errors and seven existing
  React hook dependency warnings.
- `node scripts/run-vitest-with-electron.mjs tests/worker/library-export-import.test.ts -t 'exports and reimports the semantic index through an SQLite backup snapshot' --reporter=verbose`:
  1 test passed. It backs up a vector for a real catalog text asset, closes the
  source library, imports the folder, and confirms a Worker search returns the
  asset without re-encoding; a ZIP export/import check also reads the preserved
  vector. The fixture now uses the file's actual byte size and mtime.

## Remaining risks

- Native loading now resolves and checks one package resource path, then loads
  that exact path. Forge excludes the locked macOS dylib from re-signing, and
  package verification checks its SHA-256. Packaged runtime loading, Windows
  packaging, and macOS package verification remain untested.
- The final retrieval-only 10,000-asset run measured 96.35ms first / 105.10ms
  warm p95 at 768 dimensions, and 147.27ms first / 148.97ms warm p95 at 4096
  dimensions. Both use precomputed vectors and exclude provider inference,
  process-cold startup, IPC, and rendering; they do not prove 500ms end-to-end.
- The semantic E2E verified persistence through full Electron exit/relaunch.
  Durable job claim recovery after a UtilityProcess crash, and simultaneous
  indexing/cancellation under a real UtilityProcess, remain unverified.
- Export now uses SQLite backup for active stores and read-only backup for an
  inactive sidecar, with destination space preflight and owned-partial cleanup.
  Folder and ZIP import paths have a synthetic correctness test; all export
  failure/cancellation and disk-full paths still need direct coverage.
- Legacy migration is implemented for local and HTTP cache roots, but only a
  synthetic current-revision image row has been shown to import and rank; the
  full provider-driven legacy migration and post-full-app-restart cleanup path
  still need an end-to-end test. Old text rows are intentionally rejected.
- Durable failed-job counts are reconstructed from Worker job state when a
  claim remains in retry backoff; full UtilityProcess restart recovery remains
  unverified.
- `npm run test:library-availability` passed in the final `verify:mainline` run
  (9 files / 231 tests). The complete hidden-window E2E ran 107 tests: 83
  passed, 20 failed, and 4 skipped; the new semantic SQLite full-restart E2E
  passed, while unrelated-area attribution has not been established. See the
  QA report for the exact command and failure categories.
- A controlled 10k Worker retrieval benchmark passed below 500ms at 768D and
  4096D. Query embedding, IPC/rendering, process-cold latency, and the complete
  end-to-end 500ms result remain unmeasured.
- The 20k mixed-media baseline completed two of three tests; the metadata-cache
  browse statement expectation failed in the same assertion as the
  pre-integration baseline (Serpent-38b190). The measured 20k values and result
  are in the QA report.
- The full `verify:mainline` stopped at the all-unit suite: 11 files failed,
  703 passed, 18 skipped, with 17 individual failures. Lint (0 errors, 7
  warnings), typecheck, extension verification, and library-availability
  passed. No failures were attributed to this feature without a baseline.
- Native packaging, Windows, Computer Use visual acceptance, and independent
  final reviewer sign-off remain unverified. The independent review agent did
  not complete its final pass.

## Post-merge push validation (2026-10-13)

After merging the latest `origin/dev`, fixed two folder-cover compatibility
issues found by the mainline gate: v58 now checks for an existing
`cover_asset_id` before adding it, and the cover-artifact projection omits
optional `revision_artifacts` predicates when those columns are absent. The
history-replay case is covered by the library availability suite; the
degraded-artifact case is covered by `tests/worker/lenient-folder-panel.test.ts`
(2/2 passed). The merged folder-cover picker also moved its loading update into
the asynchronous timer callback to satisfy React's set-state-in-effect lint
rule while keeping open/query event handlers responsible for immediate loading
feedback.

- `npm run test:library-availability`: 9 files / 233 tests passed.
- `npm run lint`: 0 errors, 7 existing React hook warnings.
- `npm run typecheck`: passed.
- `SERPENT_RUN_SEMANTIC_PERF=1 node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-performance.test.ts --reporter=verbose`:
  1/1 passed. For 10,000 assets, 768D first query 101.86ms, warm p95
  109.80ms, filtered 5,000 assets 46.57ms; 4096D first query 146.05ms, warm
  p95 163.16ms, filtered 5,000 assets 80.37ms. This is direct Worker retrieval
  with precomputed vectors; provider inference, IPC, UI, and process-cold time
  are excluded.
- `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`:
  1/1 passed, including full Electron process exit/relaunch and search reuse.
- `SERPENT_E2E_HIDE_WINDOW=1 npm run verify:mainline` reached the full unit
  suite after lint, typecheck, extension verification, and 9/233 library tests
  passed. The unit suite reported 19 failures, 5,730 passed, 28 skipped; one
  folder-cover degraded-schema failure was fixed and its focused file passed
  afterward. The full suite was not rerun after that final fix, so remaining
  failure count is not reasserted. The mainline command stopped before generic
  performance and full E2E gates.

## Input modality and find-similar correction (2026-10-13)

- Google’s official [EmbeddingGemma 2 model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2?hl=en) lists text, image, video, and audio capabilities. At that point the local llama-server adapter did not yet send native video; that implementation was corrected in the 2026-10-14 increment below. The HTTP OpenAI adapter sends text, while the current HTTP llama.cpp and DashScope adapters send text and image. A saved audio/video declaration alone does not prove that an adapter can send that input.
- Unified `embeddingInputModalitiesForAdapter` and `embeddingSourceForModalities` so the menu, Worker target selection, and execution use the same actual input channels. When the encoder cannot consume the original asset directly, a ready image preview can be used; the context menu hides find-similar when neither route is available.
- Root cause for the image-only MP4 path: `getSemanticAssetSources()` queried a ready video poster artifact ID but omitted its ready status. Source planning therefore treated a video with an existing poster as having no preview. The projection now includes `thumbnailStatus`. A synthetic Worker fixture verifies that an image-only session lists an MP4 poster as an image target and returns an image source target for find-similar. This path is retained only for image-only encoders; the local video-capable model uses the original video path described below.
- Added the Chinese and English settings notice for natural-language fuzzy search, similar-asset search, increased library preparation time, and memory use. The find-similar result UI style remains unchanged.
- The Electron E2E now verifies the notice, that text shows find-similar under a text-only service, and that an unsupported image hides the menu entry. The first run right-clicked a fixture where all three assets were selected and opened the batch menu; the test now selects one card before right-clicking and passes.

## Failed vector preparation and background task visibility (2026-10-13)

- The reported 121 unencoded items are failures among assets that made it into the encoder's eligible target set. An asset without a ready preview is excluded by `embeddingVisualPlan`; it is not attempted or counted as an encoding failure. A stale ready artifact whose file is missing, unreadable, corrupt, or over the input limit can still be selected and fail during `semantic.index.prepare`.
- The prior job handler stored `provider` for every exception, including Worker preparation errors. Its persisted rows therefore cannot identify the cause of those historical failures. The current code also had no per-error details to recover. The count alone cannot establish that all 121 were missing-thumbnail races. Future failures distinguish `preparation`, `provider`, and vector `storage` errors in the durable SQLite job row.
- When find-similar sees a missing vector, the Worker now checks the durable job state. A failed source returns a terminal `failed` result rather than `preparing`; after the existing retry delay expires, the job is eligible for another preparation attempt. The Renderer displays a failure notice and stops polling.
- Semantic indexing already uses per-asset rows in the Worker-owned `embedding_jobs` table and exposes aggregate progress in the existing Background Jobs dialog. The dialog now keeps a completed index visible while it has failed items, so its final failed count does not disappear when indexing ends.
- Added a synthetic MP4 fixture where the database marks the poster ready but its file is absent. It confirms the source is eligible, preparation rejects the missing artifact, and subsequent similarity queries report `failed`. An indexer-level test confirms a Worker preparation error is persisted as `preparation`; a deterministic store test confirms expired retry deadlines allow a new claim. A hidden-window Electron E2E also forces one controlled provider failure and verifies the terminal notice and retained Background Jobs summary.

Validation:

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/embedding-http-index.test.ts tests/worker/semantic-index-store.test.ts tests/worker/semantic-index-handler.test.ts tests/unit/find-similar.test.ts tests/unit/semantic-work.test.ts`: 5 files / 39 tests passed. This includes indexer-level preparation category persistence and deterministic retry-after expiry.
- `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`: 1/1 passed. It covers a controlled provider failure, the explicit find-similar failure notice, the background task summary after indexing completes, and full Electron restart/vector reuse.
- `npm run test:library-availability`: 9 files / 233 tests passed; native preflight confirmed the Electron ABI and FTS5.
- `npm run typecheck`: passed. `npx eslint src/main/embedding-http-index.ts tests/unit/embedding-http-index.test.ts tests/worker/semantic-index-store.test.ts`: 0 errors.
- The first E2E attempt clicked through an open settings modal; the second looked for the background task as a top-level button although it is inside “More tools”. The test now closes settings and opens the overflow menu. Final run passed.
- The historical 121 failures remain unattributed because their persisted category was too broad. Reprocessing them with the new stage classification, or a per-asset retry/reporting flow, is required to learn whether the cause was preview I/O or the model/provider.

Validation:

- `npm run typecheck`: passed.
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/find-similar.test.ts tests/unit/asset-commands.test.ts tests/unit/semantic-work.test.ts tests/worker/semantic-index-handler.test.ts --reporter=verbose`: 4 files / 77 tests passed.
- `npm run test:library-availability`: 9 files / 233 tests passed; native preflight confirmed Electron ABI and FTS5.
- `npx eslint src/main/embedding-http-index.ts src/main/embedding-test-index.ts src/renderer/App.tsx src/renderer/AssetContextMenu.tsx src/renderer/SemanticSearchSettings.tsx src/renderer/commands/asset-commands.ts src/renderer/find-similar.ts src/renderer/i18n/catalogs/en.ts src/renderer/i18n/catalogs/zh-CN.ts src/shared/embedding/modalities.ts src/shared/embedding/profile.ts src/shared/protocol/requests.ts src/shared/protocol/responses.ts src/worker/handlers/semantic-index.ts src/worker/library-service.ts tests/unit/asset-commands.test.ts tests/unit/find-similar.test.ts tests/unit/semantic-work.test.ts tests/worker/semantic-index-handler.test.ts tests/e2e/semantic-sqlite-lifecycle.test.ts`: 0 errors and 2 existing `App.tsx` React hook dependency warnings. After the final helper rename, `npx eslint src/renderer/App.tsx src/renderer/AssetContextMenu.tsx src/renderer/commands/asset-commands.ts src/renderer/find-similar.ts src/shared/embedding/profile.ts tests/unit/asset-commands.test.ts tests/unit/find-similar.test.ts` also completed with 0 errors and the same 2 warnings.
- `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`: 1/1 passed, covering the settings notice, menu visibility, semantic search, find-similar, full Electron exit/relaunch, and vector reuse. This E2E did not send a real MP4 image request to a provider.
- The screenshot generated by this test run was removed. Real MP4 provider inference, packaged, Windows, and Computer Use acceptance remain unverified.


## Semantic derived-preview path fix (2026-10-13)

`semantic.index.prepare` previously passed the relative `filePath` returned by `getThumbnailArtifact()` directly to `stat` and `readFile`. The Worker therefore resolved it from its working directory and consistently failed with `ENOENT`. Original image assets still use `resolveAssetPath()`; derived previews now resolve by artifact ID through `getArtifactAbsolutePath(libraryId, artifactId, 'preview')`, reusing the library ownership, current-revision, file, and symlink boundary checks.

The regression fixture writes a synthetic MP4 poster under the isolated library's `.serpent/artifacts` directory while the database stores only its relative filename. Before the implementation change, the updated success assertion failed at `stat 'clip-poster.jpg'` with `ENOENT`. The fixed test verifies JPEG bytes from prepare, a successful claim and vector write, find-similar reaching `ready`, and a missing-file negative case that still rejects preparation.

- Red: `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-handler.test.ts -t 'ready MP4 poster' --reporter=verbose`: 1 test failed with relative-path `ENOENT`.
- Fixed focused suite: `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-handler.test.ts tests/worker/semantic-index-store.test.ts --reporter=verbose`: 2 files / 17 tests passed.
- `npx eslint src/worker/handlers/semantic-index.ts tests/worker/semantic-index-handler.test.ts`: passed with no diagnostics.
- `npm run typecheck`: passed.
- `npm run test:library-availability`: 9 files / 233 tests passed; native preflight confirmed Electron ABI and FTS5.
- Root-agent background lifecycle E2E: `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`, 1/1 passed in 13.2 seconds. It covers complete Electron exit/relaunch and persisted vector reuse; it does not send real MP4/GIF/AVIF content to the provider.

This regression uses only a synthetic Worker fixture. The active library was not reindexed and its previously reported 16 failed jobs were not checked. Real MP4/GIF/AVIF provider requests, Computer Use, packaged, and Windows evidence remain unverified. The test removes its isolated temporary library in `afterEach`.

## Native video embedding (2026-10-14)

The product invariant is that a supported original modality must be sent as that modality; cover images are only a fallback for encoders without video input that do support images. The fixed [llama.cpp server README at commit 5ad1c5d](https://github.com/ggml-org/llama.cpp/blob/5ad1c5d/tools/server/README.md) documents typed `input_video`, raw base64 data, `--video-fps`, and `--video-ffmpeg-dir`. The [EmbeddingGemma 2 model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2?hl=en) documents video input and frame sampling.

- The local profile now declares video support. Target selection prefers the current original video revision even without a poster; image-only encoders use the safely resolved ready preview.
- Worker video preparation reads a bounded current source and checks the revision again after reading. Oversize/missing input fails preparation without poster fallback. Main passes the application's resolved FFmpeg/ffprobe directory to llama-server; its embedding request uses typed raw-base64 `input_video` at 1 FPS.
- Red evidence before implementation: focused tests showed the video-capable source selector returned no video target, protocol schemas rejected video, and the local index had no `embedVideoPayload` path.
- Green: final focused command `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/asset-commands.test.ts tests/unit/find-similar.test.ts tests/unit/embedding-llama-session.test.ts tests/unit/embedding-test-index.test.ts tests/worker/semantic-index-handler.test.ts tests/unit/protocol.test.ts --reporter=dot` — 6 files / 203 tests passed. It verifies native video selection/prepare, image-only poster fallback, missing derived file rejection, ready vector write, typed request body, server arguments and menu eligibility.
- `npm run typecheck`: passed. Focused ESLint across changed implementation and tests: passed with no diagnostics. `npm run test:library-availability`: 9 files / 233 tests passed; Electron ABI and FTS5 preflight passed.
- Final focused command `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/asset-commands.test.ts tests/unit/find-similar.test.ts tests/unit/embedding-llama-session.test.ts tests/unit/embedding-test-index.test.ts tests/worker/semantic-index-handler.test.ts tests/unit/protocol.test.ts --reporter=dot`: 6 files / 203 tests passed.
- Root-agent background lifecycle E2E: `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`, 1/1 passed in 9.9 seconds. This covers application restart and persisted-vector reuse but does not itself exercise native video inference.
- Real local runtime smoke: generated a two-second synthetic MP4 in an isolated temporary directory, started the installed pinned llama-server with the installed EmbeddingGemma 2 weights, `--video-fps 1`, and the bundled FFmpeg/ffprobe directory, then sent the MP4 as raw-base64 typed `input_video` to `/v1/embeddings`. The response contained 768 finite values with a non-zero norm. The temporary video was removed with its temporary directory. The first fixture-generation attempt used the bundled FFmpeg and stopped before inference because that shipping build intentionally omits `lavfi`; the successful run used the host FFmpeg only to create the fixture while llama-server decoded it with the bundled binaries.
- The active library, Computer Use, packaged and Windows remain unverified.
