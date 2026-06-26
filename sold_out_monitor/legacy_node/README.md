# Ticket Plus Monitor

This script checks the Ticket Plus activity page on a timer and posts to your webhook when either target session is no longer marked `銷售一空`.

## What it watches

- `LiVE is Smile Always～15～ in Taipei(6/19場次)`
- `LiVE is Smile Always～15～ in Taipei(6/20場次)`

## How it works

The page is rendered on the client side, so the script uses Playwright to open the page, read the visible text, and inspect the block around each target session.

If a target session is found and its nearby text does **not** contain `銷售一空`, the script treats it as available and sends one webhook notification for that specific state.

## Setup

1. Install dependencies:

```powershell
npm.cmd install
```

2. Set your ntfy topic and related headers as environment variables:

```powershell
$env:WEBHOOK_URL="https://ntfy.sh/your-topic"
$env:WEBHOOK_FORMAT="ntfy"
$env:NTFY_TITLE="ntfy 彈窗測試"
$env:NTFY_PRIORITY="urgent"
$env:NTFY_TAGS="warning"
$env:EXTENSION_TRIGGER_ENABLED="true"
$env:EXTENSION_TRIGGER_URL="http://127.0.0.1:16888/trigger"
$env:EXTENSION_TRIGGER_METHOD="POST"
$env:POLL_MIN_MS="45000"
$env:POLL_MAX_MS="90000"
$env:BROWSER_CHANNEL="chrome"
$env:HEADLESS="false"
```

3. Run a one-time check:

```powershell
npm.cmd run check
```

4. Run continuous monitoring:

```powershell
npm.cmd start
```

5. Send a test ntfy notification without checking the ticket page:

```powershell
node monitor.js --test-notify
```

## Windows batch files

You can also run the included batch files:

```bat
start-monitor.bat
```

For a test notification:

```bat
test-notify.bat
```

Logs are saved automatically to:

```text
logs\monitor.log
logs\test-notify.log
```

## ntfy format

By default the script now sends notifications in a format equivalent to:

```powershell
curl -H "Title: ntfy 彈窗測試" -H "Priority: urgent" -H "Tags: warning" -d "這是一則 urgent 彈窗測試通知" https://ntfy.sh/your-topic
```

When the monitor finds availability, it sends a plain-text message body summarizing which session no longer shows `銷售一空`.

If you want a fixed interval instead of random polling, set:

```powershell
$env:POLL_MS="60000"
```

If `POLL_MIN_MS` and `POLL_MAX_MS` are both set and valid, the script uses a random delay between them for each loop.

When availability is detected, the script repeats the webhook 3 times by default with a 60 second gap between sends. You can control that with:

```powershell
$env:ALERT_REPEAT_COUNT="3"
$env:ALERT_REPEAT_INTERVAL_MS="60000"
```

## Optional JSON mode

If you still want generic JSON webhook behavior, set:

```powershell
$env:WEBHOOK_FORMAT="json"
```

In JSON mode the script sends the structured payload with `results`, `availableTargets`, and `checkedAt`.

## Chrome extension trigger

If you also want the monitor to wake up your Chrome extension when availability is detected, keep the local Python trigger server running and set:

```powershell
$env:EXTENSION_TRIGGER_ENABLED="true"
$env:EXTENSION_TRIGGER_URL="http://127.0.0.1:16888/trigger"
$env:EXTENSION_TRIGGER_METHOD="POST"
```

The flow becomes:

1. Monitor finds a target that changed from sold out to available.
2. Monitor sends the webhook notification.
3. Monitor sends a local HTTP trigger to the Chrome extension trigger server.
4. The extension receives that trigger and starts using its own saved seat-area settings.

Use `POST` for the cleanest integration with the provided `trigger_server.py`. `GET` also works and will call the same endpoint with `?fire=1`.

## Notes

- The monitor keeps a small `.ticketplus-monitor-state.json` file so it does not spam the same webhook repeatedly for the exact same availability state.
- If you prefer Microsoft Edge, set `BROWSER_CHANNEL=msedge`.
- `HEADLESS=false` is the safer default here because this site may return less reliable results to headless automation.
- If Ticket Plus changes the page wording or layout, the parsing logic in `monitor.js` may need a small update.
