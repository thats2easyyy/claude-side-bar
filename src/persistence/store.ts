/**
 * Persistence layer for sidebar data
 * Stores tasks (queue), active task, and history per-project in ~/.claude-sidebar/projects/<hash>/
 * Global data (statusline, socket) stored in ~/.claude-sidebar/
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";

const SIDEBAR_DIR = join(homedir(), ".claude-sidebar");

// Get a short hash of the working directory for project isolation
function getProjectHash(): string {
  const cwd = process.cwd();
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

// Get the project-specific directory
function getProjectDir(): string {
  return join(SIDEBAR_DIR, "projects", getProjectHash());
}

// Store a mapping of hash -> path for easier debugging
function updateProjectMapping(): void {
  const mappingPath = join(SIDEBAR_DIR, "projects", "mapping.json");
  let mapping: Record<string, string> = {};
  try {
    if (existsSync(mappingPath)) {
      mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
    }
  } catch {}
  mapping[getProjectHash()] = process.cwd();
  ensureDir();
  mkdirSync(join(SIDEBAR_DIR, "projects"), { recursive: true });
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
}

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

export interface StatuslineData {
  contextPercent: number;
  contextTokens: number;
  contextSize: number;
  costUsd: number;
  durationMin: number;
  model: string;
  branch: string;
  repo: string;
  updatedAt: string;
}

export interface ClaudeConfig {
  enabledPlugins: string[];
  mcpServers: string[];
}

export interface ClaudeTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ClaudeTodosData {
  todos: ClaudeTodo[];
  updatedAt: string;
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

// Generic read/write helpers for GLOBAL data
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

// Read/write helpers for PROJECT-SPECIFIC data
function readProjectJson<T>(filename: string, defaultValue: T): T {
  const projectDir = getProjectDir();
  const filepath = join(projectDir, filename);
  try {
    if (existsSync(filepath)) {
      return JSON.parse(readFileSync(filepath, "utf-8"));
    }
  } catch {
    // Return default on error
  }
  return defaultValue;
}

function writeProjectJson<T>(filename: string, data: T): void {
  const projectDir = getProjectDir();
  mkdirSync(projectDir, { recursive: true });
  updateProjectMapping();
  const filepath = join(projectDir, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Tasks (user's task queue) - PROJECT SPECIFIC
export function getTasks(): Task[] {
  return readProjectJson<Task[]>("tasks.json", []);
}

export function setTasks(tasks: Task[]): void {
  writeProjectJson("tasks.json", tasks);
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

// Active task (currently being worked on by Claude) - PROJECT SPECIFIC
export function getActiveTask(): ActiveTask | null {
  return readProjectJson<ActiveTask | null>("active.json", null);
}

// Statusline data (from Claude Code)
export function getStatusline(): StatuslineData | null {
  return readJson<StatuslineData | null>("statusline.json", null);
}

// Claude's todo list (from TodoWrite hook)
export function getClaudeTodos(): ClaudeTodosData | null {
  return readJson<ClaudeTodosData | null>("claude-todos.json", null);
}

// Claude Code config (plugins and MCPs)
export function getClaudeConfig(): ClaudeConfig {
  const claudeSettingsPath = join(homedir(), ".claude", "settings.json");
  const defaultConfig: ClaudeConfig = { enabledPlugins: [], mcpServers: [] };

  try {
    if (existsSync(claudeSettingsPath)) {
      const settings = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));

      // Extract enabled plugins (keys where value is true)
      const enabledPlugins: string[] = settings.enabledPlugins
        ? Object.entries(settings.enabledPlugins)
            .filter(([_, enabled]) => enabled === true)
            .map(([name]) => name.split("@")[0] || name)
        : [];

      // Extract MCP server names
      const mcpServers: string[] = settings.mcpServers
        ? Object.keys(settings.mcpServers)
        : [];

      return { enabledPlugins, mcpServers };
    }
  } catch {
    // Return default on error
  }
  return defaultConfig;
}

export function setActiveTask(task: Task | null): void {
  if (task) {
    writeProjectJson("active.json", {
      id: task.id,
      content: task.content,
      sentAt: new Date().toISOString(),
    });
  } else {
    writeProjectJson("active.json", null);
  }
}

export function clearActiveTask(): void {
  writeProjectJson("active.json", null);
}

// History (completed tasks - append-only log) - PROJECT SPECIFIC
export function appendToHistory(content: string): void {
  const projectDir = getProjectDir();
  mkdirSync(projectDir, { recursive: true });
  const filepath = join(projectDir, "history.log");
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | ${content}\n`;
  appendFileSync(filepath, entry);
}

// Move task from queue to active - PROJECT SPECIFIC
export function activateTask(taskId: string): ActiveTask | null {
  const tasks = getTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  const task = tasks[taskIndex];

  if (taskIndex === -1 || !task) return null;

  // Remove from queue
  tasks.splice(taskIndex, 1);
  setTasks(tasks);

  // Set as active
  const activeTask: ActiveTask = {
    id: task.id,
    content: task.content,
    sentAt: new Date().toISOString(),
  };
  writeProjectJson("active.json", activeTask);

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
