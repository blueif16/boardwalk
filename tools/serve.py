"""The dev server: the repo root over http on 127.0.0.1:15178, with Cache-Control: no-cache on every response, so a
plain reload always shows the newest files (unchanged files still come back as a cheap 304).

  nohup setsid python3 -I tools/serve.py > .server.log 2>&1 < /dev/null &      (from the repo root)

Tailscale serves it to the tailnet as http://ran:5178/ (see README.md).
"""
import functools, http.server, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


http.server.ThreadingHTTPServer(("127.0.0.1", 15178), functools.partial(Handler, directory=ROOT)).serve_forever()
