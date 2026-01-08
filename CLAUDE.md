# Claude Sidebar - Development Notes

## Project Overview

Claude Sidebar is a Claude Code plugin that provides a visual sidebar panel for managing todos, context, and tasks.

## Project Structure

```
claude-sidebar/
├── .claude-plugin/plugin.json  # Plugin manifest
├── commands/sidebar.md         # /sidebar slash command
├── skills/sidebar-awareness/   # Teaches Claude about sidebar
├── hooks/hooks.json            # TodoWrite sync hook
├── src/
│   ├── cli.ts                  # CLI entry point
│   ├── sync-todos.ts           # Hook script for TodoWrite
│   ├── components/             # Ink React components
│   ├── ipc/                    # Unix socket communication
│   ├── persistence/            # JSON file storage
│   └── terminal/               # tmux integration
```

## Commands

```bash
bun run src/cli.ts show     # Render in current terminal
bun run src/cli.ts spawn    # Launch in tmux split
bun run src/cli.ts update   # Send IPC message
bun run src/cli.ts env      # Show environment info
```

## Key Files

- `src/components/Sidebar.tsx` - Main UI component
- `src/persistence/store.ts` - Data layer
- `src/terminal/tmux.ts` - tmux pane management
- `src/ipc/server.ts` - IPC for real-time updates

## Testing

```bash
# Test CLI works
bun run src/cli.ts env

# Test in actual terminal (not background)
bun run src/cli.ts show

# Test tmux spawn (must be in tmux)
tmux
bun run src/cli.ts spawn
```

## Runtime

Uses Bun instead of Node.js:
- `bun run` instead of `npm run`
- `bun install` for dependencies
- `Bun.$` for shell commands
