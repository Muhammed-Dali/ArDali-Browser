#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="com.aurivo.mediaplayer"

# Default output directory can be overridden by first arg.
OUT_BASE="${1:-$REPO_ROOT/.dist/flathub-pr}"
OUT_DIR="$OUT_BASE/$APP_ID"

MANIFEST_SRC="$REPO_ROOT/packaging/flatpak/$APP_ID.yml"
METAINFO_SRC="$REPO_ROOT/packaging/appstream/$APP_ID.metainfo.xml"
DESKTOP_SRC="$REPO_ROOT/packaging/linux/$APP_ID.desktop"

for required in "$MANIFEST_SRC" "$METAINFO_SRC" "$DESKTOP_SRC"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing required file: $required" >&2
    exit 1
  fi
done

mkdir -p "$OUT_DIR"
cp -f "$MANIFEST_SRC" "$OUT_DIR/$APP_ID.yml"
cp -f "$METAINFO_SRC" "$OUT_DIR/$APP_ID.metainfo.xml"
cp -f "$DESKTOP_SRC" "$OUT_DIR/$APP_ID.desktop"

cat > "$OUT_DIR/README.txt" <<'EOF'
This folder is prepared for a Flathub PR.

Contents:
- com.aurivo.mediaplayer.yml
- com.aurivo.mediaplayer.metainfo.xml
- com.aurivo.mediaplayer.desktop

How to use in your flathub/flathub fork:
1) Create folder: com.aurivo.mediaplayer
2) Copy these files into that folder
3) Commit and open PR
EOF

echo "Prepared Flathub PR bundle:"
echo "  $OUT_DIR"
echo
ls -la "$OUT_DIR"
