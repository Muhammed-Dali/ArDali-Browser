#!/usr/bin/env bash
set -euo pipefail

export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}"
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-x11}"
export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-KDE}"
export LD_LIBRARY_PATH="/app/aurivo/resources/native-dist/linux:/app/aurivo/resources/native/build/Release:${LD_LIBRARY_PATH:-}"
export AURIVO_SOFTWARE_RENDER="${AURIVO_SOFTWARE_RENDER:-1}"

# Flatpak icinde setuid sandbox calismaz.
if command -v zypak-wrapper >/dev/null 2>&1; then
  exec zypak-wrapper /app/aurivo/aurivo "$@"
fi
exec /app/aurivo/aurivo --no-sandbox --disable-setuid-sandbox "$@"
