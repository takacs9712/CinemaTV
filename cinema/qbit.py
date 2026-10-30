"""Real qBittorrent WebUI v2 adapter, isolated to loopback."""
import base64
import hashlib
import http.cookiejar
import json
from pathlib import Path
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request


class Qbit:
    def __init__(self, port, password):
        self.base = f"http://127.0.0.1:{int(port)}/"
        self.password = password
        self.lock = threading.RLock()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, data=None, multipart=None, retry=True):
        with self.lock:
            body = None if data is None else urllib.parse.urlencode(data).encode()
            headers = {"Referer": self.base}
            if multipart:
                body, headers["Content-Type"] = multipart
            request = urllib.request.Request(self.base + "api/v2/" + method, data=body, headers=headers)
            try:
                with self.opener.open(request, timeout=15) as response:
                    value = response.read(16 * 1024 * 1024)
                return value.decode()
            except urllib.error.HTTPError as error:
                if error.code in (401, 403) and retry and method != "auth/login":
                    self.login()
                    return self.request(method, data, multipart, retry=False)
                raise RuntimeError(f"qBittorrent API hiba ({error.code}).") from None
            except (urllib.error.URLError, TimeoutError):
                raise RuntimeError("A qBittorrent nem érhető el. Indítsd a START-CINEMA-TV parancsot.") from None

    def login(self):
        reply = self.request("auth/login", {"username": "cinema", "password": self.password}, retry=False).strip()
        # qBittorrent 5.2 returns an empty body on success. Verify the authenticated session separately.
        if reply not in ("", "Ok."):
            raise RuntimeError("A Cinema TV qBittorrent-profil bejelentkezése sikertelen.")
        self.request("app/version", retry=False)

    def info(self):
        return json.loads(self.request("torrents/info"))

    def files(self, identifier):
        return json.loads(self.request("torrents/files?" + urllib.parse.urlencode({"hash": identifier})))

    def add(self, job_id, directory, torrent=None, magnet=None):
        fields = {"savepath": str(directory), "tags": "cinema-tv,ctv-" + job_id,
                  "autoTMM": "false", "stopped": "false", "contentLayout": "Original"}
        if magnet:
            fields.update(urls=magnet, stopCondition="MetadataReceived")
            result = self.request("torrents/add", fields)
        else:
            boundary = "CinemaTV" + secrets.token_hex(16)
            chunks = []
            for key, value in fields.items():
                chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
            chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="movie.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n'.encode(),
                       torrent, f'\r\n--{boundary}--\r\n'.encode()]
            result = self.request("torrents/add", multipart=(b"".join(chunks), "multipart/form-data; boundary=" + boundary))
        if result.strip() in ("", "Ok."):
            return None
        try:
            response = json.loads(result)
            if response.get("success_count", 0) + response.get("pending_count", 0) > 0:
                identifiers = response.get("added_torrent_ids", [])
                return identifiers[0] if identifiers else None
        except (ValueError, TypeError, AttributeError):
            pass
        raise ValueError("A qBittorrent nem fogadta el a torrentet.")

    def action(self, identifier, action):
        if action not in {"start", "stop"}:
            raise ValueError("Hibás torrentművelet.")
        self.request("torrents/" + action, {"hashes": identifier})


def torrent_size(data):
    """Bounded bencode metadata validation, never execute or fetch a torrent URL here."""
    if not 0 < len(data) <= 4 * 1024 * 1024:
        raise ValueError("A .torrent legfeljebb 4 MiB lehet.")
    offset, nodes = 0, 0

    def parse(depth=0):
        nonlocal offset, nodes
        nodes += 1
        if depth > 32 or nodes > 100000 or offset >= len(data):
            raise ValueError("Hibás vagy túl összetett torrent.")
        marker = data[offset:offset + 1]
        if marker == b"i":
            end = data.index(b"e", offset + 1)
            raw = data[offset + 1:end]
            if len(raw) > 20:
                raise ValueError("Túl nagy szám a torrentben.")
            offset = end + 1
            return int(raw)
        if marker in (b"l", b"d"):
            offset += 1
            result = [] if marker == b"l" else {}
            while data[offset:offset + 1] != b"e":
                key = parse(depth + 1)
                if marker == b"l":
                    result.append(key)
                else:
                    if not isinstance(key, bytes) or key in result:
                        raise ValueError("Hibás torrentkulcs.")
                    result[key] = parse(depth + 1)
            offset += 1
            return result
        colon = data.index(b":", offset)
        if colon - offset > 8:
            raise ValueError("Hibás torrenthossz.")
        length = int(data[offset:colon])
        if length < 0 or colon + 1 + length > len(data):
            raise ValueError("Hiányos torrent.")
        offset = colon + 1 + length
        return data[colon + 1:offset]

    def safe_name(value):
        if not isinstance(value, bytes):
            raise ValueError("Hibás fájlnév.")
        name = value.decode("utf-8", errors="strict")
        if not name or name in (".", "..") or any(c in name for c in "/\\:\x00"):
            raise ValueError("Nem biztonságos fájlútvonal a torrentben.")
        return name

    try:
        root = parse()
        if offset != len(data) or not isinstance(root, dict):
            raise ValueError("Érvénytelen torrent.")
        info = root[b"info"]
        title = safe_name(info[b"name"])
        if b"files" in info:
            files = info[b"files"]
            if not isinstance(files, list) or not 1 <= len(files) <= 10000:
                raise ValueError("Hibás fájllista.")
            sizes = []
            for file in files:
                if b"l" in file.get(b"attr", b""):
                    raise ValueError("Szimbolikus linket tartalmazó torrent nem támogatott.")
                for component in file[b"path"]:
                    safe_name(component)
                sizes.append(file[b"length"])
        elif b"length" in info:
            sizes = [info[b"length"]]
        else:
            raise ValueError("Ebben a kiadásban v1/hibrid .torrent szükséges; tisztán v2 torrentet adj hozzá a qBittorrent felületén.")
        if any(not isinstance(size, int) or size < 0 for size in sizes) or sum(sizes) <= 0:
            raise ValueError("Hibás torrentméret.")
        return sum(sizes), title
    except (KeyError, IndexError, TypeError, UnicodeError, ValueError) as error:
        raise ValueError(str(error) if isinstance(error, ValueError) else "Érvénytelen torrent metaadat.") from None


def create_profile(profile, password, library, port):
    config = Path(profile) / "qBittorrent" / "config" / "qBittorrent.ini"
    if config.exists():
        return
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha512", password.encode(), salt, 100000, dklen=64)
    encoded = base64.b64encode(salt).decode() + ":" + base64.b64encode(digest).decode()
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text("\n".join([
        "[LegalNotice]", "Accepted=true", "[Preferences]", "WebUI\\Enabled=true",
        "WebUI\\Address=127.0.0.1", f"WebUI\\Port={port}", "WebUI\\Username=cinema",
        f'WebUI\\Password_PBKDF2="@ByteArray({encoded})"', "WebUI\\LocalHostAuth=true",
        "WebUI\\AuthSubnetWhitelistEnabled=false", "WebUI\\UseUPnP=false",
        "WebUI\\ServerDomains=127.0.0.1;localhost", "General\\ShowSplashScreen=false",
        "General\\StartUpWindowState=Minimized", "General\\CloseToTray=true",
        "[Network]", "PortForwardingEnabled=false", "[BitTorrent]", "Session\\Port=49851",
        "Session\\DefaultSavePath=" + str(Path(library).resolve()).replace("\\", "/"),
        "Session\\MaxActiveDownloads=2", "Session\\GlobalMaxSeedingMinutes=-1",
        "Session\\GlobalMaxRatio=-1", ""]), encoding="utf-8")
