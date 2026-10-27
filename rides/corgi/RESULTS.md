# The hidden corgi: find it in the park

View: **http://ran:5178/** (on the default page). Force a spot with `&corgi=<id>` and freeze it with `&t=`; play the
find with `&corgiFound=<clock s>`, the bark with `&corgiWoof=<clock s>`, open the card with `&corgiCard`.

## What it does

- **One corgi hides at a time**, in one of seven spots the crowd never reaches. Each is a small looping scene, and its
  motion is the clue: something small moving where the painting is still.

  | id | Where (park px) | Scene |
  |---|---|---|
  | `trestle` | the dark arch under the railway trestle (3541, 888) | sits in the shade, walks out, looks left and right, goes back in |
  | `pool` | a rooftop pool in town (1925, 641) | paddles laps, only head and shoulders above the water, ripples behind; floats at the east end |
  | `palms` | the palms by the river mouth (3492, 742) | digs, nose down, sand flying; then a look round and a sit |
  | `pin` | behind the Boardwalk Bowl's giant pin (282, 752) | hidden, then the head pokes out, then out on the roof for a sit |
  | `palm` | a parking-lot palm (1933, 889) | naps with its back to us, z's rising; wakes for a look round |
  | `river` | the river's sand bar by the bridge pier (3628, 572)-(3655, 612) | trots down to the water, sniffs, shakes off, trots back |
  | `verge` | the grass strip by the parking lot (1655, 980) | chases its tail, sits panting, sniffs the grass |

- **Found (every time):** a squash, two hops, a heart and sparkles, then its way out: it runs off leaving paw prints
  that fade (`palms`, `palm`, `verge`), backs into the dark (`trestle`), sinks (`pool`), ducks behind the pin (`pin`)
  or trots upstream (`river`). Five seconds later it is hiding in another spot that is on screen (phones only show the
  middle of the park), preferring spots not found yet.
- **The badge** (top right, the title's cream-and-ink look, Gaegu): "?" until the corgi is first found, then the
  corgi's face with a count chip (`3/7`). Its card: "Can you find the corgi?" / "You found it!" / "Every spot found!",
  one paw per hiding spot (filled when found there), and a "Need a hint?" button. Spots found are kept in this
  browser (`localStorage`, key `boardwalk.corgi.found`); without storage it still works for the visit.
- **The hint:** if it hasn't been found, it barks 45 s after it hid and every 60 s after: two little hops and a
  "woof!" speech bubble (16 CSS px at any window size) over it. The hint button barks at once.
- **Click target:** an invisible button that follows the corgi, at least 30 CSS px square, so it can be clicked on a
  MacBook where the corgi itself is about 8 CSS px tall. It is out of the tab order, so tabbing doesn't give it away.

## How it's made

1. `uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/corgi/tools/build.py`:
   - `corgi.webp` + `corgi.json`: the 12 frames of the crowd's corgi sheet (`tests/characters/gen/sheet_pet_corgi_0.png`),
     keyed, cut and outlined with `build_atlas.py`'s own functions, at 4 px per park px for a 20 park px corgi (the
     crowd's lead dogs are about 16). 89 KB.
   - `pin.webp`: the painted bowling pin cut out of `gen/park/world_v2_hd.png` (white body by colour, filled row by
     row across the red band, dilated over its outline), drawn again over the corgi when it is behind the pin. 47 KB.
2. `layer.js`: one small canvas in the rides slot, moved to the current spot's box (at most 3 device px per park px),
   the click target and the bubble in the front slot, the badge and card fixed top right. Every scene is closed form
   on the page clock. The paw icons are a CSS mask, not inline SVG, because `scripts/capture.mjs` clips to a page's
   first `<svg>` when no `--select` is given.
3. `tools/click_test.html`: frames the park, clicks the corgi, opens the card, for headless checks
   (`node scripts/capture.mjs "http://localhost:15178/rides/corgi/tools/click_test.html?corgi=pin" --select body --ready "html[data-ready]"`).

## Open

- More spots: riding a ride (a Dream Wheel cabin, a log boat, a carousel horse) through the riders contract, under
  the beach stairs once the beach layer settles, the mini golf.
- At night (time of day isn't built yet) the corgi needs the night grade like every live layer.
- Sound for the bark, if the page ever gets sound.
