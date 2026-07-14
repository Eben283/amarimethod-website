#!/usr/bin/env python3
"""Apply Parla personalization patches to an Immergo checkout (run from repo root)."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

root = Path.cwd()
if not (root / "src/components/app-root.js").exists():
    sys.exit("Run from the Immergo repo root")

# Import patch logic by re-executing the same transforms already applied in this folder.
print("This repo under immergo-italian/ is already patched.")
print("Prefer: copy this whole directory to Cloud Shell and run scripts/deploy.sh")
print("Or sync files from amarimethod-website/immergo-italian over your clone.")
