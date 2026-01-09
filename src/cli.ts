#!/usr/bin/env bun
/**
 * Claude Sidebar CLI
 *
 * Commands:
 *   show   - Render sidebar in current terminal
 *   spawn  - Launch sidebar in tmux split pane
 *   update - Send data to running sidebar via IPC
 *   env    - Show environment info (tmux status, etc.)
 */

import { program } from "commander";
import { isInTmux, getEnvInfo, spawnSidebarPane } from "./terminal/tmux";
import { isInITerm, spawnITermSidebarPane, getITermEnvInfo } from "./terminal/iterm";
import { createIPCServer } from "./ipc/server";
import { sendMessage } from "./ipc/client";
import { getSocketPath, ensureDir } from "./persistence/store";
import { dirname } from "path";
import { RawSidebar } from "./components/RawSidebar";

// Terminal title disabled - could cause flicker
// process.stdout.write("\x1b]0;claude-sidebar\x07");

program
  .name("claude-sidebar")
  .description("Visual sidebar for Claude Code")
  .version("0.1.0");

// Show command - render sidebar in current terminal
program
  .command("show")
  .description("Render sidebar in current terminal")
  .option("-s, --socket <path>", "Unix socket path for IPC")
  .action(async (options) => {
    ensureDir();
    const socketPath = options.socket || getSocketPath();

    // Start IPC server for receiving updates
    const server = createIPCServer({
      socketPath,
      onMessage: (_message) => {
        // IPC messages can be handled here if needed
      },
      onError: (error) => {
        console.error("IPC error:", error.message);
      },
    });

    // Use raw terminal rendering (bypasses Ink completely for flicker-free input)
    const sidebar = new RawSidebar(() => {
      server.close();
    });

    sidebar.start();

    // Handle Ctrl+C and termination signals for clean exit
    const cleanup = () => {
      sidebar.stop();
      server.close();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Keep process running
    await new Promise(() => {});
  });

// Spawn command - launch sidebar in split pane (iTerm2 or tmux)
program
  .command("spawn")
  .description("Launch sidebar in split pane (iTerm2 preferred, tmux fallback)")
  .option("--tmux", "Force tmux mode even in iTerm2")
  .action(async (options) => {
    // Get the path to this script
    const scriptPath = process.argv[1];
    const command = `bun ${scriptPath} show`;

    // Prefer iTerm2 if available (avoids scrollback corruption)
    if (isInITerm() && !options.tmux) {
      console.log("Using iTerm2 split (preserves scrollback)...");
      const sessionId = await spawnITermSidebarPane(command);
      if (sessionId) {
        console.log(`Sidebar spawned in iTerm2 session: ${sessionId}`);
      } else {
        console.error("Failed to spawn iTerm2 sidebar");
        process.exit(1);
      }
      return;
    }

    // Fall back to tmux
    if (!isInTmux()) {
      console.error("Error: Not running in tmux or iTerm2.");
      console.error("Options:");
      console.error("  - Run inside iTerm2 (recommended)");
      console.error("  - Start a tmux session: tmux");
      process.exit(1);
    }

    console.log("Using tmux split (may affect scrollback)...");
    const paneId = await spawnSidebarPane(command);
    if (paneId) {
      console.log(`Sidebar spawned in tmux pane: ${paneId}`);
    }
  });

// Update command - send data to running sidebar
program
  .command("update")
  .description("Send data to running sidebar via IPC")
  .option("-s, --socket <path>", "Unix socket path")
  .option("-t, --type <type>", "Message type", "update")
  .option("-d, --data <json>", "Message data (JSON)")
  .action(async (options) => {
    const socketPath = options.socket || getSocketPath();

    let data: unknown;
    if (options.data) {
      try {
        data = JSON.parse(options.data);
      } catch {
        console.error("Invalid JSON data");
        process.exit(1);
      }
    }

    try {
      await sendMessage(socketPath, {
        type: options.type,
        data,
      });
      console.log("Message sent");
    } catch (err) {
      console.error("Failed to send message:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Env command - show environment info
program
  .command("env")
  .description("Show environment info")
  .action(() => {
    const tmuxInfo = getEnvInfo();
    const itermInfo = getITermEnvInfo();
    console.log("Environment:");
    console.log(`  In iTerm2: ${itermInfo.inITerm ? "Yes" : "No"}`);
    console.log(`  In tmux: ${tmuxInfo.inTmux ? "Yes" : "No"}`);
    console.log(`  TERM_PROGRAM: ${itermInfo.termProgram}`);
    console.log(`  TERM: ${tmuxInfo.term}`);
    console.log(`  SHELL: ${tmuxInfo.shell}`);
    console.log(`  Socket: ${getSocketPath()}`);
    if (tmuxInfo.inTmux) {
      console.log(`  Stored tmux pane: ${tmuxInfo.storedPaneId || "none"}`);
    }
  });

// Default to show if no command given
if (process.argv.length === 2) {
  process.argv.push("show");
}

program.parse();
