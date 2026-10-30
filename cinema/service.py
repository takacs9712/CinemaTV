import json
from pathlib import Path
import secrets
import shutil
import threading
import time
import urllib.parse
import urllib.request

from .library import VIDEO_EXTENSIONS, within
from .qbit import torrent_size

GIB = 1024 ** 3


class Service:
    def __init__(self, config, library, qbit):
        self.config, self.library, self.qbit = config, library, qbit
        self.lock = threading.RLock()
        self.downloads = []
        self.qbit_error = None
        self.closed = threading.Event()
        self.worker = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self.library.scan()
        self.worker.start()

    def check_size(self, size, remaining=None):
        maximum = int(self.config["max_gib"]) * GIB
        reserve = int(self.config["reserve_gib"]) * GIB
        if not 0 < size <= maximum:
            raise ValueError(f"A teljes torrent mérete legfeljebb {self.config['max_gib']} GiB lehet.")
        if (size if remaining is None else remaining) > shutil.disk_usage(self.library.root).free - reserve:
            raise ValueError("Nincs elég szabad hely a PC médiameghajtóján a tartalékkal együtt.")

    def add(self, torrent=None, magnet=None, title=None, movie_id=None):
        if torrent:
            size, detected = torrent_size(torrent)
            self.check_size(size)
            title = title or detected
        elif magnet:
            if len(magnet) > 16384 or not magnet.startswith("magnet:?"):
                raise ValueError("Érvénytelen magnet link.")
            title = title or "Magnet · metaadatok keresése"
        else:
            raise ValueError("Torrentfájl vagy magnet link szükséges.")
        identifier = secrets.token_hex(12)
        directory = self.library.root / ".cinema-downloads" / identifier
        directory.mkdir(parents=True)
        # A separate directory prevents different torrents with equal filenames from overwriting each other.
        self.library.add_job(identifier, title, directory, movie_id)
        try:
            torrent_hash = self.qbit.add(identifier, directory, torrent, magnet)
            self.library.update_job(identifier, hash=torrent_hash, status="metadata" if magnet else "downloading")
        except Exception as error:
            self.library.update_job(identifier, status="error", error=str(error), auto_resume=0)
            raise
        return identifier

    def action(self, identifier, action):
        job = next((j for j in self.library.jobs() if j["id"] == identifier), None)
        if not job or not job["hash"]:
            raise ValueError("A torrent még nincs kész a vezérlésre.")
        if action not in ("start", "stop"):
            raise ValueError("Hibás művelet.")
        if action == "start":
            files = self.qbit.files(job["hash"])
            self.validate_files(job, files)
            size = sum(f["size"] for f in files)
            self.check_size(size, sum(int(f["size"] * (1 - f.get("progress", 0))) for f in files))
        self.qbit.action(job["hash"], action)
        self.library.update_job(identifier, auto_resume=int(action == "start"), error=None,
                                status="downloading" if action == "start" else "paused")

    def validate_files(self, job, files):
        if not 0 < len(files) <= 10000:
            raise ValueError("Hibás vagy túl nagy torrentfájllista.")
        for item in files:
            relative = item["name"]
            if (not isinstance(relative, str) or "\\" in relative or ":" in relative or
                    any(part in (".", "..") for part in relative.split("/")) or
                    not within(job["directory"], Path(job["directory"]) / relative)):
                raise ValueError("Nem biztonságos fájlútvonal a torrentben.")

    def update(self):
        torrents = self.qbit.info()
        result = []
        for job in self.library.jobs():
            item = next((t for t in torrents if "ctv-" + job["id"] in [s.strip() for s in t.get("tags", "").split(",")]), None)
            if item is None:
                result.append({"id": job["id"], "title": job["title"], "status": job["status"], "progress": 0,
                               "error": job["error"] or "A torrent még nem érhető el a letöltőben."})
                continue
            identifier = item["hash"]
            if job["hash"] != identifier:
                self.library.update_job(job["id"], hash=identifier)
                job["hash"] = identifier
            state = item["state"]
            ready = item.get("progress", 0) >= 1 and not state.startswith("checking") and state not in ("error", "missingFiles", "moving")
            files = None
            if job["status"] == "metadata" and item.get("total_size", 0) > 0 and "meta" not in state.lower():
                # qBittorrent stops a magnet at metadata. Enforce actual size and paths before payload download.
                try:
                    files = self.qbit.files(identifier)
                    self.validate_files(job, files)
                    self.check_size(sum(f["size"] for f in files))
                    self.qbit.action(identifier, "start")
                    self.library.update_job(job["id"], status="downloading", error=None)
                except (ValueError, RuntimeError) as error:
                    self.qbit.action(identifier, "stop")
                    self.library.update_job(job["id"], status="error", error=str(error), auto_resume=0)
                    job["error"] = str(error)
            video_id = None
            if ready:
                files = files or self.qbit.files(identifier)
                self.validate_files(job, files)
                videos = [f for f in files if Path(f["name"]).suffix.lower() in VIDEO_EXTENSIONS and f.get("progress", 0) >= 1]
                for file in videos:
                    path = Path(job["directory"]) / file["name"]
                    if not path.is_file() or path.stat().st_size != file["size"]:
                        continue
                    registered = self.library.register(path, movie_id=job["movie_id"])
                    if file == max(videos, key=lambda f: f["size"]):
                        video_id = registered
                self.library.update_job(job["id"], status="complete", error=None)
            result.append({"id": job["id"], "title": job["title"], "status": "complete" if ready else state,
                           "progress": item.get("progress", 0), "downloadSpeed": item.get("dlspeed", 0),
                           "uploadSpeed": item.get("upspeed", 0), "eta": item.get("eta"),
                           "bytes": item.get("total_size", 0), "error": job["error"], "videoId": video_id})
        with self.lock:
            self.downloads = result
            self.qbit_error = None

    def run(self):
        while not self.closed.is_set():
            try:
                self.update()
            except Exception:
                with self.lock:
                    self.qbit_error = "A qBittorrent nem érhető el. Ellenőrizd a START-CINEMA-TV indítást."
            self.closed.wait(3)

    def snapshot(self):
        with self.lock:
            return {"jobs": list(self.downloads), "error": self.qbit_error}

    def tmdb(self, query=""):
        token = self.config.get("tmdb_token", "")
        if not token:
            return []
        endpoint = "search/movie" if query else "movie/popular"
        params = {"language": "hu-HU"}
        if query:
            params["query"] = query[:200]
        request = urllib.request.Request("https://api.themoviedb.org/3/" + endpoint + "?" + urllib.parse.urlencode(params),
                                         headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.load(response)
            return [{"id": "tmdb-" + str(item["id"]), "movieId": str(item["id"]), "title": item["title"],
                     "year": item.get("release_date", "")[:4], "overview": item.get("overview", ""),
                     "poster": "https://image.tmdb.org/t/p/w342" + item["poster_path"] if item.get("poster_path") else None,
                     "backdrop": "https://image.tmdb.org/t/p/w1280" + item["backdrop_path"] if item.get("backdrop_path") else None}
                    for item in data.get("results", [])]
        except Exception:
            raise ValueError("A TMDb nem érhető el; ellenőrizd a tokent és az internetkapcsolatot.") from None
