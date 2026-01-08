#!/usr/bin/env bun
/**
 * Minimal terminal input test - absolutely no rendering during input
 */

// Hide cursor and clear screen once
process.stdout.write('\x1b[?25l\x1b[2J\x1b[H');
process.stdout.write('Type something (press Enter to echo, Escape to quit):\n> ');
process.stdout.write('\x1b[?25h'); // Show cursor

let buffer = '';

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', (key: string) => {
  // Escape - quit
  if (key === '\x1b') {
    process.stdout.write('\n\x1b[?25h\x1b[0m');
    process.exit(0);
  }

  // Enter - echo and reset
  if (key === '\r' || key === '\n') {
    process.stdout.write(`\nYou typed: ${buffer}\n> `);
    buffer = '';
    return;
  }

  // Backspace
  if (key === '\x7f') {
    if (buffer.length > 0) {
      buffer = buffer.slice(0, -1);
      process.stdout.write('\b \b');
    }
    return;
  }

  // Regular character - just echo it
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    buffer += key;
    process.stdout.write(key);
  }
});
