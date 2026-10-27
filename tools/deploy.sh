#!/usr/bin/env bash
# Publish the park to https://me.infinityopus.com (Vercel project "boardwalk", team blueif16s-projects).
#
#   tools/deploy.sh            (from the repo root; the dev server must be running on 15178)
#
# 1. Crawls the page on four screen types and copies only the files it loads into dist/ (tests/perf/tools/
#    load_shiplist.mjs), plus what a crawl at one hour can miss: every time of day's relight fields and the fonts.
# 2. Checks dist/ alone on a spare port: no 404s.
# 3. Deploys dist/ to production. dist/.vercel links it to the project; the CLI's .env.local token never ships.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=15191
curl -sf -o /dev/null http://localhost:15178/ || { echo "start the dev server first (README.md)"; exit 1; }

keep=$(mktemp -d)
[ -d dist/.vercel ] && cp -r dist/.vercel "$keep/"
rm -rf dist
also=$(ls rides/sky/fields/* site/title/fonts/* | paste -sd, -)
node tests/perf/tools/load_shiplist.mjs http://localhost:15178/ --copy dist --also "$also"
[ -d "$keep/.vercel" ] && cp -r "$keep/.vercel" dist/
rm -rf "$keep"
printf '.env*\n.vercel\n' > dist/.vercelignore

log=$(mktemp)
(cd dist && python3 -I -m http.server $PORT --bind 127.0.0.1 > "$log" 2>&1) &
srv=$!
trap 'kill $srv 2>/dev/null || true' EXIT
sleep 1
for q in "hour=13" "hour=22"; do
  node scripts/capture.mjs "http://localhost:$PORT/?$q&t=50" --select body --ready "html[data-ready]" --width 2560 --height 1440 \
    --scale 1 --wait 5000 --out "$(mktemp --suffix=.png)" | grep -E "console|error" || true
done
if grep -q '" 404 ' "$log"; then echo "missing files in dist:"; grep '" 404 ' "$log"; exit 1; fi

cd dist
[ -d .vercel ] || vercel link --yes --project boardwalk --scope blueif16s-projects
rm -f .env.local .gitignore
vercel deploy --prod --yes --scope blueif16s-projects
