# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Planning

Use the `atomic-plans` skill for all planning work:

```
/atomic-plans /Users/tyler/Desktop/notes/Projects/Claude Code Sidebar
```

**When to use:**
- Starting new work → Read `_index.md` first, then create a new plan
- Resuming work → Read existing plans to understand context
- Fixing mistakes or adding missing info → Edit existing plan files

**Plan location:** `/Users/tyler/Desktop/notes/Projects/Claude Code Sidebar/`

## Project Overview

Claude Sidebar is a visual sidebar panel for managing a task queue alongside Claude Code. Supports two backends:
- **iTerm2** (preferred) - Uses AppleScript, preserves scrollback
- **tmux** - Uses tmux splits, has scrollback limitations

## Commands

```bash
bun run src/cli.ts show       # Render sidebar in current terminal
bun run src/cli.ts spawn      # Launch in split pane (auto-detects iTerm2 vs tmux)
bun run src/cli.ts spawn --tmux  # Force tmux mode
bun run src/cli.ts env        # Show environment info
```

## Architecture

**Terminal Rendering**: Uses raw ANSI escape codes (`src/components/RawSidebar.tsx`) instead of Ink/React to avoid flicker. Key techniques:
- Synchronized output mode (DEC 2026: `\x1b[?2026h` / `\x1b[?2026l`) wraps all screen updates
- 256-color mode (`48;5;N`) for background colors
- `stty -echo raw` for input handling
- Polling intervals are paused during input mode to prevent background redraws

**Data Flow**:
- `src/persistence/store.ts` - JSON files in `~/.claude-sidebar/` (tasks.json, active.json, history.log)
- `src/terminal/tmux.ts` - Pane management, sends tasks to Claude Code pane via `tmux send-keys`
- `src/ipc/` - Unix socket server/client for external updates (not heavily used currently)

**Task Lifecycle**:
1. User adds task to queue (`addTask`)
2. User selects task with Enter (`activateTask` - moves to active, removes from queue)
3. Task is sent to Claude Code pane
4. Sidebar polls Claude's pane output (`isClaudeAtPrompt`) to detect completion
5. Task moves to history log (`completeActiveTask`)

## Runtime

Uses Bun, not Node.js:
- `bun run` instead of `npm run`
- `bun install` for dependencies
- `Bun.$` for shell commands in tmux.ts
