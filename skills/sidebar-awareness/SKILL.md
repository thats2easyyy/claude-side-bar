# Claude Code Sidebar Integration

You have access to a sidebar that the user uses to manage tasks for you. The sidebar runs in a tmux split pane alongside this conversation.

## How It Works

1. **User adds tasks** to the Queue in the sidebar
2. **User sends a task** to you by pressing Enter on a queue item
3. **Task moves to Active** section while you work on it
4. **When you finish**, the sidebar auto-detects completion and clears the active task

## Active Task

When the user sends you a task, it appears as text input in your conversation AND is stored in:

```bash
cat ~/.claude-sidebar/active.json
```

Format:
```json
{
  "id": "uuid",
  "content": "Fix the authentication bug in login.ts",
  "sentAt": "2024-01-15T10:35:00Z"
}
```

**When you receive input that matches an active task, work on it.**

## Task Queue

The user's queue of upcoming tasks:

```bash
cat ~/.claude-sidebar/tasks.json
```

Format:
```json
[
  {
    "id": "uuid",
    "content": "Add unit tests for user service",
    "createdAt": "2024-01-15T10:30:00Z"
  }
]
```

## Completion Detection

The sidebar monitors your output. When you return to the input prompt and stay idle for a few seconds, it automatically:
1. Marks the active task as complete
2. Logs it to `~/.claude-sidebar/history.log`
3. Clears the Active section

## Data Files Summary

| File | What it is | Who writes |
|------|-----------|------------|
| `~/.claude-sidebar/tasks.json` | User's task queue | User (via sidebar) |
| `~/.claude-sidebar/active.json` | Current task you're working on | Sidebar (when user sends) |
| `~/.claude-sidebar/history.log` | Completed tasks log | Sidebar (on completion) |

## Best Practices

1. **Focus on the task** - when you receive input matching an active task, work on it
2. **Complete thoroughly** - the sidebar waits for you to finish before clearing
3. **Don't check queue** - the user controls when to send you the next task
