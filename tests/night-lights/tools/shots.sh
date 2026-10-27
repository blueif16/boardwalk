#!/bin/sh
# Shots for RESULTS.md: the slice at 19:30 and 22:00 (2200 x 2000, 2 px per park px), the switch-on wave, close-ups.
# Run from the repo root with the dev server up.
U="http://localhost:15178/tests/night-lights/"
C="node scripts/capture.mjs"
O=tests/night-lights/shots
for h in 19.5 22; do $C "$U?hour=$h&t=20" --ready "html[data-ready]" --width 2200 --height 2000 --scale 1 --wait 4000 --select body --out $O/slice_$h.png | tail -1; done
for h in 18.9 19.2 19.5 19.8 20.1 20.4; do $C "$U?hour=$h&t=20&crowd=0" --ready "html[data-ready]" --width 1100 --height 1000 --scale 1 --wait 3000 --select body --out $O/wave_$h.png | tail -1; done
$C "$U?hour=22&t=20&lights=0" --ready "html[data-ready]" --width 2200 --height 2000 --scale 1 --wait 4000 --select body --out $O/slice_22_off.png | tail -1
