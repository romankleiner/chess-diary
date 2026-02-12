#!/bin/bash

# Skip build if ONLY todo.txt changed
if git diff --name-only HEAD^ HEAD | grep -q "^todoList.txt$"; then
  # Check if there are any other changed files
  if [ "$(git diff --name-only HEAD^ HEAD | wc -l)" -eq 1 ]; then
    echo "🛑 - Build cancelled (only todoList.txt changed)"
    exit 0
  fi
fi

echo "✅ - Build can proceed"
exit 1
