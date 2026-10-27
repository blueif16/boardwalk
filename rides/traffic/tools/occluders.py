"""Moved to tools/occluders.py, shared by every layer that draws things standing on the painting (the crowd uses it
too). This shim keeps `import occluders` in make_occluders.py (and any other script here) working unchanged."""
import importlib.util, os, sys

_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "occluders.py")
_spec = importlib.util.spec_from_file_location("boardwalk_tools_occluders", os.path.normpath(_path))
_mod = importlib.util.module_from_spec(_spec)
sys.modules["boardwalk_tools_occluders"] = _mod
_spec.loader.exec_module(_mod)
globals().update({k: v for k, v in vars(_mod).items() if not k.startswith("__")})
