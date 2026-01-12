---
name: clarify
description: |
  Clarify tasks through conversation - works for new ideas or existing sidebar tasks.

  Use when: (1) You have thoughts/ideas that need clarification before becoming actionable,
  (2) You want to clarify a single task through conversation,
  (3) The sidebar sends a task for clarification (via `c` key).

  Triggers: "/clarify", "clarify this", "let me explain this task".

  Requires: Claude Code sidebar for todo integration, Atomic Plans for plan output.
---

# Clarify Skill

Clarify tasks through structured conversation. Works for both new ideas (creates todos) and existing sidebar tasks (updates them).

## Invocation

- `/clarify` - Start interviewing from scratch
- `/clarify [text]` - Clarify provided text (single task or many)
- `/clarify --task-id <id> [task content]` - Clarify existing sidebar task (sent by sidebar `c` key)

## Process

Follow these steps in order:

### 1. Detect Mode

Check if invoked with `--task-id`:
- **With task ID**: Updating an existing sidebar task
- **Without task ID**: Creating new todo(s) from scratch

### 2. Locate Configuration

Check the project's CLAUDE.md for the Atomic Plans folder path. Look for a section like:

```markdown
## Clarify Configuration
Plan folder: /path/to/plans
```

Or check if Atomic Plans is already configured:

```markdown
## Project Planning
/atomic-plans /path/to/folder
```

**If no path is found:**
1. Ask the user: "Where should I save plans for this project?"
2. After they provide a path, ask: "Would you like me to add this to CLAUDE.md so I remember next time?"
3. If yes, append the configuration to CLAUDE.md

### 3. Interview Phase

The goal is to fully understand the task(s) through conversation.

**IMPORTANT: Never short-circuit the process.** Whether the user provides one clear task or a chaotic mess of ideas, always interview to clarify. A "single clear task" still benefits from clarification - edge cases, implementation approach, constraints, etc.

**If the user provided text with the command** (`/clarify [text]`):
- Skip the opening question - they already told you what's on their mind
- Go straight to AskUserQuestion to clarify specifics:
  - Ambiguous parts that need clarification
  - Implementation approach (if relevant)
  - Edge cases or constraints
  - Missing context: priorities, dependencies
  - Anything else you need to fully understand the task(s)

**If no text was provided** (`/clarify` alone):
- Start with a plain text invitation (NOT AskUserQuestion):

  "What's on your mind? Tell me everything - tasks, concerns, ideas,
  whatever's floating around. I'll help clarify and organize it."

- Let the user ramble freely in their response
- THEN use AskUserQuestion to clarify specifics about what they said

**Interview guidelines:**
- Don't ask obvious questions - if something is clear from the task description, skip it
- Be thorough - keep interviewing until you have complete clarity
- Always include "Anything else I should know?" as a final question

**Key questions to consider** (use AskUserQuestion for these):
- What's the most important thing here?
- Are there dependencies between these tasks?
- What constraints should I know about?
- Is there anything blocking progress on any of these?

**Scope filtering:**
If the user mentions things unrelated to the current project (personal tasks, other projects), ask:
"Some of this seems unrelated to [current project]. Should I include those tasks anyway, or focus only on [project]-related work?"

### 4. Create Plan

Create a new plan in the Atomic Plans folder with:

**Filename:** `NNN-clarify-[topic].md` where NNN is the next number in sequence.

**Content:**
```markdown
---
plan: NNN
title: [Topic]
state: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# [Topic]

## Intent
[Summary of what the user wants to accomplish]

## Specs
[Detailed specifications gathered during interview]

## Context
[Key decisions, constraints, and context gathered during interview]

## Next
- [ ] Execute the task(s)
```

### 5. Update or Create Todos

**If updating existing task** (has `--task-id`):

Update the existing task in the sidebar:

```bash
node << 'SCRIPT'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const sidebarDir = path.join(require('os').homedir(), '.claude-sidebar');
const hash = crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
const tasksPath = path.join(sidebarDir, 'projects', hash, 'tasks.json');
let tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
const task = tasks.find(t => t.id === 'TASK_ID_HERE');  // REPLACE with actual task ID
if (task) {
  task.clarified = true;
  task.planPath = 'PLAN_FILENAME.md';  // REPLACE with actual plan filename
  fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
  console.log('Task clarified and linked to plan');
}
SCRIPT
```

**If creating new todos** (no `--task-id`):

Extract discrete, actionable tasks from the interview. Each todo should be:
- **Specific**: Clear what needs to be done
- **Actionable**: Can be worked on independently
- **Scoped**: Relevant to the current project (unless user said otherwise)

**Act as a staff engineer to prioritize:**
Assign each task a numeric priority (1 = most important). Consider:
- **Dependencies**: Blockers come first
- **Urgency**: Bugs, deadlines, user-facing issues
- **Impact**: High-value features over nice-to-haves
- **Effort**: Quick wins can be prioritized to build momentum

Mark the top 3 most important tasks as "recommended" (shown with star in sidebar).

Write todos to the **project-specific** tasks file:

```bash
node << 'SCRIPT'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const sidebarDir = path.join(require('os').homedir(), '.claude-sidebar');
const hash = crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
const projectDir = path.join(sidebarDir, 'projects', hash);
const tasksPath = path.join(projectDir, 'tasks.json');

// Ensure directory exists
fs.mkdirSync(projectDir, { recursive: true });

// Read existing todos
let existing = [];
try { existing = JSON.parse(fs.readFileSync(tasksPath, 'utf-8')); } catch {}

// Plan filename (just the filename, not full path)
const planPath = "NNN-clarify-topic.md";  // REPLACE with actual plan filename

// New todos - REPLACE THIS ARRAY with extracted tasks
// Each task needs: content, priority (1=highest), recommended (true for top 3)
const newTodos = [
  { content: "Task 1 here", priority: 1, recommended: true },
  { content: "Task 2 here", priority: 2, recommended: true },
  { content: "Task 3 here", priority: 3, recommended: true },
  { content: "Task 4 here", priority: 4, recommended: false }
].map(task => ({
  id: crypto.randomUUID(),
  content: task.content,
  createdAt: new Date().toISOString(),
  clarified: true,           // Clarify IS the clarification process
  priority: task.priority,   // Numeric priority (1 = most important)
  recommended: task.recommended,  // Top 3 get star indicator
  planPath: planPath         // Links task to the plan file
}));

// Append and write
const combined = [...existing, ...newTodos];
fs.writeFileSync(tasksPath, JSON.stringify(combined, null, 2));
console.log('Added ' + newTodos.length + ' todos to sidebar');
SCRIPT
```

### 6. Present and Prompt

After creating/updating todos and plan:

1. Show a summary of what was created/updated
2. Ask: **"Execute this task now, or save for later?"**
   - If execute → work on the task immediately
   - If save → confirm the task is clarified and stop

**Example for existing task:**
```
Clarified your task and created plan 007-auth-refactor.md

Task: Refactor authentication module
Specs: JWT-based, 24hr expiry, refresh tokens...

Execute this task now, or save for later?
```

**Example for new tasks:**
```
Created 3 todos in your sidebar and plan 008-api-improvements.md

Your todos:
1. Add rate limiting to API endpoints
2. Implement request validation
3. Add API documentation

Execute the first task now, or save for later?
```

## Relationship to Other Features

| Feature | Purpose | When to Use |
|---------|---------|-------------|
| `/clarify` | Interview and clarify task(s) | When you need to think through a task before doing it |
| Sidebar `c` key | Invokes `/clarify --task-id` | Quick way to clarify a queued task |
| `/prioritize` | Re-evaluate and reorder all tasks | When context changes or you want fresh prioritization |
| Ralph-loop | Batch process todos autonomously | After clarifying, to work through all todos |

## Example Sessions

### From Sidebar (existing task)
```
[User presses 'c' on task "Add user authentication"]

Sidebar sends: /clarify --task-id abc123 Add user authentication

Claude: [Uses AskUserQuestion]
- What auth method? (JWT, session, OAuth?)
- Any specific security requirements?
- Which routes need protection?

User: [Answers]

Claude: [Creates plan, updates task with clarified=true]

Clarified your task and created plan 005-user-auth.md

Execute this task now, or save for later?
```

### From Chat (new task)
```
User: /clarify I need to add shift+enter support for multiline input

Claude: [Uses AskUserQuestion]
- Which input modes need this? (adding new todos, editing existing, both?)
- Should Enter still submit, with Shift+Enter for newlines?

User: [Answers]

Claude: [Creates todo, writes to sidebar, creates plan]

Created 1 todo in your sidebar and plan 009-multiline-input.md

Execute this task now, or save for later?
```

### From Chat (multiple tasks)
```
User: /clarify

Claude: What's on your mind? Tell me everything.

User: ugh so much. the auth is a mess, we're using like 3 different
patterns. also need to update the docs. oh and there's that bug with
the session timeout.

Claude: [Uses AskUserQuestion]
- Which auth pattern should we standardize on?
- Is the session timeout bug blocking anything?

User: [Answers]

Claude: [Creates todos, writes to sidebar, creates plan]

Created 4 todos in your sidebar and plan 010-auth-cleanup.md

Your todos:
1. Standardize auth on JWT pattern
2. Fix session timeout bug
3. Update auth documentation
4. Remove deprecated OAuth1 code

Execute the first task now, or save for later?
```
