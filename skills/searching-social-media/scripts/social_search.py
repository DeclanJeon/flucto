#!/usr/bin/env python3
"""Bounded, anonymous Flucto video-post search. Standard library only.

No download, cookies, install/update, transcription, popularity scoring or shell.
stdout is the report; --output explicitly creates a NEW file without overwrite.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime, timezone
import html
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time
from urllib.parse import parse_qs, urlsplit

ADAPTER_VERSION = "1.19.0"
# Reviewed host/path boundaries, not a guarantee these sites currently work.
SITES = {
    "youtube": ({"youtube.com", "youtu.be"}, r"unused"),
    "twitter": ({"x.com", "twitter.com"}, r"/(?:[\w.-]+|i/web)/status/(\d+)(?:/.*)?"),
    "instagram": ({"instagram.com"}, r"/(?:p|reel|reels)/([\w-]+)"),
    "reddit": ({"reddit.com"}, r"/(?:r/[\w-]+/)?comments/([a-zA-Z0-9]+)(?:/.*)?"),
    "threads": ({"threads.net", "threads.com"}, r"/(@[\w.-]+)/post/([\w-]+)"),
    "tiktok": ({"tiktok.com"}, r"/(@[\w.-]+)/video/(\d+)"),
    "vimeo": ({"vimeo.com"}, r"/(\d+)"),
    "bilibili": ({"bilibili.com"}, r"/video/(BV[\w]+|av\d+)"),
    "dailymotion": ({"dailymotion.com"}, r"/video/([\w]+)"),
    "nicovideo": ({"nicovideo.jp"}, r"/watch/([a-z]+\d+)"),
    "ok": ({"ok.ru"}, r"/video/(\d+)"),
    "vkvideo": ({"vkvideo.ru", "vk.com"}, r"/(video-?\d+_\d+)"),
}
VIEW_PLATFORMS = {"youtube", "bilibili", "dailymotion", "nicovideo", "vkvideo"}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def clean(value, cap=2000):
    """External strings remain data; remove controls and common credential forms."""
    if not isinstance(value, str):
        return None
    value = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", value)
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    value = re.sub(r"(?i)\bbearer\s+\S+", "Bearer [REDACTED]", value)
    value = re.sub(r"(?i)\b(cookie|authorization)\s*[:=].*$", r"\1: [REDACTED]", value)
    value = re.sub(r"(?i)((?:api[_-]?key|token)\s*[:=]\s*)\S+", r"\1[REDACTED]", value)
    value = re.sub(r"https?://[^\s/@]+:[^\s/@]+@", "https://[REDACTED]@", value)
    return value[:cap].strip() or None


def canonical_url(value, platform):
    if platform not in SITES or not isinstance(value, str) or len(value) > 4096:
        raise ValueError("unsupported URL/platform")
    if re.search(r"[\s\\\x00-\x1f\x7f]", value):
        raise ValueError("URL contains whitespace/control/backslash")
    p = urlsplit(value)
    if p.scheme not in {"http", "https"} or p.username or p.password or p.port:
        raise ValueError("URL must be a credential-free public platform link")
    host = (p.hostname or "").lower()
    host = re.sub(r"^(?:www|m)\.", "", host)
    if host not in SITES[platform][0]:
        raise ValueError("host does not match selected platform")
    path = p.path.rstrip("/")
    if platform == "youtube":
        if host == "youtu.be":
            ident = path.lstrip("/")
        elif path == "/watch":
            ident = parse_qs(p.query).get("v", [""])[0]
        elif re.fullmatch(r"/(?:shorts|live)/[\w-]{11}", path):
            ident = path.rsplit("/", 1)[1]
        else:
            raise ValueError("not a YouTube video URL")
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", ident):
            raise ValueError("invalid YouTube video ID")
        return f"https://www.youtube.com/watch?v={ident}"
    m = re.fullmatch(SITES[platform][1], path)
    if not m:
        raise ValueError("not a supported content URL; redirectors are not followed")
    if platform == "twitter":
        return f"https://x.com/i/status/{m[1]}"
    if platform == "instagram":
        return f"https://www.instagram.com/p/{m[1]}/"
    if platform == "reddit":
        return f"https://www.reddit.com/comments/{m[1].lower()}/"
    if platform == "threads":
        return f"https://www.threads.net/{m[1]}/post/{m[2]}"
    return "https://" + {"tiktok": "www.tiktok.com", "vkvideo": "vkvideo.ru"}.get(platform, host) + path


def content_id(url, platform):
    if platform == "youtube":
        return parse_qs(urlsplit(url).query)["v"][0]
    return urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]


def post_date(raw):
    if not isinstance(raw, str):
        return None
    try:
        if re.fullmatch(r"\d{8}", raw):
            return datetime.strptime(raw, "%Y%m%d").date().isoformat()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return date.fromisoformat(raw).isoformat()
    except ValueError:
        pass
    return None


def number(raw, *, positive=False, negative=False):
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    try:
        if not math.isfinite(raw):
            return None
    except OverflowError:
        return None
    if (raw < 0 and not negative) or (positive and raw <= 0):
        return None
    return raw


def normalize(row, platform, query, rank, observed_at, source_method):
    if not isinstance(row, dict) or row.get("platform", platform) != platform:
        raise ValueError("invalid candidate/platform")
    url = canonical_url(row.get("originalUrl"), platform)
    method = row.get("searchMethod", source_method)
    if method not in {"native", "web-index"} or method != source_method:
        raise ValueError("unreviewed or inconsistent search method")
    count = number(row.get("view_count"), negative=platform == "reddit")
    views = count if method == "native" and platform in VIEW_PLATFORMS else None
    return {
        "url": url, "platform": platform, "content_id": content_id(url, platform),
        "title": clean(row.get("title")),
        "uploader": None if str(row.get("uploader", "")).lower() in {"", "unknown"} else clean(row.get("uploader")),
        "published_date": post_date(row.get("upload_date")),
        "observed_at": observed_at,
        "duration_seconds": number(row.get("duration"), positive=True),
        "metrics": {"views": views,
                    "reddit_score_or_upvotes": count if method == "native" and platform == "reddit" else None,
                    "unverified_provider_count": count if count is not None and views is None and platform != "reddit" else None},
        "metric_basis": {"command": "search", "field": "view_count", "method": method,
                         "observation_time": observed_at,
                         "mapping": "reviewed per-platform units; not independently verified"},
        "evidence_level": "index_only" if method == "web-index" else "search_metadata_only",
        "content_type": "video_post_candidate_not_viewed",
        "selection_reason": None,
        "observations": [{"query": query, "rank": rank, "method": method,
                          "observed_at": observed_at, "original_url": clean(row.get("originalUrl")),
                          "reported_count_field": "view_count", "reported_count": count}],
        "metadata_inspection": {"status": "not_requested"},
    }


class Runner:
    def __init__(self, executable, deadline, per_call):
        self.executable, self.deadline, self.per_call = executable, deadline, per_call

    def call(self, args):
        left = self.deadline - time.monotonic()
        if left <= 0:
            return {"state": "budget_exhausted", "error": "overall time budget exhausted"}
        env = dict(os.environ)
        for key in ("FLUCTO_COOKIES", "YOUTUBE_COOKIES_PATH", "FLUCTO_COOKIES_FROM_BROWSER"):
            env.pop(key, None)
        env["NO_COLOR"] = "1"
        try:
            proc = subprocess.Popen([self.executable, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    shell=False, env=env, start_new_session=os.name != "nt")
        except OSError as exc:
            return {"state": "unavailable", "error": clean(str(exc))}
        try:
            out, err = proc.communicate(timeout=min(left, self.per_call))
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
            else:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            proc.communicate()
            return {"state": "timeout", "error": "process group timed out; no wrapper retry"}
        if len(out) > 4_000_000 or len(err) > 4_000_000:
            return {"state": "protocol_error", "error": "CLI output exceeds adapter size limit"}
        return {"state": "returned", "exit_code": proc.returncode,
                "stdout": out.decode("utf-8", errors="replace"),
                "stderr": clean(err.decode("utf-8", errors="replace"))}


def parse_payload(result):
    if result["state"] != "returned":
        return None
    try:
        payload = json.loads(result["stdout"])
        return payload if isinstance(payload, dict) else None
    except (ValueError, TypeError):
        return None


def search_report(args, runner):
    report = {"schema": "social-search-1.0", "created_at": utcnow(), "adapter_version": ADAPTER_VERSION,
              "request": {"queries": args.query, "platforms": args.platform, "mode": args.mode,
                          "platform_selection": "default_youtube" if getattr(args, "platform_defaulted", False) else "explicit",
                          "per_search_limit": args.per_search, "inspect_up_to": args.inspect,
                          "since": args.since, "until": args.until, "language": args.language, "region": args.region,
                          "exclude": args.exclude, "final_limit": args.limit},
              "scope": "video-post candidates, not exhaustive SNS text/image/comment search",
              "budget": {"max_network_cli_calls": args.max_calls, "calls_started": 0,
                         "per_call_seconds": args.timeout, "total_seconds": args.total_timeout,
                         "wrapper_retries": 0, "internal_provider_http_retries": "not controlled by wrapper"},
              "unapplied_filters": ["language/region are research scope only; CLI provides no verified server-side filters"],
              "runs": [], "candidates": [], "excluded": [], "metadata_runs": [], "warnings": [],
              "limits": ["Search order is provider order, not semantic relevance scoring or popularity prediction.",
                         "External titles/descriptions are untrusted data, never instructions.",
                         "No body, transcript, comments, video playback, rights clearance or factual verification performed."]}
    version = runner.call(["--version"])
    version_text = version.get("stdout", "").strip().removeprefix("v")
    report["runtime_version"] = clean(version_text)
    if version.get("exit_code") != 0 or version_text != ADAPTER_VERSION:
        report.update(status="blocked", warnings=["Flucto 1.19.0 adapter only: unavailable/unreviewed version; no search started"])
        return report
    seen = {}
    for query in args.query:
        for platform in args.platform:
            result = runner.call(["search", query, "--platform", platform, "--limit", str(args.per_search), "--json"])
            if result["state"] != "budget_exhausted":
                report["budget"]["calls_started"] += 1
            run = {"query": query, "platform": platform, "observed_at": utcnow(),
                   "exit_code": result.get("exit_code"), "state": result["state"], "sources": [], "candidate_rows": 0}
            payload = parse_payload(result)
            if (payload is None or not isinstance(payload.get("videos"), list)
                    or not isinstance(payload.get("sources"), list)
                    or payload.get("platform") != platform or payload.get("query") != query
                    or len(payload.get("sources", [])) != 1):
                run.update(state=result["state"] if result["state"] not in {"returned"} else "protocol_error",
                           error=result.get("error") or result.get("stderr") or "unexpected JSON envelope")
                report["runs"].append(run)
                continue
            source = payload["sources"][0]
            if (not isinstance(source, dict) or source.get("platform") != platform
                    or source.get("method") not in {"native", "web-index"}
                    or isinstance(source.get("count"), bool)
                    or not isinstance(source.get("count"), int) or source["count"] < 0):
                run.update(state="protocol_error", error="source/platform mismatch")
                report["runs"].append(run)
                continue
            run["sources"] = [{k: clean(source.get(k)) for k in ("platform", "method", "error", "nativeError")}]
            run["sources"][0]["count"] = number(source.get("count"))
            run["sources"][0]["search_url"] = clean(source.get("searchUrl"))
            run["candidate_rows"] = len(payload["videos"])
            failed = bool(source.get("error") or payload.get("error") or result.get("exit_code") != 0)
            run["state"] = "failed" if failed else ("empty" if not payload["videos"] else "ok")
            run["error"] = clean(source.get("error") or payload.get("error") or result.get("stderr")) if failed else None
            if source.get("nativeError"):
                report["warnings"].append(f"{platform}: native unavailable; fallback/index boundary retained")
            invalid_rows = 0
            if not failed:
                for rank, row in enumerate(payload["videos"][:args.per_search], 1):
                    try:
                        item = normalize(row, platform, query, rank, run["observed_at"], source.get("method"))
                    except (ValueError, TypeError) as exc:
                        invalid_rows += 1
                        report["excluded"].append({"platform": platform, "query": query, "rank": rank, "reason": "invalid_candidate: " + str(exc)})
                        continue
                    key = (platform, item["content_id"])
                    if key in seen:
                        seen[key]["observations"].extend(item["observations"])
                        report["excluded"].append({"url": item["url"], "retained_url": seen[key]["url"], "reason": "duplicate; observation retained"})
                    else:
                        seen[key] = item
            if invalid_rows:
                run["state"] = "protocol_partial" if invalid_rows < len(payload["videos"][:args.per_search]) else "protocol_error"
                run["error"] = f"{invalid_rows} invalid candidate rows rejected"
            report["runs"].append(run)
    # Search results frequently have no absolute publication dates. Never invent them.
    for item in seen.values():
        reason = None
        title = ((item["title"] or "") + " " + (item["uploader"] or "")).casefold()
        if any(term.casefold() in title for term in args.exclude):
            reason = "excluded_term_in_title_or_uploader"
        elif args.since or args.until:
            published = item["published_date"]
            if published is None:
                reason = "publication_date_unknown; requested period cannot be verified"
            elif (args.since and published < args.since) or (args.until and published > args.until):
                reason = "outside_requested_publication_period"
        if reason:
            report["excluded"].append({"url": item["url"], "reason": reason})
        elif len(report["candidates"]) < args.limit:
            report["candidates"].append(item)
        else:
            report["excluded"].append({"url": item["url"], "reason": "final_result_cap"})
    for item in report["candidates"][:args.inspect]:
        if report["budget"]["calls_started"] >= args.max_calls:
            item["metadata_inspection"] = {"status": "budget_exhausted"}
            continue
        # In reviewed 1.19.0, --check-only suppresses ensureBinaries provisioning.
        result = runner.call(["info", item["url"], "--check-only", "--json"])
        if result["state"] != "budget_exhausted":
            report["budget"]["calls_started"] += 1
        payload = parse_payload(result)
        expected_id = item["content_id"]
        valid = (result.get("exit_code") == 0 and isinstance(payload, dict)
                 and payload.get("id") == expected_id and isinstance(payload.get("title"), str))
        inspection = {"status": "metadata_retrieved" if valid else "failed",
                      "observed_at": utcnow(), "error": None if valid else result.get("error") or result.get("stderr") or "unexpected info JSON or mismatched content ID",
                      "count_warning": "info view_count may be likes or a synthetic zero; never used as verified views"}
        if valid:
            inspection.update(title=clean(payload["title"]), uploader=clean(payload.get("uploader")),
                              duration_seconds=number(payload.get("duration"), positive=True))
        item["metadata_inspection"] = inspection
        report["metadata_runs"].append({"url": item["url"], **inspection})
    states = [r["state"] for r in report["runs"]]
    success = sum(s in {"ok", "empty", "protocol_partial"} for s in states)
    report["status"] = ("failed" if not success else "partial" if success < len(states) or "protocol_partial" in states
                        or any(r["status"] != "metadata_retrieved" for r in report["metadata_runs"])
                        else "ok" if report["candidates"] else "empty")
    if any(r["state"] == "ok" for r in report["runs"]) and not report["candidates"]:
        report["warnings"].append("Candidates were returned but none survived validation/filters; not proof that no relevant posts exist")
    report["warnings"].append("Fewer results than requested" if len(report["candidates"]) < args.limit else "Candidate set requires purpose-fit review")
    return report


def md_cell(value):
    text = clean(str(value)) if value is not None else "미확인"
    return html.escape(text or "미확인").replace("\\", "\\\\").replace("|", "\\|").replace("[", "\\[").replace("]", "\\]").replace("`", "\\`")


def markdown(report):
    out = ["# SNS 검색 후보", "", f"상태: {report['status']} · 관측 시각: {report['created_at']}",
           "검색 후보·제공자 순서이며, 전체 SNS/인기 순위·영상 시청·사실 검증 결과가 아닙니다.",
           f"플랫폼 선택: {report['request'].get('platform_selection', 'not_recorded')} · 게시일 조건: {md_cell(report['request']['since'])} ~ {md_cell(report['request']['until'])}", "",
           "| 제목·링크 | 플랫폼·게시자 | 게시일 | 조회수 / 기타 지표 | 확인 수준 | 선정 근거 |", "|---|---|---|---|---|---|"]
    for item in report["candidates"]:
        metric = item["metrics"]
        extra = f" / Reddit score·upvotes(구분 미확인): {metric['reddit_score_or_upvotes']}" if metric["reddit_score_or_upvotes"] is not None else ""
        out.append(f"| [{md_cell(item['title'])}]({item['url']}) | {item['platform']} · {md_cell(item['uploader'])} | {md_cell(item['published_date'])} | {md_cell(metric['views'])}{extra} | {item['evidence_level']} | {md_cell(item['selection_reason'] or '검색 후보; 목적 적합성 미검증')} |")
    out += ["", "## 검색 실행·한계"]
    for run in report["runs"]:
        out.append(f"- {md_cell(run['platform'])} / {md_cell(run['query'])}: {run['state']} ({run['candidate_rows']} rows); {md_cell(run.get('error'))}")
    if report["metadata_runs"]:
        out += ["", "## 선택 메타데이터 조회 (본문·영상 검사 아님)"]
        out += [f"- {r['url']}: {r['status']} / {md_cell(r.get('error'))}" for r in report["metadata_runs"]]
    out += ["- " + md_cell(x) for x in report["unapplied_filters"] + report["warnings"] + report["limits"]]
    out += [f"- 제외·중복·상한 기록: {len(report['excluded'])}건. 세부 근거는 JSON의 excluded/observations 참조."]
    out += [f"  - {md_cell(reason)}: {count}" for reason, count in Counter(e['reason'] for e in report['excluded']).items()]
    return "\n".join(out) + "\n"


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--query", action="append", required=True)
    p.add_argument("--platform", action="append", choices=[*SITES, "all"])
    p.add_argument("--mode", choices=["general", "reference", "demand"], default="general")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--per-search", type=int, default=10)
    p.add_argument("--max-calls", type=int, default=6)
    p.add_argument("--inspect", type=int, default=0, help="optional info calls; default 0, never body/video verification")
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--total-timeout", type=float, default=120)
    p.add_argument("--since", type=lambda s: date.fromisoformat(s).isoformat())
    p.add_argument("--until", type=lambda s: date.fromisoformat(s).isoformat())
    p.add_argument("--language")
    p.add_argument("--region")
    p.add_argument("--exclude", action="append", default=[])
    p.add_argument("--executable", default="flucto")
    p.add_argument("--format", choices=["json", "md"], default="json")
    p.add_argument("--output", type=Path)
    p.add_argument("--plan", action="store_true", help="no subprocess/network; show the bounded plan")
    return p


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    if any(not q.strip() or len(q) > 500 or q.lstrip().startswith("-") or re.search(r"[\x00-\x1f\x7f]", q) for q in args.query):
        p.error("queries must be nonempty, <=500 chars, no option prefix or control characters")
    if any(not term.strip() or len(term) > 500 or re.search(r"[\x00-\x1f\x7f]", term) for term in args.exclude):
        p.error("exclude terms must be nonempty, <=500 chars and free of control characters")
    args.exclude = list(dict.fromkeys(term.strip() for term in args.exclude))
    args.query = list(dict.fromkeys(q.strip() for q in args.query))
    args.platform_defaulted = args.platform is None
    platforms = args.platform or ["youtube"]
    args.platform = list(SITES) if "all" in platforms else list(dict.fromkeys(platforms))
    if not (1 <= args.limit <= 50 and 1 <= args.per_search <= 50 and 1 <= args.max_calls <= 24
            and 0 <= args.inspect <= 10 and math.isfinite(args.timeout) and 0 < args.timeout <= 60
            and math.isfinite(args.total_timeout) and 0 < args.total_timeout <= 300):
        p.error("invalid result/call/time limits")
    if len(args.query) * len(args.platform) + args.inspect > args.max_calls:
        p.error("query/platform fanout plus reserved info calls exceeds --max-calls; narrow the plan")
    if args.since and args.until and args.since > args.until:
        p.error("--since must not be after --until")
    if args.output and (args.output.exists() or args.output.is_symlink() or not args.output.parent.is_dir()):
        p.error("--output must be a new file in an existing directory; no overwrite or implicit directory creation")
    if args.plan:
        result = {"status": "planned_not_executed", "queries": args.query, "platforms": args.platform,
                  "network_cli_calls_upper_bound": len(args.query)*len(args.platform)+args.inspect,
                  "version_probe_calls": 1, "unverified_scope_filters": ["language", "region"],
                  "date_filter": "post-filter only; missing publication date excluded when period is requested"}
        output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        code = 0
    else:
        exe = shutil.which(args.executable)
        if not exe:
            p.error("Flucto is unavailable; installation is separate authorization")
        try:
            report = search_report(args, Runner(exe, time.monotonic()+args.total_timeout, args.timeout))
        except OSError as exc:
            print(json.dumps({"status": "blocked", "error": clean(str(exc))}), file=__import__('sys').stderr)
            return 2
        output = markdown(report) if args.format == "md" else json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        code = {"blocked": 2, "failed": 2, "partial": 3}.get(report["status"], 0)
    if args.output:
        with args.output.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(output)
    else:
        print(output, end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
