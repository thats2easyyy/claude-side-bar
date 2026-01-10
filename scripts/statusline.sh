#!/bin/bash
# Claude Code statusline script for claude-sidebar
# Receives JSON from Claude Code via stdin, extracts key metrics, writes to shared file
#
# Install: Add to ~/.claude/settings.json:
# { "statusline": { "script": "/path/to/claude-sidebar/scripts/statusline.sh" } }

set -e

# Read JSON from stdin
input=$(cat)

# Extract context window data
CTX_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
USAGE=$(echo "$input" | jq -r '.context_window.current_usage // {}')
INPUT_TOKENS=$(echo "$USAGE" | jq -r '(.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)')
OUTPUT_TOKENS=$(echo "$input" | jq -r '.context_window.current_usage.output_tokens // 0')

# Calculate context percentage (input + output tokens)
TOTAL_TOKENS=$((INPUT_TOKENS + OUTPUT_TOKENS))
if [ "$CTX_SIZE" -gt 0 ]; then
  CTX_PERCENT=$((TOTAL_TOKENS * 100 / CTX_SIZE))
else
  CTX_PERCENT=0
fi

# Extract cost and duration
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
DURATION_MIN=$((DURATION_MS / 60000))

# Extract model
MODEL=$(echo "$input" | jq -r '.model.display_name // "Unknown"')

# Get project directory and git info
PROJECT_DIR=$(echo "$input" | jq -r '.workspace.project_dir // ""')
BRANCH=""
REPO=""
if [ -n "$PROJECT_DIR" ] && [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR" 2>/dev/null || true
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  REPO=$(basename "$PROJECT_DIR")
fi

# Ensure directory exists
mkdir -p ~/.claude-sidebar

# Write processed data
cat > ~/.claude-sidebar/statusline.json << EOF
{
  "contextPercent": $CTX_PERCENT,
  "contextTokens": $TOTAL_TOKENS,
  "contextSize": $CTX_SIZE,
  "costUsd": $COST,
  "durationMin": $DURATION_MIN,
  "model": "$MODEL",
  "branch": "$BRANCH",
  "repo": "$REPO",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
