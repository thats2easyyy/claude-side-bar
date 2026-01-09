/**
 * Raw terminal sidebar - bypasses Ink completely to avoid flicker
 * Uses direct ANSI escape codes for all rendering
 */

import { execSync } from "child_process";
import {
  getTasks,
  getActiveTask,
  addTask,
  updateTask,
  removeTask,
  activateTask,
  completeActiveTask,
  type Task,
  type ActiveTask,
} from "../persistence/store";
import { sendToClaudePane, isClaudeAtPrompt, focusClaudePane } from "../terminal/tmux";

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
};

type InputMode = "none" | "add" | "edit";

interface State {
  tasks: Task[];
  active: ActiveTask | null;
  selectedIndex: number;
  inputMode: InputMode;
  editingTaskId: string | null;
  inputBuffer: string;
  inputCursor: number;
}

export class RawSidebar {
  private state: State = {
    tasks: [],
    active: null,
    selectedIndex: 0,
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
  private stableCount = 0;
  private onClose?: () => void;

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

    // Setup terminal - enable focus reporting
    process.stdout.write(
      '\x1b[?1004h' + // Enable focus reporting
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

    // Handle input
    process.stdin.on('data', this.handleInput);

    // Handle resize
    process.stdout.on('resize', this.handleResize);

    // Initial render
    this.render();
  }

  stop(): void {
    this.running = false;
    // Disable focus reporting, restore cursor and clear screen
    process.stdout.write('\x1b[?1004l' + ansi.showCursor + ansi.reset + ansi.clearScreen + ansi.cursorHome);
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
    const newActive = getActiveTask();
    const tasksChanged = JSON.stringify(newTasks) !== JSON.stringify(this.state.tasks);
    const activeChanged = JSON.stringify(newActive) !== JSON.stringify(this.state.active);

    if (tasksChanged || activeChanged) {
      this.state.tasks = newTasks;
      this.state.active = newActive;

      // Start/stop completion polling
      if (newActive && !this.completionInterval) {
        this.completionInterval = setInterval(async () => {
          // Skip completion checking during input mode
          if (this.state.inputMode !== "none") return;

          const atPrompt = await isClaudeAtPrompt();
          if (atPrompt) {
            this.stableCount++;
            if (this.stableCount >= 2) {
              completeActiveTask();
              this.state.active = null;
              this.stableCount = 0;
              this.render();
            }
          } else {
            this.stableCount = 0;
          }
        }, 2000);
      } else if (!newActive && this.completionInterval) {
        clearInterval(this.completionInterval);
        this.completionInterval = null;
        this.stableCount = 0;
      }

      this.render();
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
    this.render();
    this.restartPolling();
  }

  private handleInput = (data: Buffer) => {
    const str = data.toString();

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

    // Backspace - optimized single-char delete when at end
    if (str === '\x7f' || str === '\b') {
      if (inputCursor > 0) {
        const atEnd = inputCursor === inputBuffer.length;
        this.state.inputBuffer = inputBuffer.slice(0, inputCursor - 1) + inputBuffer.slice(inputCursor);
        this.state.inputCursor = inputCursor - 1;
        if (atEnd) {
          // Simple case: just erase the last character
          this.handleBackspace();
        } else {
          // Need to redraw from cursor position
          this.redrawInputText();
        }
      }
      return;
    }

    // Arrow keys - just update internal cursor position (no visual update to prevent flicker)
    if (str === '\x1b[D' || str === '\x1bOD') { // Left
      if (inputCursor > 0) {
        this.state.inputCursor = inputCursor - 1;
      }
      return;
    }

    if (str === '\x1b[C' || str === '\x1bOC') { // Right
      if (inputCursor < inputBuffer.length) {
        this.state.inputCursor = inputCursor + 1;
      }
      return;
    }

    // Ctrl+A - start of line
    if (str === '\x01') {
      this.state.inputCursor = 0;
      return;
    }

    // Ctrl+E - end of line
    if (str === '\x05') {
      this.state.inputCursor = inputBuffer.length;
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

    // Regular character - optimized append when at end
    if (str.length === 1 && str.charCodeAt(0) >= 32 && str.charCodeAt(0) <= 126) {
      const atEnd = inputCursor === inputBuffer.length;
      this.state.inputBuffer = inputBuffer.slice(0, inputCursor) + str + inputBuffer.slice(inputCursor);
      this.state.inputCursor = inputCursor + 1;
      if (atEnd) {
        // Simple case: just append the character (cursor advances automatically)
        this.writeChar(str);
      } else {
        // Need to redraw from cursor position
        this.redrawInputText();
      }
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

    // Up arrow or k
    if (str === '\x1b[A' || str === '\x1bOA' || str === 'k') {
      if (this.state.selectedIndex > 0) {
        this.state.selectedIndex--;
        this.render();
      } else if (this.state.selectedIndex === 0 && this.state.active) {
        // Move to active task (index -1)
        this.state.selectedIndex = -1;
        this.render();
      }
      return;
    }

    // Down arrow or j
    if (str === '\x1b[B' || str === '\x1bOB' || str === 'j') {
      if (this.state.selectedIndex === -1) {
        // Move from active to first queue item
        this.state.selectedIndex = 0;
        this.render();
      } else if (this.state.selectedIndex < this.state.tasks.length - 1) {
        this.state.selectedIndex++;
        this.render();
      }
      return;
    }

    // Number keys 1-9
    if (/^[1-9]$/.test(str)) {
      const index = parseInt(str, 10) - 1;
      if (index < this.state.tasks.length) {
        this.state.selectedIndex = index;
        this.render();
      }
      return;
    }

    // Enter - send task to Claude
    if (str === '\r' || str === '\n') {
      const task = this.state.tasks[this.state.selectedIndex];
      if (task) {
        // Clear any existing active task first
        if (this.state.active) {
          completeActiveTask();
          this.state.active = null;
        }
        const activated = activateTask(task.id);
        if (activated) {
          this.state.active = activated;
          this.state.tasks = getTasks();
          sendToClaudePane(task.content);
          this.render();
          focusClaudePane();
        }
      }
      return;
    }

    // 'a' - add task
    if (str === 'a') {
      this.pausePolling();
      this.state.inputMode = "add";
      this.state.inputBuffer = "";
      this.state.inputCursor = 0;
      this.render();
      this.setupInputCursor();
      return;
    }

    // 'e' - edit task
    if (str === 'e') {
      const task = this.state.tasks[this.state.selectedIndex];
      if (task) {
        this.pausePolling();
        this.state.inputMode = "edit";
        this.state.editingTaskId = task.id;
        this.state.inputBuffer = task.content;
        this.state.inputCursor = task.content.length;
        this.render();
        this.setupInputCursor();
      }
      return;
    }

    // 'd' - delete task or clear active
    if (str === 'd') {
      if (this.state.selectedIndex === -1 && this.state.active) {
        // Clear active task
        completeActiveTask();
        this.state.active = null;
        this.state.selectedIndex = 0;
        this.render();
      } else {
        const task = this.state.tasks[this.state.selectedIndex];
        if (task) {
          removeTask(task.id);
          this.state.tasks = getTasks();
          this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
          this.render();
        }
      }
      return;
    }
  }

  private inputRow = 0;

  private setupInputCursor(): void {
    const { inputBuffer, tasks, inputMode, editingTaskId } = this.state;

    // Calculate row for the input line
    // Layout: Row 1: padding, Row 2: Active header, Row 3: active content,
    //         Row 4: margin, Row 5: Queue header, Row 6+: tasks
    let row = 6; // First task row (1-indexed)
    if (inputMode === "edit") {
      const idx = tasks.findIndex(t => t.id === editingTaskId);
      row += Math.max(0, idx);
    } else if (inputMode === "add") {
      row += tasks.length;
    }
    this.inputRow = row;

    // Position cursor at end of current text
    const cursorCol = 7 + inputBuffer.length;
    process.stdout.write(ansi.cursorTo(row, cursorCol) + ansi.showCursor);
  }

  private writeChar(char: string): void {
    process.stdout.write(ansi.beginSync + char + ansi.endSync);
  }

  private handleBackspace(): void {
    process.stdout.write(ansi.beginSync + '\b \b' + ansi.endSync);
  }

  private redrawInputText(): void {
    const { inputBuffer, inputCursor } = this.state;
    const maxWidth = this.width - 8; // Account for "  [ ] " prefix
    const displayText = inputBuffer.slice(0, maxWidth);
    const padding = ' '.repeat(Math.max(0, maxWidth - displayText.length));
    const cursorCol = 7 + Math.min(inputCursor, maxWidth);

    // Redraw full line: move to start, write prefix + text + padding with background
    process.stdout.write(
      ansi.beginSync +
      ansi.cursorTo(this.inputRow, 1) +
      `${ansi.bgGray}  [ ] ${ansi.black}${displayText}${padding}  ${ansi.reset}` +
      ansi.cursorTo(this.inputRow, cursorCol) +
      ansi.endSync
    );
  }

  private render(): void {
    if (!this.running) return;

    const lines: string[] = [];
    const { tasks, active, selectedIndex, inputMode, editingTaskId, inputBuffer, inputCursor } = this.state;

    // Use dimmed colors when unfocused
    const bg = this.focused ? ansi.bgGray : ansi.dimBg;
    const text = this.focused ? ansi.black : ansi.dimText;
    const muted = this.focused ? ansi.gray : ansi.dimText;
    const bold = this.focused ? ansi.bold : '';

    // Fill with background color
    const bgLine = `${bg}${' '.repeat(this.width)}${ansi.reset}`;

    // Header padding
    lines.push(bgLine);

    // Active section
    lines.push(`${bg}  ${bold}${text}Active${ansi.reset}${bg}${' '.repeat(this.width - 8)}${ansi.reset}`);
    if (active) {
      const activeContent = active.content.slice(0, this.width - 8);
      const isActiveSelected = selectedIndex === -1;
      const prefix = isActiveSelected ? '[•]' : '→';
      lines.push(`${bg}  ${text}${prefix} ${activeContent}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    } else {
      lines.push(`${bg}  ${muted}No active task${ansi.reset}${bg}${' '.repeat(this.width - 16)}${ansi.reset}`);
    }

    // Margin
    lines.push(bgLine);

    // To-dos section
    const queueHeader = `To-dos${tasks.length > 0 ? ` (${tasks.length})` : ''}`;
    lines.push(`${bg}  ${bold}${text}${queueHeader}${ansi.reset}${bg}${' '.repeat(this.width - queueHeader.length - 4)}${ansi.reset}`);

    if (tasks.length === 0 && inputMode !== "add") {
      lines.push(`${bg}  ${muted}No to-dos${ansi.reset}${bg}${' '.repeat(this.width - 11)}${ansi.reset}`);
    }

    // Track where the input line is for cursor positioning
    let inputLineRow = 0;
    const maxContentWidth = this.width - 8;

    // Queue items
    tasks.forEach((task, index) => {
      const isSelected = index === selectedIndex;
      const isEditing = inputMode === "edit" && editingTaskId === task.id;

      if (isEditing) {
        inputLineRow = lines.length + 1; // 1-indexed row number
        const displayText = inputBuffer.slice(0, maxContentWidth);
        const padding = ' '.repeat(Math.max(0, maxContentWidth - displayText.length));
        lines.push(`${bg}  [ ] ${text}${displayText}${padding}${ansi.reset}`);
      } else {
        const checkbox = isSelected ? '[•]' : '[ ]';
        const content = task.content.slice(0, this.width - 8);
        lines.push(`${bg}  ${text}${checkbox} ${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      }
    });

    // Add new task input
    if (inputMode === "add") {
      inputLineRow = lines.length + 1; // 1-indexed row number
      const displayText = inputBuffer.slice(0, maxContentWidth);
      const padding = ' '.repeat(Math.max(0, maxContentWidth - displayText.length));
      lines.push(`${bg}  [ ] ${text}${displayText}${padding}${ansi.reset}`);
    }

    // Fill remaining space
    const contentHeight = lines.length;
    const footerHeight = 3;
    const remainingHeight = this.height - contentHeight - footerHeight;
    for (let i = 0; i < remainingHeight; i++) {
      lines.push(bgLine);
    }

    // Footer
    const helpText = inputMode !== "none"
      ? "↵: submit | Esc: cancel"
      : "a: add | e: edit | d: del | ↵: send";
    lines.push(`${bg}  ${muted}${helpText}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    lines.push(bgLine);
    const cwd = process.cwd();
    const parts = cwd.split('/').filter(Boolean);
    const shortPath = parts.length >= 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] || cwd;

    // Get git branch
    let branch = '';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch {}

    const folderDisplay = `📁 ${shortPath}`;
    const branchDisplay = branch ? ` 🌱 ${branch}` : '';
    const footerContent = folderDisplay + branchDisplay;
    const footerPadding = ' '.repeat(Math.max(0, this.width - footerContent.length - 3));
    lines.push(`${bg}  ${text}${footerContent}${footerPadding}${ansi.reset}`);

    // Output everything at once with synchronized output to prevent partial renders
    let output = '\x1b[?2026h' + ansi.cursorHome + lines.join('\n');

    // Position cursor and show it if in input mode, otherwise hide it
    if (inputMode !== "none" && inputLineRow > 0) {
      const cursorCol = 7 + Math.min(inputCursor, maxContentWidth);
      output += ansi.cursorTo(inputLineRow, cursorCol) + ansi.showCursor;
    } else {
      output += ansi.hideCursor;
    }

    output += '\x1b[?2026l';
    process.stdout.write(output);
  }
}
