# Ticket Plus Bot - Conversation Summary

## Date
- 2026-05-09

## User Request Summary
- User asked assistant to first read files under this project:
  - `C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot`
- User required all follow-up development changes to be committed with Git.
- User asked to create and maintain a markdown summary for continuity (`AGENT_NOTES.md`).
- User requested iterative feature development for ticket area selection and purchase flow automation.

## Current Project Snapshot
- Chrome extension with popup + content script workflow.
- Domain guard: only works on `ticketplus.com.tw` and subdomains.
- Main files:
  - `manifest.json` (MV3)
  - `background.js`
  - `content.js`
  - `popup/popup.html`
  - `popup/popup.css`
  - `popup/popup.js`
  - `README.md`
  - `AGENT_NOTES.md`

## Implemented Features So Far
- Auto loop control
  - Start/Stop bot from popup.
  - Tick interval 10 seconds.
  - Tick behavior: click `更新票數`; then try selected seat areas by priority.
  - Log buffer increased to 2000 entries; popup displays latest 400 entries.
  - Popup has `自動捲動 Log` toggle (default on).
- Manual actions in popup
  - Individual manual action buttons were removed from popup UI.
  - Main operation path is now the one-click flow plus start/stop loop controls.
- Seat area discovery and selection
  - Read all panel headers from page and show checklist in popup.
  - Multi-select seat areas for auto targeting.
  - Button-based sorting (`上移` / `下移`) for target priority.
  - Persist checklist + order using `chrome.storage.local`.
- One-click purchase flow
  - Added `一鍵執行流程` button.
  - Flow steps: `更新票數 -> 選票區 -> 點 +`.
  - Added `幾張票` setting with hard limit `0~4`.
  - Added `重新整理秒數` setting.
  - If `+` is not found after area selection, flow waits `重新整理秒數`, refreshes, and retries.
  - Added `選區後延遲幾秒按+` setting for waiting before `+` clicks.
  - Added `選擇順序` setting: `top to bottom`, `bottom to top`, `middle`, `random`.
  - Flow settings are persisted automatically on change (`flow_settings_v1`).
  - Area fallback logic:
    - Uses checked checklist targets first.
    - If no targets are checked, all areas are candidates.
  - Seat availability guard:
    - Parses `剩餘 N` from area text.
    - Skips areas with `剩餘 0`.
    - If all desired targets are `剩餘 0`, refreshes and retries detection automatically.
  - Key normalization strips dynamic/status fragments such as `剩餘 N`, `NT ...`, `熱賣中`, `已售完`.
  - Start/Stop now runs flow-loop mode:
    - `Start` triggers full flow with `下一步`.
    - `+` multi-click uses 50ms gap between each click.
    - After final `+`, waits 100ms then clicks `下一步`.
    - After `下一步`, waits `重新整理秒數` then loops next round.
- Schedule controls
  - Added daily schedule settings in popup.
  - Can auto-start and auto-stop by `HH:MM:SS` time input (`type="time"` with `step="1"`).
  - Uses explicit buttons: `儲存並排程` and `停止排程`.
  - Trigger logic runs in content script every second and fires only when crossing the target second (no immediate catch-up trigger for already-passed times).
  - Schedule state is persisted in `chrome.storage.local` and restored by content script.
- Content script messaging API includes
  - `START_BOT`, `STOP_BOT`, `GET_BOT_STATUS`, `GET_BOT_LOGS`
  - `CLICK_REFRESH_ONCE`, `CLICK_PANEL_BY_TEXT`, `CLICK_REFRESH_AND_PANEL_BY_TEXT`
  - `GET_PANEL_AREAS`, `SET_AUTO_TARGETS`, `CLICK_PLUS_ON_ACTIVE_PANEL`, `CLICK_NEXT_STEP`
  - `RUN_PURCHASE_FLOW`

## Git Workflow Agreement
- Assistant should commit every development change requested by user.

## Notes For Next Development
- Optional: keyword-miss fallback (if keyword has no match, fallback to checklist/all areas).
- Optional: add retry policy for panel expansion and plus clicks when page transitions are slow.
