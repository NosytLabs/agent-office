"""Keep pytest from exploding when it imports the plugin package."""
import sys
import types
from pathlib import Path

if "hermes_constants" not in sys.modules:
    stub = types.ModuleType("hermes_constants")
    stub.get_hermes_home = lambda: Path.home() / ".hermes"
    sys.modules["hermes_constants"] = stub
