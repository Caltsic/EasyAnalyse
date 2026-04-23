from __future__ import annotations

from base64 import b64encode
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_IMAGE = ROOT / "scripts" / "assets" / "app-icon-source.png"
DESKTOP_PUBLIC = ROOT / "easyanalyse-desktop" / "public"
TAURI_ICONS = ROOT / "easyanalyse-desktop" / "src-tauri" / "icons"
ANDROID_RES = ROOT / "easyanalyse-mobile-android" / "app" / "src" / "main" / "res"

LIGHT_BACKGROUND = (247, 248, 244, 255)


def ensure_dirs() -> None:
    for path in [
        SOURCE_IMAGE.parent,
        DESKTOP_PUBLIC,
        TAURI_ICONS,
        ANDROID_RES / "drawable-nodpi",
        ANDROID_RES / "mipmap-anydpi-v26",
        ANDROID_RES / "mipmap-mdpi",
        ANDROID_RES / "mipmap-hdpi",
        ANDROID_RES / "mipmap-xhdpi",
        ANDROID_RES / "mipmap-xxhdpi",
        ANDROID_RES / "mipmap-xxxhdpi",
        ANDROID_RES / "values",
    ]:
        path.mkdir(parents=True, exist_ok=True)


def load_source_image() -> Image.Image:
    if not SOURCE_IMAGE.exists():
        raise FileNotFoundError(f"Missing icon source image: {SOURCE_IMAGE}")
    return Image.open(SOURCE_IMAGE).convert("RGBA")


def sharpen(image: Image.Image, size: int) -> Image.Image:
    if size <= 32:
        return image.filter(ImageFilter.UnsharpMask(radius=0.8, percent=145, threshold=2))
    if size <= 64:
        return image.filter(ImageFilter.UnsharpMask(radius=0.9, percent=135, threshold=2))
    if size <= 128:
        return image.filter(ImageFilter.UnsharpMask(radius=1.0, percent=120, threshold=2))
    return image.filter(ImageFilter.UnsharpMask(radius=1.2, percent=105, threshold=2))


def render_icon(
    source: Image.Image,
    size: int,
    *,
    inset_ratio: float = 0.0,
    background: tuple[int, int, int, int] = LIGHT_BACKGROUND,
) -> Image.Image:
    if not 0.0 <= inset_ratio < 0.5:
        raise ValueError(f"Invalid inset ratio: {inset_ratio}")

    inset = round(size * inset_ratio)
    inner_size = max(1, size - inset * 2)
    fitted = ImageOps.fit(source, (inner_size, inner_size), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    canvas = Image.new("RGBA", (size, size), background)
    offset = ((size - inner_size) // 2, (size - inner_size) // 2)
    canvas.alpha_composite(fitted, offset)
    return sharpen(canvas, size)


def png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def svg_wrapper(image: Image.Image) -> str:
    encoded = b64encode(png_bytes(image)).decode("ascii")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
        f'<image href="data:image/png;base64,{encoded}" x="0" y="0" width="512" height="512" />'
        "</svg>\n"
    )


def write_favicon_assets(source: Image.Image) -> None:
    favicon = render_icon(source, 256)
    favicon.save(DESKTOP_PUBLIC / "favicon.png")
    (DESKTOP_PUBLIC / "favicon.svg").write_text(svg_wrapper(render_icon(source, 512)), encoding="utf-8")


def write_desktop_icons(source: Image.Image) -> None:
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }
    for name, size in sizes.items():
        render_icon(source, size).save(TAURI_ICONS / name)

    ico_base = render_icon(source, 256)
    ico_base.save(
        TAURI_ICONS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    (TAURI_ICONS / "source.svg").write_text(svg_wrapper(render_icon(source, 512)), encoding="utf-8")


def write_android_icons(source: Image.Image) -> None:
    adaptive_foreground = render_icon(source, 432, inset_ratio=0.085)
    adaptive_foreground.save(ANDROID_RES / "drawable-nodpi" / "ic_launcher_foreground.png")

    sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for directory, size in sizes.items():
        icon = render_icon(source, size, inset_ratio=0.06)
        icon.save(ANDROID_RES / directory / "ic_launcher.png")
        icon.save(ANDROID_RES / directory / "ic_launcher_round.png")

    (ANDROID_RES / "values" / "colors.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#F7F8F4</color>
</resources>
""",
        encoding="utf-8",
    )

    adaptive_icon = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
"""
    (ANDROID_RES / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(adaptive_icon, encoding="utf-8")
    (ANDROID_RES / "mipmap-anydpi-v26" / "ic_launcher_round.xml").write_text(adaptive_icon, encoding="utf-8")


def main() -> None:
    ensure_dirs()
    source = load_source_image()
    write_favicon_assets(source)
    write_desktop_icons(source)
    write_android_icons(source)


if __name__ == "__main__":
    main()
