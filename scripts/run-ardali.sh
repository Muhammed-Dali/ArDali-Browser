#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NATIVE_PATHS="${ROOT_DIR}/native/build/Release:${ROOT_DIR}/native-dist:${ROOT_DIR}/native-dist/linux:${ROOT_DIR}/libs/linux:${ROOT_DIR}/bin"
export PATH="${NATIVE_PATHS}:${PATH}"
export LD_LIBRARY_PATH="${NATIVE_PATHS}:${LD_LIBRARY_PATH:-}"

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

exec npm start -- "$@"
