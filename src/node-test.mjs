#!/usr/bin/env node
/**
 * Node.js minimal terminal input test
 * Testing if the flicker is Bun-specific
 */

import * as readline from 'readline';

// Clear screen and show prompt
process.stdout.write('\x1b[2J\x1b[H');
process.stdout.write('Node.js test - Type something (Enter to echo, Escape to quit):\n> ');

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

let buffer = '';

process.stdin.on('keypress', (str, key) => {
  // Escape or Ctrl+C - quit
  if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
    process.stdout.write('\n');
    process.exit(0);
  }

  // Enter - echo and reset
  if (key.name === 'return') {
    process.stdout.write(`\nYou typed: ${buffer}\n> `);
    buffer = '';
    return;
  }

  // Backspace
  if (key.name === 'backspace') {
    if (buffer.length > 0) {
      buffer = buffer.slice(0, -1);
      process.stdout.write('\b \b');
    }
    return;
  }

  // Regular character
  if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
    buffer += str;
    process.stdout.write(str);
  }
});

process.stdin.resume();
