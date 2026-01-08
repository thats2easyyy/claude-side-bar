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

    // Keep process running
    await new Promise(() => {});
  });

// Spawn command - launch sidebar in tmux split pane
program
  .command("spawn")
  .description("Launch sidebar in tmux split pane")
  .action(async () => {
    if (!isInTmux()) {
      console.error("Error: Not running in tmux.");
      console.error("Start a tmux session first: tmux");
      process.exit(1);
    }

    // Get the path to this script
    const scriptPath = process.argv[1];
    const command = `bun ${scriptPath} show`;

    const paneId = await spawnSidebarPane(command);
    if (paneId) {
      console.log(`Sidebar spawned in pane: ${paneId}`);
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
    const info = getEnvInfo();
    console.log("Environment:");
    console.log(`  In tmux: ${info.inTmux ? "Yes" : "No"}`);
    console.log(`  TERM: ${info.term}`);
    console.log(`  SHELL: ${info.shell}`);
    console.log(`  Socket: ${getSocketPath()}`);
    console.log(`  Stored pane: ${info.storedPaneId || "none"}`);
  });

// Default to show if no command given
if (process.argv.length === 2) {
  process.argv.push("show");
}

program.parse();
