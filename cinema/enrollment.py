"""Durable signed-widget identity and legacy short-lived enrollment grants."""
import hashlib
import hmac
import ipaddress
from pathlib import Path
import secrets
import sqlite3
import time

from .security import protect


class Enrollment:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS grants (digest TEXT PRIMARY KEY, peer TEXT NOT NULL, expires REAL NOT NULL, token BLOB)')
            db.execute('CREATE TABLE IF NOT EXISTS bindings (digest TEXT PRIMARY KEY, label TEXT UNIQUE NOT NULL, secret BLOB NOT NULL, token BLOB)')

    def provision(self, label):
        """A private signed widget holds its durable device credential, not an IP identity."""
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT digest,secret FROM bindings WHERE label=?', (label,)).fetchone()
            if row:
                return {'id':row[0], 'secret':protect(row[1], decrypt=True).decode()}
            secret = secrets.token_urlsafe(32)
            digest = hashlib.sha256(secret.encode()).hexdigest()
            db.execute('INSERT INTO bindings VALUES (?,?,?,NULL)', (digest, label, protect(secret.encode())))
            return {'id':digest, 'secret':secret}

    def proof(self, identifier, nonce):
        if not isinstance(identifier, str) or len(identifier) != 64 or not isinstance(nonce, str) or len(nonce) != 32:
            return None
        if any(c not in '0123456789abcdef' for c in identifier + nonce):
            return None
        with self.connection() as db:
            row = db.execute('SELECT secret FROM bindings WHERE digest=?', (identifier,)).fetchone()
        if not row:
            return None
        content = 'Cinema TV discovery:' + identifier + ':' + nonce
        return hmac.new(protect(row[0], decrypt=True), content.encode(), hashlib.sha256).hexdigest()

    def connection(self):
        return sqlite3.connect(self.path, timeout=10)

    def create(self, address, ttl=900):
        address = str(ipaddress.ip_address(address))
        secret = secrets.token_urlsafe(32)
        expires = time.time() + ttl
        digest = hashlib.sha256(secret.encode()).hexdigest()
        with self.connection() as db:
            db.execute('DELETE FROM grants WHERE peer=? OR expires<?', (address, time.time()))
            db.execute('INSERT INTO grants VALUES (?,?,?,NULL)', (digest, address, expires))
        return {'secret': secret, 'expires': expires}

    def redeem(self, secret, address, issue_token):
        if not isinstance(secret, str) or not 32 <= len(secret) <= 128:
            return None
        digest = hashlib.sha256(secret.encode()).hexdigest()
        with self.connection() as db:
            # Serialize retries across HTTP threads and separate provisioning processes.
            db.execute('BEGIN IMMEDIATE')
            binding = db.execute('SELECT token FROM bindings WHERE digest=?', (digest,)).fetchone()
            if binding:
                if binding[0] is not None:
                    return protect(binding[0], decrypt=True).decode()
                token = issue_token()
                db.execute('UPDATE bindings SET token=? WHERE digest=?', (protect(token.encode()), digest))
                return token
            row = db.execute('SELECT peer,expires,token FROM grants WHERE digest=?', (digest,)).fetchone()
            if not row or row[0] != address or row[1] < time.time():
                return None
            if row[2] is not None:
                return protect(row[2], decrypt=True).decode()
            token = issue_token()
            db.execute('UPDATE grants SET token=? WHERE digest=?', (protect(token.encode()), digest))
            return token

    def claimed(self):
        with self.connection() as db:
            return bool(db.execute('SELECT 1 FROM bindings WHERE token IS NOT NULL LIMIT 1').fetchone() or
                        db.execute('SELECT 1 FROM grants WHERE token IS NOT NULL AND expires>? LIMIT 1', (time.time(),)).fetchone())
