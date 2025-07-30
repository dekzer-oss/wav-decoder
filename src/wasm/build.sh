#!/usr/bin/env bash
set -euo pipefail

# Directory this script lives in
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${1:-$SCRIPT_DIR/emcc-config.json}"
EMCC=emcc

echo "📦 Building WASM from config: $CONFIG_FILE"

# Read and resolve paths relative to SCRIPT_DIR
SRC_REL=$(jq -r '.source' "$CONFIG_FILE")
SRC="$SCRIPT_DIR/src/$SRC_REL"

OUT_JS_REL=$(jq -r '.output_js' "$CONFIG_FILE")
OUT_JS="$SCRIPT_DIR/$OUT_JS_REL"

OPTLVL=$(jq -r '.opt_level' "$CONFIG_FILE")
EXPORT_NAME=$(jq -r '.export_name' "$CONFIG_FILE")
EXPORT_ES6=$(jq -r '.export_es6 // false' "$CONFIG_FILE")
EXPORTED_FUNCS=$(jq -c '.exported_functions' "$CONFIG_FILE")
EXPORTED_RUNTIMES=$(jq -c '.exported_runtime_methods' "$CONFIG_FILE")

# Start assembling emcc args
ARGS=(
  "$SRC"
  -o "$OUT_JS"
  "-$OPTLVL"
  -s MODULARIZE=1
  -s "EXPORT_NAME='$EXPORT_NAME'"
)

# ES6 default export?
if [[ "$EXPORT_ES6" == "true" ]]; then
  ARGS+=( -s EXPORT_ES6=1 )
  echo "🔧 Enabling ES6 default export (EXPORT_ES6=1)"
fi

# Core exports + runtime flags
ARGS+=(
  -s "EXPORTED_FUNCTIONS=$EXPORTED_FUNCS"
  -s "EXPORTED_RUNTIME_METHODS=$EXPORTED_RUNTIMES"
  -s ALLOW_MEMORY_GROWTH=1
  --no-entry
)

# SIMD?
if jq -e '.simd' "$CONFIG_FILE" &> /dev/null; then
  ARGS+=( -msimd128 )
  echo "🔧 Enabling SIMD"
fi

# Include paths (also relative)
while IFS= read -r inc; do
  [[ -n "$inc" ]] && ARGS+=( -I"$SCRIPT_DIR/$inc" )
done < <(jq -r '.include_paths[]? // empty' "$CONFIG_FILE")

echo "▶️ Running: $EMCC ${ARGS[*]}"
$EMCC "${ARGS[@]}"

echo "✅ Build done: $OUT_JS"
