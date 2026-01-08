# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Sidebar is a Claude Code plugin that provides a visual sidebar panel for managing a task queue. It runs in a tmux split pane alongside Claude Code.

## Commands

```bash
bun run src/cli.ts show     # Render sidebar in current terminal
bun run src/cli.ts spawn    # Launch in tmux split pane (must be in tmux)
bun run src/cli.ts env      # Show environment info (tmux status, socket path)
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
