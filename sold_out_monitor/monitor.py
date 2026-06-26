import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib import parse, request

from playwright.sync_api import sync_playwright


SECTION_TITLES = {
    "最新公告",
    "活動介紹",
    "注意事項",
    "購買提醒",
    "取票方式",
    "退票規定",
}

PURCHASE_TITLE = "立即購買"
TABLE_HEADERS = {"場次名稱", "場次日期", "場次時間", "場次地點", "售票狀態"}
DATE_LABELS = {"日期", "場次日期"}
TIME_LABELS = {"時間", "場次時間"}
LOCATION_LABELS = {"地點", "場次地點"}
STATUS_HINTS = ("銷售一空", "立即購買", "尚未開賣", "熱賣", "剩餘", "可售", "販售", "開賣")
DATE_PATTERN = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")
TIME_PATTERN = re.compile(r"^\d{1,2}:\d{2}")


@dataclass
class SessionResult:
    id: str
    title: str
    date: str
    time: str
    location: str
    status_text: str
    found: bool
    is_sold_out: bool | None
    is_available: bool
    evidence: list[str]


def normalize_line(value: str) -> str:
    return " ".join((value or "").split()).strip()


def bool_value(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def int_value(value: Any, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def load_json_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def get_setting(config: dict[str, Any], env_name: str, config_name: str, default: Any) -> Any:
    if env_name in os.environ:
        return os.environ[env_name]
    return config.get(config_name, default)


def load_config(config_path: Path) -> dict[str, Any]:
    file_config = load_json_config(config_path)
    return {
        "ticketplus_url": get_setting(
            file_config,
            "TICKETPLUS_URL",
            "ticketplus_url",
            "https://ticketplus.com.tw/activity/a56fce0af2da4d41e26b2dfa34b7babc",
        ),
        "poll_ms": int_value(get_setting(file_config, "POLL_MS", "poll_ms", 60000), 60000),
        "poll_min_ms": int_value(get_setting(file_config, "POLL_MIN_MS", "poll_min_ms", 15000), 15000),
        "poll_max_ms": int_value(get_setting(file_config, "POLL_MAX_MS", "poll_max_ms", 60000), 60000),
        "alert_repeat_count": int_value(
            get_setting(file_config, "ALERT_REPEAT_COUNT", "alert_repeat_count", 3),
            3,
        ),
        "alert_repeat_interval_ms": int_value(
            get_setting(file_config, "ALERT_REPEAT_INTERVAL_MS", "alert_repeat_interval_ms", 60000),
            60000,
        ),
        "webhook_url": get_setting(file_config, "WEBHOOK_URL", "webhook_url", ""),
        "webhook_format": str(get_setting(file_config, "WEBHOOK_FORMAT", "webhook_format", "ntfy")).lower(),
        "ntfy_title": get_setting(file_config, "NTFY_TITLE", "ntfy_title", "TicketPlus availability alert"),
        "ntfy_priority": get_setting(file_config, "NTFY_PRIORITY", "ntfy_priority", "urgent"),
        "ntfy_tags": get_setting(file_config, "NTFY_TAGS", "ntfy_tags", "warning,ticket"),
        "extension_trigger_enabled": bool_value(
            get_setting(file_config, "EXTENSION_TRIGGER_ENABLED", "extension_trigger_enabled", True),
            True,
        ),
        "extension_trigger_url": get_setting(
            file_config,
            "EXTENSION_TRIGGER_URL",
            "extension_trigger_url",
            "http://127.0.0.1:16888/trigger",
        ),
        "extension_trigger_method": str(
            get_setting(file_config, "EXTENSION_TRIGGER_METHOD", "extension_trigger_method", "POST")
        ).upper(),
        "headless": bool_value(get_setting(file_config, "HEADLESS", "headless", False), False),
        "browser_channel": get_setting(file_config, "BROWSER_CHANNEL", "browser_channel", "msedge"),
        "timeout_ms": int_value(get_setting(file_config, "TIMEOUT_MS", "timeout_ms", 30000), 30000),
        "state_file": get_setting(file_config, "STATE_FILE", "state_file", ".ticketplus-monitor-state.json"),
        "sold_out_text": get_setting(file_config, "SOLD_OUT_TEXT", "sold_out_text", "銷售一空"),
    }


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def get_next_poll_ms(config: dict[str, Any]) -> int:
    poll_min = config["poll_min_ms"]
    poll_max = config["poll_max_ms"]
    if poll_min > 0 and poll_max >= poll_min:
        return random.randint(poll_min, poll_max)
    return max(1000, config["poll_ms"])


def make_session_id(title: str, date: str, session_time: str) -> str:
    raw = f"{title}|{date}|{session_time}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"{date or 'unknown'}-{digest}"


def is_date_line(line: str) -> bool:
    return bool(DATE_PATTERN.search(line))


def is_time_line(line: str) -> bool:
    return bool(TIME_PATTERN.search(line))


def is_status_line(line: str, sold_out_text: str) -> bool:
    return sold_out_text in line or any(hint in line for hint in STATUS_HINTS)


def find_purchase_start(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if line != PURCHASE_TITLE:
            continue
        window = lines[index + 1 : index + 12]
        has_label_format = any(label in window for label in DATE_LABELS) and any(
            label in window for label in TIME_LABELS
        )
        has_table_format = "場次名稱" in window and "售票狀態" in window
        if has_label_format or has_table_format:
            return index
    return -1


def find_purchase_end(lines: list[str], start_index: int) -> int:
    for index in range(start_index + 1, len(lines)):
        if lines[index] in SECTION_TITLES:
            return index
    return len(lines)


def extract_table_results(purchase_lines: list[str], sold_out_text: str) -> list[SessionResult]:
    data_lines = [line for line in purchase_lines if line not in TABLE_HEADERS]
    results: list[SessionResult] = []
    index = 0

    while index < len(data_lines):
        title = data_lines[index]
        if title in SECTION_TITLES or is_date_line(title) or is_time_line(title):
            index += 1
            continue

        date_index = None
        for candidate in range(index + 1, min(index + 6, len(data_lines))):
            if is_date_line(data_lines[candidate]):
                date_index = candidate
                break
        if date_index is None:
            index += 1
            continue

        time_index = None
        for candidate in range(date_index + 1, min(date_index + 4, len(data_lines))):
            if is_time_line(data_lines[candidate]):
                time_index = candidate
                break
        if time_index is None:
            index = date_index + 1
            continue

        status_index = None
        for candidate in range(time_index + 1, min(time_index + 8, len(data_lines))):
            if is_status_line(data_lines[candidate], sold_out_text):
                status_index = candidate
                break

        if status_index is None:
            next_date_index = None
            for candidate in range(time_index + 1, len(data_lines)):
                if is_date_line(data_lines[candidate]):
                    next_date_index = candidate
                    break
            status_index = (next_date_index - 2) if next_date_index and next_date_index >= time_index + 2 else time_index

        date = data_lines[date_index]
        session_time = data_lines[time_index]
        location = " ".join(data_lines[time_index + 1 : status_index]).strip()
        status_text = data_lines[status_index] if status_index < len(data_lines) else ""
        evidence = data_lines[index : min(status_index + 1, len(data_lines))]
        is_sold_out = sold_out_text in " ".join(evidence)

        results.append(
            SessionResult(
                id=make_session_id(title, date, session_time),
                title=title,
                date=date,
                time=session_time,
                location=location,
                status_text=status_text,
                found=True,
                is_sold_out=is_sold_out,
                is_available=not is_sold_out,
                evidence=evidence,
            )
        )

        index = max(status_index + 1, index + 1)

    return results


def extract_label_results(purchase_lines: list[str], sold_out_text: str) -> list[SessionResult]:
    results: list[SessionResult] = []
    index = 0

    while index < len(purchase_lines):
        try:
            date_label = next(i for i in range(index, len(purchase_lines)) if purchase_lines[i] in DATE_LABELS)
            time_label = next(i for i in range(date_label + 1, len(purchase_lines)) if purchase_lines[i] in TIME_LABELS)
            location_label = next(
                i for i in range(time_label + 1, len(purchase_lines)) if purchase_lines[i] in LOCATION_LABELS
            )
        except StopIteration:
            break

        if date_label == 0:
            index = date_label + 1
            continue

        title = purchase_lines[date_label - 1]
        date = purchase_lines[date_label + 1] if date_label + 1 < len(purchase_lines) else ""
        session_time = purchase_lines[time_label + 1] if time_label + 1 < len(purchase_lines) else ""
        location = purchase_lines[location_label + 1] if location_label + 1 < len(purchase_lines) else ""

        next_date_label = None
        for candidate in range(location_label + 1, len(purchase_lines)):
            if purchase_lines[candidate] in DATE_LABELS:
                next_date_label = candidate
                break

        block_end = next_date_label - 1 if next_date_label is not None else len(purchase_lines)
        evidence = purchase_lines[date_label - 1 : block_end]
        status_candidates = evidence[7:] if len(evidence) > 7 else evidence[4:]
        status_text = " ".join(status_candidates).strip()
        is_sold_out = sold_out_text in " ".join(evidence)

        results.append(
            SessionResult(
                id=make_session_id(title, date, session_time),
                title=title,
                date=date,
                time=session_time,
                location=location,
                status_text=status_text,
                found=True,
                is_sold_out=is_sold_out,
                is_available=not is_sold_out,
                evidence=evidence,
            )
        )

        index = next_date_label - 1 if next_date_label is not None else len(purchase_lines)

    return results


def extract_results_from_text(raw_text: str, sold_out_text: str) -> list[SessionResult]:
    lines = [normalize_line(line) for line in raw_text.splitlines()]
    lines = [line for line in lines if line]
    start_index = find_purchase_start(lines)
    if start_index < 0:
        return []

    end_index = find_purchase_end(lines, start_index)
    purchase_lines = lines[start_index + 1 : end_index]
    if any(line in TABLE_HEADERS for line in purchase_lines):
        return extract_table_results(purchase_lines, sold_out_text)
    return extract_label_results(purchase_lines, sold_out_text)


def read_state(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        return {"availability_by_id": parsed.get("availability_by_id", {})}
    except (OSError, json.JSONDecodeError):
        return {"availability_by_id": {}}


def write_state(path: Path, results: list[SessionResult]) -> None:
    state = {"availability_by_id": {item.id: item.is_available for item in results}}
    with path.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def build_payload(
    config: dict[str, Any],
    results: list[SessionResult],
    changed_to_available: list[SessionResult],
    checked_at: str,
) -> dict[str, Any]:
    return {
        "source": "sold_out_monitor",
        "url": config["ticketplus_url"],
        "checked_at": checked_at,
        "available_count": len([item for item in results if item.is_available]),
        "available_targets": [asdict(item) for item in results if item.is_available],
        "changed_to_available": [asdict(item) for item in changed_to_available],
        "results": [asdict(item) for item in results],
    }


def build_message(changed_to_available: list[SessionResult], checked_at: str) -> str:
    lines = [f"TicketPlus 有票: {checked_at}"]
    for item in changed_to_available:
        lines.append(f"- {item.date} {item.time} {item.title}")
        if item.status_text:
            lines.append(f"  狀態: {item.status_text}")
    return "\n".join(lines)


def post_url(url: str, body: bytes, headers: dict[str, str]) -> tuple[int, str]:
    req = request.Request(url, data=body, headers=headers, method="POST")
    with request.urlopen(req, timeout=30) as response:
        return response.status, response.read().decode("utf-8", errors="replace")


def send_webhook(config: dict[str, Any], payload: dict[str, Any]) -> None:
    webhook_url = config["webhook_url"]
    if not webhook_url:
        raise RuntimeError("webhook_url is not set.")

    if config["webhook_format"] == "ntfy":
        message = build_message(
            [SessionResult(**item) for item in payload["changed_to_available"]],
            payload["checked_at"],
        )
        post_url(
            webhook_url,
            message.encode("utf-8"),
            {
                "Title": str(config["ntfy_title"]),
                "Priority": str(config["ntfy_priority"]),
                "Tags": str(config["ntfy_tags"]),
                "Content-Type": "text/plain; charset=utf-8",
            },
        )
        return

    post_url(
        webhook_url,
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json; charset=utf-8"},
    )


def send_repeated_webhook(config: dict[str, Any], payload: dict[str, Any]) -> None:
    repeat_count = max(1, int(config["alert_repeat_count"]))
    repeat_interval = max(0, int(config["alert_repeat_interval_ms"])) / 1000
    for attempt in range(1, repeat_count + 1):
        send_webhook(config, payload)
        print(f"[{now_iso()}] Webhook sent ({attempt}/{repeat_count})")
        if attempt < repeat_count:
            time.sleep(repeat_interval)


def send_extension_trigger(config: dict[str, Any], payload: dict[str, Any]) -> bool:
    if not config["extension_trigger_enabled"]:
        return False

    url = str(config["extension_trigger_url"])
    method = str(config["extension_trigger_method"]).upper()
    if method == "GET":
        parsed = parse.urlparse(url)
        query = dict(parse.parse_qsl(parsed.query))
        query["fire"] = "1"
        query["id"] = f"monitor-{int(time.time())}"
        final_url = parse.urlunparse(parsed._replace(query=parse.urlencode(query)))
        with request.urlopen(final_url, timeout=10) as response:
            response.read()
        return True

    trigger_payload = {
        "trigger": True,
        "id": f"monitor-{payload['checked_at']}",
        "source": "sold_out_monitor",
        "payload": payload,
    }
    post_url(
        url,
        json.dumps(trigger_payload, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json; charset=utf-8"},
    )
    return True


def fetch_results(config: dict[str, Any], page: Any) -> tuple[str, list[SessionResult]]:
    page.goto(config["ticketplus_url"], wait_until="domcontentloaded", timeout=config["timeout_ms"])
    page.wait_for_timeout(5000)
    page.wait_for_function(
        "() => document.body && document.body.innerText.includes('立即購買')",
        timeout=config["timeout_ms"],
    )
    raw_text = page.evaluate("() => document.body ? document.body.innerText : ''")
    title = page.title()
    return title, extract_results_from_text(raw_text, config["sold_out_text"])


def run_check(config: dict[str, Any], page: Any) -> None:
    checked_at = now_iso()
    title, results = fetch_results(config, page)
    state_path = Path(config["state_file"])
    state = read_state(state_path)

    print(f"[{checked_at}] {title}")
    if not results:
        print("- 找不到立即購買場次")
    for item in results:
        status = "銷售一空" if item.is_sold_out else "可進入/有票訊號"
        print(f"- {item.date} {item.time}: {status} | {item.title}")

    changed_to_available = [
        item
        for item in results
        if item.found and item.is_available and state["availability_by_id"].get(item.id) is not True
    ]

    if changed_to_available:
        payload = build_payload(config, results, changed_to_available, checked_at)
        send_repeated_webhook(config, payload)
        triggered = send_extension_trigger(config, payload)
        dates = ", ".join(f"{item.date} {item.time}" for item in changed_to_available)
        print(f"[{now_iso()}] Available session(s): {dates}; extension_triggered={triggered}")

    write_state(state_path, results)


def send_test_notification(config: dict[str, Any]) -> None:
    checked_at = now_iso()
    sample = SessionResult(
        id="test",
        title="Test notification",
        date="2099-01-01",
        time="12:00",
        location="TicketPlus",
        status_text="test",
        found=True,
        is_sold_out=False,
        is_available=True,
        evidence=[],
    )
    payload = build_payload(config, [sample], [sample], checked_at)
    send_webhook(config, payload)
    print("Test notification sent.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Monitor all Ticket Plus sessions on an activity page.")
    parser.add_argument("--config", default="monitor_config.json", help="Path to JSON config file.")
    parser.add_argument("--once", action="store_true", help="Run one check and exit.")
    parser.add_argument("--test-notify", action="store_true", help="Send one test notification.")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    if not config["webhook_url"]:
        print("webhook_url is not set. Edit monitor_config.json or set WEBHOOK_URL.", file=sys.stderr)
        return 1

    if args.test_notify:
        send_test_notification(config)
        return 0

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=config["headless"],
            channel=config["browser_channel"] or None,
        )
        page = browser.new_page()
        try:
            while True:
                try:
                    run_check(config, page)
                except Exception as error:
                    print(f"[{now_iso()}] Check failed: {error}", file=sys.stderr)
                if args.once:
                    break
                next_poll = get_next_poll_ms(config)
                print(f"[{now_iso()}] Next check in {next_poll}ms")
                time.sleep(next_poll / 1000)
        finally:
            browser.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
