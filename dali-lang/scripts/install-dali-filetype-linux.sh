#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MIME_SOURCE_DIR="${ROOT_DIR}/linux/mime"
ICON_SOURCE_DIR="${ROOT_DIR}/assets"

MIME_TARGET_DIR="${HOME}/.local/share/mime/packages"
ICON_TARGET_DIR="${HOME}/.local/share/icons/hicolor/scalable/mimetypes"

mkdir -p "${MIME_TARGET_DIR}" "${ICON_TARGET_DIR}"

install -m 0644 "${MIME_SOURCE_DIR}/application-x-dali.xml" "${MIME_TARGET_DIR}/application-x-dali.xml"
install -m 0644 "${MIME_SOURCE_DIR}/application-x-vsix.xml" "${MIME_TARGET_DIR}/application-x-vsix.xml"
install -m 0644 "${ICON_SOURCE_DIR}/application-x-dali.svg" "${ICON_TARGET_DIR}/application-x-dali.svg"
install -m 0644 "${ICON_SOURCE_DIR}/application-x-vsix.svg" "${ICON_TARGET_DIR}/application-x-vsix.svg"

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database "${HOME}/.local/share/mime"
else
  echo "[warn] update-mime-database not found. Install 'shared-mime-info'."
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 >/dev/null 2>&1 || true
fi

echo "[ok] DALI MIME + icons installed."
echo "     Extensions: .dali .dl .vsix"
echo "     If Dolphin still shows old icons, restart Dolphin:"
echo "     kquitapp6 dolphin; dolphin >/dev/null 2>&1 &"
