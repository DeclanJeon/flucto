# General AI Video Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wellness-only discovery with general AI-video discovery, optionally scoped by a user query, while keeping public AI-generation disclosures distinct from search terms and AI-assisted discussion.

**Architecture:** Reuse the existing search provider catalog and bounded discovery fan-out. The user query narrows retrieval only; candidate status comes from public platform/creator media disclosures. Merge disclosure metadata without converting unavailable fields into negative evidence, and make relevance ordering put stronger disclosure evidence before weak or absent evidence.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Node test runner, existing video search providers.

**Spec:** `docs/ai-video-discovery-design.md` (existing public-metadata, explainability, limits, and no-download boundaries); approved scope update: general AI videos, optional free-text topic, not wellness-only.

## Global Constraints

- Discovery uses public metadata only; it does not download, inspect, or upload media for classification.
- Search terms and titles are retrieval/ranking context, never direct AI-generation evidence.
- AI-assisted planning or discussion does not imply AI-generated media.
- Keep the 1–50 result cap, bounded fan-out, source diagnostics, canonical-URL deduplication, and explicit queue selection.
- Keep unavailable disclosure metadata distinct from available metadata with no disclosure.
- Do not edit the pre-existing untracked design or plan files supplied by the user.

## Review Focus

- Arbitrary or omitted query must be accepted as general discovery; the former four wellness topics must not remain a hidden input contract.
- Query terms and AI-related titles must not upgrade a candidate to confirmed/likely.
- Duplicate results with unavailable metadata must remain unavailable after evidence merge.
- Explicit media disclosure must outrank generic tags, AI-assisted news, and no-disclosure candidates.
- A query returning no qualifying disclosure must show an honest empty state while retaining source failures/counts.

---

### Task 1: General discovery request and query expansion

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/aiVideoDiscovery.ts`
- Test: `tests/ai-video-discovery.test.mjs`

**Interfaces:**
- Request accepts optional `query?: string`; platform, limit, status, and sort retain their current contracts.
- Omitted/blank query uses exactly `AI generated video`, `video made with AI`, and `AI generated animation`.
- A supplied query `q` expands to `AI generated ${q} video`, `AI generated ${q} animation`, and `${q} video made with AI`; these phrases are retrieval-only and never evidence.
- Response no longer requires a wellness `topic` field.

- [ ] Add failing service tests for omitted query and arbitrary query, asserting generic phrases are searched and the query itself does not classify candidates.
- [ ] Run the focused test and observe the expected contract failure.
- [ ] Implement general query validation, phrase expansion, and response shape while preserving fan-out and the total output limit.
- [ ] Run discovery tests and verify the new behavior passes.

### Task 2: Evidence merge and relevance ordering

**Files:**
- Modify: `src/main/services/aiVideoDiscovery.ts`
- Modify if required: `src/main/services/aiVideoEvidence.ts`
- Test: `tests/ai-video-discovery.test.mjs`, `tests/ai-video-evidence.test.mjs`

**Interfaces:**
- Candidate classification remains based on disclosure evidence only.
- Relevance order is deterministic and prioritizes platform labels/direct creator media disclosures, then indirect/uncertain evidence, then no-disclosure/unavailable candidates; ties retain source/query rank.

- [ ] Add failing regression tests for duplicate unavailable metadata and for an explicit disclosure ranking ahead of a query-first no-evidence result.
- [ ] Run focused tests and observe expected failures.
- [ ] Preserve metadata availability across duplicate merges; classify as available only if at least one result for that canonical URL actually supplied the relevant metadata field.
- [ ] Implement evidence-aware relevance ordering without blending popularity or query text into AI classification.
- [ ] Run focused discovery/evidence tests.

### Task 3: CLI, renderer, and documentation cutover

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/index.ts`, `src/cli/output.ts`
- Modify: `src/renderer/src/components/AiVideoDiscovery.tsx`, `src/renderer/src/components/MainDownloader.tsx`
- Modify: `README.md`, `docs/architecture-extensible-platforms.md`, `CHANGELOG.md`
- Test: `tests/search-cli.test.mjs`

**Interfaces:**
- CLI supports `flucto discover [query]`; omitting the query performs broad AI-video discovery.
- Renderer replaces the required wellness selector with an optional search field and keeps platform, limit, status, sort, evidence, source reports, and explicit queue addition.
- Search hits remain inspectable with their AI status; if no `confirmed`/`likely` candidate exists, the interface explicitly says no public-disclosure match was found rather than implying the remaining hits qualify.
- [ ] Add failing CLI parser tests accepting zero or one positional query argument (multiword queries require normal shell quoting); reject more than one argument with usage guidance.
- [ ] Run the focused parser test and observe expected failures.
- [ ] Update CLI parsing, invocation, human/JSON output, and help examples.
- [ ] Update renderer controls and empty-state wording for general discovery; keep candidate selection unchecked by default.
- [ ] Update README, architecture notes, and Unreleased changelog for public-disclosure-based general discovery and limitations.
- [ ] Run CLI tests, lint, typecheck, and renderer/Electron build.

### Task 4: End-to-end QA and release verification

**Files:** None unless QA reveals a regression.

- [ ] Run focused AI discovery, provider, and CLI tests.
- [ ] Run the full test suite, lint, typecheck, and build.
- [ ] Smoke-test a real supported provider with a broad query and a specific query; inspect returned disclosure text, status, source report, and queue action.
- [ ] Confirm an omitted query is accepted, arbitrary query is accepted, query/title alone never confirms AI media, and queue selection does not start a download.
- [ ] Report live-source limitations separately from deterministic tests.
