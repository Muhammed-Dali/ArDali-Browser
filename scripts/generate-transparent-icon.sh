#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/icons/ardali_alt_boldA_1024.png"
OUT="$ROOT_DIR/icons/ardali_alt_boldA_transparent_1024.png"

if command -v magick >/dev/null 2>&1; then
  magick "$SRC" \
    \( +clone -colorspace gray -blur 0x2 -auto-level -threshold 22% -morphology Close Diamond:1 \) \
    -alpha off -compose CopyAlpha -composite \
    "$OUT"
elif command -v convert >/dev/null 2>&1; then
  convert "$SRC" \
    \( +clone -colorspace gray -blur 0x2 -auto-level -threshold 22% -morphology Close Diamond:1 \) \
    -alpha off -compose CopyAlpha -composite \
    "$OUT"
else
  echo "ImageMagick (magick/convert) bulunamadı" >&2
  exit 1
fi

echo "Generated: $OUT"
