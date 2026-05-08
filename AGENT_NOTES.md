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
  - Added `重新整理時秒數` setting.
  - If `+` is not found after area selection, flow waits `重新整理時秒數`, refreshes, and retries.
  - Added `選區後延遲幾秒按+` setting for waiting before `+` clicks.
  - Added `選擇順序` setting: `top to bottom`, `bottom to top`, `middle`, `random`.
  - Area fallback logic:
    - If keyword is provided, use keyword match first.
    - If keyword is empty, use checked checklist targets.
    - If both are empty, all areas are candidates.
  - Start/Stop now runs flow-loop mode:
    - `Start` triggers full flow with `下一步`.
    - After each full run, waits 0.5s and loops again.
- Schedule controls
  - Added daily schedule settings in popup.
  - Can auto-start and auto-stop by `hh:mm:ss AM/PM` time.
  - Uses explicit buttons: `儲存並排程` and `停止排程`.
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
