"""Download the CC BY Blender sample through the real qBittorrent engine over a local webseed."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
from pathlib import Path
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cinema.library import Library, parse_range
from cinema.qbit import Qbit
from cinema.security import SecretStore
from cinema.service import Service


def bencode(value):
    if isinstance(value, int): return b"i" + str(value).encode() + b"e"
    if isinstance(value, str): value = value.encode()
    if isinstance(value, bytes): return str(len(value)).encode() + b":" + value
    if isinstance(value, list): return b"l" + b"".join(bencode(v) for v in value) + b"e"
    return b"d" + b"".join(bencode(k) + bencode(v) for k, v in sorted(value.items())) + b"e"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    config = json.loads((root / "runtime/config.json").read_text())
    library = Library(config["library"], root / "runtime/library.sqlite3")
    qbit = Qbit(config["qbit_port"], SecretStore(root / "runtime/secrets.dat").data["qbit_password"])
    qbit.login()
    payload = args.video.read_bytes()
    name = "Sintel - Blender Foundation - CC BY 3.0 - teszt-" + secrets.token_hex(3) + ".mp4"

    class Seed(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            if urllib.parse.unquote(self.path) != "/" + name:
                self.send_error(404); return
            start, end, partial = parse_range(self.headers.get("Range"), len(payload))
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            if partial: self.send_header("Content-Range", f"bytes {start}-{end}/{len(payload)}")
            self.end_headers(); self.wfile.write(payload[start:end + 1])

    seed = ThreadingHTTPServer(("127.0.0.1", 0), Seed)
    threading.Thread(target=seed.serve_forever, daemon=True).start()
    length = 262144
    pieces = b"".join(hashlib.sha1(payload[i:i+length]).digest() for i in range(0, len(payload), length))
    info = {b"name": name.encode(), b"length": len(payload), b"piece length": length, b"pieces": pieces, b"private": 1}
    torrent = bencode({b"info": info, b"url-list": f"http://127.0.0.1:{seed.server_port}/" + urllib.parse.quote(name)})
    service = Service(config, library, qbit)
    try:
        identifier = service.add(torrent=torrent, title="Sintel – Blender Foundation, CC BY 3.0")
        for _ in range(60):
            service.update()
            job = next(j for j in service.snapshot()["jobs"] if j["id"] == identifier)
            if job.get("videoId"):
                downloaded = library.file(job["videoId"])
                assert hashlib.sha256(downloaded.read_bytes()).digest() == hashlib.sha256(payload).digest()
                print("REAL TORRENT OK: qBittorrent download, piece hashes, completed-file registration and SHA-256 verified.")
                print("Tesztvideó a médiatárban: Sintel – Blender Foundation, CC BY 3.0")
                return
            time.sleep(1)
        raise RuntimeError("A helyi webseed torrent nem fejeződött be 60 másodpercen belül.")
    finally:
        seed.shutdown(); seed.server_close()


if __name__ == "__main__":
    main()
