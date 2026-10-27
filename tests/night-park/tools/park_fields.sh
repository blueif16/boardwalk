#!/usr/bin/env bash
# Whole-park relight -> registered at half scale -> CSS field for the whole park (1 px per 4 park px).
#   tools/park_fields.sh TIME        (reads gen/park_TIME_v1_0.png; run from tests/night-park)
set -e
T=$1
PY() { uv run -q --no-project --with pillow --with numpy --with scipy python -I "$@"; }
PY -c "from PIL import Image; Image.open('gen/park_${T}_v1_0.png').convert('RGB').resize((1920,1280), Image.LANCZOS).save('gen/park_${T}_v1_0_1920.png')"
PY ../night/tools/register.py gen/park_day_1920.png gen/park_${T}_v1_0_1920.png gen/reg/park_${T}_v1_0_1920 --warp gen/park_${T}_v1_0_1920_reg.png
PY tools/build.py fit gen/park_day_1920.png gen/park_${T}_v1_0_1920_reg.png 0,0,3840,2560 gen/fields/park_$T
