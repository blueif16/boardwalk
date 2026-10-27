#!/usr/bin/env bash
# Default page checks (run from the repo root): the reviewed rides + sky, frozen clock.
L="sea,beach,wildlife,traffic,coaster,wheel,swings,teacups,flume,pirate,carousel,thrill,corgi,sky"
O=tests/night-park/shots
shot() { timeout 280 node scripts/capture.mjs "http://localhost:15178/?layers=$1&hour=$2&t=12" --ready "html[data-ready]" --select body --width $3 --height $4 --scale 1 --wait 6000 --out $O/$5.png 2>&1 | grep -E "console|exception" | head -2; }
for h in 22 19.5 18.6 6.5 13; do shot $L $h 2560 1440 main_${h}; done
for h in 22 19.5 6.5 13; do shot $L $h 1512 982 mac_${h}; done
shot "${L%,sky}" 13 2560 1440 main_13_nosky
