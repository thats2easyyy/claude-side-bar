/**
 * IPC Server for sidebar communication
 * Uses Unix domain sockets for real-time updates
 */

import { unlinkSync, existsSync } from "fs";

export interface IPCMessage {
  type: string;
  data?: unknown;
}

export interface IPCServerOptions {
  socketPath: string;
  onMessage?: (message: IPCMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export interface IPCServer {
  broadcast: (message: IPCMessage) => void;
  close: () => void;
}

export function createIPCServer(options: IPCServerOptions): IPCServer {
  const { socketPath, onMessage, onConnect, onDisconnect, onError } = options;

  // Clean up existing socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  const clients = new Set<ReturnType<typeof Bun.listen>["data"]>();

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        clients.add(socket);
        onConnect?.();
      },
      close(socket) {
        clients.delete(socket);
        onDisconnect?.();
      },
      data(socket, data) {
        try {
          const text = Buffer.from(data).toString("utf-8");
          // Handle line-delimited JSON
          const lines = text.split("\n").filter((line) => line.trim());
          for (const line of lines) {
            const message = JSON.parse(line) as IPCMessage;
            onMessage?.(message);
          }
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      },
      error(socket, error) {
        onError?.(error);
      },
    },
  });

  return {
    broadcast(message: IPCMessage) {
      const data = JSON.stringify(message) + "\n";
      for (const client of clients) {
        try {
          (client as { write: (data: string) => void }).write(data);
        } catch {
          // Client may have disconnected
        }
      }
    },
    close() {
      server.stop();
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  };
}
