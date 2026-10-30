"""Write a private per-TV bootstrap into build output, never into served or committed sources."""
import argparse
import ipaddress
import json
from pathlib import Path
import sys
import socket

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from cinema.enrollment import Enrollment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tv-address', required=True)
    args = parser.parse_args()
    config = json.loads((ROOT / 'runtime' / 'config.json').read_text(encoding='utf-8'))
    address = ipaddress.ip_address(args.tv_address)
    if address not in ipaddress.ip_network(config['network']) or address.is_loopback:
        raise ValueError('A TV címe a beállított otthoni hálózatban legyen.')
    host = ipaddress.ip_address(config['lan_host'])
    grant = Enrollment(ROOT / 'runtime' / 'enrollment.sqlite3').provision('Samsung Cinema TV')
    bootstrap = {'server': 'http://' + str(host) + ':' + str(int(config['port'])),
                 'enrollment': grant['secret'], 'discoveryId':grant['id'],
                 'hostname':socket.gethostname().lower(), 'port':int(config['port'])}
    output = ROOT / 'tv' / '.buildResult' / 'bootstrap.js'
    if not output.parent.is_dir():
        raise ValueError('Először a Tizen web buildet kell futtatni.')
    output.write_text('window.CinemaBootstrap = ' + json.dumps(bootstrap) + ';\n', encoding='utf-8')
    print('Tartós automatikus TV-kapcsolat és hitelesített helyi PC-keresés előkészítve; nincs beírandó vagy lejáró TV-kód.')


if __name__ == '__main__':
    main()
