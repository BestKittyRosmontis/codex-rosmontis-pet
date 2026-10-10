---
name: dragon-pet
description: Show the installed Rosmontis desktop pet, inspect its status, and read local usage or authorized station balance when the user asks about the pet.
---

Use `dragon_open`, `dragon_status`, `dragon_balance`, and `dragon_usage` provided by this plugin.

- The plugin starts its desktop supervisor automatically when its MCP server loads. The overlay follows the bottom-right of Codex; keep Codex running. Do not require a replacement Codex shortcut.
- Billing setup is user-operated: pet menu -> Codex usage records -> Log in and authorize. The user logs in on the station page, then selects Authorization -> Finish login and authorize.
- Never ask for passwords or login tokens in chat. Never read or print encrypted credential files, Codex auth files, browser storage, or bridge tokens.
- `dragon_balance` is the station account snapshot, not per-turn billing. Website authorization may select a different account than the current Codex key; state the source returned by the tool.
- Local token counts and configured-price estimates are not actual charges. Missing request-to-turn correspondence means actual per-turn cost remains unverified even after login. Do not infer per-turn charges from adjacent balances or timestamps.
- The recipient must authorize their own station account. The plugin does not include or grant API credit.
- Installation is handled by scripts/install-dragon-plugin.ps1. Plugin bootstrap and the current-user login startup entry use PowerShell directly; no VBS engine is required. Preserve pet preferences and history.
- Do not modify Codex binaries, WindowsApps permissions, or client update settings.
