import concurrent.futures
import json
import hashlib
import hmac
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from cinema.enrollment import Enrollment
import test_service


class EnrollmentTest(unittest.TestCase):
    def test_durable_binding_survives_time_restart_and_tv_address_change(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'binding.sqlite3'
            store = Enrollment(path)
            grant = store.provision('own-tv')
            issuer = Mock(return_value='durable-device-token')
            self.assertEqual(store.redeem(grant['secret'], '192.168.1.60', issuer), 'durable-device-token')
            with patch('cinema.enrollment.time.time', return_value=9999999999):
                restarted = Enrollment(path)
                self.assertEqual(restarted.provision('own-tv'), grant)
                self.assertEqual(restarted.redeem(grant['secret'], '192.168.1.208', issuer), 'durable-device-token')
                self.assertEqual(issuer.call_count, 1)
                self.assertTrue(restarted.claimed())
                self.assertIsNone(restarted.redeem('x' * 43, '192.168.1.208', issuer))
            nonce = 'a' * 32
            expected = hmac.new(grant['secret'].encode(), ('Cinema TV discovery:' + grant['id'] + ':' + nonce).encode(), hashlib.sha256).hexdigest()
            self.assertEqual(store.proof(grant['id'], nonce), expected)
            self.assertNotEqual(store.proof(grant['id'], 'b' * 32), expected)
            for identifier, challenge in [(grant['id'], 'invalid'), ('0' * 64, nonce), (grant['id'], 'x' * 32)]:
                self.assertIsNone(store.proof(identifier, challenge))

    def test_wrong_peer_expiry_replacement_and_idempotent_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            enrollment = Enrollment(Path(temp) / 'enrollment.sqlite3')
            issuer = Mock(return_value='private-device-token')
            with patch('cinema.enrollment.time.time', return_value=100):
                grant = enrollment.create('192.168.1.60', ttl=10)
                self.assertIsNone(enrollment.redeem(grant['secret'], '192.168.1.61', issuer))
                self.assertIsNone(enrollment.redeem('wrong' * 10, '192.168.1.60', issuer))
                self.assertEqual(enrollment.redeem(grant['secret'], '192.168.1.60', issuer), 'private-device-token')
                self.assertEqual(enrollment.redeem(grant['secret'], '192.168.1.60', issuer), 'private-device-token')
                self.assertEqual(issuer.call_count, 1)
                self.assertTrue(enrollment.claimed())
            with patch('cinema.enrollment.time.time', return_value=111):
                self.assertIsNone(enrollment.redeem(grant['secret'], '192.168.1.60', issuer))
                self.assertFalse(enrollment.claimed())
                replacement = enrollment.create('192.168.1.60')
                newer = enrollment.create('192.168.1.60')
                self.assertIsNone(enrollment.redeem(replacement['secret'], '192.168.1.60', issuer))
                self.assertEqual(enrollment.redeem(newer['secret'], '192.168.1.60', issuer), 'private-device-token')

    def test_two_instances_and_concurrent_retries_issue_only_one_token(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'enrollment.sqlite3'
            issuer = Mock(return_value='one-device-token')
            first, second = Enrollment(path), Enrollment(path)
            grant = first.create('192.168.1.60')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(instance.redeem, grant['secret'], '192.168.1.60', issuer) for instance in (first, second)]
                self.assertEqual([future.result() for future in futures], ['one-device-token', 'one-device-token'])
            self.assertEqual(issuer.call_count, 1)


class EnrollmentHTTPTest(unittest.TestCase):
    setUp = test_service.HTTPTest.setUp
    tearDown = test_service.HTTPTest.tearDown
    request = test_service.HTTPTest.request

    def test_authenticated_discovery_never_exposes_device_credentials(self):
        grant = self.server.enrollment.provision('own-tv')
        status, _, body = self.request('/api/discover?id=' + grant['id'] + '&nonce=' + 'a' * 32, headers={'Origin':'file://'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['proof'], self.server.enrollment.proof(grant['id'], 'a' * 32))
        self.assertNotIn(grant['secret'].encode(), body)
        self.assertEqual(self.request('/api/discover?id=' + grant['id'] + '&nonce=bad')[0], 404)
        status, _, body = self.request('/api/auto-pair', 'POST', {'secret':grant['secret']}, {'Origin':'file://'})
        self.assertEqual(status, 200)
        token = json.loads(body)['token']
        self.assertEqual(self.request('/api/settings', headers={'Authorization':'Bearer ' + token})[0], 200)
        self.assertNotIn(token.encode(), self.request('/api/discover?id=' + grant['id'] + '&nonce=' + 'a' * 32)[2])

    def test_native_bootstrap_pairs_and_authorizes_without_a_pin(self):
        grant = self.server.enrollment.create('127.0.0.1')
        status, _, body = self.request('/api/auto-pair', 'POST', {'secret':grant['secret']}, {'Origin':'null'})
        self.assertEqual(status, 200)
        token = json.loads(body)['token']
        self.assertEqual(self.request('/api/settings', headers={'Authorization':'Bearer ' + token})[0], 200)
        status, _, retry = self.request('/api/auto-pair', 'POST', {'secret':grant['secret']})
        self.assertEqual(json.loads(retry)['token'], token)
        self.assertTrue(json.loads(self.request('/api/local-pairing')[2])['auto_paired'])

    def test_source_bootstrap_never_exposes_private_deployment_grants_and_spoofed_peer_is_rejected(self):
        grant = self.server.enrollment.create('192.168.1.60')
        status, _, body = self.request('/api/auto-pair', 'POST', {'secret':grant['secret']}, {'X-Forwarded-For':'192.168.1.60'})
        self.assertEqual(status, 403)
        status, _, source = self.request('/bootstrap.js')
        self.assertEqual(status, 200)
        self.assertNotIn(grant['secret'].encode(), source)
        self.assertEqual(self.request('/runtime/enrollment.sqlite3')[0], 404)

    def test_packaged_tizen_file_origin_preflight_and_authenticated_requests(self):
        origin = {'Origin':'file://'}
        status, headers, _ = self.request('/api/auto-pair', 'OPTIONS', headers=origin)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'file://')
        self.assertIn('Authorization', headers['Access-Control-Allow-Headers'])
        grant = self.server.enrollment.create('127.0.0.1')
        status, headers, body = self.request('/api/auto-pair', 'POST', {'secret':grant['secret']}, origin)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'file://')
        token = json.loads(body)['token']
        self.assertEqual(self.request('/api/settings', headers={**origin, 'Authorization':'Bearer ' + token})[0], 200)
        self.assertEqual(self.request('/api/settings', headers=origin)[0], 401)
        for bad_origin in ('file://attacker.invalid', 'https://attacker.invalid'):
            self.assertEqual(self.request('/api/auto-pair', 'OPTIONS', headers={'Origin':bad_origin})[0], 403)
            self.assertEqual(self.request('/api/health', headers={'Origin':bad_origin})[0], 403)
        self.assertEqual(self.request('/api/health', headers={**origin, 'Host':'attacker.invalid'})[0], 403)


if __name__ == '__main__':
    unittest.main()
