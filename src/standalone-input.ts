#!/usr/bin/env bun
/**
 * Standalone input test - completely isolated from sidebar code
 * Tests if basic terminal input causes flicker
 */

const CSI = '\x1b[';

// Clear screen, draw a simple UI
process.stdout.write(`${CSI}2J${CSI}H`);
process.stdout.write(`${CSI}?25l`); // Hide cursor initially

// Draw simple box
const width = process.stdout.columns || 50;
const height = process.stdout.rows || 20;

function drawUI(inputText: string = '', inputMode: boolean = false) {
  let output = `${CSI}?2026h`; // Begin sync
  output += `${CSI}H`; // Home

  output += `  Simple Input Test\n`;
  output += `  ─────────────────\n`;
  output += `\n`;
  output += `  Status: ${inputMode ? 'INPUT MODE' : 'Normal'}\n`;
  output += `\n`;
  output += `  Text: [${inputText}]${' '.repeat(Math.max(0, width - inputText.length - 12))}\n`;
  output += `\n`;
  output += `  Press 'i' to enter input mode\n`;
  output += `  Press 'Esc' to exit input mode or quit\n`;

  if (inputMode) {
    output += `${CSI}?25h`; // Show cursor
  } else {
    output += `${CSI}?25l`; // Hide cursor
  }

  output += `${CSI}?2026l`; // End sync
  process.stdout.write(output);
}

// Initial draw
drawUI();

// Setup input
process.stdin.setRawMode(true);
process.stdin.resume();

let inputMode = false;
let inputBuffer = '';

process.stdin.on('data', (data) => {
  const key = data.toString();

  if (inputMode) {
    // In input mode
    if (key === '\x1b') {
      // Escape - exit input mode
      inputMode = false;
      drawUI(inputBuffer, false);
      return;
    }

    if (key === '\r' || key === '\n') {
      // Enter - submit
      inputMode = false;
      drawUI(inputBuffer, false);
      return;
    }

    if (key === '\x7f') {
      // Backspace
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        // Just update the text line, not full redraw
        process.stdout.write(`${CSI}?2026h${CSI}6;10H[${inputBuffer}]${' '.repeat(20)}${CSI}?2026l`);
      }
      return;
    }

    // Regular char
    if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) < 127) {
      inputBuffer += key;
      // Just update the text line
      process.stdout.write(`${CSI}?2026h${CSI}6;10H[${inputBuffer}]${CSI}?2026l`);
    }
  } else {
    // Normal mode
    if (key === '\x1b') {
      // Escape - quit
      process.stdout.write(`${CSI}?25h${CSI}0m${CSI}2J${CSI}H`);
      process.exit(0);
    }

    if (key === 'i') {
      // Enter input mode
      inputMode = true;
      inputBuffer = '';
      drawUI('', true);
    }
  }
});
