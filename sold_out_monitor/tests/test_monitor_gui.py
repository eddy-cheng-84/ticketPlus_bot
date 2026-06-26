import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("monitor_gui", ROOT / "monitor_gui.py")
monitor_gui = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor_gui)


class MonitorGuiConfigTests(unittest.TestCase):
    def test_form_values_to_config_coerces_seconds_to_milliseconds(self):
        values = {
            "ticketplus_url": "https://ticketplus.com.tw/activity/demo",
            "webhook_url": "https://ntfy.sh/demo",
            "webhook_format": "ntfy",
            "ntfy_title": "TicketPlus availability alert",
            "ntfy_priority": "urgent",
            "ntfy_tags": "warning,ticket",
            "extension_trigger_enabled": True,
            "extension_trigger_url": "http://127.0.0.1:16888/trigger",
            "extension_trigger_method": "POST",
            "headless": False,
            "browser_channel": "msedge",
            "poll_min_sec": "15",
            "poll_max_sec": "60",
            "alert_repeat_count": "3",
            "alert_repeat_interval_sec": "60",
            "timeout_sec": "30",
            "sold_out_text": "銷售一空",
            "state_file": ".ticketplus-monitor-state.json",
        }

        config = monitor_gui.form_values_to_config(values)

        self.assertEqual(config["poll_min_ms"], 15000)
        self.assertEqual(config["poll_max_ms"], 60000)
        self.assertEqual(config["alert_repeat_interval_ms"], 60000)
        self.assertEqual(config["timeout_ms"], 30000)
        self.assertEqual(config["browser_channel"], "msedge")
        self.assertIs(config["extension_trigger_enabled"], True)
        self.assertIs(config["headless"], False)

    def test_config_to_form_values_converts_milliseconds_to_seconds(self):
        config = {
            "ticketplus_url": "https://ticketplus.com.tw/activity/demo",
            "webhook_url": "https://ntfy.sh/demo",
            "webhook_format": "json",
            "ntfy_title": "Ticket",
            "ntfy_priority": "default",
            "ntfy_tags": "ticket",
            "extension_trigger_enabled": False,
            "extension_trigger_url": "http://127.0.0.1:16888/trigger",
            "extension_trigger_method": "GET",
            "headless": True,
            "browser_channel": "chrome",
            "poll_min_ms": 25000,
            "poll_max_ms": 65000,
            "alert_repeat_count": 2,
            "alert_repeat_interval_ms": 45000,
            "timeout_ms": 35000,
            "sold_out_text": "銷售一空",
            "state_file": ".state.json",
        }

        values = monitor_gui.config_to_form_values(config)

        self.assertEqual(values["poll_min_sec"], "25")
        self.assertEqual(values["poll_max_sec"], "65")
        self.assertEqual(values["alert_repeat_interval_sec"], "45")
        self.assertEqual(values["timeout_sec"], "35")
        self.assertEqual(values["browser_channel"], "chrome")
        self.assertIs(values["headless"], True)

    def test_form_values_to_config_rejects_invalid_poll_range(self):
        values = {
            "ticketplus_url": "https://ticketplus.com.tw/activity/demo",
            "webhook_url": "",
            "webhook_format": "ntfy",
            "ntfy_title": "TicketPlus availability alert",
            "ntfy_priority": "urgent",
            "ntfy_tags": "warning,ticket",
            "extension_trigger_enabled": True,
            "extension_trigger_url": "http://127.0.0.1:16888/trigger",
            "extension_trigger_method": "POST",
            "headless": False,
            "browser_channel": "msedge",
            "poll_min_sec": "90",
            "poll_max_sec": "30",
            "alert_repeat_count": "3",
            "alert_repeat_interval_sec": "60",
            "timeout_sec": "30",
            "sold_out_text": "銷售一空",
            "state_file": ".ticketplus-monitor-state.json",
        }

        with self.assertRaises(ValueError):
            monitor_gui.form_values_to_config(values)

    def test_resolve_app_dir_uses_parent_when_frozen_exe_lives_in_dist(self):
        app_dir = monitor_gui.resolve_app_dir(
            True,
            Path(r"C:\tool\sold_out_monitor\dist\sold_out_monitor_gui.exe"),
            Path(r"C:\tool\sold_out_monitor\monitor_gui.py"),
        )

        self.assertEqual(app_dir, Path(r"C:\tool\sold_out_monitor"))


if __name__ == "__main__":
    unittest.main()
