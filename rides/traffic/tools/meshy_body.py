"""Write the Meshy multi-image-to-3d request body for one car: rides/traffic/gen/meshy/NAME/body.json.

  python3 -I rides/traffic/tools/meshy_body.py NAME
then
  MESHY_API_KEY=$(head -1 ~/.meshy_key) python3 -I ~/3d_director/qingming/tools/meshy_task.py multi-image-to-3d \
      rides/traffic/gen/meshy/NAME @rides/traffic/gen/meshy/NAME/body.json

Settings: Meshy 7.1 ("latest"), textured from the four views themselves (no texture prompt), image_enhancement off
and remove_lighting on (keep the painted colours, drop baked highlights), remeshed to 12k triangles (the car is drawn
about 56 px long; more detail is wasted), GLB only.
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(os.path.dirname(HERE), "gen/meshy", sys.argv[1])
uri = lambda p: "data:image/png;base64," + base64.b64encode(open(os.path.join(d, p), "rb").read()).decode()
body = {
    "image_urls": [uri(v + ".png") for v in ("threequarter", "side", "front", "back")],
    "ai_model": "latest",
    "should_texture": True,
    "texture_resolution": "2k",
    "image_enhancement": False,
    "remove_lighting": True,
    "should_remesh": True,
    "topology": "triangle",
    "target_polycount": 12000,
    "target_formats": ["glb"],
}
json.dump(body, open(os.path.join(d, "body.json"), "w"))
print(os.path.join(d, "body.json"), sum(len(u) for u in body["image_urls"]) // 1024, "KB of images")
