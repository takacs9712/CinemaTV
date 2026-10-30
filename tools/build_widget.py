"""Build an unsigned review archive. Samsung installation still requires an actual Samsung signature."""
from pathlib import Path
import struct
import zlib
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def icon_png():
    width = 512
    rows = bytearray()
    for y in range(width):
        rows.append(0)
        for x in range(width):
            color = (20, 28, 44, 255)
            if 108 <= x < 404 and 110 <= y < 402:
                color = (240, 90, 104, 255)
            if 213 <= x <= 334 and abs(y - 256) <= (334 - x) * 73 / 121:
                color = (255, 255, 255, 255)
            if 131 <= y < 164 and any(left <= x < left + 35 for left in (135, 203, 271, 339)):
                color = (20, 28, 44, 255)
            rows.extend(color)
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, width, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def build():
    build = ROOT / "build"
    build.mkdir(exist_ok=True)
    (ROOT / "tv" / "icon.png").write_bytes(icon_png())
    output = build / "CinemaTV-unsigned.zip"
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted((ROOT / "tv").iterdir()):
            if file.is_file() and file.suffix in (".html", ".css", ".js", ".xml", ".png", ".svg"):
                archive.write(file, file.name)
    print(f"Forráscsomag: {output}. Ez ALÁÍRATLAN, TV-re még nem telepíthető.")


if __name__ == "__main__":
    build()
