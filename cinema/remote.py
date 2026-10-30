"""Short lived commands between a local PC and explicitly enabled, paired receivers."""
import secrets
import threading
import time

SERVICES = frozenset(('netflix', 'youtube', 'prime', 'disney', 'max', 'apple', 'spotify', 'plex', 'jellyfin', 'emby'))


class RemoteHub:
    def __init__(self):
        self.lock = threading.RLock()
        self.receivers = {}

    def heartbeat(self, owner, label, status, ack=None, services=None):
        with self.lock:
            now = time.time()
            item = self.receivers.setdefault(owner, {'id': secrets.token_urlsafe(12), 'command': None})
            available = sorted({key for key in services if isinstance(key, str) and key in SERVICES}) if isinstance(services, list) else []
            item.update(label=str(label)[:80], status=str(status)[:160], seen=now, services=available)
            command = item['command']
            if command and (command['expires'] < now or command['id'] == ack):
                item['command'] = None
            return {'id': item['id'], 'command': item['command']}

    def list(self):
        with self.lock:
            now = time.time()
            return [{key: item[key] for key in ('id', 'label', 'status', 'services')} for item in self.receivers.values() if item['seen'] > now - 15]

    def send(self, identifier, action, video_id=None, service=None):
        if action not in ('play', 'pause', 'resume', 'stop', 'rewind', 'forward', 'launch-service'):
            raise ValueError('Ismeretlen távirányító-művelet.')
        with self.lock:
            now = time.time()
            item = next((r for r in self.receivers.values() if r['id'] == identifier and r['seen'] > now - 15), None)
            if item is None:
                raise ValueError('A TV nem jelentkezik. Nyisd meg rajta a Cinema TV-t és engedélyezd a fogadást.')
            if action == 'launch-service' and (not isinstance(service, str) or service not in SERVICES or service not in item['services']):
                raise ValueError('Ezt az alkalmazást a TV nem jelezte indíthatóként. Nyisd meg a telepített Cinema TV-t és frissítsd az alkalmazáslistát.')
            item['command'] = {'id': secrets.token_urlsafe(12), 'action': action, 'videoId': video_id, 'service': service if action == 'launch-service' else None, 'expires': now + 20}
            return item['command']['id']

    def disable(self, owner):
        with self.lock:
            self.receivers.pop(owner, None)
