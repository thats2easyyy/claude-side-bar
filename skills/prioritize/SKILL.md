---
name: prioritize
description: |
  Re-prioritize all tasks in the sidebar as a staff engineer.

  Use when: (1) You want Claude to review and reorder your task list,
  (2) After adding new tasks that might change priorities,
  (3) When context has changed and you need fresh prioritization.

  Triggers: "/prioritize", "prioritize my tasks", "reorder tasks"

  Requires: Claude Code sidebar for task management.
---

# Prioritize Skill

Act as a staff engineer to review and prioritize all tasks in the sidebar.

## Invocation

- `/prioritize` - Review all tasks and assign priorities
- `/prioritize [context]` - Prioritize with specific context in mind

## Process

### 1. Read Current Tasks

```bash
node << 'SCRIPT'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const sidebarDir = path.join(require('os').homedir(), '.claude-sidebar');
const hash = crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
const tasksPath = path.join(sidebarDir, 'projects', hash, 'tasks.json');
try {
  const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
  console.log(JSON.stringify(tasks, null, 2));
} catch (e) {
  console.log('No tasks found');
}
SCRIPT
```

### 2. Evaluate and Prioritize

As a staff engineer, evaluate each task considering:

- **Dependencies**: What blocks other work? Blockers come first.
- **Urgency**: Bugs, deadlines, user-facing issues take priority.
- **Impact**: High-value features over nice-to-haves.
- **Effort**: Quick wins can build momentum; large tasks may need breakdown.
- **Context**: If user provided context, weight it heavily.
- **Specs**: Read the `spec` field of clarified tasks for detailed requirements.
- **Section**: Clarified tasks (with specs) are generally ready to execute.

Assign each task:
- `priority`: Numeric (1 = most important, higher = less important)
- `recommended`: `true` for the top 3 most important tasks (shown with star)

### 3. Write Updated Tasks

```bash
node << 'SCRIPT'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const sidebarDir = path.join(require('os').homedir(), '.claude-sidebar');
const hash = crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
const tasksPath = path.join(sidebarDir, 'projects', hash, 'tasks.json');

// REPLACE this array with the re-prioritized tasks
// Keep all original fields, just update priority and recommended
const tasks = [
  // Example - replace with actual tasks:
  // { ...originalTask, priority: 1, recommended: true },
  // { ...originalTask, priority: 2, recommended: true },
  // { ...originalTask, priority: 3, recommended: true },
  // { ...originalTask, priority: 4, recommended: false },
];

fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
console.log('Tasks re-prioritized');
SCRIPT
```

### 4. Present Results

Show the user the new priority order:

```
Re-prioritized your tasks:

Recommended (do first):
1. [task content]
2. [task content]
3. [task content]

Other tasks:
4. [task content]
5. [task content]
...
```

## Example Session

```
User: /prioritize

Claude: [Reads current tasks]

I see 6 tasks. Let me evaluate them as a staff engineer...

Based on dependencies and impact:

Recommended (do first):
1. Fix authentication bug (blocking users)
2. Add input validation (security concern)
3. Update API documentation (unblocks other team)

Other tasks:
4. Refactor CSS (nice-to-have)
5. Add dark mode (feature request)
6. Update dependencies (maintenance)

Tasks have been re-prioritized in your sidebar.
```

## Skill Flow

This skill is part of a chain:

1. **Clarify** → Creates specs for each task (the "what")
2. **Prioritize** → Staff engineer decides what's next (this skill)
3. **Atomic Plans** → Track execution progress when working

## Notes

- This skill reads and modifies the sidebar's tasks.json directly
- It preserves all existing task fields (id, content, clarified, spec, etc.)
- Only updates `priority` and `recommended` fields
- Can be run anytime - safe to run multiple times
- Read specs to understand task complexity when prioritizing
