/**
 * Persistence layer for sidebar data
 * Stores tasks (queue), active task, and history in ~/.claude-sidebar/
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SIDEBAR_DIR = join(homedir(), ".claude-sidebar");

export interface Task {
  id: string;
  content: string;
  createdAt: string;
}

export interface ActiveTask {
  id: string;
  content: string;
  sentAt: string;
}

// Get the data directory path
export function getDataDir(): string {
  return SIDEBAR_DIR;
}

// Ensure the sidebar directory exists
export function ensureDir(): void {
  if (!existsSync(SIDEBAR_DIR)) {
    mkdirSync(SIDEBAR_DIR, { recursive: true });
  }
}

// Generic read/write helpers
function readJson<T>(filename: string, defaultValue: T): T {
  const filepath = join(SIDEBAR_DIR, filename);
  try {
    if (existsSync(filepath)) {
      return JSON.parse(readFileSync(filepath, "utf-8"));
    }
  } catch {
    // Return default on error
  }
  return defaultValue;
}

function writeJson<T>(filename: string, data: T): void {
  ensureDir();
  const filepath = join(SIDEBAR_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Tasks (user's task queue)
export function getTasks(): Task[] {
  return readJson<Task[]>("tasks.json", []);
}

export function setTasks(tasks: Task[]): void {
  writeJson("tasks.json", tasks);
}

export function addTask(content: string): Task {
  const tasks = getTasks();
  const task: Task = {
    id: crypto.randomUUID(),
    content,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  setTasks(tasks);
  return task;
}

export function updateTask(id: string, content: string): void {
  const tasks = getTasks();
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.content = content;
    setTasks(tasks);
  }
}

export function removeTask(id: string): void {
  const tasks = getTasks().filter((t) => t.id !== id);
  setTasks(tasks);
}

// Active task (currently being worked on by Claude)
export function getActiveTask(): ActiveTask | null {
  return readJson<ActiveTask | null>("active.json", null);
}

export function setActiveTask(task: Task | null): void {
  if (task) {
    writeJson("active.json", {
      id: task.id,
      content: task.content,
      sentAt: new Date().toISOString(),
    });
  } else {
    writeJson("active.json", null);
  }
}

export function clearActiveTask(): void {
  writeJson("active.json", null);
}

// History (completed tasks - append-only log)
export function appendToHistory(content: string): void {
  ensureDir();
  const filepath = join(SIDEBAR_DIR, "history.log");
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | ${content}\n`;
  appendFileSync(filepath, entry);
}

// Move task from queue to active
export function activateTask(taskId: string): ActiveTask | null {
  const tasks = getTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex === -1) return null;

  const task = tasks[taskIndex];

  // Remove from queue
  tasks.splice(taskIndex, 1);
  setTasks(tasks);

  // Set as active
  const activeTask: ActiveTask = {
    id: task.id,
    content: task.content,
    sentAt: new Date().toISOString(),
  };
  writeJson("active.json", activeTask);

  return activeTask;
}

// Complete active task (move to history)
export function completeActiveTask(): void {
  const active = getActiveTask();
  if (active) {
    appendToHistory(active.content);
    clearActiveTask();
  }
}

// Socket path for IPC
export function getSocketPath(): string {
  return join(SIDEBAR_DIR, "sidebar.sock");
}

// Export the directory path
export { SIDEBAR_DIR };
