#!/usr/bin/env bash
# Plate -> registered at 1 px per park px -> CSS field (1 px per 4 park px) -> graded HD slice.
#   tools/pipeline.sh NAME DAY_1536 PLATE_4K RECT
# Run from tests/night-park. Writes gen/NAME_1536_reg.png, gen/reg/NAME_*, gen/fields/NAME_{A,B}.png, gen/slice_NAME.png
set -e
NAME=$1; DAY=$2; PLATE=$3; RECT=$4
PY="uv run -q --no-project --with pillow --with numpy --with scipy python -I"
$PY -c "from PIL import Image; Image.open('$PLATE').convert('RGB').resize((1536,1024), Image.LANCZOS).save('gen/${NAME}_1536.png')"
$PY ../night/tools/register.py $DAY gen/${NAME}_1536.png gen/reg/$NAME --warp gen/${NAME}_1536_reg.png
$PY tools/build.py fit $DAY gen/${NAME}_1536_reg.png $RECT gen/fields/$NAME
$PY tools/build.py grade gen/slice_day_hd.png 1900,650,1100,1000 gen/fields/$NAME gen/slice_$NAME.png
