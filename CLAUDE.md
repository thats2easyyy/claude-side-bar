# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-sidebar is a visual sidebar panel for managing a task queue alongside Claude Code. Supports two backends:
- **iTerm2** (preferred) - Uses AppleScript, preserves scrollback
- **tmux** - Uses tmux splits, has scrollback limitations

## Commands

```bash
cc-sidebar show       # Render sidebar in current terminal
cc-sidebar spawn      # Launch in split pane (auto-detects iTerm2 vs tmux)
cc-sidebar spawn --tmux  # Force tmux mode
cc-sidebar env        # Show environment info
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

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run src/cli.ts show

# Spawn in split pane
bun run src/cli.ts spawn
```
