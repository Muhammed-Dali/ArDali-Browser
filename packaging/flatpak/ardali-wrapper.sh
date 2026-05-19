#!/usr/bin/env bash
set -euo pipefail

# App ID for Wayland grouping
export FLATPAK_APP_ID="com.ardali.mediaplayer"

export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}"
# Force Wayland for Electron to ensure correct grouping
export ELECTRON_OZONE_PLATFORM_HINT="wayland"
export ARDALI_DISPLAY_BACKEND="wayland"
export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-KDE}"

export LD_LIBRARY_PATH="/app/ardali/resources/native-dist/linux:/app/ardali/resources/native/build/Release:${LD_LIBRARY_PATH:-}"
export ARDALI_SOFTWARE_RENDER="${ARDALI_SOFTWARE_RENDER:-1}"

# Ensure shared visualizer ID
export ARDALI_VIS_WMCLASS="$FLATPAK_APP_ID"
export ARDALI_VIS_DESKTOP_ENTRY="$FLATPAK_APP_ID"
export ARDALI_APP_ID="$FLATPAK_APP_ID"

unset ELECTRON_RUN_AS_NODE
unset DESKTOP_STARTUP_ID
unset XDG_ACTIVATION_TOKEN

# Rename argv[0] to match AppID - This is CRITICAL for KDE Wayland
BINARY="/app/ardali/ardali"

if command -v zypak-wrapper >/dev/null 2>&1; then
  exec zypak-wrapper "$BINARY" --class="$FLATPAK_APP_ID" --app-id="$FLATPAK_APP_ID" "$@"
fi

exec "$BINARY" --class="$FLATPAK_APP_ID" --app-id="$FLATPAK_APP_ID" "$@"
