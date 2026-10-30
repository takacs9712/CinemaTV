import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

from .library import Library, parse_range
from .qbit import Qbit, create_profile
from .security import Pairing, SecretStore
from .service import Service
from .remote import RemoteHub
from .enrollment import Enrollment

ROOT = Path(__file__).resolve().parent.parent


class CinemaServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, config, runtime):
        self.config, self.runtime = config, runtime
        self.secrets = SecretStore(runtime / "secrets.dat")
        self.pairing = Pairing()
        self.enrollment = Enrollment(runtime / 'enrollment.sqlite3')
        self.library = Library(config["library"], runtime / "library.sqlite3")
        self.qbit = Qbit(config["qbit_port"], self.secrets.data["qbit_password"])
        self.service = Service(config, self.library, self.qbit)
        self.remote = RemoteHub()
        self.allowed_network = ipaddress.ip_network(config["network"])
        super().__init__((config["bind"], config["port"]), Handler)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CinemaTV/0.1"

    def log_message(self, *_):
        # Do not write media tickets, device tokens, filenames or URLs into logs.
        pass

    def allowed_peer(self):
        address = ipaddress.ip_address(self.client_address[0])
        local = ipaddress.ip_address(self.connection.getsockname()[0])
        # A DHCP address change must not break an already paired TV. The new
        # destination is an actual local socket address, never a forwarded header.
        return address.is_loopback or address in self.server.allowed_network or (
            local.is_private and not local.is_loopback and address in ipaddress.ip_network(str(local) + '/24', strict=False))

    def local_peer(self):
        address = self.client_address[0]
        return ipaddress.ip_address(address).is_loopback or address == self.connection.getsockname()[0]

    def valid_host(self):
        host = self.headers.get("Host", "").split(":")[0].lower()
        return host in {"localhost", "127.0.0.1", self.server.config["lan_host"], self.connection.getsockname()[0], socket.gethostname().lower()}

    def origin(self):
        origin = self.headers.get("Origin")
        # Packaged Tizen widgets can serialize their local origin as file://
        # rather than null. This does not bypass peer, Host or bearer checks.
        allowed = {"null", "file://", f"http://127.0.0.1:{self.server.server_port}",
                   f"http://localhost:{self.server.server_port}",
                   f"http://{self.server.config['lan_host']}:{self.server.server_port}",
                   f"http://{self.connection.getsockname()[0]}:{self.server.server_port}",
                   f"http://{socket.gethostname().lower()}:{self.server.server_port}"}
        return origin if origin in allowed else None

    def headers_common(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        origin = self.origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,Range")
        self.send_header("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges")

    def reply(self, status, data, content_type="application/json; charset=utf-8"):
        body = json.dumps(data, ensure_ascii=False).encode() if isinstance(data, (dict, list)) else data
        self.send_response(status)
        self.headers_common()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def authorized(self):
        auth = self.headers.get("Authorization", "")
        return auth.startswith("Bearer ") and self.server.secrets.authorized(auth[7:])

    def body(self, limit=65536):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Chunked feltöltés nincs engedélyezve.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > limit:
            raise ValueError("Túl nagy kérés.")
        return self.rfile.read(length)

    def json_body(self):
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            raise ValueError("JSON kérés szükséges.")
        body = json.loads(self.body())
        if not isinstance(body, dict):
            raise ValueError("Hibás JSON kérés.")
        return body

    def do_OPTIONS(self):
        if not self.allowed_peer() or not self.valid_host() or not self.origin():
            self.reply(403, {"error": "Nem engedélyezett eredet."})
            return
        self.reply(200, {})

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.dispatch(False)

    def do_POST(self):
        self.dispatch(True)

    def dispatch(self, mutate):
        try:
            self.connection.settimeout(20)
            if not self.allowed_peer() or not self.valid_host():
                self.reply(403, {"error": "Csak a beállított helyi hálózat engedélyezett."})
                return
            url = urllib.parse.urlsplit(self.path)
            path, query = url.path, urllib.parse.parse_qs(url.query)
            if self.headers.get("Origin") and not self.origin():
                self.reply(403, {"error": "Nem engedélyezett eredet."})
                return
            if path == "/api/health" and not mutate:
                self.reply(200, {"name": "Cinema TV", "version": "0.1.0", "paired": self.authorized()})
                return
            if path == '/api/discover' and not mutate:
                proof = self.server.enrollment.proof(query.get('id', [''])[0], query.get('nonce', [''])[0])
                self.reply(200 if proof else 404, {'proof':proof} if proof else {'error':'Ismeretlen eszköz.'})
                return
            if path == "/api/local-pairing" and self.local_peer() and not mutate:
                self.reply(200, {"pin": self.server.pairing.pin, "expires": self.server.pairing.expires,
                                 "url": f"http://{self.server.config['lan_host']}:{self.server.server_port}",
                                 'auto_paired': self.server.enrollment.claimed(), 'receivers': self.server.remote.list()})
                return
            if path == "/api/pair" and mutate:
                body = self.json_body()
                if not self.server.pairing.accept(self.client_address[0], body.get("pin")):
                    self.reply(403, {"error": "Hibás vagy lejárt párosítókód. A PC-n kérj új kódot."})
                    return
                self.reply(200, {"token": self.server.secrets.issue_device(body.get("label", "Cinema TV"))})
                return
            if path == '/api/auto-pair' and mutate:
                body = self.json_body()
                token = self.server.enrollment.redeem(body.get('secret'), self.client_address[0],
                    lambda: self.server.secrets.issue_device('Samsung Tizen TV (automatikus)'))
                if not token:
                    self.reply(403, {'error': 'Az automatikus TV-párosítás engedélye nem érvényes. A PC-ről frissíthető a TV telepítése.'})
                    return
                self.reply(200, {'token': token})
                return
            if path.startswith("/media/") and not mutate:
                identifier = path.removeprefix("/media/")
                if not self.authorized() and not self.server.secrets.valid_ticket(identifier, query.get("ticket", [""])[0]):
                    self.reply(401, {"error": "Lejárt médiahozzáférés. Nyisd meg újra a filmet."})
                    return
                self.stream(identifier)
                return
            if path.startswith("/api/"):
                if not self.authorized():
                    self.reply(401, {"error": "Párosítsd a TV-t a PC-n megjelenő kóddal."})
                    return
                self.api(path, query, mutate)
                return
            if mutate:
                self.reply(404, {"error": "Ismeretlen művelet."})
                return
            names = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/apps.js": "apps.js", "/navigation.js": "navigation.js", "/connection.js": "connection.js", "/bootstrap.js": "bootstrap.js", "/style.css": "style.css", "/icon.svg": "icon.svg"}
            if path not in names:
                self.reply(404, {"error": "Nincs ilyen oldal."})
                return
            file = ROOT / "tv" / names[path]
            self.reply(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except FileNotFoundError:
            self.reply(404, {"error": "A fájl már nem érhető el. Frissítsd a médiatárat."})
        except (ValueError, RuntimeError) as error:
            self.close_connection = True
            self.reply(400, {"error": str(error)[:400]})
        except Exception:
            self.close_connection = True
            self.reply(500, {"error": "A művelet nem sikerült. Ellenőrizd a PC-s szervert és a meghajtót."})

    def api(self, path, query, mutate):
        service, library = self.server.service, self.server.library
        if path == "/api/receivers" and not mutate:
            self.reply(200, {'receivers': self.server.remote.list()})
        elif path == "/api/receiver" and mutate:
            body = self.json_body()
            owner = hashlib.sha256(self.headers['Authorization'][7:].encode()).hexdigest()
            if body.get('enabled') is False:
                self.server.remote.disable(owner)
                self.reply(200, {'ok': True})
            else:
                self.reply(200, self.server.remote.heartbeat(owner, body.get('label', 'Cinema TV'), body.get('status', 'Készen áll'), body.get('ack'), body.get('services')))
        elif path == "/api/remote" and mutate:
            if not self.local_peer():
                self.reply(403, {'error': 'A távirányítást a helyi PC-n nyisd meg.'})
                return
            body = self.json_body()
            if body.get('action') == 'play':
                library.file(body['videoId'])
            identifier = self.server.remote.send(body['receiverId'], body['action'], body.get('videoId'), body.get('service'))
            self.reply(200, {'id': identifier})
        elif path == "/api/library" and not mutate:
            self.reply(200, {"videos": library.list()})
        elif path == "/api/catalog" and not mutate:
            self.reply(200, {"movies": service.tmdb(query.get("q", [""])[0])})
        elif path == "/api/downloads" and not mutate:
            self.reply(200, service.snapshot())
        elif path == "/api/settings" and not mutate:
            config = self.server.config
            result = {key: config[key] for key in ["max_gib", "reserve_gib", "autoplay"]}
            result.update(free_bytes=shutil.disk_usage(library.root).free, tmdb_configured=bool(config.get("tmdb_token")), local=self.local_peer())
            if self.local_peer():
                result["library"] = str(library.root)
            self.reply(200, result)
        elif path == "/api/settings" and mutate:
            body = self.json_body()
            if "tmdb_token" in body and not self.local_peer():
                raise ValueError("A TMDb tokent a PC-n állítsd be.")
            config = self.server.config
            for key, bounds in [("max_gib", (1, 500)), ("reserve_gib", (1, 100))]:
                if key in body:
                    value = int(body[key])
                    if not bounds[0] <= value <= bounds[1]:
                        raise ValueError("Az érték kívül esik az engedélyezett tartományon.")
                    config[key] = value
            if "autoplay" in body:
                config["autoplay"] = bool(body["autoplay"])
            if "tmdb_token" in body:
                token = str(body["tmdb_token"]).strip()
                if len(token) > 2048:
                    raise ValueError("Túl hosszú token.")
                self.server.secrets.data["tmdb_token"] = token
                self.server.secrets.save()
                config["tmdb_token"] = token
            save_config(config, self.server.runtime)
            self.reply(200, {"ok": True})
        elif path == "/api/rescan" and mutate:
            self.json_body()
            self.reply(200, {"count": library.scan()})
        elif path == "/api/progress" and mutate:
            body = self.json_body()
            library.progress(body["id"], body["position"], body["duration"])
            self.reply(200, {"ok": True})
        elif path == "/api/favorite" and mutate:
            library.favorite(self.json_body()["id"])
            self.reply(200, {"ok": True})
        elif path == "/api/play" and mutate:
            identifier = self.json_body()["id"]
            library.file(identifier)
            ticket = self.server.secrets.ticket(identifier)
            self.reply(200, {"path": f"/media/{identifier}?ticket={ticket}"})
        elif path == "/api/torrent" and mutate:
            data = self.body(4 * 1024 * 1024)
            identifier = service.add(torrent=data, movie_id=query.get("movieId", [None])[0])
            self.reply(200, {"id": identifier})
        elif path == "/api/magnet" and mutate:
            body = self.json_body()
            self.reply(200, {"id": service.add(magnet=body["magnet"], title=body.get("title"), movie_id=body.get("movieId"))})
        elif path == "/api/download-action" and mutate:
            body = self.json_body()
            service.action(body["id"], body["action"])
            self.reply(200, {"ok": True})
        elif path == "/api/renew-pairing" and mutate and self.local_peer():
            self.json_body()
            self.reply(200, {"pin": self.server.pairing.renew(), "expires": self.server.pairing.expires})
        else:
            self.reply(404, {"error": "Ismeretlen API-művelet."})

    def stream(self, identifier):
        path = self.server.library.file(identifier)
        size = path.stat().st_size
        try:
            start, end, partial = parse_range(self.headers.get("Range"), size)
        except ValueError:
            self.send_response(416)
            self.headers_common()
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(206 if partial else 200)
        self.headers_common()
        self.send_header("Content-Type", {".mkv": "video/x-matroska", ".ts": "video/mp2t"}.get(path.suffix.lower(), mimetypes.guess_type(path.name)[0] or "video/mp4"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(max(0, end - start + 1)))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                block = source.read(min(1024 * 1024, remaining))
                if not block:
                    break
                self.wfile.write(block)
                remaining -= len(block)


def save_config(config, runtime):
    data = {key: value for key, value in config.items() if key != "tmdb_token"}
    temp = runtime / "config.tmp"
    temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temp.replace(runtime / "config.json")


def load_config(runtime, args):
    file = runtime / "config.json"
    if file.exists():
        config = json.loads(file.read_text(encoding="utf-8"))
    else:
        host = args.host or "127.0.0.1"
        config = {"bind": "0.0.0.0", "lan_host": host, "port": 8790, "qbit_port": 8801,
                  "network": str(ipaddress.ip_network(host + "/24", strict=False)),
                  "library": str((ROOT / "library").resolve()), "max_gib": 20, "reserve_gib": 2, "autoplay": True}
    if args.host:
        config["lan_host"] = args.host
        config["network"] = str(ipaddress.ip_network(args.host + "/24", strict=False))
    if args.library:
        config["library"] = str(Path(args.library).resolve())
    if args.port is not None:
        config["port"] = args.port
    save_config(config, runtime)
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", help="PC helyi IPv4 címe")
    parser.add_argument("--library")
    parser.add_argument("--port", type=int)
    parser.add_argument("--init", action="store_true")
    parser.add_argument("--qbit-exe", default=r"C:\Program Files\qBittorrent\qbittorrent.exe")
    args = parser.parse_args()
    runtime = ROOT / "runtime"
    runtime.mkdir(exist_ok=True)
    config = load_config(runtime, args)
    secret_store = SecretStore(runtime / "secrets.dat")
    config["tmdb_token"] = secret_store.data.get("tmdb_token", "")
    create_profile(runtime / "qbit-profile", secret_store.data["qbit_password"], config["library"], config["qbit_port"])
    if args.init:
        print("Cinema TV konfiguráció és külön qBittorrent-profil létrehozva.")
        return
    server = CinemaServer(config, runtime)
    server.service.start()
    info = f"Cinema TV: http://{config['lan_host']}:{config['port']}\nPC-beállítás: http://127.0.0.1:{config['port']}\nPárosítókód (10 percig): {server.pairing.pin}\n"
    (runtime / "connection.txt").write_text(info, encoding="utf-8")
    (runtime / "server.pid").write_text(str(os.getpid()), encoding="ascii")
    print(info, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.service.closed.set()
        server.server_close()


if __name__ == "__main__":
    main()
