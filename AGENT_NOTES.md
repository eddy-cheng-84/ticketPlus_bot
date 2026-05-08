# Ticket Plus Bot - Conversation Summary

## Date
- 2026-05-09

## User Request Summary
- User asked assistant to first read files under this project:
  - `C:\Users\Lu_white\Documents\chrome_extension\ticket_plus_bot`
- User required all follow-up development changes to be committed with Git.
- User asked to create a markdown summary of the conversation for future continuity and commit it into this repo.
- User requested iterative feature development for ticket area selection automation.

## Current Project Snapshot
- Chrome extension with popup + content script workflow.
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
  - Click `更新票數` once.
  - Click panel by keyword.
  - Click `更新票數` then panel by keyword.
  - Click `+` button in current active/expanded panel.
- Seat area discovery and selection
  - Read all panel headers from page and show checklist in popup.
  - Multi-select seat areas for auto targeting.
  - Drag-and-drop sorting for target priority.
  - Persist checklist + order using `chrome.storage.local`.
- Content script messaging API includes
  - `START_BOT`, `STOP_BOT`, `GET_BOT_STATUS`, `GET_BOT_LOGS`
  - `CLICK_REFRESH_ONCE`, `CLICK_PANEL_BY_TEXT`, `CLICK_REFRESH_AND_PANEL_BY_TEXT`
  - `GET_PANEL_AREAS`, `SET_AUTO_TARGETS`, `CLICK_PLUS_ON_ACTIVE_PANEL`

## Git Workflow Agreement
- Assistant should commit every development change requested by user.

## Notes For Next Development
- If user wants stronger seat matching, add exact-match mode and regex mode.
- If user wants quantity automation, add configurable retry and max-plus count.
