# Claude Code Sidebar - Product Specification

## Vision

A keyboard-driven task management sidebar for Claude Code that provides **awareness and visibility** without interrupting flow. Think Trello/Kanban for your Claude Code terminal.

```
┌─────────────────────────────────┬────────────────────┐
│                                 │  Claude Code       │
│         Claude Code             │     Sidebar        │
│     (main conversation)         │ ──────────────────│
│                                 │  [Queue] Active    │
│  You chat here, Claude works    │  1. Fix auth bug   │
│                                 │  2. Add tests      │
│                                 │  3. Update docs    │
│                                 │                    │
│                                 │  [+] New task...   │
└─────────────────────────────────┴────────────────────┘
         Main pane (67%)              Sidebar (33%)
```

---

## Core Problem

When working with Claude Code:
- Claude's todo list (TodoWrite) exists but is invisible unless you ask
- No way to queue up tasks while Claude is working
- Can't see progress at a glance
- Mental load of remembering "what's next" falls on the user

## Solution

A tmux-based sidebar that:
1. Shows a **task queue** you can build while Claude works
2. Displays **Claude's active work** (synced from TodoWrite)
3. Lets you **select tasks** for Claude via keyboard
4. **Persists everything** between sessions

---

## Core Experience

### The Feeling
**Awareness/visibility** - User wants to see what's happening without interrupting Claude's flow. Not about control or micromanagement.

### Primary Value
**Queued requests** - The most valuable thing the sidebar shows is "what I want Claude to work on next."

### Mental Model
**Trello/Kanban** - Cards (tasks) that can be organized, prioritized, and moved through states.

---

## User Workflow

### Parallel Work
While Claude codes in the main pane, the user works in the sidebar:
- Writing detailed task descriptions
- Answering Claude's clarifying questions
- Organizing and prioritizing the queue (via keyboard)

### Task Origins
Tasks come from:
- Mid-conversation ideas ("oh, we should also...")
- Pre-session planning (know what you want before starting)
- External sources (Slack, email, tickets - copy them in)

### Task Lifecycle
1. **Add task** to queue (Enter to submit, Shift+Enter for newlines)
2. **Organize** queue via keyboard
3. **Select task** for Claude (keyboard shortcut or numbered selection)
4. Claude asks "which task from this list?" with numbered options
5. **Auto-clear** completed tasks (keep it clean)

---

## Interaction Design

### Keyboard-Driven
Everything should work without a mouse:
- Navigation (exact shortcuts TBD - user open to suggestions)
- Task selection (number keys: "press 3 to select task 3")
- Task creation (Enter to submit, Shift+Enter for newline)
- Sidebar toggle (hotkey to show/hide)

### Visibility
- **Toggle hotkey** to show/hide sidebar
- Takes 33% of terminal width
- User will size their terminal appropriately

### States/Tabs
Use **tabs for states** (like current design):
- Queue (user's tasks)
- Active (what Claude is working on / TodoWrite sync)
- Possibly: Context (files/notes)

---

## Claude Integration

### Notification Behavior
**Silent addition** - When user adds tasks to queue, Claude is NOT interrupted. Claude keeps working undisturbed.

### Task Handoff
When Claude finishes current work and queue has tasks:
- Claude can ask "which task do you want me to work on?" in the **main chat**
- Tasks have numbers: user types "3" to select task 3
- Alternatively: user explicitly selects task in sidebar and sends it

### TodoWrite Sync
- Claude's TodoWrite items appear in the sidebar (Active tab)
- User is passively aware of TodoWrite but doesn't actively manage it
- Sidebar shows Claude's progress without user asking

### Sync Concerns (Critical)
User's biggest worry is **state confusion**:
- Sidebar shows one thing, Claude's context says another
- Lost tasks (user adds, Claude never sees)
- Duplicate work (Claude works on removed task)

**Must solve:** Reliable sync between sidebar state and Claude's awareness.

---

## Persistence

**Everything persists:**
- Task queue survives terminal/tmux close
- Session state saved to disk
- User expects to return and find their queue intact

Storage: `~/.claude-sidebar/`

---

## Technical Requirements

### tmux Dependency
Required, but should be seamless:
- **Auto-install tmux** if missing (prompt user)
- Clear error if tmux not available

### Installation
**One command install** - No friction:
```bash
claude --plugin-dir /path/to/sidebar
# or
/plugin marketplace install claude-code-sidebar
```

### Scope
**Claude Code only** - Purpose-built, deep integration. Not a generic terminal task manager.

---

## Design Principles

### Aesthetics
**Clean and minimal** - Simple, not ugly. Function-focused but not rough.

### Philosophy
- Don't interrupt Claude's work
- Keyboard-first, mouse optional
- Persist everything
- Zero config to start, customize later

### Success Criteria
**"I use it daily"** - Must become part of natural workflow, not an occasional tool.

---

## Naming

**Claude Code Sidebar** - Descriptive, clear, connects to parent product.

---

## Edge Cases

### Urgent Task Interrupt
User says this is **not a real scenario** - they wouldn't force-switch Claude mid-task. They'd wait or manually tell Claude in chat.

### Empty State
When no tasks queued, sidebar should:
- Show helpful prompt to add first task
- Not feel broken or empty

### Many Tasks
Queue size "varies wildly" - UI must handle 1 task or 20 tasks gracefully.

---

## Out of Scope (For Now)

- Mobile/web access
- Team/multi-user features
- Integration with non-Claude tools
- Complex priority systems

---

## Open Questions

1. **Exact keyboard shortcuts** - vim-style? number keys? What feels native?
2. **How does Claude "see" the queue?** - Via skill? File read? IPC?
3. **What triggers Claude to ask about next task?** - Automatic on completion? User prompt?
4. **Sidebar toggle hotkey** - What keystroke? Customizable?

---

## Marketplace Readiness

To publish:
- [ ] One-command install works
- [ ] README with demo GIF
- [ ] Zero-config first run
- [ ] tmux auto-detection/install prompt
- [ ] Reliable sync (no state confusion)
- [ ] Clean, minimal UI
- [ ] Keyboard shortcuts documented

---

## Summary

Claude Code Sidebar is a **keyboard-driven task queue** that lives alongside Claude Code. It lets users build up work for Claude without interrupting current tasks, provides visibility into Claude's progress, and persists between sessions. The goal is daily use - seamless enough to become part of the natural Claude Code workflow.
