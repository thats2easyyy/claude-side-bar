#!/usr/bin/env bun
/**
 * Syncs Claude Code's TodoWrite output to the sidebar
 * Called via PostToolUse hook whenever Claude updates its todo list
 *
 * Receives JSON via stdin with structure:
 * {
 *   "tool_name": "TodoWrite",
 *   "tool_input": { "todos": [...] },
 *   "tool_result": "..."
 * }
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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
    }
  } catch (err) {
    // Silently fail - don't interrupt Claude Code
    console.error("sync-todos error:", err);
  }
}

main();
