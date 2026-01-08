/**
 * IPC Client for sending messages to the sidebar
 */

import { existsSync } from "fs";

export interface IPCMessage {
  type: string;
  data?: unknown;
}

/**
 * Send a message to the sidebar via Unix socket
 */
export async function sendMessage(
  socketPath: string,
  message: IPCMessage
): Promise<void> {
  if (!existsSync(socketPath)) {
    throw new Error(`Socket not found: ${socketPath}`);
  }

  return new Promise((resolve, reject) => {
    const socket = Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          const data = JSON.stringify(message) + "\n";
          socket.write(data);
          socket.end();
        },
        close() {
          resolve();
        },
        data() {
          // We don't expect responses for now
        },
        error(socket, error) {
          reject(error);
        },
      },
    });
  });
}

/**
 * Connect to sidebar and listen for messages
 */
export function connectToSidebar(
  socketPath: string,
  onMessage: (message: IPCMessage) => void,
  onError?: (error: Error) => void
): { close: () => void } {
  if (!existsSync(socketPath)) {
    throw new Error(`Socket not found: ${socketPath}`);
  }

  let buffer = "";

  const socket = Bun.connect({
    unix: socketPath,
    socket: {
      open() {
        // Connected
      },
      close() {
        // Disconnected
      },
      data(socket, data) {
        buffer += Buffer.from(data).toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line) as IPCMessage;
              onMessage(message);
            } catch (err) {
              onError?.(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      },
      error(socket, error) {
        onError?.(error);
      },
    },
  });

  return {
    close() {
      socket.then((s) => s.end());
    },
  };
}
