#!/usr/bin/env bash

bibliotheca_release_arch_label() {
  local raw="${1:-arm64 x86_64}"
  local normalized has_arm64=0 has_x86_64=0 arch
  normalized=$(printf "%s" "$raw" | tr "," " ")
  for arch in $normalized; do
    case "$arch" in
      arm64) has_arm64=1 ;;
      x86_64) has_x86_64=1 ;;
    esac
  done
  if [[ "$has_arm64" == "1" && "$has_x86_64" == "1" ]]; then
    printf "macos-universal"
  elif [[ "$has_arm64" == "1" ]]; then
    printf "macos-arm64"
  elif [[ "$has_x86_64" == "1" ]]; then
    printf "macos-x86_64"
  else
    printf "macos-%s" "$(printf "%s" "$normalized" | tr " " "+")"
  fi
}

bibliotheca_app_zip_name() {
  local version=$1
  local arches="${2:-arm64 x86_64}"
  printf "Bibliotheca-%s-%s.zip" "$(bibliotheca_release_arch_label "$arches")" "$version"
}
