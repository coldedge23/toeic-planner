"""Compatibility entry point for the current package-based listening acceptance."""
from pathlib import Path
import runpy
import sys

if len(sys.argv) == 1:
    sys.argv.append('http://127.0.0.1:4178')
runpy.run_path(str(Path(__file__).with_name('verify-listening-packs-browser.py')), run_name='__main__')
