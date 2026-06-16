# Chrome Extension Scaffold

## Load in Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Structure
- manifest.json
- background.js
- content.js
- popup/

## Minimal External Trigger Example
1. Run the local trigger server:
   `python trigger_server.py`
2. Reload the extension in Chrome.
3. Open the Ticketplus target page.
4. In the side panel, enable external HTTP trigger and set the URL to:
   `http://127.0.0.1:16888/trigger`
5. Save the setting.

### Quick test
- Open:
  `http://127.0.0.1:16888/trigger?fire=1`
- Then let the extension poll, or click the panel button `立即測試外部觸發`

### External program POST example
You can arm one trigger with:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:16888/trigger `
  -ContentType "application/json" `
  -Body '{"trigger":true,"id":"job-001"}'
```

You can also include start options:

```json
{
  "trigger": true,
  "id": "job-002",
  "options": {
    "selectedTargets": ["A區"],
    "orderMode": "top_to_bottom",
    "plusCount": 2,
    "refreshToAreaDelayMs": 1500,
    "areaToPlusDelayMs": 300
  }
}
```
