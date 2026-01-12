# cc-sidebar

A visual sidebar for managing tasks alongside [Claude Code](https://claude.ai/code). Run it in a split pane next to your Claude Code session to queue tasks, track progress, and stay organized.

```
+-------------------------------+------------------+
|                               |   cc-sidebar     |
|        Claude Code            |------------------|
|                               | Claude           |
|                               |   Fixing bug...  |
|                               |                  |
|                               | Queue            |
|                               |   Add tests      |
|                               |   Update docs    |
+-------------------------------+------------------+
```

## Features

- **Task Queue**: Add tasks for Claude to work through
- **Auto-completion detection**: Sidebar detects when Claude finishes a task
- **Keyboard-driven**: Full keyboard navigation
- **iTerm2 + tmux support**: Works with both (iTerm2 preferred)
- **Persistent**: Data survives restarts

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
bun add -g cc-sidebar
```

### Shell Alias (Recommended)

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
alias sidebar='cc-sidebar show'
```

Then just type `sidebar` from any project directory.

## Quick Start

### Option 1: iTerm2 (Recommended)

1. Open iTerm2
2. Start Claude Code: `claude`
3. Run: `cc-sidebar spawn`

A split pane opens on the right with the sidebar.

### Option 2: tmux

1. Start tmux: `tmux`
2. Start Claude Code: `claude`
3. Run: `cc-sidebar spawn --tmux`

## Usage

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `a` | Add new task |
| `Enter` | Send task to Claude |
| `e` | Edit selected task |
| `d` | Delete selected task |
| `j/k` or arrows | Navigate list |
| `Tab` | Switch sections |
| `q` or `Esc` | Quit sidebar |

### How It Works

1. **Add tasks** to the Queue using `a`
2. **Send a task** to Claude by pressing `Enter`
3. **Task moves to Active** while Claude works
4. **Auto-completes** when Claude returns to prompt

### Data Storage

Data is stored in `~/.claude-sidebar/`:

| File | Purpose |
|------|---------|
| `tasks.json` | Task queue |
| `active.json` | Current active task |
| `history.log` | Completed tasks |

## Claude Code Setup

Two optional integrations to make Claude aware of the sidebar:

### 1. Auto-completion (Recommended)

Add this to your `~/.claude/CLAUDE.md` so Claude automatically marks sidebar tasks as done:

```markdown
## Sidebar Integration

When completing work, check if this project uses the sidebar task queue.

**Detection:**
- Compute project hash: `sha256(cwd).slice(0, 12)`
- Check if `~/.claude-sidebar/projects/<hash>/tasks.json` exists
- If not, skip this section

**On task completion:**
1. Read the tasks.json file for this project
2. Find any task that semantically matches what you just completed
3. Move the matching task to done.json (Review section) for user confirmation:
   - Remove from tasks.json array
   - Add to done.json array with `completedAt` timestamp
4. Write both files back

Keep it simple - if no clear match, don't move anything. User can manually mark tasks done.

**done.json format:**
```json
[{"id": "...", "content": "task content", "completedAt": "ISO timestamp"}]
```
```

### 2. Install Skills (Recommended)

cc-sidebar includes skills that integrate with Claude Code:

| Skill | Trigger | What it does |
|-------|---------|--------------|
| `/clarify` | `/clarify` | Interview to clarify tasks, creates plan + todos (works for new or existing tasks) |
| `/prioritize` | `/prioritize` | Re-prioritize all sidebar tasks as a staff engineer |
| `sidebar-awareness` | (always on) | Gives Claude context about sidebar data files |

Install all skills:

```bash
mkdir -p ~/.claude/skills
cp -r ~/.bun/install/global/node_modules/cc-sidebar/skills/* ~/.claude/skills/
```

Or install individually:

```bash
cp -r ~/.bun/install/global/node_modules/cc-sidebar/skills/clarify ~/.claude/skills/
cp -r ~/.bun/install/global/node_modules/cc-sidebar/skills/prioritize ~/.claude/skills/
```

## Commands

```bash
cc-sidebar show             # Render in current terminal
cc-sidebar show --dir /path # Show tasks for a specific project
cc-sidebar spawn            # Launch in split pane (auto-detects iTerm2 vs tmux)
cc-sidebar spawn --tmux     # Force tmux mode
cc-sidebar env              # Show environment info
```

### Working with Multiple Projects

The sidebar stores tasks per-project based on the working directory. Use `--dir` to show tasks for any project without changing directories:

```bash
# Show sidebar for a specific project
cc-sidebar show --dir ~/projects/my-app

# Create an alias for a frequent project
alias sidebar-app="cc-sidebar show --dir ~/projects/my-app"
```

## Requirements

- [Bun](https://bun.sh) >= 1.0.0
- iTerm2 or tmux
- macOS (iTerm2 support) or Linux (tmux)

## License

MIT
