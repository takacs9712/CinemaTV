import hashlib
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from cinema.library import Library, parse_range, within
from cinema.qbit import torrent_size
from cinema.qbit import Qbit
from cinema.security import Pairing, SecretStore, protect
from cinema.server import CinemaServer


def encode(value):
    if isinstance(value, int): return b"i" + str(value).encode() + b"e"
    if isinstance(value, str): value = value.encode()
    if isinstance(value, bytes): return str(len(value)).encode() + b":" + value
    if isinstance(value, list): return b"l" + b"".join(encode(v) for v in value) + b"e"
    return b"d" + b"".join(encode(k) + encode(v) for k, v in sorted(value.items())) + b"e"


class RangeTest(unittest.TestCase):
    def test_full_open_suffix_and_bounded(self):
        self.assertEqual(parse_range(None, 100), (0, 99, False))
        self.assertEqual(parse_range("bytes=10-19", 100), (10, 19, True))
        self.assertEqual(parse_range("bytes=90-", 100), (90, 99, True))
        self.assertEqual(parse_range("bytes=-10", 100), (90, 99, True))
        self.assertEqual(parse_range("bytes=90-500", 100), (90, 99, True))
    def test_malformed_and_unsatisfiable(self):
        for value in ("bytes=100-", "bytes=-0", "bytes=50-10", "bytes=0-5,10-20", "bytes=-", "words=0-10"):
            with self.assertRaises(ValueError): parse_range(value, 100)


class TorrentTest(unittest.TestCase):
    def test_qbittorrent_legacy_and_52_add_responses(self):
        for reply in ("Ok.", "", '{"success_count":1,"failure_count":0,"pending_count":0,"added_torrent_ids":["abc"]}'):
            client = Qbit(8801, "test")
            client.request = lambda *a, **k: reply
            self.assertIn(client.add("job", Path("test"), torrent=b"test"), (None, "abc"))
        client.request = lambda *a, **k: "Fails."
        with self.assertRaises(ValueError): client.add("job", Path("test"), torrent=b"test")
    def test_real_bencoded_single_and_multifile(self):
        data = encode({b"info": {b"name": b"movie.mp4", b"length": 123, b"piece length": 16384, b"pieces": b"x" * 20}})
        self.assertEqual(torrent_size(data), (123, "movie.mp4"))
        data = encode({b"info": {b"name": b"movie", b"files": [{b"length": 100, b"path": [b"movie.mkv"]}, {b"length": 10, b"path": [b"subtitle.srt"]}]}})
        self.assertEqual(torrent_size(data)[0], 110)
    def test_rejects_traversal_and_symlink(self):
        for path in (b"..", b"C:evil", b"/outside", b"x\\outside"):
            with self.assertRaises(ValueError): torrent_size(encode({b"info": {b"name": b"movie", b"files": [{b"length": 1, b"path": [path]}]}}))
        with self.assertRaises(ValueError): torrent_size(encode({b"info": {b"name": b"movie", b"files": [{b"length": 1, b"path": [b"film"], b"attr": b"l"}]}}))


class HTTPTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.media = self.root / "library"
        self.config = {"library": str(self.media), "network": "127.0.0.0/8", "bind": "127.0.0.1", "port": 0,
                       "lan_host": "127.0.0.1", "qbit_port": 9, "max_gib": 20, "reserve_gib": 2, "autoplay": True}
        self.server = CinemaServer(self.config, self.root)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.video = self.media / "sample.mp4"
        self.video.write_bytes(bytes(range(256)) * 4)
        self.server.library.scan()
        self.identifier = self.server.library.list()[0]["id"]
        self.token = self.server.secrets.issue_device("test")

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = headers or {}
        if data is not None:
            data = json.dumps(data)
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=data, headers=headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_unauthorized_and_host_rebinding_rejected(self):
        self.assertEqual(self.request("/api/library")[0], 401)
        self.assertEqual(self.request("/api/health", headers={"Host": "attacker.invalid"})[0], 403)
        self.assertEqual(self.request("/api/health", headers={"Origin": "https://attacker.invalid"})[0], 403)

    def test_pairing_and_media_ticket_range(self):
        status, _, data = self.request("/api/pair", "POST", {"pin": self.server.pairing.pin, "label": "TV"})
        self.assertEqual(status, 200)
        token = json.loads(data)["token"]
        status, _, data = self.request("/api/play", "POST", {"id": self.identifier}, {"Authorization": "Bearer " + token})
        self.assertEqual(status, 200)
        path = json.loads(data)["path"]
        status, headers, body = self.request(path, headers={"Range": "bytes=15-31"})
        self.assertEqual(status, 206)
        self.assertEqual(headers["Content-Range"], "bytes 15-31/1024")
        self.assertEqual(body, self.video.read_bytes()[15:32])
        self.assertEqual(self.request(path, headers={"Range": "bytes=2000-"})[0], 416)
        self.assertEqual(self.request(path, method="HEAD")[2], b"")
        self.assertEqual(self.request("/media/" + self.identifier)[0], 401)

    def test_secrets_and_paths_are_not_exposed(self):
        status, _, data = self.request("/api/library", headers={"Authorization": "Bearer " + self.token})
        self.assertEqual(status, 200)
        self.assertNotIn(b'"path"', data)
        for path in ("/runtime/secrets.dat", "/../runtime/config.json", "/%2e%2e/runtime/config.json"):
            self.assertEqual(self.request(path)[0], 404)

    def test_incomplete_downloads_are_not_indexed(self):
        pending = self.media / ".cinema-downloads" / "job" / "incomplete.mp4"
        pending.parent.mkdir(parents=True)
        pending.write_bytes(b"not yet complete")
        self.server.library.scan()
        self.assertEqual(len(self.server.library.list()), 1)

    def test_watch_position_persists_and_disconnected_file_is_hidden(self):
        self.server.library.progress(self.identifier, 50, 100)
        restored = Library(self.media, self.root / "library.sqlite3")
        self.assertEqual(restored.list()[0]["position"], 50)
        self.video.unlink(); restored.scan()
        self.assertEqual(restored.list(), [])


class SecurityTest(unittest.TestCase):
    def test_pairing_rate_limit_and_ticket_tampering(self):
        pairing = Pairing()
        for _ in range(5): self.assertFalse(pairing.accept("client", "wrong"))
        self.assertFalse(pairing.accept("client", pairing.pin))
        self.assertTrue(pairing.accept("another", pairing.pin))
        with tempfile.TemporaryDirectory() as temp:
            store = SecretStore(Path(temp) / "secrets.dat")
            ticket = store.ticket("video")
            self.assertTrue(store.valid_ticket("video", ticket))
            self.assertFalse(store.valid_ticket("another", ticket))
            self.assertFalse(store.valid_ticket("video", ticket + "x"))
            self.assertFalse(store.valid_ticket("video", store.ticket("video", ttl=-1)))
    def test_windows_encryption_roundtrip(self):
        payload = b"private configuration"
        self.assertEqual(protect(protect(payload), decrypt=True), payload)


if __name__ == "__main__":
    unittest.main()
