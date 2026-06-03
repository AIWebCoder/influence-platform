"""Convert UTF-16-LE source files to UTF-8 (Windows editor null-byte issue)."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    for arg in sys.argv[1:]:
        path = Path(arg)
        raw = path.read_bytes()
        if len(raw) < 2 or raw[1] != 0:
            print(f"skip (already UTF-8): {path}")
            continue
        path.write_text(raw.decode("utf-16-le"), encoding="utf-8", newline="\n")
        print(f"fixed: {path}")


if __name__ == "__main__":
    main()
