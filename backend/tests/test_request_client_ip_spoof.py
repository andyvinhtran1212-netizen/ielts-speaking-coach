"""SA-1029-XFF1 (PC-J142): the per-client key must not be caller-chosen.

Staging measurement (SA 29/10, one HTTP/2 connection, POST /tts): with
"X-Forwarded-For: <random>, <random>" 65 requests passed the 60/min burst
throttle; the key was the caller's LEFTMOST hop, because for a Cloudflare
(WARP) egress Railway's edge derives X-Real-IP from it. One rule
(services.request_safety.client_address) keys RequestSafetyMiddleware
(/api/error-logs, /api/analytics/events), the /tts throttle and Reading's
anon_src: rightmost untrusted XFF hop → X-Real-IP → peer (PC-J202/J183).

EDGE stands for the hop Railway's edge appends (the caller's real address).
Only explicitly configured proxy CIDRs may be skipped. Non-global and invalid
rightmost hops must never let the scan cross into caller-controlled input.
"""
import ipaddress
import random

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.requests import Request as StarletteRequest

from config import Settings, settings
from pydantic import ValidationError
from routers import reading_student
from routers import tts as tts_module
from services import request_safety
from services.request_safety import RequestSafetyMiddleware, client_address, request_client_ip

EDGE = '52.95.110.1'
OTHER_EDGE = '34.117.59.81'
EDGE_V6 = '2a09:bac5:d46e:a0::10:485'


@pytest.fixture(autouse=True)
def no_implicit_proxy_trust(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '')


def _random_global_ipv4(rng):
    while True:
        ip = ipaddress.IPv4Address(rng.getrandbits(32))
        if ip.is_global:
            return str(ip)


def _random_hops(seed, count=100):
    """Caller-chosen values: public IPv4/IPv6, private, CGNAT and junk."""
    rng = random.Random(seed)
    makers = (
        lambda: _random_global_ipv4(rng),
        lambda: str(ipaddress.IPv6Address((0x2001 << 112) | rng.getrandbits(112))),
        lambda: f'10.{rng.randrange(256)}.{rng.randrange(256)}.{rng.randrange(256)}',
        lambda: f'100.{rng.randrange(64, 128)}.{rng.randrange(256)}.{rng.randrange(256)}',
        lambda: f'{_random_global_ipv4(rng)}:{rng.randrange(1, 65536)}',
        lambda: rng.choice(['unknown', '<script>', 'x' * 300, '', ' ', '[::1]']),
    )
    return [makers[i % len(makers)]() for i in range(count)]


def _request(headers=(), peer='198.18.0.1'):
    """A real Starlette Request, so repeated header lines behave as in prod."""
    return StarletteRequest({
        'type': 'http', 'method': 'POST', 'path': '/', 'query_string': b'',
        'headers': [(k.lower().encode('latin-1'), v.encode('latin-1')) for k, v in headers],
        'client': (peer, 443) if peer else None,
    })


# ── Helper: one rule, caller hops never choose the key ─────────────────────

def test_rotating_the_first_forwarded_hop_never_changes_the_key():
    keys = {client_address(None, f'{spoof}, {EDGE}', 'peer') for spoof in _random_hops(1)}
    assert keys == {EDGE}


def test_spoofed_real_ip_does_not_override_a_public_forwarded_hop():
    # The measured attack: X-Real-IP is copied from the caller's first hop.
    for spoof in _random_hops(2):
        assert client_address(spoof, f'{spoof}, {EDGE}', 'peer') == EDGE
        assert client_address(spoof, EDGE, 'peer') == EDGE


def test_real_ip_without_forwarded_header_is_the_key():
    # Fallback contract, not proof of edge authenticity: J179 tracks the
    # CF-Connecting-IP/WARP spoofing path; J177's edge probes gate promotion.
    assert client_address(EDGE, None, 'peer') == EDGE
    assert client_address(EDGE, '', 'peer') == EDGE
    assert client_address(f' {EDGE} ', ' , ', 'peer') == EDGE


@pytest.mark.parametrize('junk', ['unknown', '<script>', 'x' * 300, '', ' ', ',,,',
                                  '1.2.3.4.5', '999.1.1.1', 'for=1.2.3.4', '[::1'])
def test_invalid_hop_stops_the_scan_and_never_becomes_a_key(junk):
    assert client_address(None, f'{junk}, {EDGE}', 'peer') == EDGE
    assert client_address(None, f'{EDGE}, {junk}', 'peer') == 'peer'
    assert client_address(OTHER_EDGE, f'{EDGE}, {junk}', 'peer') == OTHER_EDGE
    assert client_address(junk, junk, 'peer') == 'peer'
    assert client_address(junk, None, None) is None


def test_ports_and_brackets_are_stripped_to_the_address():
    assert client_address(None, f'{EDGE}:443', 'peer') == EDGE
    assert client_address(f'{EDGE}:80', None, 'peer') == EDGE
    assert client_address(None, f'[{EDGE_V6}]:443', 'peer') == client_address(None, EDGE_V6, 'peer')
    assert client_address(None, f'[{EDGE_V6}]', 'peer') == client_address(None, EDGE_V6, 'peer')
    assert client_address(None, f'::ffff:{EDGE}', 'peer') == EDGE
    # Valid loopback keys unless it is explicitly configured as trusted.
    assert client_address(None, f'{EDGE}, [::1]', 'peer') == '::/64'
    assert client_address(None, f'{EDGE}:http', 'peer') == 'peer'


def test_every_key_is_an_address_or_the_peer():
    for spoof in _random_hops(3, 300):
        for key in (client_address(spoof, spoof, 'peer'),
                    client_address(None, f'{spoof}, {spoof}', 'peer')):
            if key != 'peer':
                ipaddress.ip_network(key)  # raises for anything caller-shaped


def test_ipv6_is_keyed_per_64():
    same = {client_address(None, ip, 'peer') for ip in (
        '2001:4860:4860:1::1', '2001:4860:4860:1:ffff:ffff:ffff:fffe', '[2001:4860:4860:1::9]:443')}
    assert same == {'2001:4860:4860:1::/64'}
    assert client_address(None, '2001:4860:4860:2::1', 'peer') == '2001:4860:4860:2::/64'


def test_only_configured_internal_hops_after_the_edge_are_skipped(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '100.64.0.0/10,10.0.0.0/8')
    for spoof in _random_hops(4, 30):
        assert client_address(None, f'{spoof}, {EDGE}, 100.64.3.4, 10.1.2.3', 'peer') == EDGE
    assert client_address(None, f'{OTHER_EDGE}, 100.64.3.4', 'peer') == OTHER_EDGE


def test_private_untrusted_hop_wins_over_real_ip():
    assert client_address(EDGE, '10.0.0.1', 'peer') == '10.0.0.1'
    assert client_address(None, '10.0.0.9, 10.0.0.1', 'peer') == '10.0.0.1'


@pytest.mark.parametrize('edge', ['10.0.0.5', '100.64.3.3', '203.0.113.20',
                                 '127.0.0.1', '169.254.1.1', 'fc00::5', 'fe80::5'])
def test_non_global_untrusted_hop_never_lets_a_caller_public_hop_win(edge):
    # PC-J202 reverses the unsafe PC-J176 trade-off. Globalness is irrelevant.
    expected = edge if ':' not in edge else str(ipaddress.ip_network(edge + '/64', strict=False))
    for spoof in _random_hops(6, 40):
        assert client_address(OTHER_EDGE, f'{spoof}, {edge}', 'peer') == expected


@pytest.mark.parametrize('cidr,proxy,outside', [
    ('10.0.0.0/8', '10.0.0.5', '11.0.0.5'),
    ('100.64.0.0/10', '100.127.255.255', '100.128.0.0'),
    ('192.168.0.0/16', '192.168.255.255', '192.169.0.0'),
    ('172.16.0.0/12', '172.31.255.255', '172.32.0.0'),
    ('127.0.0.0/8', '127.0.0.1', '128.0.0.1'),
    ('203.0.113.9/32', '203.0.113.9', '203.0.113.10'),
    ('fc00::/7', 'fdff::5', 'fe00::5'),
    ('fe80::/10', 'febf::5', 'fec0::5'),
    ('::1/128', '::1', '::2'),
    ('2001:db8:1::/48', '2001:db8:1::1', '2001:db8:2::1'),
])
def test_configured_proxy_skips_exactly_one_hop_and_stops_at_untrusted(cidr, proxy, outside, monkeypatch):
    # Synthetic configurations only: none of these ranges is trusted by default.
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', cidr)
    for spoof in ('9.9.9.9', '9.9.9.10'):
        assert client_address(EDGE, f'{spoof}, 203.0.113.20, {proxy}', 'peer') == '203.0.113.20'
    expected = outside if ':' not in outside else str(ipaddress.ip_network(outside + '/64', strict=False))
    assert client_address(EDGE, f'9.9.9.9, {outside}', 'peer') == expected
    if ':' not in proxy:
        assert client_address(None, f'203.0.113.20, ::ffff:{proxy}', 'peer') == '203.0.113.20'


def test_trusted_proxy_does_not_skip_an_invalid_neighbor(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    for junk in ('unknown', '', ' ', 'bad-ip'):
        for spoof in _random_hops(7, 10):
            assert client_address(EDGE, f'{spoof}, {junk}, 10.0.0.1', 'peer') == EDGE
            assert client_address(None, f'{spoof}, {junk}, 10.0.0.1', 'peer') == 'peer'


def test_all_trusted_hops_fall_back_to_real_ip_then_peer(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    assert client_address(EDGE, '10.0.0.2, 10.0.0.1', OTHER_EDGE) == EDGE
    assert client_address('unknown', '10.0.0.2, 10.0.0.1', OTHER_EDGE) == OTHER_EDGE


def test_proxy_allowlist_is_empty_by_default_and_configurable_from_env(monkeypatch):
    monkeypatch.delenv('TRUSTED_PROXY_CIDRS', raising=False)
    assert Settings(_env_file=None).TRUSTED_PROXY_CIDRS == ''
    # PC-J227: fc00::/7 is now below the IPv6 /32 floor; a measured-style /32
    # keeps the same IPv6-plus-IPv4 trusted chain under test.
    monkeypatch.setenv('TRUSTED_PROXY_CIDRS', ' 10.0.0.0/8, fd12:3456::/32 ')
    configured = Settings(_env_file=None)
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', configured.TRUSTED_PROXY_CIDRS)
    assert client_address(None, '203.0.113.20, fd12:3456::1, 10.0.0.1', 'peer') == '203.0.113.20'


@pytest.mark.parametrize('cidrs', ['garbage', '10.0.0.1/8', '10.0.0.0/33',
                                   'fc00::/129', '10.0.0.0/8,', ',10.0.0.0/8'])
def test_invalid_proxy_cidr_fails_configuration(cidrs):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, TRUSTED_PROXY_CIDRS=cidrs)


@pytest.mark.parametrize('cidrs,offender,floor', [
    ('0.0.0.0/0', '0.0.0.0/0', '/8'),
    ('::/0', '::/0', '/32'),
    ('0.0.0.0/1', '0.0.0.0/1', '/8'),
    ('128.0.0.0/1', '128.0.0.0/1', '/8'),
    ('10.0.0.0/7', '10.0.0.0/7', '/8'),
    ('2001:db8::/31', '2001:db8::/31', '/32'),
    ('fc00::/7', 'fc00::/7', '/32'),
    ('fe80::/10', 'fe80::/10', '/32'),
    ('10.0.0.0/8, 0.0.0.0/0', '0.0.0.0/0', '/8'),
])
def test_overly_broad_proxy_cidr_fails_startup_from_env(cidrs, offender, floor, monkeypatch):
    # PC-J227 (SA-J202-1): through the real env + validator path, one broad
    # entry fails the whole list, so X-Real-IP never becomes caller-chosen.
    monkeypatch.setenv('TRUSTED_PROXY_CIDRS', cidrs)
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None)
    message = str(exc.value)
    assert 'quá rộng' in message and floor in message and offender in message
    assert 'docs/CLIENT_IP_TRUST.md' in message


@pytest.mark.parametrize('cidrs', ['', '10.0.0.0/8', '100.64.0.0/10', '203.0.113.9/32',
                                   '2001:db8::/32', '2001:db8:1::/48', '::1/128',
                                   ' 10.0.0.0/8 , 2001:db8::/32,  203.0.113.9/32 '])
def test_proxy_cidr_at_or_above_prefix_floor_is_accepted_from_env(cidrs, monkeypatch):
    monkeypatch.setenv('TRUSTED_PROXY_CIDRS', cidrs)
    assert Settings(_env_file=None).TRUSTED_PROXY_CIDRS == cidrs.strip()


def test_oversize_header_cannot_push_the_edge_hop_out(monkeypatch):
    # Count parsed hops instead of timing. Stop immediately at an untrusted
    # hop; an all-trusted suffix still cannot exceed the eight-hop bound.
    parsed = []
    parse_ip = request_safety._parse_ip
    monkeypatch.setattr(request_safety, '_parse_ip', lambda v: parsed.append(v.strip() if v is not None else None) or parse_ip(v))
    chain = ', '.join(['8.8.8.8'] * 5000 + [EDGE])
    assert client_address(None, chain, 'peer') == EDGE
    assert parsed == [EDGE]
    parsed.clear()
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    chain = ', '.join([EDGE] + ['10.0.0.1'] * 5000)
    assert client_address(OTHER_EDGE, chain, 'peer') == OTHER_EDGE
    assert parsed[:request_safety._MAX_INSPECTED_HOPS] == ['10.0.0.1'] * request_safety._MAX_INSPECTED_HOPS
    assert parsed[request_safety._MAX_INSPECTED_HOPS:] == [OTHER_EDGE, 'peer']


def test_request_helper_joins_repeated_forwarded_lines_in_order():
    request = _request([('X-Forwarded-For', '8.8.4.4'), ('X-Forwarded-For', EDGE),
                        ('X-Real-IP', '8.8.4.4')])
    assert request_client_ip(request) == EDGE
    assert request_client_ip(_request([('X-Real-IP', '1.1.1.1'), ('X-Real-IP', EDGE)])) == EDGE
    assert request_client_ip(_request()) == '198.18.0.1'
    assert request_client_ip(_request(peer=None)) is None
    assert request_client_ip(None) is None


# ── Middleware: shipped per-client budgets hold under rotating hops ────────

def _safety_client():
    app = FastAPI()
    app.add_middleware(RequestSafetyMiddleware)

    @app.post('/api/error-logs')
    async def log(request: Request):
        await request.json()
        return {'received': True}

    @app.post('/api/analytics/events')
    async def analytics(request: Request):
        await request.json()
        return {'received': True}
    return TestClient(app)


@pytest.mark.parametrize('path,budget', [('/api/error-logs', 60), ('/api/analytics/events', 120)])
@pytest.mark.parametrize('spoofed', ['first_hop', 'real_ip', 'none'])
@pytest.mark.parametrize('edge', [EDGE, '203.0.113.20', '10.0.0.5'])
def test_ingress_budget_holds_when_caller_headers_rotate(path, budget, spoofed, edge):
    client = _safety_client()
    rng = random.Random(budget)

    def headers():
        spoof = _random_global_ipv4(rng)
        if spoofed == 'first_hop':  # as measured: X-Real-IP copies the first hop
            return {'X-Forwarded-For': f'{spoof}, {_random_global_ipv4(rng)}, {edge}',
                    'X-Real-IP': spoof}
        if spoofed == 'real_ip':
            return {'X-Forwarded-For': edge, 'X-Real-IP': spoof}
        return {}  # control: the socket peer keys

    for _ in range(budget):
        assert client.post(path, json={'message': 'x'}, headers=headers()).status_code == 200
    limited = client.post(path, json={'message': 'x'}, headers=headers())
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '60'
    # Another caller (another edge hop) still has its own budget.
    assert client.post(path, json={'message': 'x'},
                       headers={'X-Forwarded-For': f'{EDGE}, {OTHER_EDGE}'}).status_code == 200


def test_middleware_joins_repeated_forwarded_lines():
    client = _safety_client()
    client.headers.clear()
    for i in range(60):
        assert client.post('/api/error-logs', json={'message': 'x'}, headers=[
            ('X-Forwarded-For', f'8.8.{i}.1'), ('X-Forwarded-For', EDGE)]).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=[
        ('X-Forwarded-For', '9.9.9.9'), ('X-Forwarded-For', EDGE)]).status_code == 429


def test_ip_probe_log_is_staging_only_and_opt_in(monkeypatch, caplog):
    # TEMPORARY with request_safety._log_ip_probe (PC-J142 Bước 0): remove both
    # before promote.
    client = _safety_client()
    probe = {'X-Aver-IP-Probe': '1', 'X-Forwarded-For': f'8.8.8.8, {EDGE}', 'X-Real-IP': '8.8.8.8'}
    # SA-1933-4 (PC-J184): headers that join a line to Railway's HTTP log
    # (srcIp) or show what a Cloudflare egress passes through.
    extra = {'X-Railway-Request-Id': 'rq-sa1933', 'CF-Connecting-IP': '9.9.9.9',
             'CF-Ray': '8c0ffee-SIN', 'True-Client-IP': '9.9.9.8',
             'Forwarded': 'for=9.9.9.7;proto=https', 'X-Envoy-External-Address': '9.9.9.6',
             'Via': '1.1 sa-proxy'}
    caplog.set_level('DEBUG', logger='services.request_safety.ip_probe')
    monkeypatch.setattr(settings, 'ENVIRONMENT', 'production')
    client.post('/api/analytics/events', json={}, headers=probe)
    monkeypatch.setattr(settings, 'ENVIRONMENT', 'staging')
    client.post('/api/analytics/events', json={}, headers={**probe, 'X-Aver-IP-Probe': '0'})
    assert not [r for r in caplog.records if '[ip-probe]' in r.getMessage()]
    client.post('/api/analytics/events?token=secret', json={}, headers={
        **probe, **extra, 'Authorization': 'Bearer secret', 'Cookie': 'sb=secret'})
    [record] = [r for r in caplog.records if '[ip-probe]' in r.getMessage()]
    message = record.getMessage()
    assert EDGE in message and 'testclient' in message
    for name, value in extra.items():
        assert f'{name.lower()}={[value]!r}' in message
    assert 'secret' not in message and '/api/' not in message
    # Long values stay capped per line, as for X-Real-IP.
    caplog.clear()
    client.post('/api/analytics/events', json={}, headers={**probe, 'Via': 'v' * 1000})
    [record] = [r for r in caplog.records if '[ip-probe]' in r.getMessage()]
    assert f"via={['v' * 256]!r}" in record.getMessage()


# ── /tts burst throttle ────────────────────────────────────────────────────

@pytest.fixture
def tts_budget(monkeypatch):
    monkeypatch.setattr(tts_module.settings, 'TTS_IP_MAX_PER_MINUTE', 60)
    monkeypatch.setattr(tts_module, '_ip_hits', {})
    return 60


@pytest.mark.parametrize('spoofed', ['first_hop', 'real_ip'])
@pytest.mark.parametrize('edge', [EDGE, '203.0.113.20', '10.0.0.5', '100.64.3.3'])
def test_tts_throttle_429s_at_61_when_caller_headers_rotate(tts_budget, spoofed, edge):
    rng = random.Random(61)

    def request():
        spoof = _random_global_ipv4(rng)
        if spoofed == 'first_hop':
            return _request([('X-Forwarded-For', f'{spoof}, {_random_global_ipv4(rng)}, {edge}'),
                             ('X-Real-IP', spoof)])
        return _request([('X-Forwarded-For', edge), ('X-Real-IP', spoof)])

    for _ in range(tts_budget):
        tts_module._throttle_ip(request())
    with pytest.raises(HTTPException) as error:
        tts_module._throttle_ip(request())
    assert error.value.status_code == 429
    tts_module._throttle_ip(_request([('X-Forwarded-For', OTHER_EDGE)]))  # own window


@pytest.mark.parametrize('real_ip', [None, EDGE])
def test_tts_invalid_rightmost_hop_still_blocks_request_61(tts_budget, real_ip):
    for i in range(tts_budget + 1):
        headers = [('X-Forwarded-For', f'8.8.8.{i}, unknown')]
        if real_ip:
            headers.append(('X-Real-IP', real_ip))
        if i < tts_budget:
            tts_module._throttle_ip(_request(headers))
        else:
            with pytest.raises(HTTPException) as error:
                tts_module._throttle_ip(_request(headers))
            assert error.value.status_code == 429


# ── Reading anon_src ───────────────────────────────────────────────────────

@pytest.mark.parametrize('edge', [EDGE, '203.0.113.20', '10.0.0.5'])
def test_reading_anon_src_ignores_caller_hops_and_spoofed_real_ip(monkeypatch, edge):
    monkeypatch.setattr(settings, 'READING_ANON_SALT', 'salt-x')

    def anon_src(headers):
        return reading_student._hash_anon_src(reading_student._client_ip(_request(headers)))

    expected = reading_student._hash_anon_src(edge)
    for spoof in _random_hops(5, 40):
        assert anon_src([('X-Forwarded-For', f'{spoof}, {edge}')]) == expected
        assert anon_src([('X-Forwarded-For', edge), ('X-Real-IP', spoof)]) == expected
    assert anon_src([('X-Forwarded-For', OTHER_EDGE)]) != expected
