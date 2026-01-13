/**
 * Raw terminal sidebar - bypasses Ink completely to avoid flicker
 * Uses direct ANSI escape codes for all rendering
 */

import { execSync } from "child_process";
import {
  getTasks,
  getStatusline,
  getClaudeTodos,
  getEffectiveCwd,
  addTask,
  updateTask,
  removeTask,
  markTaskClarified,
  setTaskSection,
  getActiveTask,
  setActiveTask,
  activateTask,
  completeActiveTask,
  getRecentlyDone,
  removeFromDone,
  returnToActive,
  type Task,
  type TaskSection,
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

// Wrap text into multiple lines (handles both newlines and width wrapping)
function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  // First split by actual newlines
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.length <= maxWidth) {
      lines.push(para);
    } else {
      // Wrap long lines
      let remaining = para;
      while (remaining.length > 0) {
        lines.push(remaining.slice(0, maxWidth));
        remaining = remaining.slice(maxWidth);
      }
    }
  }
  return lines.length > 0 ? lines : [''];
}

type SidebarSection = "inbox" | "clarified" | "in_progress" | "review";

interface State {
  tasks: Task[];
  activeTask: ActiveTask | null;
  doneTasks: DoneTask[];
  claudeTodos: ClaudeTodo[];
  statusline: StatuslineData | null;
  selectedSection: SidebarSection;
  selectedIndex: number;
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
    selectedSection: "inbox",
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
  private onClose?: () => void;
  private isPasting = false;
  private pasteBuffer = "";

  // Get tasks sorted by priority (lower number = higher priority)
  // Tasks without priority go last, sorted by createdAt
  private getSortedTasks(): Task[] {
    const { tasks } = this.state;
    return [...tasks].sort((a, b) => {
      // Both have priority: sort by priority (lower first)
      if (a.priority !== undefined && b.priority !== undefined) {
        return a.priority - b.priority;
      }
      // Only a has priority: a comes first
      if (a.priority !== undefined) return -1;
      // Only b has priority: b comes first
      if (b.priority !== undefined) return 1;
      // Neither has priority: sort by createdAt (oldest first)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  // Get tasks for a specific section
  private getTasksForSection(section: "inbox" | "clarified"): Task[] {
    return this.getSortedTasks().filter(t => {
      const taskSection = t.section || (t.clarified ? "clarified" : "inbox");
      return taskSection === section;
    });
  }

  // Get items for the currently selected section
  private getCurrentSectionItems(): { type: "task" | "todo" | "done"; item: Task | ClaudeTodo | DoneTask }[] {
    const { selectedSection, claudeTodos, doneTasks } = this.state;

    if (selectedSection === "inbox") {
      return this.getTasksForSection("inbox").map(t => ({ type: "task" as const, item: t }));
    }
    if (selectedSection === "clarified") {
      return this.getTasksForSection("clarified").map(t => ({ type: "task" as const, item: t }));
    }
    if (selectedSection === "in_progress") {
      return claudeTodos.map(t => ({ type: "todo" as const, item: t }));
    }
    if (selectedSection === "review") {
      return doneTasks.map(t => ({ type: "done" as const, item: t }));
    }
    return [];
  }

  // Get the ordered list of non-empty sections for navigation
  private getNavigableSections(): SidebarSection[] {
    // All sections always visible and navigable (except in_progress which is display-only)
    return ["inbox", "clarified", "review"];
  }

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
        const line = lines[0] || '';
        this.state.inputBuffer = inputBuffer.slice(0, inputCursor) + line + inputBuffer.slice(inputCursor);
        this.state.inputCursor = inputCursor + line.length;
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
        const content = afterStart.split(pasteEnd)[0] || "";
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

    // Shift+Enter (\n) - insert newline
    // In iTerm2: Enter sends \r, Shift+Enter sends \n
    if (str === '\n') {
      this.state.inputBuffer = inputBuffer.slice(0, inputCursor) + '\n' + inputBuffer.slice(inputCursor);
      this.state.inputCursor = inputCursor + 1;
      this.redrawInputText();
      return;
    }

    // Enter (\r) - submit
    if (str === '\r') {
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
      const maxWidth = this.width - 10;
      if (inputCursor >= maxWidth) {
        this.state.inputCursor = inputCursor - maxWidth;
        this.moveCursor();
      }
      return;
    }

    // Down arrow - move down one visual line
    if (str === '\x1b[B' || str === '\x1bOB') {
      const maxWidth = this.width - 10;
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
      const maxWidth = this.width - 10;
      const visualLine = Math.floor(inputCursor / maxWidth);
      this.state.inputCursor = visualLine * maxWidth;
      this.moveCursor();
      return;
    }

    // Ctrl+E - end of current visual line
    if (str === '\x05') {
      const maxWidth = this.width - 10;
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

    // Up arrow or k - navigate within section or to previous section
    if (str === '\x1b[A' || str === '\x1bOA' || str === 'k') {
      const items = this.getCurrentSectionItems();
      const { selectedIndex } = this.state;

      if (selectedIndex > 0) {
        this.state.selectedIndex--;
      } else {
        // Move to previous section
        const sections = this.getNavigableSections();
        const currentIdx = sections.indexOf(this.state.selectedSection);
        if (currentIdx > 0) {
          const prevSection = sections[currentIdx - 1];
          this.state.selectedSection = prevSection!;
          // Select last item in previous section
          const prevItems = this.getCurrentSectionItems();
          this.state.selectedIndex = Math.max(0, prevItems.length - 1);
        }
      }
      this.render();
      return;
    }

    // Down arrow or j - navigate within section or to next section
    if (str === '\x1b[B' || str === '\x1bOB' || str === 'j') {
      const items = this.getCurrentSectionItems();
      const { selectedIndex } = this.state;

      if (selectedIndex < items.length - 1) {
        this.state.selectedIndex++;
      } else {
        // Move to next section
        const sections = this.getNavigableSections();
        const currentIdx = sections.indexOf(this.state.selectedSection);
        if (currentIdx < sections.length - 1) {
          const nextSection = sections[currentIdx + 1];
          this.state.selectedSection = nextSection!;
          this.state.selectedIndex = 0;
        }
      }
      this.render();
      return;
    }

    // Tab - switch between sections
    if (str === '\t') {
      const sections = this.getNavigableSections();
      const currentIdx = sections.indexOf(this.state.selectedSection);
      const nextIdx = (currentIdx + 1) % sections.length;
      this.state.selectedSection = sections[nextIdx]!;
      this.state.selectedIndex = 0;
      this.render();
      return;
    }

    // Enter - send task to Claude (works in inbox and clarified sections)
    if (str === '\r' || str === '\n') {
      const { selectedSection, selectedIndex } = this.state;
      if (selectedSection !== "inbox" && selectedSection !== "clarified") return;

      const tasks = this.getTasksForSection(selectedSection);
      const task = tasks[selectedIndex];
      if (task) {
        // Send to Claude and move to active
        sendToClaudePane(task.content);
        activateTask(task.id);
        this.loadData();
        this.state.selectedIndex = Math.max(0, selectedIndex - 1);
        this.render();
        focusClaudePane();
      }
      return;
    }

    // 'c' - clarify (only works in inbox section)
    if (str === '\x1b[13;5u' || str === '\x1b\r' || str === '\x1b\n' || str === 'c') {
      if (this.state.selectedSection !== "inbox") return;
      const tasks = this.getTasksForSection("inbox");
      const task = tasks[this.state.selectedIndex];
      if (task) {
        sendToClaudePane(`/clarify --task-id ${task.id} ${task.content}`);
        this.render();
        focusClaudePane();
      }
      return;
    }

    // 'a' - add task (adds to inbox)
    if (str === 'a') {
      this.pausePolling();
      this.state.selectedSection = "inbox";
      this.state.inputMode = "add";
      this.state.inputBuffer = "";
      this.state.inputCursor = 0;
      this.prevInputLineCount = 1;
      this.render();
      this.setupInputCursor();
      return;
    }

    // 'e' - edit task (only in inbox/clarified sections)
    if (str === 'e') {
      const { selectedSection, selectedIndex } = this.state;
      if (selectedSection !== "inbox" && selectedSection !== "clarified") return;

      const tasks = this.getTasksForSection(selectedSection);
      const task = tasks[selectedIndex];
      if (task) {
        this.pausePolling();
        this.state.inputMode = "edit";
        this.state.editingTaskId = task.id;
        this.state.inputBuffer = task.content;
        this.state.inputCursor = task.content.length;
        const maxWidth = this.width - 10;
        this.prevInputLineCount = Math.max(1, Math.ceil(task.content.length / maxWidth));
        this.render();
        this.setupInputCursor();
      }
      return;
    }

    // 'd' - delete from inbox/clarified, or confirm done in review
    if (str === 'd') {
      const { selectedSection, selectedIndex } = this.state;

      if (selectedSection === "inbox" || selectedSection === "clarified") {
        const tasks = this.getTasksForSection(selectedSection);
        const task = tasks[selectedIndex];
        if (task) {
          removeTask(task.id);
          this.state.tasks = getTasks();
          this.state.selectedIndex = Math.max(0, selectedIndex - 1);
          this.render();
        }
      } else if (selectedSection === "review") {
        const task = this.state.doneTasks[selectedIndex];
        if (task) {
          removeFromDone(task.id);
          this.state.doneTasks = getRecentlyDone();
          if (this.state.doneTasks.length === 0) {
            // Move to another section
            const sections = this.getNavigableSections();
            this.state.selectedSection = sections[0] || "inbox";
            this.state.selectedIndex = 0;
          } else {
            this.state.selectedIndex = Math.min(selectedIndex, this.state.doneTasks.length - 1);
          }
          this.render();
        }
      }
      return;
    }

    // 'r' - return review item to in_progress
    if (str === 'r') {
      if (this.state.selectedSection === "review") {
        const task = this.state.doneTasks[this.state.selectedIndex];
        if (task) {
          returnToActive(task.id);
          this.loadData();
          if (this.state.doneTasks.length === 0) {
            const sections = this.getNavigableSections();
            this.state.selectedSection = sections[0] || "inbox";
            this.state.selectedIndex = 0;
          } else {
            this.state.selectedIndex = Math.min(
              this.state.selectedIndex,
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

  // Calculate visual row and column from cursor position in text with newlines
  private getVisualCursorPos(): { row: number; col: number } {
    const { inputBuffer, inputCursor } = this.state;
    const maxWidth = this.width - 10;

    let visualRow = 0;
    let pos = 0;

    // Walk through the text character by character
    while (pos < inputCursor) {
      if (inputBuffer[pos] === '\n') {
        visualRow++;
        pos++;
      } else {
        // Find the end of this line (next newline or end of text)
        let lineStart = pos;
        let lineEnd = inputBuffer.indexOf('\n', pos);
        if (lineEnd === -1) lineEnd = inputBuffer.length;
        const lineLen = lineEnd - lineStart;

        // How many visual rows does this line take?
        const visualLinesForThisLine = Math.max(1, Math.ceil(lineLen / maxWidth));

        // Is cursor within this line?
        if (inputCursor <= lineEnd) {
          const posInLine = inputCursor - lineStart;
          const extraRows = Math.floor(posInLine / maxWidth);
          const col = posInLine % maxWidth;
          return { row: visualRow + extraRows, col };
        }

        visualRow += visualLinesForThisLine;
        pos = lineEnd + 1; // Move past the newline
      }
    }

    // Cursor at the very end after a newline
    return { row: visualRow, col: 0 };
  }

  private getCursorPosition(): string {
    const { row, col } = this.getVisualCursorPos();
    const cursorRow = this.inputRow + row;
    const cursorCol = 9 + col; // 2 indent + 2 star + 4 bracket = 8, plus 1 for 1-indexed
    return ansi.cursorTo(cursorRow, cursorCol);
  }

  private redrawInputText(): void {
    const { inputBuffer } = this.state;
    const maxWidth = this.width - 10; // Account for "  ★ [ ] " prefix (8 chars) + padding

    // Wrap text into multiple lines
    const wrappedLines = wrapText(inputBuffer, maxWidth);
    if (wrappedLines.length === 0) wrappedLines.push('');

    // Calculate cursor position using the newline-aware function
    const { row, col } = this.getVisualCursorPos();
    const cursorRow = this.inputRow + row;
    const cursorCol = 9 + col;

    // Redraw all wrapped lines
    let output = ansi.beginSync;
    wrappedLines.forEach((line, i) => {
      const prefix = i === 0 ? '  [ ] ' : '      '; // 2 star area + 4 bracket or 6 spaces
      const padding = ' '.repeat(Math.max(0, maxWidth - line.length));
      output += ansi.cursorTo(this.inputRow + i, 1) +
        `${ansi.bgGray}  ${prefix}${ansi.black}${line}${padding}  ${ansi.reset}`;
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
    const { inputMode, editingTaskId, inputBuffer, inputCursor } = this.state;

    // Use dimmed colors when unfocused
    const bg = this.focused ? ansi.bgGray : ansi.dimBg;
    const text = this.focused ? ansi.black : ansi.dimText;
    const muted = this.focused ? ansi.gray : ansi.dimText;
    const bold = this.focused ? ansi.bold : '';

    // Fill with background color
    const bgLine = `${bg}${' '.repeat(this.width)}${ansi.reset}`;

    // Header padding
    lines.push(bgLine);
    lines.push(bgLine);

    const { statusline } = this.state;

    // Content width: total width - 2 (margin) - 4 (indicator like "[ ] ") - 2 (right padding)
    const maxContentWidth = this.width - 8;
    const { claudeTodos, activeTask, doneTasks, selectedSection, selectedIndex } = this.state;

    // Track where the input line is for cursor positioning
    let inputLineRow = 0;

    // ANSI strikethrough
    const strikethrough = '\x1b[9m';
    const noStrike = '\x1b[29m';

    // Helper to render a task in inbox/clarified sections
    const renderTask = (task: Task, index: number, section: "inbox" | "clarified") => {
      const isSelected = selectedSection === section && index === selectedIndex;
      const isEditing = inputMode === "edit" && editingTaskId === task.id;
      const bracket = (isSelected && this.focused) ? "[>] " : "[ ] ";
      const star = task.recommended ? "★ " : "";
      const color = section === "clarified" ? text : muted;

      if (isEditing) {
        inputLineRow = lines.length + 1;
        this.inputRow = inputLineRow;
        const wrappedLines = wrapText(inputBuffer, maxContentWidth - 2);
        if (wrappedLines.length === 0) wrappedLines.push('');
        wrappedLines.forEach((line, i) => {
          const prefix = i === 0 ? `${bracket}${star}` : "    ";
          const padding = ' '.repeat(Math.max(0, maxContentWidth - 2 - line.length));
          lines.push(`${bg}  ${prefix}${text}${line}${padding}${ansi.reset}`);
        });
      } else if (isSelected && this.focused && (task.content.length > maxContentWidth - 2 || task.content.includes('\n'))) {
        const wrappedLines = wrapText(task.content, maxContentWidth - 2);
        wrappedLines.forEach((line, i) => {
          const prefix = i === 0 ? `${bracket}${star}` : "    ";
          lines.push(`${bg}  ${color}${prefix}${line}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
        });
      } else {
        const firstLine = task.content.split('\n')[0] || task.content;
        const content = firstLine.slice(0, maxContentWidth - 2);
        lines.push(`${bg}  ${color}${bracket}${star}${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      }

      // Show spec preview or plan path when selected
      if (isSelected && this.focused && (task.spec || task.planPath) && !isEditing) {
        const detail = task.spec
          ? task.spec.split('\n')[0]?.slice(0, maxContentWidth - 4) || ''
          : `→ ${task.planPath}`;
        lines.push(`${bg}  ${muted}      ${detail.slice(0, maxContentWidth - 2)}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      }
    };

    // === INBOX SECTION ===
    const inboxTasks = this.getTasksForSection("inbox");
    const inboxCount = inboxTasks.length > 0 ? ` (${inboxTasks.length})` : '';
    lines.push(`${bg}  ${bold}${text}Inbox${inboxCount}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);

    if (inboxTasks.length > 0) {
      inboxTasks.forEach((task, index) => renderTask(task, index, "inbox"));
    }

    // Add new task input (in inbox section)
    if (inputMode === "add") {
      inputLineRow = lines.length + 1;
      this.inputRow = inputLineRow;
      const wrappedLines = wrapText(inputBuffer, maxContentWidth - 2);
      if (wrappedLines.length === 0) wrappedLines.push('');
      wrappedLines.forEach((line, i) => {
        const prefix = i === 0 ? '[ ] ' : '    ';
        const padding = ' '.repeat(Math.max(0, maxContentWidth - 2 - line.length));
        lines.push(`${bg}  ${prefix}${text}${line}${padding}${ansi.reset}`);
      });
    } else if (inboxTasks.length === 0) {
      lines.push(`${bg}  ${ansi.gray}[ ] a to add tasks${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    }
    lines.push(bgLine);

    // === CLARIFIED SECTION ===
    const clarifiedTasks = this.getTasksForSection("clarified");
    const clarifiedCount = clarifiedTasks.length > 0 ? ` (${clarifiedTasks.length})` : '';
    lines.push(`${bg}  ${bold}${text}Clarified${clarifiedCount}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    if (clarifiedTasks.length > 0) {
      clarifiedTasks.forEach((task, index) => renderTask(task, index, "clarified"));
    } else {
      lines.push(`${bg}  ${ansi.gray}[ ] c to clarify tasks${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    }
    lines.push(bgLine);

    // === IN PROGRESS SECTION ===
    lines.push(`${bg}  ${bold}${text}In Progress${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    if (activeTask) {
      const content = activeTask.content.slice(0, maxContentWidth);
      lines.push(`${bg}  ${ansi.green}▸   ${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    } else {
      lines.push(`${bg}  ${ansi.gray}[ ] ↵ to send tasks${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    }
    lines.push(bgLine);

    // === REVIEW SECTION ===
    const reviewCount = doneTasks.length > 0 ? ` (${doneTasks.length})` : '';
    lines.push(`${bg}  ${bold}${text}Review${reviewCount}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    if (doneTasks.length > 0) {
      doneTasks.forEach((task, index) => {
        const isSelected = selectedSection === "review" && index === selectedIndex && this.focused;
        const content = task.content.slice(0, maxContentWidth);
        const icon = isSelected ? "[?] " : " ?  ";
        const color = isSelected ? text : muted;
        lines.push(`${bg}  ${color}${icon}${content}${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
      });
    } else {
      lines.push(`${bg}  ${ansi.gray}[ ] d to mark as done${ansi.reset}${bg}${ansi.clearToEnd}${ansi.reset}`);
    }
    lines.push(bgLine);

    // Fill remaining space
    const contentHeight = lines.length;
    const footerHeight = statusline ? 6 : 4;
    const remainingHeight = this.height - contentHeight - footerHeight;
    for (let i = 0; i < remainingHeight; i++) {
      lines.push(bgLine);
    }

    // Footer - context-aware help
    let helpText: string;
    if (inputMode !== "none") {
      helpText = "↵: submit | ⇧↵: newline | Esc: cancel";
    } else if (selectedSection === "review") {
      helpText = "d: confirm done | r: return";
    } else if (selectedSection === "inbox") {
      helpText = "a: add | c: clarify | ↵: send | d: del";
    } else if (selectedSection === "clarified") {
      helpText = "↵: send | e: edit | d: del";
    } else {
      helpText = "↑↓: navigate | Tab: switch section";
    }
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
      lines.push(bgLine);
    }

    // Repo and branch at bottom
    let branch = '';
    let repo = '';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch {}
    const cwd = getEffectiveCwd();
    const parts = cwd.split('/').filter(Boolean);
    repo = parts[parts.length - 1] || cwd;
    const branchDisplay = branch ? `${branch}` : '';
    const repoDisplay = repo ? `${repo}` : '';
    const repoContent = branchDisplay && repoDisplay
      ? `${repoDisplay} · ${branchDisplay}`
      : repoDisplay || branchDisplay;
    lines.push(`${bg}  ${muted}${repoContent}${ansi.clearToEnd}${ansi.reset}`);

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
