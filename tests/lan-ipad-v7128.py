#!/usr/bin/env python3
"""v7.128: an explicit LAN listener serves the same app on its actual local IP.

All files live in an isolated synthetic library. This never opens real media.
"""
import ipaddress
import pathlib
import re
import tempfile
import urllib.error
import urllib.request

from isolated import ROOT, launch, stop


def status(url, *, headers=None):
    # Do not route a private LAN test through runner or corporate HTTP proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with opener.open(request, timeout=10) as response:
            response.read()
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-lan-v7128-') as tmp:
        root = pathlib.Path(tmp)
        lib = root / 'library'
        lib.mkdir()
        (lib / 'safe-sample.txt').write_text('局域网测试', encoding='utf-8')
        proc = log = None
        try:
            proc, port, log = launch(ROOT / 'dist/douyin.js', lib,
                                     root / 'home', flags=('--lan',))
            local = f'http://127.0.0.1:{port}'
            assert status(local + '/manifest.webmanifest') == 200
            log_text = (root / 'home' / 'server.log').read_text(
                encoding='utf-8', errors='replace')
            matches = re.findall(r'局域网访问：http://(\d+(?:\.\d+){3}):(\d+)/', log_text)
            assert matches, 'LAN startup must show a device-accessible IP'
            addresses = [address for address, printed_port in matches
                         if int(printed_port) == port and
                         ipaddress.ip_address(address).is_private]
            assert addresses, matches
            lan = f'http://{addresses[0]}:{port}'
            assert status(lan + '/manifest.webmanifest') == 200, lan
            assert status(local + '/manifest.webmanifest',
                          headers={'Host':'untrusted.example:' + str(port)}) == 403
            assert status(lan + '/manifest.webmanifest',
                          headers={'Host':'192.168.99.99:' + str(port)}) == 403
            # A LAN same-origin reader call must pass CSRF validation and then
            # report its nonexistent synthetic book normally.
            reader = lan + '/api/reading/outline?id=0000000000000000'
            assert status(reader, headers={'Origin':lan}) in (400, 404), reader
            assert status(reader, headers={'Origin':'http://evil.example'}) == 403
            assert status(reader, headers={'Origin':f'http://{addresses[0]}:{port+1}'}) == 403
            print('PASS v7.128 real HTTP: loopback + private LAN, bound Host '
                  'and same-origin reader routes; ' + lan, flush=True)
        finally:
            if proc is not None:
                stop(proc, log)


if __name__ == '__main__':
    main()
