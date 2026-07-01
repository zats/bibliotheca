#!/usr/bin/env bash

bibliotheca_sparkle_tool() {
  local tool=$1
  local root=$2
  local path
  if path=$(command -v "$tool" 2>/dev/null); then
    printf "%s\n" "$path"
    return 0
  fi
  if [[ -x "$root/.build/artifacts/sparkle/Sparkle/bin/$tool" ]]; then
    printf "%s\n" "$root/.build/artifacts/sparkle/Sparkle/bin/$tool"
    return 0
  fi
  swift package --package-path "$root" resolve >/dev/null
  path=$(find "$root/.build/artifacts" -path "*/Sparkle/bin/$tool" -type f -perm -111 | head -n 1)
  if [[ -n "$path" ]]; then
    printf "%s\n" "$path"
    return 0
  fi
  echo "ERROR: Missing Sparkle tool: $tool" >&2
  return 1
}
