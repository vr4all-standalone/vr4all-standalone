"""Regenerate desktop icons from the approved VR4ALL headset artwork."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
source = ROOT / "public" / "brand-headset.png"
target = ROOT / "desktop"
image = Image.open(source).convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
image.save(target / "icon.png", format="PNG")
image.save(
    target / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
