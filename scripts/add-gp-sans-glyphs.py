#!/usr/bin/env python3
"""Add the missing zero glyph to Marker Sans Caps."""

from copy import deepcopy
from base64 import b64encode
from pathlib import Path
import re

from fontTools.ttLib import TTFont


FONT_PATH = Path(__file__).resolve().parents[1] / "fonts/GP_Sans/MarkerSansCaps.ttf"
EMBEDDED_ASSETS_PATH = Path(__file__).resolve().parents[1] / "assets_embedded.js"

def main():
    font = TTFont(FONT_PATH)
    glyphs = font["glyf"]
    metrics = font["hmtx"].metrics
    glyph_order = font.getGlyphOrder()

    # Appending preserves the original glyph IDs, which existing cmap entries use.
    if "zero" not in glyph_order:
        glyph_order.append("zero")
    font.setGlyphOrder(glyph_order)

    # The requested zero is deliberately identical to the capital O.
    glyphs["zero"] = deepcopy(glyphs["O"])
    metrics["zero"] = metrics["O"]

    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[ord("0")] = "zero"

    font.save(FONT_PATH)

    data_uri = "data:font/truetype;base64," + b64encode(FONT_PATH.read_bytes()).decode("ascii")
    embedded_assets = EMBEDDED_ASSETS_PATH.read_text()
    updated_assets, replacements = re.subn(
        r'(const FONT_CAPS_B64 = ")[^"]+(";)',
        rf'\g<1>{data_uri}\g<2>',
        embedded_assets,
        count=1,
    )
    if replacements != 1:
        raise RuntimeError("Could not update FONT_CAPS_B64 in assets_embedded.js")
    EMBEDDED_ASSETS_PATH.write_text(updated_assets)


if __name__ == "__main__":
    main()
