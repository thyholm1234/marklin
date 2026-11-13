#!/bin/bash
# Kører alle målinger fra SPEC-generator-v2 afsnit 8. Brug: tools/run-all.sh <outfil> [parallel-antal]
# Hver kørsel er ét Node-proces; kører man dem parallelt, påvirker de hinandens tider – brug 1 til rigtige målinger.
cd "$(dirname "$0")/.."
OUT=${1:-/dev/stdout}
B="node tools/bench.js"
run() { echo "### $*"; $B "$@" 2>&1 | grep -E 'ERR|!!|SUM|Error|rror:'; }
{
run mine 3000 1500 16 - 2500
run mine 2050 1200 16 - 2500
run mine 4500 2500 16 - 2500
run mine 3000 1500 16 - 2500 '{"allSwitches":true}'
run mine 3000 1500 16 - 2500 '{"topologies":{"free":true}}'
run mine 3000 1500 16 - 2500 '{"elements":{"inner":"must"}}'
run mine 3000 1500 16 - 2500 '{"areas":[[{"x":2000,"y":900},{"x":3000,"y":900},{"x":3000,"y":1500},{"x":2000,"y":1500}]]}'
run large 3000 1500 16 - 2500
run large 4500 2500 16 - 2500 '{"allSwitches":true}'
run medium 2050 1200 16 - 900 '{"maximize":false}'
run small 1600 1000 16 - 2500
} > "$OUT"
