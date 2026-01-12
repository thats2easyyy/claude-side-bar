---
name: brain-dump
description: |
  Transform thoughts into structured todos and a plan - works for one task or many.

  Use when: (1) You have a mess of ideas and need to organize them into actionable tasks,
  (2) You want to clarify a single task through conversation before adding it,
  (3) You need both a plan document and sidebar todos from any input.

  Triggers: "/brain-dump", "brain dump", "organize my thoughts", "extract todos from this".

  Requires: Claude Code sidebar for todo integration, Atomic Plans for plan output.
---

# Brain-Dump Skill

Transform thoughts into structured, actionable todos with an accompanying plan. Works for one task or many - the process is the same.

## Invocation

- `/brain-dump` - Start interviewing immediately
- `/brain-dump [text]` - Process provided text (single task or many), then ask clarifying questions

## Process

Follow these steps in order:

### 1. Locate Configuration

Check the project's CLAUDE.md for the Atomic Plans folder path. Look for a section like:

```markdown
## Brain-Dump Configuration
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

### 2. Interview Phase

The goal is to extract actionable, project-relevant tasks through conversation.

**IMPORTANT: Never short-circuit the process.** Whether the user provides one clear task or a chaotic mess of ideas, always interview to clarify. A "single clear task" still benefits from clarification - edge cases, implementation approach, constraints, etc. Don't ask "is this just one task?" - just proceed with clarification.

**If the user provided text with the command** (`/brain-dump [text]`):
- Skip the opening question - they already told you what's on their mind
- Go straight to AskUserQuestion to clarify specifics:
  - Ambiguous parts that need clarification
  - Implementation approach (if relevant)
  - Edge cases or constraints
  - Missing context: priorities, dependencies
  - Anything else you need to fully understand the task(s)

**If no text was provided** (`/brain-dump` alone):
- Start with a plain text invitation (NOT AskUserQuestion):

  "What's on your mind? Tell me everything - tasks, concerns, ideas,
  whatever's floating around. I'll help organize it."

- Let the user ramble freely in their response
- THEN use AskUserQuestion to clarify specifics about what they said

**Key questions to consider** (use AskUserQuestion for these):
- What's the most important thing here?
- Are there dependencies between these tasks?
- What constraints should I know about?
- Is there anything blocking progress on any of these?
- Anything else I should know?

**Scope filtering:**
If the user mentions things unrelated to the current project (personal tasks, other projects), ask:
"Some of this seems unrelated to [current project]. Should I include those tasks anyway, or focus only on [project]-related work?"

### 3. Extract and Prioritize Todos

From the interview, identify discrete, actionable tasks. Each todo should be:
- **Specific**: Clear what needs to be done
- **Actionable**: Can be worked on independently
- **Scoped**: Relevant to the current project (unless user said otherwise)

**Act as a staff engineer to prioritize:**
Assign each task a numeric priority (1 = most important). Consider:
- **Dependencies**: Blockers come first
- **Urgency**: Bugs, deadlines, user-facing issues
- **Impact**: High-value features over nice-to-haves
- **Effort**: Quick wins can be prioritized to build momentum

Mark the top 3 most important tasks as "recommended" (shown with ★ in sidebar).

### 4. Write Todos to Sidebar

Write the extracted todos to the **project-specific** tasks file.

**IMPORTANT:** Tasks are stored per-project using a hash of the working directory:
```
~/.claude-sidebar/projects/<hash>/tasks.json
```

**IMPORTANT: Read first, then append.** Do not clobber existing todos.

Use this exact script to write todos (it handles the project hash automatically):

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
const planPath = "NNN-brain-dump-topic.md";  // REPLACE with actual plan filename

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
  clarified: true,           // Brain-dump IS the clarification process
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

### 5. Create Plan

Create a new plan in the Atomic Plans folder with:

**Filename:** `NNN-brain-dump-[topic].md` where NNN is the next number in sequence.

**Content:**
```markdown
---
plan: NNN
title: Brain Dump - [Topic]
state: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Brain Dump - [Topic]

## Intent
[Summary of what the user wants to accomplish]

## Extracted Todos
[List the todos that were created]

## Context from Interview
[Key decisions, constraints, and context gathered during interview]

## Next
- [ ] Work through todos in sidebar
```

### 6. Present and Wait

After creating todos and plan:

1. Show a summary of what was created:
   - Number of todos added to sidebar
   - Link to the plan file

2. **Do not auto-execute.** Let the user decide what to do next:
   - Work through todos one by one (select in sidebar, press Enter)
   - Use clarify mode (`c` key) to add specs to unclarified todos
   - Use `/ralph-loop` to batch process all todos

Example closing message:
```
Created 5 todos in your sidebar and plan 007-brain-dump-auth-refactor.md

Your todos:
1. Extract auth logic into separate module
2. Add unit tests for token validation
3. Update API endpoints to use new auth module
4. Document the new auth flow
5. Remove deprecated auth code

What would you like to do next?
```

## Relationship to Other Features

| Feature | Purpose | When to Use |
|---------|---------|-------------|
| Brain-dump | Clarify + add todos from chat | When you want to describe tasks conversationally (one or many) |
| Clarify mode (`c` key) | Clarify existing sidebar todo | When task is already in sidebar and needs specs before executing |
| `/prioritize` | Re-evaluate and reorder all tasks | When context changes or you want fresh prioritization |
| Ralph-loop | Batch process todos autonomously | After brain-dump, to work through all todos |

## Example Sessions

### Single Task Example
```
User: /brain-dump I need to add shift+enter support for multiline input in the sidebar

Claude: [Uses AskUserQuestion to clarify]
- Which input modes need this? (adding new todos, editing existing, both?)
- Should Enter still submit, with Shift+Enter for newlines?
- Any other keyboard shortcuts you want to add while we're in there?

User: [Answers questions]

Claude: [Creates todo, writes to sidebar, creates plan]

Created 1 todo in your sidebar and plan 009-multiline-input.md

Your todos:
1. Add shift+enter for multiline input in add/edit modes

Work on this now, or save for later?
```

### Multiple Tasks Example
```
User: /brain-dump

Claude: What's on your mind? Tell me everything - tasks, concerns, ideas.

User: ugh so much. the auth is a mess, we're using like 3 different
patterns. also need to update the docs. oh and there's that bug with
the session timeout.

Claude: [Uses AskUserQuestion]
- Which auth pattern should we standardize on?
- Is the session timeout bug blocking anything?

User: [Answers questions]

Claude: [Creates todos, writes to sidebar, creates plan]

Created 4 todos in your sidebar and plan 010-auth-cleanup.md

Your todos:
1. Standardize auth on JWT pattern
2. Fix session timeout bug in middleware
3. Update auth documentation
4. Remove deprecated OAuth1 code

What would you like to do next?
```
