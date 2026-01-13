---
name: clarify
description: |
  Clarify tasks through deep conversation - works for new ideas or existing sidebar tasks.

  Use when: (1) You have thoughts/ideas that need clarification before becoming actionable,
  (2) You want to clarify a single task through conversation,
  (3) The sidebar sends a task for clarification (via `c` key).

  Triggers: "/clarify", "clarify this", "let me explain this task".

  Requires: Claude Code sidebar for todo integration.
---

# Clarify Skill

Clarify tasks through structured, in-depth conversation. Creates a **spec for each todo** (not a shared plan).

## Invocation

- `/clarify` - Start interviewing from scratch
- `/clarify [text]` - Clarify provided text (single task or many)
- `/clarify --task-id <id> [task content]` - Clarify existing sidebar task (sent by sidebar `c` key)

## Process

### 1. Detect Mode

Check if invoked with `--task-id`:
- **With task ID**: Updating an existing sidebar task
- **Without task ID**: Creating new todo(s) from scratch

### 2. Interview Phase

**Interview me in detail using AskUserQuestion about literally anything:**
- Technical implementation details
- UI & UX considerations
- Concerns and risks
- Tradeoffs between approaches
- Edge cases and error handling
- Dependencies and blockers
- Success criteria

**CRITICAL RULES:**
- Make sure questions are NOT obvious - don't ask things that are clear from context
- Be very in-depth - continue interviewing continually until complete
- Multiple rounds of questions are expected and encouraged
- Always end with "Anything else I should know?" as a final question

**If the user provided text** (`/clarify [text]`):
- Skip opening invitation - go straight to clarifying questions

**If no text was provided** (`/clarify` alone):
- Start with: "What's on your mind? Tell me everything - tasks, concerns, ideas, whatever's floating around."
- Let them ramble, then ask clarifying questions

### 3. Write Spec for Each Todo

After interviewing, create a **spec for each todo**. The spec is stored directly on the task (in the `spec` field), not in a separate plan file.

**Spec format:**
```
## [Task Title]

### What
[Clear description of what needs to be done]

### Why
[The purpose/motivation]

### How
[Implementation approach based on interview]

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Notes
[Any constraints, risks, or considerations from interview]
```

### 4. Update or Create Todos

**If updating existing task** (has `--task-id`):

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
  task.section = 'clarified';
  task.spec = `SPEC_CONTENT_HERE`;  // REPLACE with actual spec
  fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
  console.log('Task clarified with spec');
}
SCRIPT
```

**If creating new todos** (no `--task-id`):

Extract discrete, actionable tasks. Each todo should be:
- **Specific**: Clear what needs to be done
- **Actionable**: Can be worked on independently
- **Has a spec**: Detailed specification from interview

**Prioritization (act as staff engineer):**
- Dependencies first (blockers)
- Urgency (bugs, deadlines)
- Impact (high-value over nice-to-have)
- Quick wins for momentum

Mark top 3 as "recommended".

```bash
node << 'SCRIPT'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const sidebarDir = path.join(require('os').homedir(), '.claude-sidebar');
const hash = crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
const projectDir = path.join(sidebarDir, 'projects', hash);
const tasksPath = path.join(projectDir, 'tasks.json');

fs.mkdirSync(projectDir, { recursive: true });

let existing = [];
try { existing = JSON.parse(fs.readFileSync(tasksPath, 'utf-8')); } catch {}

// REPLACE with extracted tasks - each has its own spec
const newTodos = [
  {
    content: "Task 1 here",
    priority: 1,
    recommended: true,
    spec: `## Task 1\n\n### What\n...\n\n### Why\n...\n\n### How\n...\n\n### Acceptance Criteria\n- [ ] ...`
  },
  // ... more tasks
].map(task => ({
  id: crypto.randomUUID(),
  content: task.content,
  createdAt: new Date().toISOString(),
  section: 'clarified',
  clarified: true,
  priority: task.priority,
  recommended: task.recommended,
  spec: task.spec
}));

const combined = [...existing, ...newTodos];
fs.writeFileSync(tasksPath, JSON.stringify(combined, null, 2));
console.log('Added ' + newTodos.length + ' clarified todos to sidebar');
SCRIPT
```

### 5. Present and Prompt

After creating/updating todos:

1. Show summary of what was clarified
2. Show the spec for each task
3. Ask: **"Execute this task now, or save for later?"**
   - Execute → start working immediately
   - Save → confirm clarified and stop

**Example output:**
```
Clarified 2 todos:

1. ★ Implement user authentication
   Spec: JWT-based auth with 24hr expiry, refresh tokens...

2. ★ Add rate limiting to API
   Spec: 100 req/min per user, 429 response, Redis backend...

Execute the first task now, or save for later?
```

## Relationship to Other Skills

| Skill | Purpose |
|-------|---------|
| `/clarify` | Interview and write spec for task(s) |
| `/prioritize` | Re-evaluate all tasks as staff engineer |
| Atomic Plans | Track execution progress when working on task |

**Flow:**
1. **Clarify** creates specs (the "what")
2. **Prioritize** decides what's next
3. **Atomic Plans** tracks execution (the "how/progress")

## Example Session

```
User: /clarify I need to add dark mode support

Claude: [AskUserQuestion]
- Should this affect the entire app or just certain components?
- Do you want system preference detection (prefers-color-scheme)?
- Are there specific colors/themes you want, or should I design them?
- Should the preference persist across sessions (localStorage)?

User: [Answers each question]

Claude: [AskUserQuestion - follow-up]
- For the color palette, do you have brand colors to work with?
- Should transitions be animated when switching themes?
- Any components that should NOT support dark mode?
- Anything else I should know?

User: [Answers]

Claude: [Creates todo with spec]

Clarified 1 todo:

★ Add dark mode support
  Spec:
  ## Dark Mode Support

  ### What
  Add system-wide dark mode toggle with OS preference detection

  ### Why
  User requested for better nighttime usability

  ### How
  - CSS custom properties for colors
  - React context for theme state
  - localStorage for persistence
  - prefers-color-scheme media query for initial

  ### Acceptance Criteria
  - [ ] Toggle switches between light/dark
  - [ ] Respects OS preference on first visit
  - [ ] Persists choice in localStorage
  - [ ] Smooth transition animation

Execute this task now, or save for later?
```
