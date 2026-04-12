#!/usr/bin/env bash
set -euo pipefail

# App ID for Wayland grouping
export FLATPAK_APP_ID="com.aurivo.mediaplayer"

export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}"
# Force Wayland for Electron to ensure correct grouping
export ELECTRON_OZONE_PLATFORM_HINT="wayland"
export AURIVO_DISPLAY_BACKEND="wayland"
export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-KDE}"

export LD_LIBRARY_PATH="/app/aurivo/resources/app.asar.unpacked/Aurivo-Pulse/libs:/app/aurivo/resources/native-dist/linux:/app/aurivo/resources/native/build/Release:${LD_LIBRARY_PATH:-}"
export AURIVO_SOFTWARE_RENDER="${AURIVO_SOFTWARE_RENDER:-1}"

# Ensure shared visualizer ID
export AURIVO_VIS_WMCLASS="$FLATPAK_APP_ID"

unset ELECTRON_RUN_AS_NODE

# Rename argv[0] to match AppID - This is CRITICAL for KDE Wayland
BINARY="/app/aurivo/aurivo"

if command -v zypak-wrapper >/dev/null 2>&1; then
  exec zypak-wrapper "$BINARY" --no-sandbox --disable-setuid-sandbox "$@"
fi

exec "$BINARY" --no-sandbox --disable-setuid-sandbox "$@"
