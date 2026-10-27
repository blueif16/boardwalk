# The park crowd's cast

The animals on the whole-park page (`http://ran:5178/`). Every look is a 4 × 3 sprite sheet from shyfai, cut and
outlined by `tests/characters/tools/build_atlas.py --park` into `tests/park-crowd/atlas.png`. The crowd uses every
look in the atlas, so a new sheet needs no code change, only its line in the build's `SHEETS`.

Lineup of every look: `tests/characters/shots/lineup_park.png`. Rebuild it with
`uv run -q --no-project --with pillow python -I tests/characters/tools/lineup.py --cols 3`.

## Who is in it

| Group | Count | Looks |
|---|---|---|
| Adult species | 35 | bear, bunny, brown bunny, orange cat, grey cat, shiba, cream dog (round 1); panda, fox, pig, raccoon, koala, frog, penguin, tiger, sheep, duck, elephant, hamster (round 2); lion, giraffe, deer, otter, owl, hedgehog, squirrel, mouse, monkey, zebra, hippo, seal, alpaca, crocodile, flamingo, red panda (round 3) |
| Outfit variants | 17 | `<species>~<colour>`: the clothing recoloured (below) |
| Kids | 7 | bear cub, bunny kid, panda kid, fox kid, piglet, kitten, lion cub |
| Pets on a lead | 4 | puppy, corgi, poodle, cat |

So 52 adult looks, 7 kids and 4 pets. In a 120-animal crowd at midday (seed 1), 39 species are on screen at once,
and no species appears more than 9 times. 12 of the 18 families are one species; the rest are mixed on purpose.

## How the crowd picks

- **Families:** 80% are one species, parents and kids together. Each kid look is tied to an adult species
  (`KID_OF` in `crowd.js`: bear → bear cub, bunny → bunny kid, panda → panda kid, fox → fox kid, pig → piglet,
  orange cat → kitten, lion → lion cub). The other 20% mix any adults with any kids.
- **Couples and friends:** any adults, mixed.
- **Dog walkers:** any adult with any of the four pets (cats on a harness included).
- These lists live in `crowd.js`. `sim.js` gained two options, `pets` and `kidOf`; without them it behaves as before.

## Outfit variants

`build_atlas.py --park [--variants N]` (default 1) recolours each adult's clothing into N palette colours:

1. Sample the clothing on the front view's torso (58–72% down the cell, middle fifth). Skip the species if that area
   is grey (saturation under 0.12) or has too few pixels.
2. Select that hue (±16°) across the sheet, keep only its large connected areas (this drops rosy cheeks and inner
   ears), and drop anything in the top 38% of each cell (the head).
3. Skip the species if more than 8% of the selected pixels sit in the head area: the clothing shares a hue with fur,
   a beak or a hat, so recolouring would bleed. This skips bunny, cat, shiba, tiger, frog, duck, giraffe and most
   round-3 species with striped or patterned clothes.
4. Pick palette colours at least 50° from the old clothing and 30° from the fur. Keep each pixel's shading by scaling
   its saturation and value against the sampled ones.

**What went wrong on the way:**
- The first rule (skip if saturation is under 0.22) skipped pale shirts (panda, fox, lion).
- Without the head rule, koala and otter got teal noses and penguins lavender cheeks.
- With the head rule in the wrong order, it hid the fur clash and let bunny and cat through with pink-ear changes;
  the clash check now runs before the head is dropped.
- Python's `hash()` is random per run, so palette picks changed between builds; they now use crc32.

The 17 variants were checked on the lineup: clothing only, shading intact, no fur touched.

## The sheets

All at the shyfai tool's defaults (gpt-image-2.5, 3840 × 2560, quality high), one image per sheet, refs
`gen/style_frame/v1_1.png` and `tests/characters/gen/ref_chars.png`, `--jobs 1`.

| Round | Sheets | Batch file | Prompt |
|---|---|---|---|
| 1 | 9 (7 adults, bear cub, puppy) | `prompts/sheets.jsonl` | `sheet_common.txt` (plain t-shirt), `sheet_pet.txt` |
| 2 | 12 adults | `prompts/sheets_v2.jsonl` | `sheet_common_v2.txt` |
| 3 | 16 adults, 6 kids, 3 pets | `prompts/sheets_v3.jsonl` | `sheet_common_v2.txt`; pets from `sheet_pet.txt` |

Round 3 times (s, one image each): lion 45, giraffe 48, deer 34, otter 41, owl 39, hedgehog 41, squirrel 48,
mouse 55, monkey 43, zebra 54, hippo 53, seal 37, alpaca 46, crocodile 51, flamingo 43, red panda 40, bunny kid 35,
panda kid 53, fox kid 41, piglet 49, kitten 38, lion cub 50, corgi 59, poodle 34, cat 48. About 19 minutes for 25
images.

**Prompt changes:**
- `sheet_common_v2.txt` changed round 1's "a plain t-shirt" to "simple summer clothes" and added "Its species,
  colours and outfit must read at a glance even at a tiny size: a clear silhouette (ears, tail, snout) and two or
  three flat colour areas".
- Kids use the same prompt with "a small …, a child, rounder and chubbier" in the character line, as the bear cub
  did.
- Pets reuse `sheet_pet.txt` with the animal swapped. For the cat: "PET CAT", "The same cat twelve times", and
  "stretching, front paws forward and bottom up" in place of "sniffing the ground".

**Checks on round 3:** all 25 sheets came out on the first try.
- All 12 cells were found on every sheet.
- The side-walk cell that faces left (cell 2 on owl, hedgehog, hippo, crocodile, bunny kid and lion cub) is mirrored
  by the build, and every side frame faces right.
- Keying is clean on the white and cream animals (alpaca, sheep, poodle, bunny kid).
- No sheet was redrawn.

## Atlas

The park atlas packs at 2 atlas px per stage px, twice what a screen shows at size 38. That lets all 63 looks fit one
2048² texture (3.4 MB PNG). The characters test keeps 4 px per stage px and its original 9 sheets: a plain build
without `--park` is unchanged byte for byte.

## Adding a species

1. Write `prompts/sheet_<name>.txt`: `sheet_common_v2.txt` with `{character}` replaced by one line of species,
   colours and outfit (two or three flat colour areas; a hat or accessory helps it read).
2. Add a line to a batch file and run `python3 -I tools/shyfai_image.py --batch <file> --jobs 1` from the repo root.
3. Add `"<name>": <height in stage px>` to `SHEETS` in `build_atlas.py`. Adults are 27–33, kids 21–23, pets 12–14. A
   kid also needs a line in `KIDS` (`build_atlas.py`) and in `KID_OF` (`crowd.js`); a pet's name starts with `pet_`.
4. Rebuild with `uv run -q --no-project --with pillow --with numpy --with scipy python -I tests/characters/tools/build_atlas.py --park`,
   check its line in the build output (missing cells, mirrored cells, variants), and look at it on the lineup.

## Not done, and what still repeats

- **Held items:** only the sheets' own act poses (ice cream, phone photo, sitting). Balloons and beach bags would need
  new act cells or a separate prop sheet, so I left them out.
- **Few kid species:** kids exist for 7 species, so the families of the other 28 are always mixed.
- **Pets are small:** at 12–14 stage px tall, they are hard to tell apart at laptop size.
- **The same 12 poses for everyone:** variety comes from species and colour, not motion.
- **Pandas show up most** (adult, variant and kid: 9 of 120 at seed 1). Weighting species evenly, not looks, would
  even this out.
