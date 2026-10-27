"""Write the beach pose sheets' prompt files and batch file from rides/beach/prompts/beach_sheet.txt.

  python3 -I rides/beach/tools/make_batch.py OUT.jsonl species [species ...]

Each species' character line is taken from tests/characters/prompts/sheet_<species>.txt; its existing sheet
(tests/characters/gen/sheet_<species>_0.png) is the only reference image.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
P = os.path.join(ROOT, "rides/beach/prompts")
common = open(os.path.join(P, "beach_sheet.txt")).read()
out, names = sys.argv[1], sys.argv[2:]
with open(out, "w") as f:
    for n in names:
        src = open(os.path.join(ROOT, f"tests/characters/prompts/sheet_{n}.txt")).read()
        line = re.search(r"The character: (.*?)(?: Its species|\n)", src).group(1).strip()
        txt = common.replace("{character}", line)
        pf = f"rides/beach/prompts/beach_{n}.txt"
        open(os.path.join(ROOT, pf), "w").write(txt)
        f.write(json.dumps({"out": f"rides/beach/gen/beach_{n}", "prompt_file": pf, "ref": [f"tests/characters/gen/sheet_{n}_0.png"]}) + "\n")
print(out, names)
