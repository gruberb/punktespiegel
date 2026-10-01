#!/usr/bin/env bash
# Renders the PNG brand assets from their SVG sources with headless Chrome.
# The SVG is inlined into an HTML page (not loaded via <img>) so the Google
# Fonts used by the wordmark and the OG image apply; without network access
# the system fallback faces are used.
set -euo pipefail

chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
public="$(cd "$(dirname "$0")/.." && pwd)/frontend/public"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

[[ -x "$chrome" ]] || { echo "Chrome nicht gefunden: $chrome (CHROME=... setzen)" >&2; exit 1; }

render() {
  local source="$1" target="$2" width="$3" height="$4"
  {
    printf '<!doctype html><meta charset="utf-8">'
    printf '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500&display=block">'
    printf '<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:%spx;height:%spx}</style>' "$width" "$height"
    cat "$source"
  } > "$tmp/page.html"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --virtual-time-budget=5000 \
    --window-size="$width,$height" --screenshot="$target" "file://$tmp/page.html" >/dev/null 2>&1
  echo "$target"
}

render "$public/icons/app-icon.svg" "$public/icons/icon-1024.png" 1024 1024
render "$public/icons/app-icon.svg" "$public/icons/icon-512.png" 512 512
render "$public/icons/app-icon.svg" "$public/icons/icon-192.png" 192 192
render "$public/icons/app-icon.svg" "$public/icons/apple-touch-icon.png" 180 180
render "$public/icons/app-icon-maskable.svg" "$public/icons/icon-maskable-512.png" 512 512
render "$public/og-image.svg" "$public/og-image.png" 1200 630
