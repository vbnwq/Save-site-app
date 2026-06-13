#!/usr/bin/env bash
# ============================================================
#  NetSaver — cross-compile a standalone Windows .exe on Linux
#  Requires: mingw-w64 (x86_64-w64-mingw32-g++), python3
#  Output:   build/NetSaver.exe   (single portable file)
# ============================================================
set -e
cd "$(dirname "$0")"

CXX=x86_64-w64-mingw32-g++
WINDRES=x86_64-w64-mingw32-windres

echo "[1/3] Embedding UI (HTML+CSS+JS) into src/ui_html.h ..."
python3 tools/embed.py

echo "[2/3] Compiling resources (icon, manifest, version) ..."
$WINDRES -I src src/app.rc -O coff -o build/app_res.o

echo "[3/3] Compiling NetSaver.exe ..."
$CXX -std=c++17 -O2 -DNDEBUG \
  -I libs/shim -I libs -I src \
  src/main.cpp build/app_res.o -o build/NetSaver.exe \
  -mwindows -static -static-libgcc -static-libstdc++ \
  -ladvapi32 -lole32 -loleaut32 -lshlwapi -lversion \
  -lshell32 -lcomdlg32 -luser32 -lgdi32

x86_64-w64-mingw32-strip build/NetSaver.exe || true

echo ""
echo "Done -> build/NetSaver.exe"
ls -lh build/NetSaver.exe
