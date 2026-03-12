#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build-visualizer-win-mingw"
TOOLCHAIN_FILE="${ROOT_DIR}/scripts/toolchains/mingw64.cmake"
NATIVE_DIST_DIR="${ROOT_DIR}/native-dist/windows"

BUILD_TYPE="Release"
RUN_WINE="0"
SKIP_RESOURCES="0"
SKIP_CONFIGURE="0"
CLEAN="0"

usage() {
  cat <<'EOF'
Build projectM visualizer for Windows on Arch Linux using mingw-w64, then optionally smoke-test with Wine.

Usage:
  scripts/build-visualizer-win-mingw.sh [options]

Options:
  --debug                 Build type Debug (default: Release)
  --run-wine              Run the resulting .exe with wine after build
  --skip-resources        Don't run scripts/prepare-win-resources.js (DLL bundling)
  --skip-configure        Skip CMake configure step (reuse existing build dir)
  --clean                 Remove build dir before building
  -h, --help              Show help

Notes:
  - This builds ONLY the visualizer (aurivo-projectm-visualizer.exe).
  - For a real Windows installer, still use GitHub Actions windows-latest (MSYS2).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) BUILD_TYPE="Debug"; shift ;;
    --run-wine) RUN_WINE="1"; shift ;;
    --skip-resources) SKIP_RESOURCES="1"; shift ;;
    --skip-configure) SKIP_CONFIGURE="1"; shift ;;
    --clean) CLEAN="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    return 1
  fi
  return 0
}

echo "[mingw] root: ${ROOT_DIR}"
echo "[mingw] build dir: ${BUILD_DIR}"
echo "[mingw] build type: ${BUILD_TYPE}"

missing=0
need_cmd cmake || missing=1
need_cmd ninja || missing=1
need_cmd x86_64-w64-mingw32-gcc || missing=1
need_cmd x86_64-w64-mingw32-g++ || missing=1
need_cmd x86_64-w64-mingw32-windres || missing=1
need_cmd x86_64-w64-mingw32-objdump || echo "[mingw] WARN: x86_64-w64-mingw32-objdump not found (DLL dependency scan may be limited)"
need_cmd x86_64-w64-mingw32-pkg-config || echo "[mingw] WARN: x86_64-w64-mingw32-pkg-config not found (pkg-config discovery may fail)"

if [[ "${RUN_WINE}" == "1" ]]; then
  need_cmd wine || missing=1
fi

if [[ "${missing}" == "1" ]]; then
  cat <<'EOF' >&2

Install hints (Arch):
  sudo pacman -S --needed cmake ninja mingw-w64-gcc mingw-w64-binutils mingw-w64-headers mingw-w64-crt mingw-w64-winpthreads

You also need Windows-target libraries (names may vary by repo/AUR):
  - mingw-w64-sdl2
  - mingw-w64-sdl2_image
  - mingw-w64-glew
  - mingw-w64-projectm (or mingw-w64-libprojectm / projectM-4)

If pacman doesn't have them, try yay:
  yay -S mingw-w64-sdl2 mingw-w64-sdl2_image mingw-w64-glew mingw-w64-projectm
EOF
  exit 1
fi

if [[ "${CLEAN}" == "1" ]]; then
  echo "[mingw] cleaning build dir..."
  rm -rf -- "${BUILD_DIR}"
fi

mkdir -p -- "${BUILD_DIR}" "${NATIVE_DIST_DIR}"

export PKG_CONFIG_ALLOW_SYSTEM_CFLAGS=1
export PKG_CONFIG_ALLOW_SYSTEM_LIBS=1

if command -v x86_64-w64-mingw32-pkg-config >/dev/null 2>&1; then
  export PKG_CONFIG="x86_64-w64-mingw32-pkg-config"
fi

# Arch sysroot layout: DLLs frequently live under /usr/x86_64-w64-mingw32/bin
DLL_DIR="/usr/x86_64-w64-mingw32/bin"
if [[ ! -d "${DLL_DIR}" ]]; then
  DLL_DIR="/usr/x86_64-w64-mingw32/sys-root/mingw/bin"
fi

if [[ "${SKIP_CONFIGURE}" != "1" ]]; then
  echo "[mingw] configuring..."
  cmake -S "${ROOT_DIR}/visualizer" -B "${BUILD_DIR}" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN_FILE}" \
    -DCMAKE_BUILD_TYPE="${BUILD_TYPE}" \
    -DCMAKE_PREFIX_PATH="/usr/x86_64-w64-mingw32" \
    -DPKG_CONFIG_EXECUTABLE="${PKG_CONFIG:-pkg-config}"
fi

echo "[mingw] building..."
cmake --build "${BUILD_DIR}" --config "${BUILD_TYPE}"

EXE_SRC="${BUILD_DIR}/aurivo-projectm-visualizer.exe"
if [[ ! -f "${EXE_SRC}" ]]; then
  echo "Build output not found: ${EXE_SRC}" >&2
  echo "Tip: check CMake output above; missing SDL2/projectM deps are common." >&2
  exit 1
fi

EXE_DST="${NATIVE_DIST_DIR}/aurivo-projectm-visualizer.exe"
cp -f -- "${EXE_SRC}" "${EXE_DST}"
echo "[mingw] copied: ${EXE_DST}"

if [[ "${SKIP_RESOURCES}" != "1" ]]; then
  echo "[mingw] bundling runtime DLLs into native-dist/windows..."
  if [[ -d "${DLL_DIR}" ]]; then
    AURIVO_VISUALIZER_DLL_DIR="${DLL_DIR}" node "${ROOT_DIR}/scripts/prepare-win-resources.js" || true
  else
    echo "[mingw] WARN: DLL dir not found; set AURIVO_VISUALIZER_DLL_DIR manually to bundle runtime DLLs." >&2
  fi
fi

if [[ "${RUN_WINE}" == "1" ]]; then
  echo "[mingw] running with wine..."
  (
    cd -- "${NATIVE_DIST_DIR}"
    wine "./$(basename -- "${EXE_DST}")" --presets "${ROOT_DIR}/third_party/projectm/presets" || true
  )
fi

echo "[mingw] done."
