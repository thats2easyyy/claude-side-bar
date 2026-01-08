# Claude Sidebar

A Claude Code plugin that provides a visual sidebar panel for managing todos, context, and tasks—running alongside Claude Code in a split terminal pane.

```
┌─────────────────────────────┬──────────────────┐
│                             │  Claude Sidebar  │
│       Claude Code           │ ─────────────────│
│                             │ Todos │ Context  │
│                             │ ● Review PR      │
│                             │ ◐ Fix auth bug   │
└─────────────────────────────┴──────────────────┘
```

## Features

- **Real-time todo sync**: Claude's TodoWrite items appear automatically
- **Task queue**: Add tasks for Claude to work on
- **Context panel**: Store files and notes for reference
- **Keyboard-driven**: Full keyboard navigation
- **Persistent**: Data survives restarts

## Installation

```bash
# Install the plugin in Claude Code
/plugin install /path/to/claude-sidebar
```

## Usage

```bash
# Start tmux if not already in a session
tmux

# Open the sidebar
/sidebar
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Tab / Shift+Tab | Switch tabs |
| Up / Down | Navigate list |
| a | Add new item |
| d | Delete selected item |
| Enter | Select task for Claude |
| Esc | Close sidebar |

## How It Works

1. **Sidebar spawns in tmux**: Creates a 33% width pane on the right
2. **Todos auto-sync**: A hook captures TodoWrite and updates the sidebar
3. **Task selection**: Select a task and Claude reads it from `~/.claude-sidebar/selected.json`

## Development

```bash
# Install dependencies
bun install

# Run standalone (in terminal)
bun run src/cli.ts show

# Spawn in tmux pane
bun run src/cli.ts spawn

# Check environment
bun run src/cli.ts env
```

## Tech Stack

- **Runtime**: Bun
- **Terminal UI**: Ink (React)
- **Split panes**: tmux
- **IPC**: Unix domain sockets
- **Persistence**: JSON files in `~/.claude-sidebar/`

## Files

Data is stored in `~/.claude-sidebar/`:

| File | Purpose |
|------|---------|
| `todos.json` | Claude's todos (synced from TodoWrite) |
| `tasks.json` | User's task queue |
| `selected.json` | Currently selected task |
| `context.json` | Files and notes |
