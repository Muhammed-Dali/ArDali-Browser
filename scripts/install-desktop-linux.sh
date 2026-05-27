#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="ardali-media-player"

DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR_512="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_DIR_256="$HOME/.local/share/icons/hicolor/256x256/apps"

mkdir -p "$DESKTOP_DIR" "$ICON_DIR_512" "$ICON_DIR_256"

# Ikonları üret (GNOME/Wayland/KDE dock & üst bar için)
SRC_ICON="$ROOT_DIR/icons/app/ardali_alt_boldA_transparent_1024.png"

if command -v magick >/dev/null 2>&1; then
  magick "$SRC_ICON" -resize 512x512 "$ICON_DIR_512/${APP_ID}.png"
  magick "$SRC_ICON" -resize 256x256 "$ICON_DIR_256/${APP_ID}.png"
elif command -v convert >/dev/null 2>&1; then
  convert "$SRC_ICON" -resize 512x512 "$ICON_DIR_512/${APP_ID}.png"
  convert "$SRC_ICON" -resize 256x256 "$ICON_DIR_256/${APP_ID}.png"
else
  # ImageMagick yoksa en azından kopyala
  cp -f "$SRC_ICON" "$ICON_DIR_512/${APP_ID}.png"
  cp -f "$SRC_ICON" "$ICON_DIR_256/${APP_ID}.png"
fi

# Desktop entry oluştur
cat > "$DESKTOP_DIR/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ArDali
Comment=ArDali Media Player (dev)
Exec=${ROOT_DIR}/scripts/run-ardali.sh %U
Icon=${APP_ID}
Terminal=false
Categories=AudioVideo;Player;
StartupWMClass=${APP_ID}
MimeType=audio/mpeg;audio/wav;audio/flac;audio/aac;audio/ogg;audio/mp4;audio/x-m4a;audio/opus;audio/aiff;audio/x-ms-wma;video/mp4;video/x-matroska;video/x-msvideo;video/quicktime;video/x-ms-wmv;video/webm;video/x-m4v;
EOF

# GNOME cache güncelle (varsa)
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" || true

echo "Installed: $DESKTOP_DIR/${APP_ID}.desktop"
