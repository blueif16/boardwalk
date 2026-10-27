# Boardwalk

A living storybook map of the Santa Cruz Beach Boardwalk: the whole official park map repainted in a cute pastel
style, fixed to fill any desktop or laptop screen, with live layers on top (animal crowds, rides, water, time of day).

Split out of `living-anatomy` on 2026-10-26.

## Run

```sh
nohup setsid python3 -I tools/serve.py > .server.log 2>&1 < /dev/null &    # from the repo root (no-cache headers)
"/mnt/c/Program Files/Tailscale/tailscale.exe" serve --bg --http=5178 http://127.0.0.1:15178   # once; it persists
```

On any device in the tailnet: **http://ran:5178/** (the park), `http://ran:5178/board.html` (the board). Local tools
(capture scripts, bakes) use `http://localhost:15178/`. The server listens on a different local port because WSL's
mirrored networking holds the port on the Windows side, and Tailscale needs 5178 there.

| Page | What it is |
|---|---|
| `index.html` | The whole park on one screen (the shape of the real site) |
| `board.html` | The board: style frames, tests, decisions, with pictures and live links |
| `base/compose.html?tests=name,name` | The workbench: live test layers on the Giant Dipper slice |

## Folders

| Folder | What it holds |
|---|---|
| `STYLE.md`, `CHARACTERS.md` | The look and the crowd's behaviour |
| `base/` | The shared stage, camera, clock, time of day and the compose page (`base/README.md`) |
| `tests/<name>/` | The seven bakeoff tests, each with a `RESULTS.md` |
| `gen/` | Generated images with their request records (`*.json`); `gen/park/` is the whole park |
| `prompts/` | Every prompt sent to the image model |
| `tools/` | Image generation (`shyfai_image.py`) and palette tools |
| `scripts/` | Headless Chrome screenshot and drive scripts (`capture.mjs`, `drive.mjs`) |
| `reference/` | The official map, OSM data and third-party style references (study only, not for redistribution) |

Python tools run with `uv run --no-project --with pillow --with numpy [--with scipy] python -I ...` from the repo root.
