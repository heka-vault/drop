"""Static safety checks for the generated README illustrations (stdlib only)."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
for name in ("explainer-light.svg", "explainer-dark.svg", "explainer-still.svg", "explainer-still-dark.svg"):
    path = ROOT / name
    content = path.read_text()
    assert path.stat().st_size < 100_000, name
    root = ET.fromstring(content)
    assert root.attrib["viewBox"] == "0 0 1280 720"
    for element in root.iter():
        tag = element.tag.split("}")[-1]
        assert tag not in {"script", "foreignObject", "image", "a", "iframe"}, tag
        for key, value in element.attrib.items():
            assert not key.lower().startswith("on"), key
            assert not key.endswith("href"), value
    assert "@import" not in content and "url(" not in content
    assert "prefers-reduced-motion: reduce" in content
    assert "The server never sees the key." in content
    assert "24 hours" in content and "1 open" in content
    assert root.find("{http://www.w3.org/2000/svg}title") is not None
    assert root.find("{http://www.w3.org/2000/svg}desc") is not None
    assert not re.search(r"https?://(?!www.w3.org/2000/svg|drop.example.com)", content)
    print(f"PASS {name}: {path.stat().st_size:,} bytes, self-contained SVG")
