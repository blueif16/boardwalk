# Boardwalk style

A cute storybook map of the Santa Cruz Beach Boardwalk: warm pastel colours, thin tinted outlines, soft shading, toy-like
proportions and a crowd of tiny animal characters. Every layer (painted base, Rive, three.js, water) is judged against
the style frames below.

## Style frames

| Frame | Role |
|---|---|
| `gen/style_frame/v1_1.png` | The base: palette, line, shading, characters, and the tidy boardwalk wall and stairs |
| `gen/style_frame/v1_0.png` | Same look, softer lines; the coaster and swing ride drawn larger |
| `gen/map_crop/dipper_wheel_v2_0.png` | The real park: the official map's Giant Dipper slice redrawn in this look, on the map's camera |

New frames take these as image references, not `reference/style_ref*.jpg`: those are third-party, study only, and
ref 2 carries watermarks.

## Camera

- The official park map's camera (`reference/map/boardwalk-map-2025-pdf.jpg`): looking inland from over the beach,
  the strip almost horizontal, parallel projection, vertical edges vertical.
- Layout comes from the official map; true positions in metres come from OpenStreetMap (`reference/map/osm_plan.png`).
- The surf is at the bottom, then sand, the boardwalk wall and stairs, the rides, Beach Street and the town at the top.
- The whole park is wider than a screen (about 3.2:1 in the official map), so the view pans sideways.

## Line

- Silhouette ink: warm near-black brown, `#2c201b` (measured: `#231a18` in v1_1, `#2c201b` in v3b_0; 3–5% of pixels).
- Interior lines are thinner and tinted: a darker version of the fill they sit on, never pure black.
- Line width stays constant on screen at every zoom level.

## Colour

Measured from v1_1 and v3b_0 (`tools/palette.py`):

| Role | Colours |
|---|---|
| Dry sand, wet sand | `#f9d7a7` `#eebf91`, `#d1ad95` |
| Sea, shallows, foam | `#54b3d9` `#5eaed9`, `#a1cde2` `#88beda`, `#f9f4ea` |
| Boardwalk wood, wall | `#bc8666` `#aa7e65`, `#604e43` `#745c4c` |
| Coaster white, rails red | `#f9f4ea`, `#e89671` `#ec8167` |
| Awnings, stands | salmon `#ec8167`, butter `#f2b275`, cornflower `#85adcd`, lavender grey `#b4b7b8` |
| Palms, planting | `#83805a` `#7d9459` |
| Street, pavement | `#aca9a1` `#a19981` |

## Shading and shadow

- One soft shade tone per fill; a gentle gradient is allowed on large surfaces (awnings, coaster bents).
- Soft, short contact shadows under objects only. No long cast shadows: the light changes with the time of day and a
  painted shadow can't move.

## Water and beach

- Flat blue water with short white dash ripples; curling white foam lines where the waves run up the sand.
- A band of darker wet sand behind the foam, where the last wave pulled back.

## Proportions and characters

- Chunky, rounded, toy-like. Characters and rides are scaled up against the real map; positions stay true.
- Animal characters: bears, bunnies, cats, dogs, each doing something.
- Busy on the boardwalk, more room on the beach.

## Text

Image generation never draws text. Signboards stay blank in the painting and get their real names as separate vector
layers.

## Generation

- Images: shyfai (`tools/shyfai_image.py`, model gpt-image-2.5). Prompts live in `prompts/`, outputs in `gen/`.
- Anything that ships on the site is generated at the top settings: gpt-image-2.5, 3840x2560 (2.5x the stage), quality
  high. These are the tool's defaults. Everything made during the tests was 1536x1024 at quality auto, so it is test
  material only and gets regenerated before it ships.
- 3D: Meshy or Tripo when a part needs a model.
