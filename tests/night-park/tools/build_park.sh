#!/usr/bin/env bash
# The whole park's relight fields: every piece relight in gen/pieces -> registered, fitted, harmonised to the
# whole-park key -> merged over the key (96 px feather) -> flat ground smoothed -> rides/sky/fields/.
#   tools/build_park.sh [TIME...]      (default: night dusk golden dawn; run from tests/night-park)
# Pieces already fitted are skipped; a piece whose relight hasn't landed is left to the key.
set -e
PY() { uv run -q --no-project --with pillow --with numpy --with scipy python -I "$@"; }
TIMES=${@:-night dusk golden dawn}
XS=(0 1152 2304); YS=(0 768 1536)
for T in $TIMES; do
  for r in 0 1 2; do for c in 0 1 2; do (
    N=r${r}c${c}_$T; P=gen/pieces/${N}_0.png
    [ -f "$P" ] || exit 0
    [ -f gen/fields/pieces/${N}_h.json ] && exit 0
    mkdir -p gen/fields/pieces gen/reg/pieces
    RECT=${XS[$c]},${YS[$r]},1536,1024
    PY -c "from PIL import Image; Image.open('$P').convert('RGB').resize((1536,1024), Image.LANCZOS).save('gen/pieces/${N}_1536.png')"
    PY ../night/tools/register.py gen/pieces/in_r${r}c${c}.png gen/pieces/${N}_1536.png gen/reg/pieces/$N --warp gen/pieces/${N}_1536_reg.png > gen/reg/pieces/$N.log
    PY tools/build.py fit gen/pieces/in_r${r}c${c}.png gen/pieces/${N}_1536_reg.png $RECT gen/fields/pieces/$N > /dev/null
    PY tools/build.py merge gen/fields/pieces/${N}_h gen/fields/pieces/$N --base gen/fields/park_$T --day gen/park_day_1920.png > /dev/null
    echo "$N $(head -c 160 gen/reg/pieces/$N.log)"
  ) & done; done; wait
  LIST=""; for r in 0 1 2; do for c in 0 1 2; do [ -f gen/fields/pieces/r${r}c${c}_${T}_h.json ] && LIST="$LIST gen/fields/pieces/r${r}c${c}_${T}_h"; done; done
  [ "$T" = night ] && LIST="$LIST gen/fields/lights_off_h"   # the lights agent's lights-off plate of the slice (INTERFACE)
  PY tools/build.py merge gen/fields/park_full_$T gen/fields/park_$T $LIST --feather 96
  PY tools/build.py flat gen/fields/park_full_$T gen/park_day_3840.png gen/fields/park_fullf_$T
  PY -c "
from PIL import Image
for c in 'AB': Image.open('gen/fields/park_fullf_${T}_'+c+'.png').convert('RGB').save('../../rides/sky/fields/${T}_'+c+'.webp','WEBP',quality=95,method=6)
"
  echo "$T: merged$(echo $LIST | wc -w | xargs -I{} echo ' {} fields') -> rides/sky/fields/${T}_{A,B}.webp"
done
