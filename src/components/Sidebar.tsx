import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { Box, Text, useInput, useApp, useStdin } from "ink";
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
import { sendToClaudePane, isClaudeAtPrompt } from "../terminal/tmux";

// Parse a raw keypress buffer into key info (simplified version)
function parseRawKey(data: Buffer): { input: string; key: any } {
  const str = data.toString();
  const key = {
    return: str === '\r' || str === '\n',
    escape: str === '\x1b',
    backspace: str === '\x7f' || str === '\b',
    delete: str === '\x1b[3~',
    leftArrow: str === '\x1b[D' || str === '\x1bOD',
    rightArrow: str === '\x1b[C' || str === '\x1bOC',
    upArrow: str === '\x1b[A' || str === '\x1bOA',
    downArrow: str === '\x1b[B' || str === '\x1bOB',
    ctrl: str.charCodeAt(0) < 32 && str !== '\r' && str !== '\n' && str !== '\x1b',
    meta: str.startsWith('\x1b') && str.length > 1 && !str.startsWith('\x1b[') && !str.startsWith('\x1bO'),
    tab: str === '\t',
    shift: false,
  };

  let input = str;
  // Extract ctrl+letter
  if (key.ctrl && str.length === 1) {
    input = String.fromCharCode(str.charCodeAt(0) + 96); // ctrl+a = 0x01 -> 'a'
  }
  // Strip escape sequences
  if (str.startsWith('\x1b[') || str.startsWith('\x1bO')) {
    input = '';
  }

  return { input, key };
}

interface SidebarProps {
  onClose?: () => void;
}

// Render text with cursor at position for input mode (memoized)
// Using single Text with inline styling to avoid fragment flickering
const TextWithCursor = memo(function TextWithCursor({ text, cursorPos }: { text: string; cursorPos: number }) {
  const before = text.slice(0, cursorPos);
  const at = text[cursorPos] || " ";
  const after = text.slice(cursorPos + 1);

  // Use a single Text wrapper to prevent Ink fragment flickering
  return (
    <Text>
      <Text color="black">{before}</Text>
      <Text color="white" backgroundColor="black">{at}</Text>
      <Text color="black">{after}</Text>
    </Text>
  );
});

// Truncate text with ellipsis
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// Memoized Active Section - only re-renders when active task changes
const ActiveSection = memo(function ActiveSection({ active }: { active: ActiveTask | null }) {
  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Text bold color="black">Active</Text>
      <Box flexDirection="column">
        {active ? (
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color="black">→</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color="black" wrap="wrap">
                {active.content}
              </Text>
            </Box>
          </Box>
        ) : (
          <Text color="gray">No active task</Text>
        )}
      </Box>
    </Box>
  );
});

// Memoized Queue Item - only re-renders when this specific item changes
const QueueItem = memo(function QueueItem({
  task,
  isSelected,
  checkboxWidth,
}: {
  task: Task;
  isSelected: boolean;
  checkboxWidth: number;
}) {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={checkboxWidth} flexShrink={0}>
        <Text color="black">{isSelected ? "[•]" : "[ ]"}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color="black" wrap="wrap">
          {task.content}
        </Text>
      </Box>
    </Box>
  );
});


// Static input placeholder - NEVER re-renders during typing
// Shows a blinking cursor prompt; actual typed text is not shown to avoid flicker
const InputPlaceholder = memo(function InputPlaceholder({
  checkboxWidth,
}: {
  checkboxWidth: number;
}) {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={checkboxWidth} flexShrink={0}>
        <Text color="black">[ ]</Text>
      </Box>
      <Box flexGrow={1}>
        <Text backgroundColor="black" color="white">{" "}</Text>
        <Text color="gray">{" typing... (press Enter to submit)"}</Text>
      </Box>
    </Box>
  );
}, () => true); // Never re-render - always return true from comparison

// Memoized Footer - only re-renders when mode changes
const Footer = memo(function Footer({ inputMode, active }: { inputMode: InputMode; active: boolean }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color="gray">
        {inputMode !== "none"
          ? "Enter: submit | Esc: cancel"
          : active
          ? "Tab: section | d: clear active"
          : "Tab: section | a: add | e: edit | d: del | Enter: send"}
      </Text>
      <Box marginTop={1}>
        <Text color="black">{"• "}</Text>
        <Text bold color="black">Claude Sidebar</Text>
      </Box>
    </Box>
  );
});

type Section = "active" | "queue";
type InputMode = "none" | "add" | "edit";

export function Sidebar({ onClose }: SidebarProps) {
  const { exit } = useApp();
  const { stdin, setRawMode } = useStdin();
  // Get terminal height once on mount (avoid re-renders from useStdout)
  const terminalHeight = useRef(process.stdout.rows || 40).current;

  // Hide terminal cursor to reduce flicker (we show our own cursor in TextWithCursor)
  useEffect(() => {
    process.stdout.write('\x1B[?25l'); // Hide cursor
    return () => {
      process.stdout.write('\x1B[?25h'); // Show cursor on cleanup
    };
  }, []);

  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<ActiveTask | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("queue");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>("none");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Input state - stored ONLY in refs to avoid ANY React re-renders during typing
  // This eliminates flicker completely at the cost of not showing typed text
  const inputBufferRef = useRef("");
  const inputCursorRef = useRef(0);

  // Refs for raw input handling - bypasses Ink's reconciler completely
  const rawInputHandlerRef = useRef<((data: Buffer) => void) | null>(null);

  // Update input refs only - NO React state updates during typing
  const updateInput = useCallback((buffer: string, cursor: number) => {
    inputBufferRef.current = buffer;
    inputCursorRef.current = cursor;
    // Intentionally do NOT update any React state here
  }, []);

  // Completion polling
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastOutputRef = useRef<string>("");
  const stableCountRef = useRef(0);

  // Load data on mount and periodically (only update if changed)
  // PAUSE polling during input mode to prevent any re-renders
  useEffect(() => {
    // Don't poll during input mode - this prevents flicker
    if (inputMode !== "none") {
      return;
    }

    const loadData = () => {
      const newTasks = getTasks();
      const newActive = getActiveTask();

      // Only update state if data actually changed (prevents unnecessary re-renders)
      setTasks(prev => {
        const prevJson = JSON.stringify(prev);
        const newJson = JSON.stringify(newTasks);
        return prevJson === newJson ? prev : newTasks;
      });
      setActive(prev => {
        const prevJson = JSON.stringify(prev);
        const newJson = JSON.stringify(newActive);
        return prevJson === newJson ? prev : newActive;
      });
    };

    loadData();
    const interval = setInterval(loadData, 1000);
    return () => clearInterval(interval);
  }, [inputMode]);

  // Start/stop completion polling when active task changes
  useEffect(() => {
    if (active && !pollingRef.current) {
      // Start polling for completion
      pollingRef.current = setInterval(async () => {
        const atPrompt = await isClaudeAtPrompt();
        if (atPrompt) {
          stableCountRef.current++;
          // Wait for 2 consecutive checks (4 seconds) to confirm completion
          if (stableCountRef.current >= 2) {
            completeActiveTask();
            setActive(null);
            stableCountRef.current = 0;
          }
        } else {
          stableCountRef.current = 0;
        }
      }, 2000);
    } else if (!active && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
      stableCountRef.current = 0;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [active]);

  // Helper to find word boundaries
  const findPrevWordBoundary = (text: string, pos: number): number => {
    if (pos <= 0) return 0;
    let i = pos - 1;
    while (i > 0 && text[i] === " ") i--;
    while (i > 0 && text[i - 1] !== " ") i--;
    return i;
  };

  const findNextWordBoundary = (text: string, pos: number): number => {
    if (pos >= text.length) return text.length;
    let i = pos;
    while (i < text.length && text[i] !== " ") i++;
    while (i < text.length && text[i] === " ") i++;
    return i;
  };

  // RAW STDIN HANDLER - removes ALL Ink's stdin listeners during input mode
  // This is the nuclear option to prevent any Ink-triggered re-renders
  useEffect(() => {
    if (inputMode === "none") {
      return;
    }

    // Get all 'readable' listeners and remove them temporarily
    const readableListeners = process.stdin.listeners('readable');
    readableListeners.forEach(listener => {
      process.stdin.removeListener('readable', listener as any);
    });

    // Add our own data handler directly
    const handleData = (data: Buffer) => {
      const { input, key } = parseRawKey(data);
      const buffer = inputBufferRef.current;
      const cursor = inputCursorRef.current;

      if (key.return) {
        // Restore Ink's listeners BEFORE changing state
        readableListeners.forEach(listener => {
          process.stdin.addListener('readable', listener as any);
        });
        process.stdin.removeListener('data', handleData);

        if (buffer.trim()) {
          if (inputMode === "add") {
            addTask(buffer.trim());
          } else if (inputMode === "edit" && editingTaskId) {
            updateTask(editingTaskId, buffer.trim());
          }
          setTasks(getTasks());
        }
        inputBufferRef.current = "";
        inputCursorRef.current = 0;
        setInputMode("none");
        setEditingTaskId(null);
        return;
      }

      if (key.escape) {
        // Restore Ink's listeners BEFORE changing state
        readableListeners.forEach(listener => {
          process.stdin.addListener('readable', listener as any);
        });
        process.stdin.removeListener('data', handleData);

        inputBufferRef.current = "";
        inputCursorRef.current = 0;
        setInputMode("none");
        setEditingTaskId(null);
        return;
      }

      // All other input - no state changes, no re-renders
      if (key.leftArrow) {
        updateInput(buffer, key.meta ? findPrevWordBoundary(buffer, cursor) : Math.max(0, cursor - 1));
      } else if (key.rightArrow) {
        updateInput(buffer, key.meta ? findNextWordBoundary(buffer, cursor) : Math.min(buffer.length, cursor + 1));
      } else if (key.backspace && cursor > 0) {
        updateInput(buffer.slice(0, cursor - 1) + buffer.slice(cursor), cursor - 1);
      } else if (key.ctrl && input === "a") {
        updateInput(buffer, 0);
      } else if (key.ctrl && input === "e") {
        updateInput(buffer, buffer.length);
      } else if (key.ctrl && input === "u") {
        updateInput(buffer.slice(cursor), 0);
      } else if (key.ctrl && input === "k") {
        updateInput(buffer.slice(0, cursor), cursor);
      } else if (key.ctrl && input === "w") {
        const newPos = findPrevWordBoundary(buffer, cursor);
        updateInput(buffer.slice(0, newPos) + buffer.slice(cursor), newPos);
      } else if (input && !key.ctrl && input.length === 1) {
        const code = input.charCodeAt(0);
        if (code >= 32 && code <= 126) {
          updateInput(buffer.slice(0, cursor) + input + buffer.slice(cursor), cursor + 1);
        }
      }
    };

    // Use 'data' event instead of 'readable' to get raw data directly
    process.stdin.on('data', handleData);

    return () => {
      process.stdin.removeListener('data', handleData);
      // Restore Ink's readable listeners
      readableListeners.forEach(listener => {
        process.stdin.addListener('readable', listener as any);
      });
    };
  }, [inputMode, editingTaskId, updateInput]);

  // Send task to Claude
  const sendTaskToClaude = async (task: Task) => {
    if (active) return; // Already have an active task

    const activated = activateTask(task.id);
    if (activated) {
      setActive(activated);
      setTasks(getTasks());
      await sendToClaudePane(task.content);
    }
  };

  // Handle keyboard input - ONLY for normal mode (non-input)
  // Input mode is handled by raw stdin handler above to avoid reconciler flicker
  useInput((input, key) => {
    // Normal mode only - input mode handled by raw stdin
    if (key.escape) {
      onClose?.();
      exit();
      return;
    }

    // Tab to switch sections
    if (key.tab) {
      setActiveSection((prev) => (prev === "active" ? "queue" : "active"));
      setSelectedIndex(0);
      return;
    }

    // Navigation
    if (key.upArrow || input === "k") {
      if (activeSection === "queue") {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      return;
    }

    if (key.downArrow || input === "j") {
      if (activeSection === "queue") {
        setSelectedIndex((prev) => Math.min(tasks.length - 1, prev + 1));
      }
      return;
    }

    // Queue-specific actions
    if (activeSection === "queue") {
      // Number keys for quick selection
      if (/^[1-9]$/.test(input)) {
        const index = parseInt(input, 10) - 1;
        if (index < tasks.length) {
          setSelectedIndex(index);
        }
        return;
      }

      // Enter to send task to Claude
      if (key.return && tasks[selectedIndex] && !active) {
        sendTaskToClaude(tasks[selectedIndex]);
        return;
      }

      // Add task
      if (input === "a") {
        setInputMode("add");
        updateInput("", 0);
                return;
      }

      // Edit task
      if (input === "e" && tasks[selectedIndex]) {
        setInputMode("edit");
        setEditingTaskId(tasks[selectedIndex].id);
        updateInput(tasks[selectedIndex].content, tasks[selectedIndex].content.length);
                return;
      }

      // Delete task
      if (input === "d" && tasks[selectedIndex]) {
        removeTask(tasks[selectedIndex].id);
        setTasks(getTasks());
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
    }

    // Active section - allow clearing active task manually
    if (activeSection === "active" && input === "d" && active) {
      completeActiveTask();
      setActive(null);
      return;
    }
  }, { isActive: inputMode === "none" }); // DISABLE useInput during input mode to prevent reconciler flicker

  const CHECKBOX_WIDTH = 4; // "[ ] " is 4 chars

  return (
    <Box
      flexDirection="column"
      width="100%"
      height={terminalHeight}
      paddingX={2}
      paddingY={1}
      backgroundColor="#e8e8e8"
    >
      {/* Active Section - memoized */}
      <ActiveSection active={active} />

      {/* Queue Section */}
      <Box flexDirection="column" marginBottom={1} flexShrink={0}>
        <Box flexShrink={0}>
          <Text bold color="black">Queue</Text>
          {tasks.length > 0 && <Text color="gray"> ({tasks.length})</Text>}
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          {tasks.length === 0 && inputMode !== "add" && (
            <Text color="gray">No tasks queued</Text>
          )}
          {tasks.map((task, index) => {
            const isEditing = inputMode === "edit" && editingTaskId === task.id;
            if (isEditing) {
              return (
                <InputPlaceholder
                  key={task.id}
                  checkboxWidth={CHECKBOX_WIDTH}
                />
              );
            }
            return (
              <QueueItem
                key={task.id}
                task={task}
                isSelected={activeSection === "queue" && index === selectedIndex}
                checkboxWidth={CHECKBOX_WIDTH}
              />
            );
          })}
          {inputMode === "add" && (
            <InputPlaceholder
              checkboxWidth={CHECKBOX_WIDTH}
            />
          )}
        </Box>
      </Box>

      {/* Spacer - fills remaining height with background */}
      <Box flexGrow={1} />

      {/* Footer - memoized */}
      <Footer inputMode={inputMode} active={!!active} />
    </Box>
  );
}
