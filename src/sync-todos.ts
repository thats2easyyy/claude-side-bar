#!/usr/bin/env bun
/**
 * Syncs Claude Code's TodoWrite output to the sidebar
 * Called via PostToolUse hook whenever Claude updates its todo list
 *
 * Two functions:
 * 1. Sync Claude's todos to sidebar display (claude-todos.json)
 * 2. Auto-complete sidebar queue items when Claude marks related work done
 *
 * Receives JSON via stdin with structure:
 * {
 *   "tool_name": "TodoWrite",
 *   "tool_input": { "todos": [...] },
 *   "tool_result": "..."
 * }
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const SIDEBAR_DIR = join(homedir(), ".claude-sidebar");

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface HookPayload {
  tool_name: string;
  tool_input: {
    todos: TodoItem[];
  };
}

interface SidebarTask {
  id: string;
  content: string;
  createdAt: string;
}

interface DoneTask {
  id: string;
  content: string;
  completedAt: string;
}

// Get project-specific directory using same hash as sidebar
function getProjectDir(): string {
  const cwd = process.cwd();
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return join(SIDEBAR_DIR, "projects", hash);
}

// Normalize text for comparison: lowercase, keep only alphanumeric, collapse whitespace
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extract significant words (length > 2) from text
function extractWords(s: string): Set<string> {
  return new Set(normalizeText(s).split(' ').filter(w => w.length > 2));
}

// Check if strings are similar based on word overlap (50% threshold)
function isSimilar(a: string, b: string): boolean {
  const wordsA = extractWords(a);
  const wordsB = extractWords(b);

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  const minSize = Math.min(wordsA.size, wordsB.size);
  return overlap >= minSize * 0.5;
}

// Check completed Claude todos against sidebar queue and move matches to Done
function autoCompleteSidebarTasks(completedTodos: TodoItem[]): void {
  const projectDir = getProjectDir();
  const tasksPath = join(projectDir, "tasks.json");
  const donePath = join(projectDir, "done.json");

  if (!existsSync(tasksPath)) return;

  try {
    const tasks: SidebarTask[] = JSON.parse(readFileSync(tasksPath, "utf-8"));
    const done: DoneTask[] = existsSync(donePath)
      ? JSON.parse(readFileSync(donePath, "utf-8"))
      : [];

    const now = new Date().toISOString();
    const remaining: SidebarTask[] = [];
    const newDone: DoneTask[] = [];

    for (const task of tasks) {
      const matchesCompleted = completedTodos.some(todo => isSimilar(todo.content, task.content));
      if (matchesCompleted) {
        newDone.push({ id: task.id, content: task.content, completedAt: now });
      } else {
        remaining.push(task);
      }
    }

    if (newDone.length > 0) {
      const updatedDone = [...newDone, ...done].slice(0, 10);
      writeFileSync(tasksPath, JSON.stringify(remaining, null, 2));
      writeFileSync(donePath, JSON.stringify(updatedDone, null, 2));
    }
  } catch {
    // Silently fail - don't interrupt Claude Code
  }
}

async function main() {
  // Read JSON from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString("utf-8");

  if (!input.trim()) {
    process.exit(0);
  }

  try {
    const payload: HookPayload = JSON.parse(input);

    if (payload.tool_name === "TodoWrite" && payload.tool_input?.todos) {
      // Ensure directory exists
      mkdirSync(SIDEBAR_DIR, { recursive: true });

      // Write todos to file for sidebar to poll
      const todosPath = join(SIDEBAR_DIR, "claude-todos.json");
      writeFileSync(todosPath, JSON.stringify({
        todos: payload.tool_input.todos,
        updatedAt: new Date().toISOString()
      }, null, 2));

      // Check for completed todos and auto-complete matching sidebar tasks
      const completedTodos = payload.tool_input.todos.filter(t => t.status === "completed");
      if (completedTodos.length > 0) {
        autoCompleteSidebarTasks(completedTodos);
      }
    }
  } catch (err) {
    // Silently fail - don't interrupt Claude Code
    console.error("sync-todos error:", err);
  }
}

main();
