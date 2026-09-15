#!/bin/bash
# protect-sensitive.sh — PreToolUse gate on Edit|Write.
# Exit 2 blocks the tool call and shows stderr to Claude.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
FILE_PATH="${FILE_PATH//\\//}"

# Secrets: never editable, never committable.
for pattern in ".env" ".pem" "credentials" "secret"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH looks like a secret ('$pattern'). This repo is PUBLIC. Secrets belong in Vercel env vars, never in version control." >&2
    exit 2
  fi
done

# Legal pages: editable, but only as a conscious decision.
if [[ "$FILE_PATH" == *"legal-pages"* ]]; then
  echo "Blocked: $FILE_PATH is a legal page linked from Google Cloud Console's OAuth consent screen and the Chrome Web Store. Confirm with the user exactly what changed and why before editing." >&2
  exit 2
fi

exit 0
