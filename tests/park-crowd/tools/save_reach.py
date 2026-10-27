"""Saves the reach printed by `node scripts/drive.mjs ... --actions tests/park-crowd/tools/dump_reach.json` (stdin) as
tests/park-crowd/occ_reach.json, the input of make_occluders.py."""
import json, os, sys

line = next((l for l in sys.stdin.read().splitlines() if l.startswith("eval: ")), None)
if not line:
    sys.exit("no eval result on stdin")
data = json.loads(json.loads(line[len("eval: "):]))
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "occ_reach.json")
json.dump(data, open(out, "w"))
print(f"{out}: {len(data['lines'])} lines, {len(data['points'])} points")
