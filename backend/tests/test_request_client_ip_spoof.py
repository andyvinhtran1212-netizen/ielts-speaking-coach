"""SA-1029-XFF1 (PC-J142): the per-client key must not be caller-chosen.

Staging measurement (SA 29/10, one HTTP/2 connection, POST /tts): with
"X-Forwarded-For: <random>, <random>" 65 requests passed the 60/min burst
throttle; the key was the caller's LEFTMOST hop, because for a Cloudflare
(WARP) egress Railway's edge derives X-Real-IP from it. One rule
(services.request_safety.client_address) keys RequestSafetyMiddleware
(/api/error-logs, /api/analytics/events), the /tts throttle and Reading's
anon_src: rightmost public XFF hop → X-Real-IP → rightmost XFF hop → peer.

EDGE stands for the hop Railway's edge appends (the caller's real address).
Global addresses are used on purpose: documentation ranges (203.0.113.0/24…)
are not globally routable, and the rule skips non-global hops as proxy
infrastructure.
"""
import ipaddress
import random
import time

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.requests import Request as StarletteRequest

from config import settings
from routers import reading_student
from routers import tts as tts_module
from services.request_safety import RequestSafetyMiddleware, client_address, request_client_ip

EDGE = '52.95.110.1'
OTHER_EDGE = '34.117.59.81'
EDGE_V6 = '2a09:bac5:d46e:a0::10:485'


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
    # No XFF means no edge hop to prefer. Railway overwrites a client-sent
    # X-Real-IP (SA mode "X-Real-IP: <random>" → 429 at #61), so without XFF
    # it is the edge's value; locally it is only reachable through a proxy.
    assert client_address(EDGE, None, 'peer') == EDGE
    assert client_address(EDGE, '', 'peer') == EDGE
    assert client_address(f' {EDGE} ', ' , ', 'peer') == EDGE


@pytest.mark.parametrize('junk', ['unknown', '<script>', 'x' * 300, '', ' ', ',,,',
                                  '1.2.3.4.5', '999.1.1.1', 'for=1.2.3.4', '[::1'])
def test_junk_is_skipped_and_never_becomes_a_key(junk):
    assert client_address(None, f'{junk}, {EDGE}', 'peer') == EDGE
    assert client_address(None, f'{EDGE}, {junk}', 'peer') == EDGE
    assert client_address(junk, junk, 'peer') == 'peer'
    assert client_address(junk, None, None) is None


def test_ports_and_brackets_are_stripped_to_the_address():
    assert client_address(None, f'{EDGE}:443', 'peer') == EDGE
    assert client_address(f'{EDGE}:80', None, 'peer') == EDGE
    assert client_address(None, f'[{EDGE_V6}]:443', 'peer') == client_address(None, EDGE_V6, 'peer')
    assert client_address(None, f'[{EDGE_V6}]', 'peer') == client_address(None, EDGE_V6, 'peer')
    assert client_address(None, f'::ffff:{EDGE}', 'peer') == EDGE
    # A bracketed loopback is valid but not public: the edge hop still wins.
    assert client_address(None, f'{EDGE}, [::1]', 'peer') == EDGE
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


def test_internal_hops_after_the_edge_are_skipped():
    # Proxy infrastructure appended behind the edge must not fold every
    # visitor into one key.
    for spoof in _random_hops(4, 30):
        assert client_address(None, f'{spoof}, {EDGE}, 100.64.3.4, 10.1.2.3', 'peer') == EDGE
    assert client_address(None, f'{OTHER_EDGE}, 100.64.3.4', 'peer') == OTHER_EDGE


def test_private_only_chain_falls_back_to_real_ip_then_last_hop():
    assert client_address(EDGE, '10.0.0.1', 'peer') == EDGE
    assert client_address(None, '10.0.0.9, 10.0.0.1', 'peer') == '10.0.0.1'


def test_oversize_header_cannot_push_the_edge_hop_out():
    chain = ', '.join(['8.8.8.8'] * 5000 + [EDGE])
    started = time.perf_counter()
    assert client_address(None, chain, 'peer') == EDGE
    assert time.perf_counter() - started < 0.05


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
def test_ingress_budget_holds_when_caller_headers_rotate(path, budget, spoofed):
    client = _safety_client()
    rng = random.Random(budget)

    def headers():
        spoof = _random_global_ipv4(rng)
        if spoofed == 'first_hop':  # as measured: X-Real-IP copies the first hop
            return {'X-Forwarded-For': f'{spoof}, {_random_global_ipv4(rng)}, {EDGE}',
                    'X-Real-IP': spoof}
        if spoofed == 'real_ip':
            return {'X-Forwarded-For': EDGE, 'X-Real-IP': spoof}
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
    caplog.set_level('DEBUG', logger='services.request_safety.ip_probe')
    monkeypatch.setattr(settings, 'ENVIRONMENT', 'production')
    client.post('/api/analytics/events', json={}, headers=probe)
    monkeypatch.setattr(settings, 'ENVIRONMENT', 'staging')
    client.post('/api/analytics/events', json={}, headers={**probe, 'X-Aver-IP-Probe': '0'})
    assert not [r for r in caplog.records if '[ip-probe]' in r.getMessage()]
    client.post('/api/analytics/events?token=secret', json={}, headers={
        **probe, 'Authorization': 'Bearer secret'})
    [record] = [r for r in caplog.records if '[ip-probe]' in r.getMessage()]
    message = record.getMessage()
    assert EDGE in message and 'testclient' in message
    assert 'secret' not in message and '/api/' not in message


# ── /tts burst throttle ────────────────────────────────────────────────────

@pytest.fixture
def tts_budget(monkeypatch):
    monkeypatch.setattr(tts_module.settings, 'TTS_IP_MAX_PER_MINUTE', 60)
    monkeypatch.setattr(tts_module, '_ip_hits', {})
    return 60


@pytest.mark.parametrize('spoofed', ['first_hop', 'real_ip'])
def test_tts_throttle_429s_at_61_when_caller_headers_rotate(tts_budget, spoofed):
    rng = random.Random(61)

    def request():
        spoof = _random_global_ipv4(rng)
        if spoofed == 'first_hop':
            return _request([('X-Forwarded-For', f'{spoof}, {_random_global_ipv4(rng)}, {EDGE}'),
                             ('X-Real-IP', spoof)])
        return _request([('X-Forwarded-For', EDGE), ('X-Real-IP', spoof)])

    for _ in range(tts_budget):
        tts_module._throttle_ip(request())
    with pytest.raises(HTTPException) as error:
        tts_module._throttle_ip(request())
    assert error.value.status_code == 429
    tts_module._throttle_ip(_request([('X-Forwarded-For', OTHER_EDGE)]))  # own window


# ── Reading anon_src ───────────────────────────────────────────────────────

def test_reading_anon_src_ignores_caller_hops_and_spoofed_real_ip(monkeypatch):
    monkeypatch.setattr(settings, 'READING_ANON_SALT', 'salt-x')

    def anon_src(headers):
        return reading_student._hash_anon_src(reading_student._client_ip(_request(headers)))

    expected = reading_student._hash_anon_src(EDGE)
    for spoof in _random_hops(5, 40):
        assert anon_src([('X-Forwarded-For', f'{spoof}, {EDGE}')]) == expected
        assert anon_src([('X-Forwarded-For', EDGE), ('X-Real-IP', spoof)]) == expected
    assert anon_src([('X-Forwarded-For', OTHER_EDGE)]) != expected
