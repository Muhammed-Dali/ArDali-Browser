#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Wayland/X11 hint: KDE Plasma Wayland (Arch vb.) ortaminda Electron'un dogru backend'i secmesine yardimci olur.
if [[ -z "${ELECTRON_OZONE_PLATFORM_HINT:-}" ]]; then
  if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]] || [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    export ELECTRON_OZONE_PLATFORM_HINT="wayland"
  elif [[ "${XDG_SESSION_TYPE:-}" == "x11" ]] || [[ -n "${DISPLAY:-}" ]]; then
    export ELECTRON_OZONE_PLATFORM_HINT="x11"
  else
    export ELECTRON_OZONE_PLATFORM_HINT="auto"
  fi
fi

exec npm start
