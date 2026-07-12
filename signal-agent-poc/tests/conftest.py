"""Shared pytest fixtures for the Signal-to-Action Agent POC.

Ensures the POC root (this file's parent directory) is importable as
`run_signal_agent` and `skills.*` regardless of how pytest is invoked.
"""

import sys
from pathlib import Path

POC_ROOT = Path(__file__).resolve().parent.parent
if str(POC_ROOT) not in sys.path:
    sys.path.insert(0, str(POC_ROOT))
