# Flucto adapter contract

## Reviewed implementation, not a universal API

The installed Flucto CLI **1.19.0** help and local implementations of CLI dispatch, videoSearch, mediaInfo, search providers and public web-index fallback were inspected during implementation. No upstream code is bundled. Other versions fail closed until the adapter is reviewed and tests updated. The executable must already be installed.

- search: `flucto search QUERY --platform SITE --limit N --json`.
- Envelope: `platform, query, videos[], sources[], error?`.
- Candidate fields used: `originalUrl, platform, title, uploader, duration, view_count, searchMethod`. Optional absolute `upload_date` is parsed if present, but is not promised by current search providers.
- Source fields: `platform, method (native/web-index), count, error?, nativeError?`.
- 0 exit can include a site fallback or partial failure; inspect JSON.
- `--limit` is 1–50 total results per CLI invocation, not per site. The wrapper explicitly fans out individual sites so failures and budgets are visible.
- Reviewed platform IDs: youtube, twitter, instagram, reddit, threads, tiktok, vimeo, bilibili, dailymotion, nicovideo, ok, vkvideo. Support declaration is not live success.
- Public web-index fallback uses an anonymous locally installed Chrome/Chromium and may fail due to missing browser, login walls, markup changes, CAPTCHA or network. Never auto-install a browser or bypass access controls.

## Metadata and unsafe upstream ambiguities

`info URL --json` can auto-provision missing yt-dlp/FFmpeg. In reviewed 1.19.0, adding `--check-only` suppresses the dispatch's provisioning while still executing info. The wrapper uses exactly this version-gated path; missing binaries cause failure, not installation. Info can retry internally (notably X). Wrapper retry count 0 is not a claim of zero upstream HTTP retries.

1.19.0 info `view_count` can fall back to likes, and missing counts become zero. It is deliberately NOT copied into normalized views. Search Reddit `view_count` is derived from score/upvotes, so it is exposed as `reddit_score_or_upvotes`, with the distinction unknown. Native YouTube/Bilibili/Dailymotion/Nicovideo/VKvideo search counts have a reviewed views/play mapping. Other counts stay unverified; no cross-platform metric sorting or composite score.

`duration=0` is an upstream missing-value sentinel; normalized duration is null. Known native view count 0 remains 0. Missing fields remain null. Relative dates are not converted into exact publication dates. Search metadata does not verify content claims or authorship.

## Output

JSON `social-search-1.0` is a research artifact, not a production schema:
- request, runtime_version, adapter_version, created_at, scope and unapplied_filters;
- budget and each run's query/platform/observation time/source/method/error/status;
- candidates with canonical URLs, missing-value-safe metadata, metric units and provenance observations;
- optional metadata_inspection, plus excluded duplicates/date-unknown/outside-period/excluded-term/cap decisions;
- warnings and limits; selection_reason remains null until an agent supplies an evidence-scoped explanation.

Statuses: blocked (unavailable/unreviewed runtime), failed (no successful search scope), partial (some failed/unexecuted scopes or info), empty (successful retrieval but no retained candidate), ok (all requested search scopes completed with retained candidates). Empty after filtering does not mean no relevant posts exist.

Exit codes: 0 ok/empty/planned, 2 blocked/failed/usage, 3 partial. Preserve partial JSON even on nonzero exit. No stdout boilerplate: unexpected JSON is protocol_error, not a best-effort invented parse.

Default stdout; explicit `--output` creates a new file in an existing directory using exclusive write. No overwrite, implicit folder creation or production-ledger mutation. Binary output/cookies/environment are not logged. Queries and public metadata are sent to the selected platform/public index as part of requested search; avoid confidential search strings without appropriate authorization.
