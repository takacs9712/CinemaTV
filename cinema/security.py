"""Pairing and expiring media tickets. Secrets remain in the ignored runtime directory."""
import base64
import ctypes
from ctypes import wintypes
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import threading
import time


def protect(data: bytes, decrypt=False) -> bytes:
    if os.name != "nt":
        return data

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    api = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not api(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.windll.kernel32.LocalFree(result.data)


class SecretStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        if path.exists():
            self.data = json.loads(protect(path.read_bytes(), decrypt=True))
        else:
            self.data = {"media_key": secrets.token_hex(32), "qbit_password": secrets.token_urlsafe(32), "devices": {}}
            self.save()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_bytes(protect(json.dumps(self.data).encode()))
        if os.name != "nt":
            temp.chmod(0o600)
        temp.replace(self.path)

    def issue_device(self, label):
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            self.data["devices"][digest] = {"label": str(label)[:80], "created": int(time.time())}
            self.save()
        return token

    def authorized(self, token):
        if not isinstance(token, str) or len(token) > 256:
            return False
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            return digest in self.data["devices"]

    def ticket(self, video_id, ttl=21600):
        expires = int(time.time()) + ttl
        content = f"{video_id}:{expires}"
        signature = hmac.new(bytes.fromhex(self.data["media_key"]), content.encode(), hashlib.sha256).hexdigest()
        return f"{expires}.{signature}"

    def valid_ticket(self, video_id, ticket):
        try:
            expires, signature = ticket.split(".")
            if int(expires) < time.time() or int(expires) > time.time() + 86400:
                return False
            expected = hmac.new(bytes.fromhex(self.data["media_key"]), f"{video_id}:{expires}".encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(expected, signature)
        except (ValueError, TypeError, AttributeError):
            return False


class Pairing:
    def __init__(self):
        self.lock = threading.Lock()
        self.pin = ""
        self.expires = 0
        self.attempts = {}
        self.renew()

    def renew(self):
        with self.lock:
            self.pin = f"{secrets.randbelow(1000000):06d}"
            self.expires = time.time() + 600
            self.attempts.clear()
            return self.pin

    def accept(self, address, pin):
        with self.lock:
            now = time.time()
            attempts = [t for t in self.attempts.get(address, []) if t > now - 60]
            self.attempts[address] = attempts + [now]
            if len(attempts) >= 5 or now > self.expires:
                return False
            return hmac.compare_digest(str(pin), self.pin)
