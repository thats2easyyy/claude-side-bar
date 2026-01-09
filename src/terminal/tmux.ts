/**
 * tmux integration for spawning sidebar in split pane
 * Based on patterns from claude-canvas
 */

import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

const PANE_FILE = "/tmp/claude-sidebar-pane-id";

/**
 * Check if we're running inside tmux
 */
export function isInTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Get stored pane ID from file
 */
function getStoredPaneId(): string | null {
  try {
    if (existsSync(PANE_FILE)) {
      return readFileSync(PANE_FILE, "utf-8").trim();
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Store pane ID to file
 */
function storePaneId(paneId: string): void {
  writeFileSync(PANE_FILE, paneId);
}

/**
 * Clear stored pane ID
 */
function clearStoredPaneId(): void {
  try {
    if (existsSync(PANE_FILE)) {
      unlinkSync(PANE_FILE);
    }
  } catch {
    // Ignore
  }
}

/**
 * Check if a pane ID is still valid
 */
async function isPaneValid(paneId: string): Promise<boolean> {
  try {
    const result = await $`tmux display-message -t ${paneId} -p "#{pane_id}"`.text();
    return result.trim() === paneId;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux pane and run command in it
 */
async function createNewPane(command: string): Promise<string> {
  // Create horizontal split with fixed 50 character width for sidebar
  // -h = horizontal split (side by side)
  // -l 50 = new pane gets 50 columns (fixed width)
  // -d = don't switch focus to new pane
  // -P -F "#{pane_id}" = print the new pane ID
  const result = await $`tmux split-window -h -l 50 -d -P -F "#{pane_id}"`.text();
  const paneId = result.trim();

  // Store the pane ID for future reuse
  storePaneId(paneId);

  // Send the command to the new pane
  await $`tmux send-keys -t ${paneId} ${command} Enter`.quiet();

  return paneId;
}

/**
 * Reuse an existing pane by sending a new command to it
 */
async function reuseExistingPane(paneId: string, command: string): Promise<void> {
  // Send Ctrl+C to stop any running process
  await $`tmux send-keys -t ${paneId} C-c`.quiet();

  // Wait a moment for the process to stop
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Clear and run the new command
  await $`tmux send-keys -t ${paneId} "clear && ${command}" Enter`.quiet();
}

/**
 * Spawn sidebar in a tmux pane (creates new or reuses existing)
 */
export async function spawnSidebarPane(command: string): Promise<string> {
  if (!isInTmux()) {
    throw new Error("Sidebar requires tmux. Please run inside a tmux session.");
  }

  // Check for existing pane
  const existingPaneId = getStoredPaneId();

  if (existingPaneId && (await isPaneValid(existingPaneId))) {
    console.log(`Reusing existing sidebar pane: ${existingPaneId}`);
    await reuseExistingPane(existingPaneId, command);
    return existingPaneId;
  }

  // Clear stale pane reference if any
  if (existingPaneId) {
    console.log("Clearing stale pane reference...");
    clearStoredPaneId();
  }

  // Create new pane
  console.log("Creating new sidebar pane...");
  const paneId = await createNewPane(command);
  console.log(`Created sidebar pane: ${paneId}`);

  return paneId;
}

/**
 * Close the sidebar pane
 */
export async function closeSidebarPane(): Promise<void> {
  const paneId = getStoredPaneId();
  if (paneId && (await isPaneValid(paneId))) {
    try {
      await $`tmux kill-pane -t ${paneId}`.quiet();
    } catch {
      // Pane might already be gone
    }
  }
  clearStoredPaneId();
}

/**
 * Get environment info for debugging
 */
export function getEnvInfo(): {
  inTmux: boolean;
  term: string;
  shell: string;
  storedPaneId: string | null;
} {
  return {
    inTmux: isInTmux(),
    term: process.env.TERM || "unknown",
    shell: process.env.SHELL || "unknown",
    storedPaneId: getStoredPaneId(),
  };
}

/**
 * Get Claude Code's pane ID (the pane that isn't the sidebar)
 */
export async function getClaudePaneId(): Promise<string | null> {
  if (!isInTmux()) return null;

  const sidebarPaneId = getStoredPaneId();
  if (!sidebarPaneId) return null;

  try {
    const panesOutput = await $`tmux list-panes -F "#{pane_id}"`.text();
    const panes = panesOutput.trim().split("\n");
    return panes.find((p) => p !== sidebarPaneId) || null;
  } catch {
    return null;
  }
}

/**
 * Focus the Claude Code pane (switch tmux focus to it)
 */
export async function focusClaudePane(): Promise<boolean> {
  const claudePane = await getClaudePaneId();
  if (!claudePane) return false;

  try {
    await $`tmux select-pane -t ${claudePane}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a message to the Claude Code pane (the pane that isn't the sidebar)
 */
export async function sendToClaudePane(message: string): Promise<boolean> {
  const claudePane = await getClaudePaneId();
  if (!claudePane) return false;

  try {
    await $`tmux send-keys -t ${claudePane} ${message} Enter`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the last N lines of Claude's pane output
 */
export async function captureClaudePane(lines: number = 10): Promise<string | null> {
  const claudePane = await getClaudePaneId();
  if (!claudePane) return null;

  try {
    const output = await $`tmux capture-pane -t ${claudePane} -p -S -${lines}`.text();
    return output;
  } catch {
    return null;
  }
}

/**
 * Check if Claude Code is at an input prompt (waiting for input)
 * Returns true if Claude appears to be waiting for user input
 */
export async function isClaudeAtPrompt(): Promise<boolean> {
  const output = await captureClaudePane(5);
  if (!output) return false;

  const lines = output.trim().split("\n");
  const lastLine = lines[lines.length - 1] || "";

  // Claude Code shows ">" at start when waiting for input
  // Also check for common prompt patterns
  const promptPatterns = [
    /^>\s*$/,           // Just ">" with optional whitespace
    /^> $/,             // "> " with space
    /^\s*>\s*$/,        // Whitespace + ">" + whitespace
  ];

  return promptPatterns.some((pattern) => pattern.test(lastLine));
}
