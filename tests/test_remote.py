import json
import unittest
from unittest.mock import patch

from cinema.remote import RemoteHub
import test_service


class HubTest(unittest.TestCase):
    def test_streaming_requires_a_current_native_capability_and_cannot_send_arbitrary_app_ids(self):
        hub = RemoteHub()
        tv = hub.heartbeat('tv', 'Samsung', 'Ready', services=['netflix', 'factory-app', 'netflix', 5])
        browser = hub.heartbeat('browser', 'Browser', 'Ready')
        self.assertEqual(next(r for r in hub.list() if r['id'] == tv['id'])['services'], ['netflix'])
        for receiver, service in ((browser['id'], 'netflix'), (tv['id'], 'youtube'), (tv['id'], 'factory-app')):
            with self.assertRaises(ValueError):
                hub.send(receiver, 'launch-service', service=service)
        command_id = hub.send(tv['id'], 'launch-service', service='netflix')
        received = hub.heartbeat('tv', 'Samsung', 'Ready', services=['netflix'])['command']
        self.assertEqual(received['id'], command_id)
        self.assertEqual(received['service'], 'netflix')
        self.assertIsNone(hub.heartbeat('tv', 'Samsung', 'Launching', ack=command_id, services=['netflix'])['command'])
        hub.heartbeat('tv', 'Samsung', 'Ready', services=[])
        with self.assertRaises(ValueError):
            hub.send(tv['id'], 'launch-service', service='netflix')

    def test_command_is_owned_acknowledged_once_and_expires(self):
        hub = RemoteHub()
        with patch('cinema.remote.time.time', return_value=100):
            tv = hub.heartbeat('tv-token-hash', 'Samsung', 'Ready')
            hub.heartbeat('other-token-hash', 'Other', 'Ready')
            command_id = hub.send(tv['id'], 'play', 'movie')
            self.assertIsNone(hub.heartbeat('other-token-hash', 'Other', 'Ready')['command'])
            command = hub.heartbeat('tv-token-hash', 'Samsung', 'Ready')['command']
            self.assertEqual(command['videoId'], 'movie')
            self.assertIsNone(hub.heartbeat('tv-token-hash', 'Samsung', 'Playing', command_id)['command'])
            hub.send(tv['id'], 'pause')
        with patch('cinema.remote.time.time', return_value=121):
            self.assertEqual(hub.list(), [])
            self.assertIsNone(hub.heartbeat('tv-token-hash', 'Samsung', 'Ready')['command'])
        hub.disable('tv-token-hash')
        self.assertFalse(any(item['id'] == tv['id'] for item in hub.list()))


class RemoteHTTPTest(unittest.TestCase):
    setUp = test_service.HTTPTest.setUp
    tearDown = test_service.HTTPTest.tearDown
    request = test_service.HTTPTest.request

    def test_streaming_command_reaches_only_the_selected_capable_paired_receiver(self):
        headers = {'Authorization':'Bearer ' + self.token}
        _, _, body = self.request('/api/receiver', 'POST', {'label':'Samsung','services':['netflix']}, headers)
        receiver = json.loads(body)['id']
        payload = {'receiverId':receiver,'action':'launch-service','service':'netflix'}
        self.assertEqual(self.request('/api/remote', 'POST', payload, headers)[0], 200)
        _, _, body = self.request('/api/receiver', 'POST', {'services':['netflix']}, headers)
        self.assertEqual(json.loads(body)['command']['service'], 'netflix')
        payload['service'] = 'guessed-app-id'
        self.assertEqual(self.request('/api/remote', 'POST', payload, headers)[0], 400)

    def test_pc_command_requires_pairing_and_a_real_library_video(self):
        self.assertEqual(self.request('/api/remote', 'POST', {'action':'stop'})[0], 401)
        headers = {'Authorization':'Bearer ' + self.token}
        status, _, body = self.request('/api/receiver', 'POST', {'label':'TV','status':'Ready'}, headers)
        self.assertEqual(status, 200)
        receiver = json.loads(body)['id']
        payload = {'receiverId':receiver,'action':'play','videoId':self.identifier}
        self.assertEqual(self.request('/api/remote', 'POST', payload, headers)[0], 200)
        status, _, body = self.request('/api/receiver', 'POST', {'label':'TV','status':'Ready'}, headers)
        command = json.loads(body)['command']
        self.assertEqual(command['videoId'], self.identifier)
        status, _, body = self.request('/api/receiver', 'POST', {'label':'TV','status':'Playing','ack':command['id']}, headers)
        self.assertIsNone(json.loads(body)['command'])
        payload['videoId'] = 'not-a-library-video'
        self.assertNotEqual(self.request('/api/remote', 'POST', payload, headers)[0], 200)
        from cinema.server import Handler
        with patch.object(Handler, 'local_peer', return_value=False):
            self.assertEqual(self.request('/api/remote', 'POST', {'receiverId':receiver,'action':'stop'}, headers)[0], 403)


if __name__ == '__main__':
    unittest.main()
