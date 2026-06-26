# Sold Out Monitor

This folder contains a deploy-friendly Ticket Plus sold-out monitor.

The Python version monitors every session listed under the activity page's `立即購買` section. To switch events, edit only `monitor_config.json` and change `ticketplus_url`.

## Quick Start

1. Edit `monitor_config.json`.
2. Run `start-monitor.bat`.

If `dist\sold_out_monitor.exe` exists, the batch file runs the exe. Otherwise it falls back to:

```bat
python monitor.py --config monitor_config.json
```

## Build Exe

Run:

```bat
build-exe.bat
```

The output will be:

```text
dist\sold_out_monitor.exe
```

The exe uses your installed Chrome by default through Playwright's `browser_channel: "chrome"` setting.

## Config

Main settings:

```json
{
  "ticketplus_url": "https://ticketplus.com.tw/activity/...",
  "webhook_url": "https://ntfy.sh/your-topic",
  "extension_trigger_enabled": true,
  "extension_trigger_url": "http://127.0.0.1:16888/trigger"
}
```

The monitor treats a session as sold out when its card contains:

```text
銷售一空
```

Any session that does not contain that text is treated as available, then the monitor sends the webhook and triggers the Chrome extension server.

## Commands

Run one check:

```bat
sold_out_monitor.exe --config monitor_config.json --once
```

Send a test notification:

```bat
sold_out_monitor.exe --config monitor_config.json --test-notify
```

## Legacy Node Version

The original Node.js monitor is preserved under `legacy_node`.
