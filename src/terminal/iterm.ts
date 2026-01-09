/**
 * iTerm2 integration for spawning sidebar in split pane
 * Uses AppleScript to create native iTerm2 splits (no tmux needed)
 */

import { $ } from "bun";

/**
 * Check if we're running in iTerm2
 */
export function isInITerm(): boolean {
  return process.env.TERM_PROGRAM === "iTerm.app";
}

/**
 * Get the current session's unique ID for reference
 */
export async function getCurrentSessionId(): Promise<string | null> {
  try {
    const script = `
      tell application "iTerm2"
        tell current session of current tab of current window
          return unique id
        end tell
      end tell
    `;
    const result = await $`osascript -e ${script}`.text();
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Create an iTerm2 vertical split (sidebar on right) and run command
 * Returns the unique ID of the new session
 */
export async function spawnITermSidebarPane(command: string): Promise<string | null> {
  try {
    const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // Split first, then send command to the new session
    const script = `
      tell application "iTerm2"
        tell current session of current tab of current window
          set newSession to (split vertically with default profile)
        end tell
        tell newSession
          write text "${escapedCommand}"
          return unique id
        end tell
      end tell
    `;
    const result = await $`osascript -e ${script}`.text();
    return result.trim();
  } catch (err) {
    console.error("Failed to spawn iTerm sidebar:", err);
    return null;
  }
}

/**
 * Send text to a specific iTerm2 session by index (1-based)
 * Session 1 is typically the first/left pane, session 2 is the right pane
 */
export async function sendToSession(sessionIndex: number, text: string): Promise<boolean> {
  try {
    const escapedText = text.replace(/"/g, '\\"');
    const script = `
      tell application "iTerm2"
        tell session ${sessionIndex} of current tab of current window
          write text "${escapedText}"
        end tell
      end tell
    `;
    await $`osascript -e ${script}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Send text to the first session (Claude Code pane)
 * Assumes sidebar is in session 2 and Claude is in session 1
 */
export async function sendToClaudePane(text: string): Promise<boolean> {
  return sendToSession(1, text);
}

/**
 * Get the number of sessions in the current tab
 */
export async function getSessionCount(): Promise<number> {
  try {
    const script = `
      tell application "iTerm2"
        return count of sessions of current tab of current window
      end tell
    `;
    const result = await $`osascript -e ${script}`.text();
    return parseInt(result.trim(), 10);
  } catch {
    return 0;
  }
}

/**
 * Close a session by index
 */
export async function closeSession(sessionIndex: number): Promise<boolean> {
  try {
    const script = `
      tell application "iTerm2"
        tell session ${sessionIndex} of current tab of current window
          close
        end tell
      end tell
    `;
    await $`osascript -e ${script}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Focus a specific session by index
 */
export async function focusSession(sessionIndex: number): Promise<boolean> {
  try {
    const script = `
      tell application "iTerm2"
        tell session ${sessionIndex} of current tab of current window
          select
        end tell
      end tell
    `;
    await $`osascript -e ${script}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get environment info for debugging
 */
export function getITermEnvInfo(): {
  inITerm: boolean;
  termProgram: string;
} {
  return {
    inITerm: isInITerm(),
    termProgram: process.env.TERM_PROGRAM || "unknown",
  };
}
