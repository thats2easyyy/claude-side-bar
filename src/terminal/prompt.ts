/**
 * Shared prompt detection logic for Claude Code terminals
 * Used by both iTerm2 and tmux integrations
 */

/**
 * Patterns that indicate Claude Code is waiting for input
 */
const PROMPT_PATTERNS = [
  /^❯\s*$/,  // Just the prompt character with optional whitespace
  /^>\s*$/,  // Fallback prompt character
];

/**
 * Check if terminal output indicates Claude is at a prompt
 * Analyzes the last few lines of output for prompt patterns
 */
export function checkOutputForPrompt(output: string): boolean {
  const lines = output.trim().split("\n");
  const linesToCheck = 5;

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - linesToCheck); i--) {
    const line = lines[i] || "";
    if (PROMPT_PATTERNS.some((pattern) => pattern.test(line))) {
      return true;
    }
  }

  return false;
}
