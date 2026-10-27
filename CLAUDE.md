# Boardwalk: notes for agents

Read `NEXT_SESSION.md` first: current state, the user's decisions and the open issues in priority order.

- **Goal:** the whole official park map, painted in our style, fixed on one screen. It covers the window (no scrolling,
  no bars) on desktop monitors and MacBooks alike. The painting is 3:2: the park strip across the full width, town and
  hills above, beach and sea below as margins that wider screens trim. `index.html` (the root page, http://ran:5178/) is the site.
- **Image settings for anything that ships:** gpt-image-2.5, 3840 x 2560, quality high. These are the defaults of
  `tools/shyfai_image.py`. Smaller sizes or quality auto only for throwaway tests.
- **Edits lose detail:** an edit repaints the whole canvas from a reduced copy of its input, even with a mask. Never pass
  finished high-detail art through an edit; paste the original pixels back over anything an edit was not meant to
  change. Sharpness comes from redrawing small pieces at 3840 x 2560 each and shrinking the stitched result to screen
  size.
- **Positions:** rides and paths are placed where our painting draws them, measured on the painting. The official map
  (`tests/layout/layout.json`) is the guide for what goes where, not the coordinate system.
- **Third-party material** in `reference/` is study only: never feed `reference/style_ref*.jpg` to the image model.
- Screenshots: `node scripts/capture.mjs <url> --ready "html[data-ready]" ...`. Headless Chrome's WebGL is software,
  so frame rates from it are not real GPU numbers. With `--scale` above 1 it renders at 1x into a larger frame; for a
  high-resolution shot use a bigger `--width/--height` at `--scale 1`.
- Ask the user for keys, plans or credits when a paid service blocks a task (Meshy, shyfai).
