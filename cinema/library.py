import hashlib
import json
import mimetypes
from pathlib import Path
import sqlite3
import threading
import time

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".m4v", ".webm", ".avi", ".mov", ".ts"}


def within(root, file):
    root, file = Path(root).resolve(), Path(file).resolve()
    try:
        file.relative_to(root)
        return file != root
    except ValueError:
        return False


class Library:
    def __init__(self, root, database):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = str(database)
        self.lock = threading.RLock()
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS videos (
                    id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
                    bytes INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1,
                    position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0,
                    favorite INTEGER NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0,
                    last_played INTEGER NOT NULL DEFAULT 0, movie_id TEXT
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, hash TEXT, movie_id TEXT, title TEXT NOT NULL,
                    directory TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                    error TEXT, auto_resume INTEGER NOT NULL DEFAULT 1
                );
            """)

    def connection(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def register(self, path, title=None, movie_id=None):
        path = Path(path).resolve()
        if not within(self.root, path) or not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError("A videó nincs az engedélyezett médiamappában.")
        relative = path.relative_to(self.root).as_posix()
        identifier = hashlib.sha256(relative.encode()).hexdigest()[:32]
        with self.lock, self.connection() as db:
            db.execute("""INSERT INTO videos(id,path,title,bytes,movie_id) VALUES(?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes,available=1,
                movie_id=COALESCE(excluded.movie_id,videos.movie_id)""",
                (identifier, relative, title or path.stem.replace(".", " "), path.stat().st_size, movie_id))
        return identifier

    def scan(self):
        found = []
        # Torrent files enter the library only after qBittorrent reports the entire job complete.
        for path in self.root.rglob("*"):
            if ".cinema-downloads" in path.relative_to(self.root).parts or path.is_symlink():
                continue
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS and within(self.root, path):
                found.append(path)
        with self.lock, self.connection() as db:
            for row in db.execute("SELECT id,path FROM videos").fetchall():
                path = self.root / row["path"]
                db.execute("UPDATE videos SET available=? WHERE id=?", (int(path.is_file() and within(self.root, path)), row["id"]))
        for path in found:
            self.register(path)
        return len(found)

    def list(self):
        with self.connection() as db:
            rows = db.execute("SELECT * FROM videos WHERE available=1 ORDER BY title COLLATE NOCASE").fetchall()
        return [{k: row[k] for k in row.keys() if k != "path"} for row in rows]

    def file(self, identifier):
        with self.connection() as db:
            row = db.execute("SELECT path,available FROM videos WHERE id=?", (identifier,)).fetchone()
        if not row or not row["available"]:
            raise FileNotFoundError("A videó nem található.")
        path = (self.root / row["path"]).resolve()
        if not within(self.root, path) or not path.is_file():
            raise FileNotFoundError("A videó nem érhető el.")
        return path

    def progress(self, identifier, position, duration):
        position, duration = float(position), float(duration)
        import math
        if not all(math.isfinite(x) and 0 <= x <= 7 * 86400 for x in [position, duration]):
            raise ValueError("Hibás lejátszási pozíció.")
        watched = duration > 0 and position >= duration * .95
        with self.lock, self.connection() as db:
            db.execute("UPDATE videos SET position=?,duration=?,watched=?,last_played=? WHERE id=?",
                       (position, duration, int(watched), int(time.time()), identifier))

    def favorite(self, identifier):
        with self.lock, self.connection() as db:
            db.execute("UPDATE videos SET favorite=1-favorite WHERE id=?", (identifier,))

    def jobs(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY rowid DESC")]

    def add_job(self, identifier, title, directory, movie_id=None):
        with self.lock, self.connection() as db:
            db.execute("INSERT INTO jobs(id,title,directory,movie_id) VALUES(?,?,?,?)", (identifier, title, str(directory), movie_id))

    def update_job(self, identifier, **values):
        allowed = {"hash", "status", "error", "auto_resume"}
        if not values or not set(values) <= allowed:
            raise ValueError("Hibás munkamódosítás.")
        with self.lock, self.connection() as db:
            db.execute("UPDATE jobs SET " + ",".join(k + "=?" for k in values) + " WHERE id=?", [*values.values(), identifier])


def parse_range(value, size):
    """One RFC 9110 byte range; reject malformed/unsatisfiable requests."""
    if value is None:
        return 0, size - 1, False
    import re
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or size <= 0 or not any(match.groups()):
        raise ValueError("Invalid Range")
    first, last = match.groups()
    if first:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
        if start >= size or end < start:
            raise ValueError("Unsatisfiable Range")
    else:
        count = int(last)
        if count <= 0:
            raise ValueError("Invalid suffix")
        start, end = max(0, size - count), size - 1
    return start, end, True
