---
name: sidebar
description: Open the Claude Code sidebar panel for task queue management
---

# Sidebar Command

Spawn the Claude Sidebar in a tmux split pane.

## Requirements

**You must be running Claude Code inside a tmux session.** Check the TMUX environment variable - if it's empty, tell the user to:
1. Start or attach to tmux: `tmux` or `tmux attach`
2. Run Claude Code from inside tmux

## Spawning the Sidebar

Run this command to spawn the sidebar:

```bash
cd ${CLAUDE_PLUGIN_ROOT} && bun run src/cli.ts spawn
```

The sidebar will appear on the right side (50 chars wide) showing:
- **Active**: Current task sent to Claude (auto-completes when Claude finishes)
- **Queue**: User's task backlog

## Keyboard Shortcuts (in sidebar)

| Key | Action |
|-----|--------|
| Tab | Switch between Active and Queue sections |
| ↑↓ or j/k | Navigate queue list |
| 1-9 | Quick select queue item by number |
| a | Add new task to queue |
| e | Edit selected queue item |
| d | Delete selected item (or clear active task) |
| Enter | Send selected task to Claude |
| Esc | Close sidebar |

## How It Works

1. Sidebar spawns in a tmux split pane (50 chars fixed width)
2. User adds tasks to Queue via `a` key
3. User presses Enter to send a task to Claude
4. Task moves to Active section, text is injected into Claude's input
5. Sidebar polls Claude's pane for completion (detects when Claude returns to prompt)
6. When complete, task is logged to history and Active section clears

## Checking Sidebar Status

```bash
cd ${CLAUDE_PLUGIN_ROOT} && bun run src/cli.ts env
```

## Closing the Sidebar

User can press `Esc` in the sidebar, or close the tmux pane:

```bash
tmux kill-pane -t $(cat /tmp/claude-sidebar-pane-id)
```
