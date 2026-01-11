/**
 * Raw terminal sidebar - bypasses Ink completely to avoid flicker
 * Uses direct ANSI escape codes for all rendering
 */

import { execSync } from "child_process";
import {
  getTasks,
  getStatusline,
  getClaudeTodos,
  addTask,
  updateTask,
  removeTask,
  getActiveTask,
  setActiveTask,
  activateTask,
  completeActiveTask,
  getRecentlyDone,
  removeFromDone,
  type Task,
  type ActiveTask,
  type DoneTask,
  type StatuslineData,
  type ClaudeTodo,
} from "../persistence/store";
import * as tmux from "../terminal/tmux";
import * as iterm from "../terminal/iterm";

// Check if using iTerm2 natively (not inside tmux)
function useITerm(): boolean {
  return iterm.isInITerm() && !tmux.isInTmux();
}

// Unified functions that work with both iTerm2 and tmux
async function sendToClaudePane(text: string): Promise<boolean> {
  return useITerm() ? iterm.sendToClaudePane(text) : tmux.sendToClaudePane(text);
}

async function focusClaudePane(): Promise<boolean> {
  return useITerm() ? iterm.focusSession(1) : tmux.focusClaudePane();
}

async function isClaudeAtPrompt(): Promise<boolean> {
  return useITerm() ? iterm.isClaudeAtPrompt() : tmux.isClaudeAtPrompt();
}

// ANSI escape codes
const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  clearScreen: `${CSI}2J`,
  cursorHome: `${CSI}H`,
  cursorTo: (row: number, col: number) => `${CSI}${row};${col}H`,
  clearLine: `${CSI}2K`,
  clearToEnd: `${CSI}K`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  // Cursor styles
  steadyCursor: `${CSI}2 q`,
  blinkCursor: `${CSI}1 q`,
  // Synchronized output (DEC mode 2026) - prevents flicker
  beginSync: `${CSI}?2026h`,
  endSync: `${CSI}?2026l`,
  // Alternate screen buffer
  enterAltScreen: `${CSI}?1049h`,
  exitAltScreen: `${CSI}?1049l`,
  // Colors
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  inverse: `${CSI}7m`,
  black: `${CSI}30m`,
  gray: `${CSI}90m`,
  white: `${CSI}37m`,
  bgGray: `${CSI}48;2;255;255;255m`, // #ffffff - focused
  bgBlack: `${CSI}40m`,
  bgWhite: `${CSI}107m`,
  // Dimmed colors for unfocused state
  dimBg: `${CSI}48;2;245;245;245m`, // #f5f5f5 - unfocused
  dimText: `${CSI}30m`, // Same black text (unfocused)
  // Context warning colors
  yellow: `${CSI}33m`, // Warning (60-80%)
  red: `${CSI}31m`, // Critical (>80%)
  green: `${CSI}32m`, // Good (<60%)
};

type InputMode = "none" | "add" | "edit";

// Wrap text into multiple lines
function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    lines.push(remaining.slice(0, maxWidth));
    remaining = remaining.slice(maxWidth);
  }
  return lines;
}

interface State {
  tasks: Task[];
  activeTask: ActiveTask | null;
  doneTasks: DoneTask[];
  claudeTodos: ClaudeTodo[];
  statusline: StatuslineData | null;
  selectedSection: "queue" | "done";
  selectedIndex: number;
  doneSelectedIndex: number;
  inputMode: InputMode;
  editingTaskId: string | null;
  inputBuffer: string;
  inputCursor: number;
}

export class RawSidebar {
  private state: State = {
    tasks: [],
    activeTask: null,
    doneTasks: [],
    claudeTodos: [],
    statusline: null,
    selectedSection: "queue",
    selectedIndex: 0,
    doneSelectedIndex: 0,
    inputMode: "none",
    editingTaskId: null,
    inputBuffer: "",
    inputCursor: 0,
  };

  private width: number;
  private height: number;
  private focused = true;
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private completionInterval: ReturnType<typeof setInterval> | null = null;
  private onClose?: () => void;
  private isPasting = false;
  private pasteBuffer = "";

  constructor(onClose?: () => void) {
    this.width = process.stdout.columns || 50;
    this.height = process.stdout.rows || 40;
    this.onClose = onClose;
  }

  start(): void {
    this.running = true;

    // Use stty to ensure echo is off and we're in raw mode
    try {
      execSync('stty -echo raw', { stdio: 'ignore' });
    } catch {}

    // Setup terminal - enter alt screen buffer and enable focus reporting
    process.stdout.write(
      ansi.enterAltScreen + // Enter alternate screen buffer (prevents scrollback pollution)
      '\x1b[?1004h' + // Enable focus reporting
      '\x1b[?2004h' + // Enable bracketed paste mode
      ansi.hideCursor + ansi.clearScreen + ansi.cursorHome
    );

    // Configure stdin for raw input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Load initial data
    this.loadData();

    // Start polling for data changes
    this.pollInterval = setInterval(() => {
      if (this.state.inputMode === "none") {
        this.loadData();
      }
    }, 1000);

    // Start polling for task completion (check if Claude is idle)
    this.completionInterval = setInterval(() => {
      this.checkCompletion();
    }, 3000);

    // Handle input
    process.stdin.on('data', this.handleInput);

    // Handle resize
    process.stdout.on('resize', this.handleResize);

    // Initial render
    this.render();
  }

  stop(): void {
    this.running = false;
    // Disable focus reporting, bracketed paste, restore cursor, and exit alternate screen buffer
    process.stdout.write('\x1b[?1004l' + '\x1b[?2004l' + ansi.showCursor + ansi.reset + ansi.exitAltScreen);
    process.stdin.setRawMode(false);
    process.stdin.removeListener('data', this.handleInput);
    process.stdout.removeListener('resize', this.handleResize);

    // Restore terminal settings
    try {
      execSync('stty echo -raw sane', { stdio: 'ignore' });
    } catch {}

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.completionInterval) {
      clearInterval(this.completionInterval);
    }
  }

  private loadData(): void {
    const newTasks = getTasks();
    const newActiveTask = getActiveTask();
    const newDoneTasks = getRecentlyDone();
    const newClaudeTodos = getClaudeTodos()?.todos || [];
    const newStatusline = getStatusline();

    const tasksChanged = JSON.stringify(newTasks) !== JSON.stringify(this.state.tasks);
    const activeChanged = JSON.stringify(newActiveTask) !== JSON.stringify(this.state.activeTask);
    const doneChanged = JSON.stringify(newDoneTasks) !== JSON.stringify(this.state.doneTasks);
    const claudeTodosChanged = JSON.stringify(newClaudeTodos) !== JSON.stringify(this.state.claudeTodos);
    const statuslineChanged = JSON.stringify(newStatusline) !== JSON.stringify(this.state.statusline);

    if (tasksChanged || activeChanged || doneChanged || claudeTodosChanged || statuslineChanged) {
      this.state.tasks = newTasks;
      this.state.activeTask = newActiveTask;
      this.state.doneTasks = newDoneTasks;
      this.state.claudeTodos = newClaudeTodos;
      this.state.statusline = newStatusline;
      this.render();
    }
  }

  // Check if Claude is idle and complete active task
  private async checkCompletion(): Promise<void> {
    if (!this.state.activeTask) return;

    try {
      const isIdle = await isClaudeAtPrompt();
      if (isIdle) {
        completeActiveTask();
        this.loadData();
      }
    } catch {
      // Ignore errors from prompt detection
    }
  }

  private handleResize = () => {
    this.width = process.stdout.columns || 50;
    this.height = process.stdout.rows || 40;
    // Don't render during input mode to prevent flicker
    if (this.state.inputMode === "none") {
      this.render();
    }
  };

  private pausePolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.completionInterval) {
      clearInterval(this.completionInterval);
      this.completionInterval = null;
    }
  }

  private restartPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      if (this.state.inputMode === "none") {
        this.loadData();
      }
    }, 1000);
  }

  private exitInputMode(): void {
    this.state.inputBuffer = "";
    this.state.inputCursor = 0;
    this.state.inputMode = "none";
    this.state.editingTaskId = null;
    this.prevInputLineCount = 0;
    this.render();
    this.restartPolling();
  }

  private handlePaste(content: string): void {
    // Only handle paste in input mode
    if (this.state.inputMode === "none") {
      return;
    }

    if (this.state.inputMode === "add") {
      // Split by newlines and create multiple tasks (brain dump feature)
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length === 0) return;

      if (lines.length === 1) {
        // Single line - insert into buffer
        const { inputBuffer, inputCursor } = this.state;
        this.state.inputBuffer = inputBuffer.slice(0, inputCursor) + lines[0] + inputBuffer.slice(inputCursor);
        this.state.inputCursor = inputCursor + lines[0].length;
        this.redrawInputText();
      } else {
        // Multiple lines - create tasks for each
        lines.forEach(line => addTask(line));
        this.state.tasks = getTasks();
        this.exitInputMode();
      }
    } else if (this.state.inputMode === "edit") {
      // In edit mode - insert at cursor
      const { inputBuffer, inputCursor } = this.state;
      // Join multiple lines with space for edit mode
      const text = content.replace(/\r?\n/g, ' ').trim();
      this.state.inputBuffer = inputBuffer.slice(0, inputCursor) + text + inputBuffer.slice(inputCursor);
      this.state.inputCursor = inputCursor + text.length;
      this.redrawInputText();
    }
  }

  private handleInput = (data: Buffer) => {
    const str = data.toString();

    // Bracketed paste mode detection
    const pasteStart = '\x1b[200~';
    const pasteEnd = '\x1b[201~';

    // Check for paste start
    if (str.includes(pasteStart)) {
      this.isPasting = true;
      this.pasteBuffer = "";
      // Extract content after paste start marker
      const afterStart = str.split(pasteStart)[1] || "";
      if (afterStart.includes(pasteEnd)) {
        // Paste start and end in same chunk
        const content = afterStart.split(pasteEnd)[0];
        this.handlePaste(content);
        this.isPasting = false;
      } else {
        this.pasteBuffer = afterStart;
      }
      return;
    }

    // Check for paste end (if we're in paste mode)
    if (this.isPasting) {
      if (str.includes(pasteEnd)) {
        const beforeEnd = str.split(pasteEnd)[0];
        this.pasteBuffer += beforeEnd;
        this.handlePaste(this.pasteBuffer);
        this.isPasting = false;
        this.pasteBuffer = "";
      } else {
        this.pasteBuffer += str;
      }
      return;
    }

    // Terminal focus events (sent by terminal when focus-events enabled)
    if (str === '\x1b[I') {
      // Focus in
      if (!this.focused) {
        this.focused = true;
        this.render();
      }
      return;
    }
    if (str === '\x1b[O') {
      // Focus out
      if (this.focused) {
        this.focused = false;
        this.render();
      }
      return;
    }

    if (this.state.inputMode !== "none") {
      this.handleInputMode(str);
    } else {
      this.handleNormalMode(str);
    }
  };

  private handleInputMode(str: string): void {
    const { inputBuffer, inputCursor } = this.state;

    // Enter - submit
    if (str === '\r' || str === '\n') {
      if (inputBuffer.trim()) {
        if (this.state.inputMode === "add") {
          addTask(inputBuffer.trim());
        } else if (this.state.inputMode === "edit" && this.state.editingTaskId) {
          updateTask(this.state.editingTaskId, inputBuffer.trim());
        }
        this.state.tasks = getTasks();
      }
      this.exitInputMode();
      return;
    }

    // Escape - cancel
    if (str === '\x1b') {
      this.exitInputMode();
      return;
    }

    // Backspace
    if (str === '\x7f' || str === '\b') {
      if (inputCursor > 0) {
        this.state.inputBuffer = inputBuffer.slice(0, inputCursor - 1) + inputBuffer.slice(inputCursor);
        this.state.inputCursor = inputCursor - 1;
        // Always redraw for multi-line support
        this.redrawInputText();
      }
      return;
    }

    // Arrow keys
    if (str === '\x1b[D' || str === '\x1bOD') { // Left
      if (inputCursor > 0) {
        this.state.inputCursor = inputCursor - 1;
        this.moveCursor();
      }
      return;
    }

    if (str === '\x1b[C' || str === '\x1bOC') { // Right
      if (inputCursor < inputBuffer.length) {
        this.state.inputCursor = inputCursor + 1;
        this.moveCursor();
      }
      return;
    }

    // Up arrow - move up one visual line
    if (str === '\x1b[A' || str === '\x1bOA') {
      const maxWidth = this.width - 8;
      if (inputCursor >= maxWidth) {
        this.state.inputCursor = inputCursor - maxWidth;
        this.moveCursor();
      }
      return;
    }

    // Down arrow - move down one visual line
    if (str === '\x1b[B' || str === '\x1bOB') {
      const maxWidth = this.width - 8;
      const newPos = inputCursor + maxWidth;
      if (newPos <= inputBuffer.length) {
        this.state.inputCursor = newPos;
        this.moveCursor();
      } else if (inputCursor < inputBuffer.length) {
        // If can't go down a full line, go to end
        this.state.inputCursor = inputBuffer.length;
        this.moveCursor();
      }
      return;
    }

    // Option+Left - move to start of previous word (iTerm2: \x1b[1;3D or \x1bb)
    if (str === '\x1b[1;3D' || str === '\x1bb') {
      let pos = inputCursor;
      // Skip any spaces before cursor
      while (pos > 0 && inputBuffer[pos - 1] === ' ') pos--;
      // Skip word characters
      while (pos > 0 && inputBuffer[pos - 1] !== ' ') pos--;
      this.state.inputCursor = pos;
      this.moveCursor();
      return;
    }

    // Option+Right - move to end of next word (iTerm2: \x1b[1;3C or \x1bf)
    if (str === '\x1b[1;3C' || str === '\x1bf') {
      let pos = inputCursor;
      // Skip word characters
      while (pos < inputBuffer.length && inputBuffer[pos] !== ' ') pos++;
      // Skip any spaces after word
      while (pos < inputBuffer.length && inputBuffer[pos] === ' ') pos++;
      this.state.inputCursor = pos;
      this.moveCursor();
      return;
    }

    // Ctrl+A - start of current visual line
    if (str === '\x01') {
      const maxWidth = this.width - 8;
      const visualLine = Math.floor(inputCursor / maxWidth);
      this.state.inputCursor = visualLine * maxWidth;
      this.moveCursor();
      return;
    }

    // Ctrl+E - end of current visual line
    if (str === '\x05') {
      const maxWidth = this.width - 8;
      const visualLine = Math.floor(inputCursor / maxWidth);
      const lineEnd = Math.min((visualLine + 1) * maxWidth, inputBuffer.length);
      this.state.inputCursor = lineEnd;
      this.moveCursor();
      return;
    }

    // Ctrl+U - clear to start
    if (str === '\x15') {
      this.state.inputBuffer = inputBuffer.slice(inputCursor);
      this.state.inputCursor = 0;
      this.redrawInputText();
      return;
    }

    // Ctrl+K - clear to end
    if (str === '\x0b') {
      this.state.inputBuffer = inputBuffer.slice(0, inputCursor);
      this.redrawInputText();
      return;
    }

    // Ctrl+W - delete word before cursor
    if (str === '\x17') {
      if (inputCursor > 0) {
        // Find start of previous word (skip trailing spaces, then skip word chars)
        let pos = inputCursor;
        while (pos > 0 && inputBuffer[pos - 1] === ' ') pos--;
        while (pos > 0 && inputBuffer[pos - 1] !== ' ') pos--;
        this.state.inputBuffer = inputBuffer.slice(0, pos) + inputBuffer.slice(inputCursor);
        this.state.inputCursor = pos;
        this.redrawInputText();
      }
      return;
    }

    // Regular character
    if (str.length === 1 && str.charCodeAt(0) >= 32 && str.charCodeAt(0) <= 126) {
      this.state.inputBuffer = inputBuffer.slice(0, inputCursor) + str + inputBuffer.slice(inputCursor);
      this.state.inputCursor = inputCursor + 1;
      // Always redraw for multi-line support
      this.redrawInputText();
      return;
    }
  }

  private handleNormalMode(str: string): void {
    // Escape - close
    if (str === '\x1b') {
      this.stop();
      this.onClose?.();
      process.exit(0);
    }

    // Up arrow or k (navigates queue and done sections)
    if (str === '\x1b[A' || str === '\x1bOA' || str === 'k') {
      const { selectedSection, selectedIndex, doneSelectedIndex, tasks, doneTasks } = this.state;

      if (selectedSection === "queue") {
        if (tasks.length === 0) {
          // No queue items, try to go to done
          if (doneTasks.length > 0) {
            this.state.selectedSection = "done";
            this.state.doneSelectedIndex = doneTasks.length - 1;
          }
        } else if (selectedIndex > 0) {
          this.state.selectedIndex--;
        } else {
          // At top of queue, wrap to bottom of done (or bottom of queue)
          if (doneTasks.length > 0) {
            this.state.selectedSection = "done";
            this.state.doneSelectedIndex = Math.min(doneTasks.length - 1, 4); // Max 5 shown
          } else {
            this.state.selectedIndex = tasks.length - 1;
          }
        }
      } else {
        // In done section
        if (doneSelectedIndex > 0) {
          this.state.doneSelectedIndex--;
        } else {
          // At top of done, wrap to bottom of queue (or bottom of done)
          if (tasks.length > 0) {
            this.state.selectedSection = "queue";
            this.state.selectedIndex = tasks.length - 1;
          } else {
            this.state.doneSelectedIndex = Math.min(doneTasks.length - 1, 4);
          }
        }
      }
      this.render();
      return;
    }

    // Down arrow or j (navigates queue and done sections)
    if (str === '\x1b[B' || str === '\x1bOB' || str === 'j') {
      const { selectedSection, selectedIndex, doneSelectedIndex, tasks, doneTasks } = this.state;

      if (selectedSection === "queue") {
        if (tasks.length === 0) {
          // No queue items, try to go to done
          if (doneTasks.length > 0) {
            this.state.selectedSection = "done";
            this.state.doneSelectedIndex = 0;
          }
        } else if (selectedIndex < tasks.length - 1) {
          this.state.selectedIndex++;
        } else {
          // At bottom of queue, wrap to top of done (or top of queue)
          if (doneTasks.length > 0) {
            this.state.selectedSection = "done";
            this.state.doneSelectedIndex = 0;
          } else {
            this.state.selectedIndex = 0;
          }
        }
      } else {
        // In done section
        const maxDoneIndex = Math.min(doneTasks.length - 1, 4); // Max 5 shown
        if (doneSelectedIndex < maxDoneIndex) {
          this.state.doneSelectedIndex++;
        } else {
          // At bottom of done, wrap to top of queue (or top of done)
          if (tasks.length > 0) {
            this.state.selectedSection = "queue";
            this.state.selectedIndex = 0;
          } else {
            this.state.doneSelectedIndex = 0;
          }
        }
      }
      this.render();
      return;
    }

    // Number keys 1-9 (select queue item, switches to queue section)
    if (/^[1-9]$/.test(str)) {
      const index = parseInt(str, 10) - 1;
      if (index < this.state.tasks.length) {
        this.state.selectedSection = "queue";
        this.state.selectedIndex = index;
        this.render();
      }
      return;
    }

    // Enter - send task to Claude (only works in queue section)
    if (str === '\r' || str === '\n') {
      if (this.state.selectedSection !== "queue") return;
      const task = this.state.tasks[this.state.selectedIndex];
      if (task) {
        // Send to Claude and move to active
        sendToClaudePane(task.content);
        activateTask(task.id);
        this.loadData();
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
        this.render();
        focusClaudePane();
      }
      return;
    }

    // Ctrl+Enter or 'c' - clarify mode (only works in queue section)
    // CSI u format: \x1b[13;5u (iTerm2), 'c' as fallback
    if (str === '\x1b[13;5u' || str === '\x1b\r' || str === '\x1b\n' || str === 'c') {
      if (this.state.selectedSection !== "queue") return;
      const task = this.state.tasks[this.state.selectedIndex];
      if (task) {
        const clarifyPrompt = `CLARIFY MODE

TASK: ${task.content}

Interview me in depth using AskUserQuestion about this task. Ask about anything relevant: technical implementation, UI/UX, edge cases, concerns, tradeoffs, constraints, dependencies, etc.

Guidelines:
- Don't ask obvious questions - if something is clear from the task description, don't ask about it
- Be thorough - keep interviewing until you have complete clarity
- Always include "Anything else I should know?" as a final question
- Ask about context handling: clear window / compact / keep / decide for me
- Ask about Atomic Plans: create a plan / just execute / decide for me

After clarification is complete, write specs to an Atomic Plan, then execute the task.`;

        sendToClaudePane(clarifyPrompt);
        activateTask(task.id);
        this.loadData();
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
        this.render();
        focusClaudePane();
      }
      return;
    }

    // 'a' - add task (always switches to queue section)
    if (str === 'a') {
      this.pausePolling();
      this.state.selectedSection = "queue";
      this.state.inputMode = "add";
      this.state.inputBuffer = "";
      this.state.inputCursor = 0;
      this.prevInputLineCount = 1; // Start with 1 empty line
      this.render();
      this.setupInputCursor();
      return;
    }

    // 'e' - edit task (only works in queue section)
    if (str === 'e') {
      if (this.state.selectedSection !== "queue") return;
      const task = this.state.tasks[this.state.selectedIndex];
      if (task) {
        this.pausePolling();
        this.state.inputMode = "edit";
        this.state.editingTaskId = task.id;
        this.state.inputBuffer = task.content;
        this.state.inputCursor = task.content.length;
        const maxWidth = this.width - 8;
        this.prevInputLineCount = Math.max(1, Math.ceil(task.content.length / maxWidth));
        this.render();
        this.setupInputCursor();
      }
      return;
    }

    // 'd' - delete task (works on queue or done section)
    if (str === 'd') {
      if (this.state.selectedSection === "queue") {
        const task = this.state.tasks[this.state.selectedIndex];
        if (task) {
          removeTask(task.id);
          this.state.tasks = getTasks();
          this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
          this.render();
        }
      } else {
        // Delete from done section
        const task = this.state.doneTasks[this.state.doneSelectedIndex];
        if (task) {
          removeFromDone(task.id);
          this.state.doneTasks = getRecentlyDone();
          // Adjust selection if needed
          if (this.state.doneTasks.length === 0) {
            // No more done tasks, go back to queue
            this.state.selectedSection = "queue";
            this.state.selectedIndex = Math.max(0, this.state.tasks.length - 1);
          } else {
            this.state.doneSelectedIndex = Math.min(
              this.state.doneSelectedIndex,
              this.state.doneTasks.length - 1
            );
          }
          this.render();
        }
      }
      return;
    }
  }

  private inputRow = 0;
  private prevInputLineCount = 0;

  private setupInputCursor(): void {
    process.stdout.write(this.getCursorPosition() + ansi.showCursor);
  }

  private moveCursor(): void {
    process.stdout.write(ansi.beginSync + this.getCursorPosition() + ansi.endSync);
  }

  private getCursorPosition(): string {
    const { inputCursor } = this.state;
    const maxWidth = this.width - 8;

    // Calculate which visual line the cursor is on and column within that line
    const visualLine = Math.floor(inputCursor / maxWidth);
    const col = inputCursor % maxWidth;

    // Position cursor (this.inputRow is set during render)
    const cursorRow = this.inputRow + visualLine;
    const cursorCol = 7 + col;
    return ansi.cursorTo(cursorRow, cursorCol);
  }

  private redrawInputText(): void {
    const { inputBuffer, inputCursor } = this.state;
    const maxWidth = this.width - 8; // Account for "  [ ] " prefix

    // Wrap text into multiple lines
    const wrappedLines = wrapText(inputBuffer, maxWidth);
    if (wrappedLines.length === 0) wrappedLines.push('');

    // Calculate cursor position
    const visualLine = Math.floor(inputCursor / maxWidth);
    const col = inputCursor % maxWidth;
    const cursorRow = this.inputRow + visualLine;
    const cursorCol = 7 + col;

    // Redraw all wrapped lines
    let output = ansi.beginSync;
    wrappedLines.forEach((line, i) => {
      const prefix = i === 0 ? '[ ]' : '   ';
      const padding = ' '.repeat(Math.max(0, maxWidth - line.length));
      output += ansi.cursorTo(this.inputRow + i, 1) +
        `${ansi.bgGray}  ${prefix} ${ansi.black}${line}${padding}  ${ansi.reset}`;
    });

    // Clear any leftover lines from previous longer text
    for (let i = wrappedLines.length; i < this.prevInputLineCount; i++) {
      output += ansi.cursorTo(this.inputRow + i, 1) +
        `${ansi.bgGray}${' '.repeat(this.width)}${ansi.reset}`;
    }
    this.prevInputLineCount = wrappedLines.length;

    output += ansi.cursorTo(cursorRow, cursorCol) + ansi.endSync;
    process.stdout.write(output);
  }

  private render(): void {
    if (!this.running) return;

    const lines: string[] = [];
    const { tasks, selectedIndex, inputMode, editingTaskId, inputBuffer, inputCursor } = this.state;

    // Use dimmed colors when unfocused
    const bg = this.focused ? ansi.bgGray : ansi.dimBg;
    const text = this.focused ? ansi.black : ansi.dimText;
    const muted = this.focused ? ansi.gray : ansi.dimText;
    const bold = this.focused ? ansi.bold : '';

    // Fill with background color
    const bgLine = `${bg}${' '.repeat(this.width)}${ansi.reset}`;

    // Header padding
    lines.push(bgLine);

    // Repo and branch at top (from statusline if available, else fallback)
    const { statusline } = this.state;
    let branch = statusline?.branch || '';
    let repo = statusline?.repo || '';
    if (!branch) {
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
      } catch {}
    }
    if (!repo) {
      const cwd = process.cwd();
      const parts = cwd.split('/').filter(Boolean);
      repo = parts[parts.length - 1] || cwd;
    }
    const branchDisplay = branch ? `${branch}` : '';
    const repoDisplay = repo ? `${repo}` : '';
    const headerContent = branchDisplay && repoDisplay
      ? `${repoDisplay} · ${branchDisplay}`
      : repoDisplay || branchDisplay;
    lines.push(`${bg}  ${text}${headerContent}${ansi.clearToEnd}${ansi.reset}`);
    lines.push(bgLine); // Space after header

    // Active section - combines sidebar active task + Claude's TodoWrite items
    const { claudeTodos } = this.state;
    const { activeTask, doneTasks } = this.state;
    const activeTodos = claudeTodos.filter(t => t.status !== "completed");
    const maxContentWidth = this.width - 8;

    // Show Active section if there's an active task OR in-progress todos
    if (activeTask || activeTodos.length > 0) {
      lines.push(`${bg}  ${bold}${text}Active${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);

      // Show sidebar active task first (sent from queue)
      if (activeTask) {
        const content = activeTask.content.slice(0, maxContentWidth - 2);
        lines.push(`${bg}  ${ansi.green}▶ ${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      }

      // Show Claude's TodoWrite items (what Claude is tracking)
      activeTodos.forEach((todo) => {
        let statusIcon: string;
        let todoColor = text;
        if (todo.status === "in_progress") {
          statusIcon = "●";
          todoColor = ansi.green;
        } else {
          statusIcon = "○";
        }
        const content = todo.content.slice(0, maxContentWidth - 2);
        lines.push(`${bg}  ${todoColor}${statusIcon} ${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      });

      lines.push(bgLine);
    }

    // Done section (recently completed tasks, navigable for deletion)
    const { selectedSection, doneSelectedIndex } = this.state;
    if (doneTasks.length > 0) {
      lines.push(`${bg}  ${bold}${text}Done${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      doneTasks.slice(0, 5).forEach((task, index) => {
        const isSelected = selectedSection === "done" && index === doneSelectedIndex && this.focused;
        const content = task.content.slice(0, maxContentWidth - 2);
        const icon = isSelected ? "[✓]" : " ✓ ";
        const color = isSelected ? text : muted;
        lines.push(`${bg}  ${color}${icon} ${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      });
      lines.push(bgLine);
    }

    // To-dos section
    const queueHeader = `To-dos${tasks.length > 0 ? ` (${tasks.length})` : ''}`;
    lines.push(`${bg}  ${bold}${text}${queueHeader}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);

    // Track where the input line is for cursor positioning
    let inputLineRow = 0;

    // Queue items
    tasks.forEach((task, index) => {
      const isSelected = selectedSection === "queue" && index === selectedIndex;
      const isEditing = inputMode === "edit" && editingTaskId === task.id;

      if (isEditing) {
        inputLineRow = lines.length + 1; // 1-indexed row number
        this.inputRow = inputLineRow; // Store for cursor positioning
        const wrappedLines = wrapText(inputBuffer, maxContentWidth);
        if (wrappedLines.length === 0) wrappedLines.push('');
        wrappedLines.forEach((line, i) => {
          const prefix = i === 0 ? '[ ]' : '   ';
          const padding = ' '.repeat(Math.max(0, maxContentWidth - line.length));
          lines.push(`${bg}  ${prefix} ${text}${line}${padding}${ansi.reset}`);
        });
      } else if (isSelected && this.focused && task.content.length > maxContentWidth) {
        // Wrap text when selected (only when focused)
        const wrappedLines = wrapText(task.content, maxContentWidth);
        wrappedLines.forEach((line, i) => {
          const checkbox = i === 0 ? '[•]' : '   ';
          lines.push(`${bg}  ${text}${checkbox} ${line}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
        });
      } else {
        const checkbox = (isSelected && this.focused) ? '[•]' : '[ ]';
        const content = task.content.slice(0, maxContentWidth);
        lines.push(`${bg}  ${text}${checkbox} ${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      }
    });

    // Add new task input
    if (inputMode === "add") {
      inputLineRow = lines.length + 1; // 1-indexed row number
      this.inputRow = inputLineRow; // Store for cursor positioning
      const wrappedLines = wrapText(inputBuffer, maxContentWidth);
      if (wrappedLines.length === 0) wrappedLines.push('');
      wrappedLines.forEach((line, i) => {
        const prefix = i === 0 ? '[ ]' : '   ';
        const padding = ' '.repeat(Math.max(0, maxContentWidth - line.length));
        lines.push(`${bg}  ${prefix} ${text}${line}${padding}${ansi.reset}`);
      });
    } else if (this.focused) {
      // Show hint to add task (only when focused)
      lines.push(`${bg}  ${ansi.gray}[ ] press a to add${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    }

    // Fill remaining space
    const contentHeight = lines.length;
    const footerHeight = statusline ? 4 : 3;
    const remainingHeight = this.height - contentHeight - footerHeight;
    for (let i = 0; i < remainingHeight; i++) {
      lines.push(bgLine);
    }

    // Footer
    const helpText = inputMode !== "none"
      ? "↵: submit | Esc: cancel"
      : "a: add | e: edit | d: del | ↵: send | c: clarify";
    lines.push(`${bg}  ${muted}${helpText}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    lines.push(bgLine);

    // Context metadata at bottom (if available from Claude Code)
    if (statusline) {
      // Color-code context based on usage level
      const ctxPercent = statusline.contextPercent;
      const ctxColor = ctxPercent >= 80 ? ansi.red : ctxPercent >= 60 ? ansi.yellow : ansi.green;

      // Visual progress bar (10 chars wide)
      const barWidth = 10;
      const filledCount = Math.round((ctxPercent / 100) * barWidth);
      const emptyCount = barWidth - filledCount;
      const progressBar = '█'.repeat(filledCount) + '░'.repeat(emptyCount);

      const ctxDisplay = `${ctxColor}${progressBar}${ansi.reset}${bg} ${text}${ctxPercent}%`;
      const costDisplay = `$${statusline.costUsd.toFixed(2)}`;
      const durationDisplay = `${statusline.durationMin}m`;
      const statusInfo = `${ctxDisplay}  ${costDisplay}  ${durationDisplay}`;
      lines.push(`${bg}  ${statusInfo}${ansi.clearToEnd}${ansi.reset}`);
    }
    lines.push(bgLine); // Bottom padding

    // Output everything at once with synchronized output to prevent partial renders
    let output = '\x1b[?2026h' + ansi.cursorHome + lines.join('\n');

    // Position cursor and show it if in input mode, otherwise hide it
    if (inputMode !== "none" && inputLineRow > 0) {
      // Calculate which visual line the cursor is on
      const visualLine = Math.floor(inputCursor / maxContentWidth);
      const col = inputCursor % maxContentWidth;
      const cursorRow = inputLineRow + visualLine;
      const cursorCol = 7 + col;
      output += ansi.cursorTo(cursorRow, cursorCol) + ansi.showCursor;
    } else {
      output += ansi.hideCursor;
    }

    output += '\x1b[?2026l';
    process.stdout.write(output);
  }
}
