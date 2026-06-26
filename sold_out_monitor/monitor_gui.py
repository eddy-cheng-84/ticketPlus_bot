import json
import queue
import sys
import threading
import time
import traceback
from dataclasses import asdict
from pathlib import Path
from tkinter import BooleanVar, StringVar, Tk, messagebox
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText
from typing import Any, Callable

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import monitor
from playwright.sync_api import sync_playwright


def resolve_app_dir(is_frozen: bool, executable_path: Path, file_path: Path) -> Path:
    if is_frozen:
        executable_dir = executable_path.resolve().parent
        if executable_dir.name.lower() == "dist":
            return executable_dir.parent
        return executable_dir
    return file_path.resolve().parent


def app_dir() -> Path:
    return resolve_app_dir(
        bool(getattr(sys, "frozen", False)),
        Path(sys.executable),
        Path(__file__),
    )


CONFIG_PATH = app_dir() / "monitor_config.json"
EXAMPLE_CONFIG_PATH = app_dir() / "monitor_config.example.json"


def _positive_int(value: Any, field_name: str, minimum: int = 0) -> int:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 必須是數字") from exc
    if number < minimum:
        raise ValueError(f"{field_name} 必須 >= {minimum}")
    return number


def _seconds_to_ms(value: Any, field_name: str, minimum: int = 0) -> int:
    return _positive_int(value, field_name, minimum) * 1000


def _ms_to_seconds(value: Any) -> str:
    try:
        return str(int(value) // 1000)
    except (TypeError, ValueError):
        return "0"


def form_values_to_config(values: dict[str, Any]) -> dict[str, Any]:
    ticketplus_url = str(values.get("ticketplus_url", "")).strip()
    if not ticketplus_url:
        raise ValueError("活動網址不能空白")

    poll_min_ms = _seconds_to_ms(values.get("poll_min_sec", "15"), "最小輪詢秒數", 1)
    poll_max_ms = _seconds_to_ms(values.get("poll_max_sec", "60"), "最大輪詢秒數", 1)
    if poll_max_ms < poll_min_ms:
        raise ValueError("最大輪詢秒數不能小於最小輪詢秒數")

    alert_repeat_count = _positive_int(values.get("alert_repeat_count", "1"), "通知重複次數", 1)
    alert_repeat_interval_ms = _seconds_to_ms(
        values.get("alert_repeat_interval_sec", "60"),
        "通知重複間隔秒數",
        0,
    )
    timeout_ms = _seconds_to_ms(values.get("timeout_sec", "30"), "等待頁面 timeout 秒數", 1)

    config = {
        "ticketplus_url": ticketplus_url,
        "webhook_url": str(values.get("webhook_url", "")).strip(),
        "webhook_format": str(values.get("webhook_format", "ntfy")).strip().lower() or "ntfy",
        "ntfy_title": str(values.get("ntfy_title", "")).strip() or "TicketPlus availability alert",
        "ntfy_priority": str(values.get("ntfy_priority", "urgent")).strip() or "urgent",
        "ntfy_tags": str(values.get("ntfy_tags", "warning,ticket")).strip() or "warning,ticket",
        "extension_trigger_enabled": bool(values.get("extension_trigger_enabled", True)),
        "extension_trigger_url": str(values.get("extension_trigger_url", "")).strip()
        or "http://127.0.0.1:16888/trigger",
        "extension_trigger_method": str(values.get("extension_trigger_method", "POST")).strip().upper() or "POST",
        "headless": bool(values.get("headless", False)),
        "browser_channel": str(values.get("browser_channel", "msedge")).strip() or "msedge",
        "poll_min_ms": poll_min_ms,
        "poll_max_ms": poll_max_ms,
        "alert_repeat_count": alert_repeat_count,
        "alert_repeat_interval_ms": alert_repeat_interval_ms,
        "timeout_ms": timeout_ms,
        "sold_out_text": str(values.get("sold_out_text", "銷售一空")).strip() or "銷售一空",
        "state_file": str(values.get("state_file", ".ticketplus-monitor-state.json")).strip()
        or ".ticketplus-monitor-state.json",
    }
    return config


def config_to_form_values(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticketplus_url": str(config.get("ticketplus_url", "")),
        "webhook_url": str(config.get("webhook_url", "")),
        "webhook_format": str(config.get("webhook_format", "ntfy")),
        "ntfy_title": str(config.get("ntfy_title", "TicketPlus availability alert")),
        "ntfy_priority": str(config.get("ntfy_priority", "urgent")),
        "ntfy_tags": str(config.get("ntfy_tags", "warning,ticket")),
        "extension_trigger_enabled": bool(config.get("extension_trigger_enabled", True)),
        "extension_trigger_url": str(config.get("extension_trigger_url", "http://127.0.0.1:16888/trigger")),
        "extension_trigger_method": str(config.get("extension_trigger_method", "POST")),
        "headless": bool(config.get("headless", False)),
        "browser_channel": str(config.get("browser_channel", "msedge")),
        "poll_min_sec": _ms_to_seconds(config.get("poll_min_ms", 15000)),
        "poll_max_sec": _ms_to_seconds(config.get("poll_max_ms", 60000)),
        "alert_repeat_count": str(config.get("alert_repeat_count", 3)),
        "alert_repeat_interval_sec": _ms_to_seconds(config.get("alert_repeat_interval_ms", 60000)),
        "timeout_sec": _ms_to_seconds(config.get("timeout_ms", 30000)),
        "sold_out_text": str(config.get("sold_out_text", "銷售一空")),
        "state_file": str(config.get("state_file", ".ticketplus-monitor-state.json")),
    }


def read_gui_config(config_path: Path = CONFIG_PATH, example_path: Path = EXAMPLE_CONFIG_PATH) -> dict[str, Any]:
    source_path = config_path if config_path.exists() else example_path
    config = monitor.load_config(source_path)
    if config_path.exists():
        return config
    return config


def write_gui_config(config: dict[str, Any], config_path: Path = CONFIG_PATH) -> None:
    with config_path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def format_result_lines(title: str, results: list[monitor.SessionResult]) -> list[str]:
    lines = [f"頁面：{title}"]
    if not results:
        return lines + ["找不到立即購買場次"]
    for item in results:
        status = "銷售一空" if item.is_sold_out else "可通知"
        lines.append(f"{item.date} {item.time} | {status} | {item.title}")
    return lines


class MonitorGui(Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Ticket Plus Sold Out Monitor")
        self.geometry("1040x760")
        self.minsize(900, 650)

        self.log_queue: queue.Queue[str] = queue.Queue()
        self.stop_event = threading.Event()
        self.worker_thread: threading.Thread | None = None

        self.vars = self._create_vars(config_to_form_values(read_gui_config()))
        self._build_ui()
        self.after(120, self._drain_log_queue)
        self.log("GUI 已啟動。建議先按「掃描一次」。")

    def _create_vars(self, values: dict[str, Any]) -> dict[str, StringVar | BooleanVar]:
        return {
            "ticketplus_url": StringVar(value=values["ticketplus_url"]),
            "webhook_url": StringVar(value=values["webhook_url"]),
            "webhook_format": StringVar(value=values["webhook_format"]),
            "ntfy_title": StringVar(value=values["ntfy_title"]),
            "ntfy_priority": StringVar(value=values["ntfy_priority"]),
            "ntfy_tags": StringVar(value=values["ntfy_tags"]),
            "extension_trigger_enabled": BooleanVar(value=values["extension_trigger_enabled"]),
            "extension_trigger_url": StringVar(value=values["extension_trigger_url"]),
            "extension_trigger_method": StringVar(value=values["extension_trigger_method"]),
            "headless": BooleanVar(value=values["headless"]),
            "browser_channel": StringVar(value=values["browser_channel"]),
            "poll_min_sec": StringVar(value=values["poll_min_sec"]),
            "poll_max_sec": StringVar(value=values["poll_max_sec"]),
            "alert_repeat_count": StringVar(value=values["alert_repeat_count"]),
            "alert_repeat_interval_sec": StringVar(value=values["alert_repeat_interval_sec"]),
            "timeout_sec": StringVar(value=values["timeout_sec"]),
            "sold_out_text": StringVar(value=values["sold_out_text"]),
            "state_file": StringVar(value=values["state_file"]),
        }

    def _build_ui(self) -> None:
        root = ttk.Frame(self, padding=14)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(3, weight=1)

        self._build_basic_frame(root)
        self._build_notify_frame(root)
        self._build_buttons(root)
        self._build_log(root)

    def _build_basic_frame(self, parent: ttk.Frame) -> None:
        frame = ttk.LabelFrame(parent, text="基本設定", padding=12)
        frame.grid(row=0, column=0, sticky="ew")
        frame.columnconfigure(1, weight=1)
        frame.columnconfigure(3, weight=1)

        self._entry(frame, "活動網址", "ticketplus_url", 0, 0, columnspan=3)
        self._combo(frame, "瀏覽器", "browser_channel", ["msedge", "chrome", ""], 1, 0)
        ttk.Checkbutton(frame, text="Headless 背景執行", variable=self.vars["headless"]).grid(
            row=1, column=2, sticky="w", padx=8, pady=5
        )
        self._entry(frame, "售完文字", "sold_out_text", 1, 3)
        self._entry(frame, "最小輪詢秒數", "poll_min_sec", 2, 0)
        self._entry(frame, "最大輪詢秒數", "poll_max_sec", 2, 2)
        self._entry(frame, "頁面 timeout 秒數", "timeout_sec", 3, 0)
        self._entry(frame, "狀態檔", "state_file", 3, 2)

    def _build_notify_frame(self, parent: ttk.Frame) -> None:
        frame = ttk.LabelFrame(parent, text="通知與 Extension Trigger", padding=12)
        frame.grid(row=1, column=0, sticky="ew", pady=(10, 0))
        frame.columnconfigure(1, weight=1)
        frame.columnconfigure(3, weight=1)

        self._entry(frame, "Webhook URL", "webhook_url", 0, 0, columnspan=3)
        self._combo(frame, "格式", "webhook_format", ["ntfy", "json"], 1, 0)
        self._entry(frame, "ntfy 標題", "ntfy_title", 1, 2)
        self._entry(frame, "ntfy Priority", "ntfy_priority", 2, 0)
        self._entry(frame, "ntfy Tags", "ntfy_tags", 2, 2)
        ttk.Checkbutton(
            frame,
            text="啟用 Extension Trigger",
            variable=self.vars["extension_trigger_enabled"],
        ).grid(row=3, column=0, columnspan=2, sticky="w", padx=8, pady=5)
        self._entry(frame, "Trigger URL", "extension_trigger_url", 4, 0, columnspan=3)
        self._combo(frame, "Trigger Method", "extension_trigger_method", ["POST", "GET"], 5, 0)
        self._entry(frame, "通知重複次數", "alert_repeat_count", 5, 2)
        self._entry(frame, "重複間隔秒數", "alert_repeat_interval_sec", 6, 0)

    def _build_buttons(self, parent: ttk.Frame) -> None:
        frame = ttk.Frame(parent)
        frame.grid(row=2, column=0, sticky="ew", pady=12)
        for index in range(6):
            frame.columnconfigure(index, weight=1)

        ttk.Button(frame, text="儲存設定", command=self.save_config).grid(row=0, column=0, sticky="ew", padx=4)
        ttk.Button(frame, text="掃描一次", command=self.scan_once).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(frame, text="測試通知", command=self.test_notify).grid(row=0, column=2, sticky="ew", padx=4)
        ttk.Button(frame, text="開始監控", command=self.start_monitor).grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Button(frame, text="停止", command=self.stop_monitor).grid(row=0, column=4, sticky="ew", padx=4)
        ttk.Button(frame, text="清除 Log", command=self.clear_log).grid(row=0, column=5, sticky="ew", padx=4)

    def _build_log(self, parent: ttk.Frame) -> None:
        frame = ttk.LabelFrame(parent, text="Log / Debug", padding=8)
        frame.grid(row=3, column=0, sticky="nsew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        self.log_text = ScrolledText(frame, height=18, wrap="word", font=("Consolas", 10))
        self.log_text.grid(row=0, column=0, sticky="nsew")

    def _entry(
        self,
        parent: ttk.Frame,
        label: str,
        key: str,
        row: int,
        column: int,
        columnspan: int = 1,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w", padx=8, pady=5)
        ttk.Entry(parent, textvariable=self.vars[key]).grid(
            row=row,
            column=column + 1,
            columnspan=columnspan,
            sticky="ew",
            padx=8,
            pady=5,
        )

    def _combo(
        self,
        parent: ttk.Frame,
        label: str,
        key: str,
        values: list[str],
        row: int,
        column: int,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w", padx=8, pady=5)
        ttk.Combobox(parent, textvariable=self.vars[key], values=values, state="readonly").grid(
            row=row,
            column=column + 1,
            sticky="ew",
            padx=8,
            pady=5,
        )

    def form_values(self) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for key, variable in self.vars.items():
            values[key] = variable.get()
        return values

    def current_config(self) -> dict[str, Any]:
        config = form_values_to_config(self.form_values())
        config["state_file"] = str((app_dir() / config["state_file"]).resolve())
        return config

    def save_config(self) -> bool:
        try:
            config = form_values_to_config(self.form_values())
            write_gui_config(config)
        except Exception as error:
            messagebox.showerror("設定錯誤", str(error))
            self.log(f"設定儲存失敗：{error}")
            return False
        self.log(f"設定已儲存：{CONFIG_PATH}")
        return True

    def scan_once(self) -> None:
        self._start_worker("掃描一次", self._scan_once_worker)

    def test_notify(self) -> None:
        self._start_worker("測試通知", self._test_notify_worker)

    def start_monitor(self) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            self.log("已有工作執行中，請先停止或等待完成。")
            return
        if not self.save_config():
            return
        self.stop_event.clear()
        self.worker_thread = threading.Thread(target=self._monitor_loop_worker, daemon=True)
        self.worker_thread.start()
        self.log("開始監控。")

    def stop_monitor(self) -> None:
        self.stop_event.set()
        self.log("已送出停止要求。")

    def clear_log(self) -> None:
        self.log_text.delete("1.0", "end")

    def _start_worker(self, name: str, target: Callable[[], None]) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            self.log("已有工作執行中，請先停止或等待完成。")
            return
        if not self.save_config():
            return
        self.stop_event.clear()
        self.worker_thread = threading.Thread(target=self._wrap_worker(name, target), daemon=True)
        self.worker_thread.start()

    def _wrap_worker(self, name: str, target: Callable[[], None]) -> Callable[[], None]:
        def run() -> None:
            self.log(f"{name} 開始。")
            try:
                target()
                self.log(f"{name} 結束。")
            except Exception as error:
                self.log(f"{name} 失敗：{error}")
                self.log(traceback.format_exc())

        return run

    def _scan_once_worker(self) -> None:
        config = self.current_config()
        title, results = self._fetch_results(config)
        for line in format_result_lines(title, results):
            self.log(line)

    def _test_notify_worker(self) -> None:
        config = self.current_config()
        monitor.send_test_notification(config)
        self.log("測試通知已送出。")

    def _monitor_loop_worker(self) -> None:
        config = self.current_config()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=config["headless"],
                channel=config["browser_channel"] or None,
            )
            page = browser.new_page()
            try:
                while not self.stop_event.is_set():
                    try:
                        self._run_check_with_log(config, page)
                    except Exception as error:
                        self.log(f"本輪監控失敗：{error}")
                        self.log(traceback.format_exc())
                    wait_ms = monitor.get_next_poll_ms(config)
                    self.log(f"下一輪等待 {wait_ms // 1000} 秒。")
                    if self.stop_event.wait(wait_ms / 1000):
                        break
            finally:
                browser.close()
        self.log("監控已停止。")

    def _fetch_results(self, config: dict[str, Any]) -> tuple[str, list[monitor.SessionResult]]:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=config["headless"],
                channel=config["browser_channel"] or None,
            )
            page = browser.new_page()
            try:
                return monitor.fetch_results(config, page)
            finally:
                browser.close()

    def _run_check_with_log(self, config: dict[str, Any], page: Any) -> None:
        checked_at = monitor.now_iso()
        title, results = monitor.fetch_results(config, page)
        state_path = Path(config["state_file"])
        state = monitor.read_state(state_path)

        self.log(f"[{checked_at}] {title}")
        for line in format_result_lines(title, results)[1:]:
            self.log(line)

        changed_to_available = [
            item
            for item in results
            if item.found and item.is_available and state["availability_by_id"].get(item.id) is not True
        ]
        if changed_to_available:
            payload = monitor.build_payload(config, results, changed_to_available, checked_at)
            monitor.send_repeated_webhook(config, payload)
            triggered = monitor.send_extension_trigger(config, payload)
            dates = ", ".join(f"{item.date} {item.time}" for item in changed_to_available)
            self.log(f"有票訊號：{dates}; extension_triggered={triggered}")
        else:
            self.log("本輪沒有新的有票訊號。")

        monitor.write_state(state_path, results)

    def log(self, message: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        self.log_queue.put(f"[{stamp}] {message}")

    def _drain_log_queue(self) -> None:
        while True:
            try:
                message = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_text.insert("end", message + "\n")
            self.log_text.see("end")
        self.after(120, self._drain_log_queue)


def main() -> int:
    if "--smoke-test" in sys.argv:
        config = form_values_to_config(config_to_form_values(read_gui_config()))
        print(f"GUI smoke test OK: {config['browser_channel']} {config['ticketplus_url']}")
        return 0

    app = MonitorGui()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
