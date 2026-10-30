"""Locate the developer endpoint on the configured home LAN, without asking for a TV IP."""
import concurrent.futures
import ipaddress
import json
from pathlib import Path
import socket

ROOT = Path(__file__).resolve().parent.parent


def find(network):
    network = ipaddress.ip_network(network)
    if network.num_addresses > 1024 or not network.is_private:
        raise ValueError('A keresés legfeljebb 1024 címes privát otthoni hálózaton támogatott.')

    def probe(address):
        try:
            with socket.create_connection((str(address), 26101), timeout=.4):
                return str(address)
        except OSError:
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        return [address for address in pool.map(probe, network.hosts()) if address]


if __name__ == '__main__':
    config = json.loads((ROOT / 'runtime' / 'config.json').read_text(encoding='utf-8'))
    print(json.dumps({'developer_endpoints':find(config['network'])}))
