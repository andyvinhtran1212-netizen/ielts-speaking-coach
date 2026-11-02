"""SA-1029-XFF1 (PC-J142) / PC-J520: the per-client key must be the caller's
own address: not caller-chosen, and not shared with other callers.

One rule (services.request_safety.client_address) keys RequestSafetyMiddleware
(/api/error-logs, /api/analytics/events), the /tts throttle and Reading's
anon_src: untrusted X-Real-IP → rightmost untrusted XFF hop → peer.

PC-J177 (staging 02/11, 91 requests over WARP and GitHub runners): Railway's
edge drops the caller's XFF, sends "X-Forwarded-For: <srcIp>, <CDN77 PoP>"
and overwrites X-Real-IP with srcIp. The PoP is shared by every client on it
and rotates per request, so keying on the rightmost hop (PR #1933) bucketed
learners by PoP. J177_EDGE_HEADERS replays what the app received.

EDGE stands for the caller's real address as the edge reports it. Without
X-Real-IP, only explicitly configured proxy CIDRs may be skipped in XFF, and
non-global and invalid rightmost hops must never let the scan cross into
caller-controlled input. Local tests cannot prove edge behavior; J177 did.
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
RAILWAY_PEER = '100.64.0.7'

# PC-J177 (SA report, staging 02/11): one row per distinct
# (srcIp from Railway's HTTP log, X-Forwarded-For the app received) over the
# 91 requests. X-Real-IP was srcIp in 91/91; the rightmost hop is a CDN77 PoP
# (152.233.14.0/23 SGP, 79.127.228.0/24 HKG, 84.17.44.0/23 LAX).
J177_EDGE_HEADERS = [
    ('104.28.210.153', '104.28.210.153, 152.233.15.121'),
    ('104.28.210.155', '104.28.210.155, 152.233.15.121'),
    ('104.28.242.151', '104.28.242.151, 79.127.228.17'),
    ('104.28.242.154', '104.28.242.154, 152.233.68.98'),
    ('104.28.210.150', '104.28.210.150, 79.127.228.17'),
    ('104.28.210.151', '104.28.210.151, 79.127.228.18'),
    ('104.28.210.155', '104.28.210.155, 152.233.68.97'),
    ('104.28.210.152', '104.28.210.152, 79.127.228.18'),
    ('104.28.242.153', '104.28.242.153, 152.233.15.123'),
    ('20.65.155.22', '20.65.155.22, 84.17.44.226'),
    ('20.65.155.22', '20.65.155.22, 84.17.44.229'),
    ('20.64.8.212', '20.64.8.212, 84.17.44.225'),
    ('20.64.8.212', '20.64.8.212, 84.17.44.226'),
    ('20.64.8.212', '20.64.8.212, 84.17.44.227'),
    ('20.64.8.212', '20.64.8.212, 84.17.44.229'),
    ('104.28.242.153', '104.28.242.153, 152.233.68.98'),  # the 61-request burst
]
# The burst's PoP and two J177 sources measured behind it.
J177_POP = '152.233.68.98'
J177_SRC_A, J177_SRC_B = '104.28.242.153', '104.28.242.154'


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


def test_real_ip_outranks_every_forwarded_hop():
    # PC-J520: the edge overwrites X-Real-IP with srcIp and appends its own
    # PoP to XFF, so neither caller hops nor the PoP may override X-Real-IP.
    for hop in _random_hops(2):
        assert client_address(EDGE, f'{hop}, {OTHER_EDGE}', 'peer') == EDGE
        assert client_address(EDGE, hop, 'peer') == EDGE


# ── PC-J177 replay: Railway edge headers as received on staging ────────────

def test_j177_replay_keys_every_request_on_its_source_address():
    # PR #1933 keyed all 91 requests on the PoP; none matched srcIp.
    for src, xff in J177_EDGE_HEADERS:
        assert client_address(src, xff, RAILWAY_PEER) == src
        assert request_client_ip(_request([('X-Forwarded-For', xff), ('X-Real-IP', src)],
                                          peer=RAILWAY_PEER)) == src


def test_j177_sources_behind_one_pop_get_separate_keys():
    by_pop = {}
    for src, xff in J177_EDGE_HEADERS:
        by_pop.setdefault(xff.rsplit(',', 1)[1].strip(), set()).add(src)
    shared = {pop: srcs for pop, srcs in by_pop.items() if len(srcs) > 1}
    # 20.65.155.22 and 20.64.8.212 are two Azure runners behind 84.17.44.226.
    assert set(shared) == {'152.233.15.121', '152.233.68.98', '79.127.228.17',
                           '79.127.228.18', '84.17.44.226', '84.17.44.229'}
    for pop, srcs in shared.items():
        keys = {client_address(src, f'{src}, {pop}', RAILWAY_PEER) for src in srcs}
        assert keys == srcs


def test_j177_one_source_across_rotating_pops_keeps_one_key():
    pops_of = {}
    for src, xff in J177_EDGE_HEADERS:
        pops_of.setdefault(src, set()).add(xff)
    assert len(pops_of['20.64.8.212']) == 4 and len(pops_of['104.28.210.155']) == 2
    for src, xffs in pops_of.items():
        assert {client_address(src, xff, RAILWAY_PEER) for xff in xffs} == {src}


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
    # Junk/empty X-Real-IP falls back to the XFF rule, then the peer.
    assert client_address(junk, f'{OTHER_EDGE}, {EDGE}', 'peer') == EDGE
    assert client_address(junk, f'{EDGE}, {junk}', 'peer') == 'peer'


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


def test_private_untrusted_hop_keys_only_without_real_ip():
    # PC-J520 reverses the PC-J202 order: X-Real-IP first, XFF as fallback.
    assert client_address(EDGE, '10.0.0.1', 'peer') == EDGE
    assert client_address(None, '10.0.0.9, 10.0.0.1', 'peer') == '10.0.0.1'


@pytest.mark.parametrize('edge', ['10.0.0.5', '100.64.3.3', '203.0.113.20',
                                 '127.0.0.1', '169.254.1.1', 'fc00::5', 'fe80::5'])
def test_non_global_untrusted_hop_never_lets_a_caller_public_hop_win(edge):
    # PC-J202 reverses the unsafe PC-J176 trade-off. Globalness is irrelevant.
    expected = edge if ':' not in edge else str(ipaddress.ip_network(edge + '/64', strict=False))
    for spoof in _random_hops(6, 40):
        assert client_address(None, f'{spoof}, {edge}', 'peer') == expected


@pytest.mark.parametrize('cidr,proxy,outside', [
    ('10.0.0.0/8', '10.0.0.5', '11.0.0.5'),
    ('100.64.0.0/10', '100.127.255.255', '100.128.0.0'),
    ('192.168.0.0/16', '192.168.255.255', '192.169.0.0'),
    ('172.16.0.0/12', '172.31.255.255', '172.32.0.0'),
    ('127.0.0.0/8', '127.0.0.1', '128.0.0.1'),
    ('169.254.0.0/16', '169.254.255.255', '169.255.0.0'),
    ('10.1.2.3/32', '10.1.2.3', '10.1.2.4'),
    ('fd12:3456::/32', 'fd12:3456:ffff::5', 'fd12:3457::5'),
    ('fe80::/32', 'fe80::5', 'fe80:1::5'),
    ('::1/128', '::1', '::2'),
    ('fd12:3456:1::/48', 'fd12:3456:1::1', 'fd12:3456:2::1'),
])
def test_configured_proxy_skips_exactly_one_hop_and_stops_at_untrusted(cidr, proxy, outside, monkeypatch):
    # Synthetic configurations only: none of these ranges is trusted by default.
    # PC-J368: assignment is validated now, so every row is an internal range
    # at or above the prefix floor (was 203.0.113.9/32, fc00::/7, fe80::/10,
    # 2001:db8:1::/48, which only passed because setattr skipped the validator).
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', cidr)
    for spoof in ('9.9.9.9', '9.9.9.10'):
        assert client_address(None, f'{spoof}, 203.0.113.20, {proxy}', 'peer') == '203.0.113.20'
        # An X-Real-IP inside the proxy range is the proxy, not the client.
        assert client_address(proxy, f'{spoof}, 203.0.113.20, {proxy}', 'peer') == '203.0.113.20'
    expected = outside if ':' not in outside else str(ipaddress.ip_network(outside + '/64', strict=False))
    assert client_address(None, f'9.9.9.9, {outside}', 'peer') == expected
    assert client_address(outside, '9.9.9.9', 'peer') == expected
    if ':' not in proxy:
        assert client_address(None, f'203.0.113.20, ::ffff:{proxy}', 'peer') == '203.0.113.20'


def test_trusted_proxy_does_not_skip_an_invalid_neighbor(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    for junk in ('unknown', '', ' ', 'bad-ip'):
        for spoof in _random_hops(7, 10):
            assert client_address(EDGE, f'{spoof}, {junk}, 10.0.0.1', 'peer') == EDGE
            assert client_address(None, f'{spoof}, {junk}, 10.0.0.1', 'peer') == 'peer'


def test_all_trusted_hops_fall_back_to_the_peer(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    assert client_address(EDGE, '10.0.0.2, 10.0.0.1', OTHER_EDGE) == EDGE
    assert client_address('unknown', '10.0.0.2, 10.0.0.1', OTHER_EDGE) == OTHER_EDGE
    assert client_address('10.0.0.3', '10.0.0.2, 10.0.0.1', OTHER_EDGE) == OTHER_EDGE


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


@pytest.mark.parametrize('cidrs', ['', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
                                   '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
                                   '10.1.2.3', '100.127.255.0/24', 'fd12:3456::/32',
                                   'fc00::/32', 'fd12:3456:1::/48', 'fe80::/32', '::1/128', '::1',
                                   ' 10.0.0.0/8 , fd12:3456::/32,  100.64.0.0/10 '])
def test_internal_proxy_cidr_at_or_above_prefix_floor_is_accepted_from_env(cidrs, monkeypatch):
    monkeypatch.setenv('TRUSTED_PROXY_CIDRS', cidrs)
    assert Settings(_env_file=None).TRUSTED_PROXY_CIDRS == cidrs.strip()


@pytest.mark.parametrize('cidrs,offender', [
    # P3-SA-1: the prefix floor alone accepted these public ranges.
    ('1.0.0.0/8', '1.0.0.0/8'),
    ('34.0.0.0/8', '34.0.0.0/8'),  # GCP, easy to mislabel as "Railway"
    ('2606:4700::/32', '2606:4700::/32'),  # Cloudflare
    ('2001::/32', '2001::/32'),  # Teredo: is_global is False on Python 3.11
    ('203.0.113.9/32', '203.0.113.9/32'),
    ('8.8.8.8', '8.8.8.8'),
    ('2001:db8::/32', '2001:db8::/32'),
    ('64:ff9b::/96', '64:ff9b::/96'),  # NAT64
    ('2002:a00::/32', '2002:a00::/32'),  # 6to4 wrapping 10.0.0.0/16
    ('100.0.0.0/9', '100.0.0.0/9'),  # floor-sized, wider than 100.64.0.0/10
    ('172.0.0.0/11', '172.0.0.0/11'),  # wider than 172.16.0.0/12
    ('::/64', '::/64'),  # contains ::ffff:0:0/96
    ('10.0.0.0/8, 34.0.0.0/8', '34.0.0.0/8'),
])
def test_public_proxy_cidr_fails_startup_from_env(cidrs, offender, monkeypatch):
    # PC-J368 (P3-SA-1): a public range the attacker can rent or route through
    # would let their own edge hop be skipped. Membership in the internal
    # allowlist is explicit, never derived from is_global.
    monkeypatch.setenv('TRUSTED_PROXY_CIDRS', cidrs)
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None)
    message = str(exc.value)
    assert 'không nằm trong dải nội bộ' in message and offender in message
    assert 'docs/CLIENT_IP_TRUST.md' in message


@pytest.mark.parametrize('cidrs,offender', [
    ('::ffff:0:0/96', '::ffff:0:0/96'),
    ('::ffff:0.0.0.0/96', '::ffff:0.0.0.0/96'),
    ('::ffff:10.0.0.0/104', '::ffff:10.0.0.0/104'),
    ('::ffff:127.0.0.1/128', '::ffff:127.0.0.1/128'),
    ('::ffff:10.0.0.1', '::ffff:10.0.0.1'),
    ('10.0.0.0/8, ::ffff:0:0/96', '::ffff:0:0/96'),
])
def test_ipv4_mapped_proxy_cidr_fails_startup_from_env(cidrs, offender, monkeypatch):
    # CR P3 (PR #2061): hops are unwrapped to IPv4, so a mapped CIDR never
    # matches. Reject it with its own message instead of accepting it silently.
    monkeypatch.setenv('TRUSTED_PROXY_CIDRS', cidrs)
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None)
    message = str(exc.value)
    assert 'IPv4-mapped' in message and offender in message
    assert 'docs/CLIENT_IP_TRUST.md' in message


@pytest.mark.parametrize('cidrs', ['0.0.0.0/0', '34.0.0.0/8', '::ffff:0:0/96', 'garbage'])
def test_runtime_assignment_runs_the_proxy_cidr_validator(cidrs, monkeypatch):
    # P3-SA-3: assignment used to bypass the validator, so a test or runtime
    # write could install a list startup would reject. The value is unchanged.
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    with pytest.raises(ValidationError):
        settings.TRUSTED_PROXY_CIDRS = cidrs
    assert settings.TRUSTED_PROXY_CIDRS == '10.0.0.0/8'
    fresh = Settings(_env_file=None, TRUSTED_PROXY_CIDRS='')
    with pytest.raises(ValidationError):
        fresh.TRUSTED_PROXY_CIDRS = cidrs
    assert fresh.TRUSTED_PROXY_CIDRS == ''


def test_runtime_assignment_of_an_internal_proxy_cidr_is_normalized(monkeypatch):
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', ' 10.0.0.0/8, fd12:3456::/32 ')
    assert settings.TRUSTED_PROXY_CIDRS == '10.0.0.0/8, fd12:3456::/32'
    assert client_address(None, '203.0.113.20, fd12:3456::1, 10.0.0.1', 'peer') == '203.0.113.20'


def _install_bypassing_validator(path, cidrs, monkeypatch):
    """SA-4: the three in-process writes that skip the Settings validator."""
    if path == 'object_setattr':
        object.__setattr__(settings, 'TRUSTED_PROXY_CIDRS', cidrs)
        installed = settings
    elif path == 'model_copy':
        installed = settings.model_copy(update={'TRUSTED_PROXY_CIDRS': cidrs})
    else:
        installed = Settings.model_construct(TRUSTED_PROXY_CIDRS=cidrs)
    monkeypatch.setattr(request_safety, 'settings', installed)
    request_safety._trusted_proxy_networks.cache_clear()
    return installed


def _proxy_warnings(caplog):
    return [r for r in caplog.records
            if r.name == 'services.request_safety' and r.levelname == 'WARNING']


_BYPASS_PATHS = ['object_setattr', 'model_copy', 'model_construct']


@pytest.mark.parametrize('path', _BYPASS_PATHS)
@pytest.mark.parametrize('cidrs,hop,key,reason', [
    ('0.0.0.0/0', '10.0.0.1', '10.0.0.1', 'too_broad'),
    ('::/0', 'fd12::1', 'fd12::/64', 'too_broad'),
    ('::ffff:0:0/96', '::ffff:8.8.8.9', '8.8.8.9', 'ipv4_mapped'),
    ('8.8.8.0/24', '8.8.8.9', '8.8.8.9', 'not_internal'),
    ('10.0.0.0/8, 0.0.0.0/0', '10.0.0.1', '10.0.0.1', 'too_broad'),
    ('garbage', '10.0.0.1', '10.0.0.1', 'unparseable'),
    ('10.0.0.0/8,', '10.0.0.1', '10.0.0.1', 'unparseable'),
])
def test_validator_bypass_fails_closed_at_use(path, cidrs, hop, key, reason, monkeypatch, caplog):
    # PC-J377 (SA-4): these writes skip validate_trusted_proxy_cidrs, so the
    # model still holds the bad list. client_address re-checks it at use and
    # trusts no proxy: without X-Real-IP the rightmost hop keys, and an
    # X-Real-IP inside the bad range is not skipped as a proxy either.
    caplog.set_level('WARNING', logger='services.request_safety')
    installed = _install_bypassing_validator(path, cidrs, monkeypatch)
    assert installed.TRUSTED_PROXY_CIDRS == cidrs
    for _ in range(3):
        assert client_address(None, f'1.1.1.1, {hop}', 'peer') == key
        assert client_address(hop, '1.1.1.1', 'peer') == key
    [record] = _proxy_warnings(caplog)
    message = record.getMessage()
    assert f'reason={reason}' in message
    assert f'entries={len(cidrs.split(","))}' in message
    for entry in cidrs.split(','):
        if entry.strip():
            assert entry.strip() not in message


@pytest.mark.parametrize('path', _BYPASS_PATHS)
@pytest.mark.parametrize('cidrs,hop', [('10.0.0.0/8', '10.0.0.1'),
                                       ('fc00::/32', 'fc00::1'),
                                       ('10.0.0.0/8, fd12:3456::/32', 'fd12:3456::1')])
def test_validator_bypass_with_an_internal_cidr_still_skips_the_proxy(path, cidrs, hop, monkeypatch, caplog):
    caplog.set_level('WARNING', logger='services.request_safety')
    _install_bypassing_validator(path, cidrs, monkeypatch)
    assert client_address(None, f'1.1.1.1, {hop}', 'peer') == '1.1.1.1'
    assert client_address(hop, f'1.1.1.1, {hop}', 'peer') == '1.1.1.1'
    assert not _proxy_warnings(caplog)


def test_oversize_header_cannot_push_the_edge_hop_out(monkeypatch):
    # Count parsed hops instead of timing. Stop immediately at an untrusted
    # hop; an all-trusted suffix still cannot exceed the eight-hop bound.
    parsed = []
    parse_ip = request_safety._parse_ip
    monkeypatch.setattr(request_safety, '_parse_ip', lambda v: parsed.append(v.strip() if v is not None else None) or parse_ip(v))
    chain = ', '.join(['8.8.8.8'] * 5000 + [EDGE])
    assert client_address(None, chain, 'peer') == EDGE
    assert parsed == [None, EDGE]  # X-Real-IP (absent), then one hop
    parsed.clear()
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_CIDRS', '10.0.0.0/8')
    chain = ', '.join([EDGE] + ['10.0.0.1'] * 5000)
    assert client_address(None, chain, OTHER_EDGE) == OTHER_EDGE
    assert parsed == [None] + ['10.0.0.1'] * request_safety._MAX_INSPECTED_HOPS + [OTHER_EDGE]


def test_request_helper_joins_repeated_forwarded_lines_in_order():
    request = _request([('X-Forwarded-For', '8.8.4.4'), ('X-Forwarded-For', EDGE)])
    assert request_client_ip(request) == EDGE
    assert request_client_ip(_request([('X-Forwarded-For', '8.8.4.4'), ('X-Forwarded-For', EDGE),
                                       ('X-Real-IP', OTHER_EDGE)])) == OTHER_EDGE
    assert request_client_ip(_request([('X-Real-IP', '1.1.1.1'), ('X-Real-IP', EDGE)])) == EDGE
    # J177 V5/V6: the edge passes CF-Connecting-IP through; it never keys.
    assert request_client_ip(_request([('CF-Connecting-IP', '9.9.9.9'),
                                       ('X-Forwarded-For', f'{EDGE}, {J177_POP}'),
                                       ('X-Real-IP', EDGE)])) == EDGE
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


def _edge_headers(src, rng):
    """What Railway's edge sends whatever the caller sent (J177): the caller's
    XFF/X-Real-IP are dropped/overwritten and the PoP hop rotates."""
    return {'X-Forwarded-For': f'{src}, 152.233.{rng.choice((14, 15, 68))}.{rng.randrange(256)}',
            'X-Real-IP': src}


@pytest.mark.parametrize('path,budget', [('/api/error-logs', 60), ('/api/analytics/events', 120)])
@pytest.mark.parametrize('spoofed', ['edge_rewritten', 'forwarded_only', 'none'])
@pytest.mark.parametrize('edge', [EDGE, '203.0.113.20', '10.0.0.5'])
def test_ingress_budget_holds_when_caller_headers_rotate(path, budget, spoofed, edge):
    client = _safety_client()
    rng = random.Random(budget)

    def headers():
        if spoofed == 'edge_rewritten':  # as measured: PoP rotates, X-Real-IP = srcIp
            return _edge_headers(edge, rng)
        if spoofed == 'forwarded_only':  # fallback: caller hops left of the edge hop
            return {'X-Forwarded-For': f'{_random_global_ipv4(rng)}, {_random_global_ipv4(rng)}, {edge}'}
        return {}  # control: the socket peer keys

    for _ in range(budget):
        assert client.post(path, json={'message': 'x'}, headers=headers()).status_code == 200
    limited = client.post(path, json={'message': 'x'}, headers=headers())
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '60'
    # Another caller behind the same PoP still has its own budget.
    assert client.post(path, json={'message': 'x'},
                       headers={'X-Forwarded-For': f'{OTHER_EDGE}, {J177_POP}',
                                'X-Real-IP': OTHER_EDGE}).status_code == 200


@pytest.mark.parametrize('path,budget', [('/api/error-logs', 60), ('/api/analytics/events', 120)])
def test_j177_burst_on_one_pop_does_not_429_another_client(path, budget):
    # PC-J520: J177's burst (61 × 413-sized posts from J177_SRC_A) shared its
    # bucket with every other staging client behind J177_POP.
    client = _safety_client()
    burst = {'X-Forwarded-For': f'{J177_SRC_A}, {J177_POP}', 'X-Real-IP': J177_SRC_A}
    for _ in range(budget):
        assert client.post(path, json={'message': 'x'}, headers=burst).status_code == 200
    assert client.post(path, json={'message': 'x'}, headers=burst).status_code == 429
    # The same source on a rotated PoP stays limited.
    assert client.post(path, json={'message': 'x'}, headers={
        'X-Forwarded-For': f'{J177_SRC_A}, 152.233.15.123', 'X-Real-IP': J177_SRC_A}).status_code == 429
    assert client.post(path, json={'message': 'x'}, headers={
        'X-Forwarded-For': f'{J177_SRC_B}, {J177_POP}', 'X-Real-IP': J177_SRC_B}).status_code == 200


def test_worker_ceiling_holds_when_real_ip_is_caller_chosen():
    # Residual risk if X-Real-IP ever became caller-chosen (an origin reached
    # without Railway's edge, or an edge change): per-client budgets split,
    # but the shipped per-worker ceiling (600/min error logs) still holds.
    client = _safety_client()
    rng = random.Random(600)
    for _ in range(600):
        assert client.post('/api/error-logs', json={'message': 'x'},
                           headers={'X-Real-IP': _random_global_ipv4(rng)}).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers={'X-Real-IP': _random_global_ipv4(rng)}).status_code == 429


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


@pytest.mark.parametrize('spoofed', ['edge_rewritten', 'forwarded_only'])
@pytest.mark.parametrize('edge', [EDGE, '203.0.113.20', '10.0.0.5', '100.64.3.3'])
def test_tts_throttle_429s_at_61_when_caller_headers_rotate(tts_budget, spoofed, edge):
    rng = random.Random(61)

    def request():
        if spoofed == 'edge_rewritten':
            return _request(list(_edge_headers(edge, rng).items()))
        return _request([('X-Forwarded-For', f'{_random_global_ipv4(rng)}, {_random_global_ipv4(rng)}, {edge}')])

    for _ in range(tts_budget):
        tts_module._throttle_ip(request())
    with pytest.raises(HTTPException) as error:
        tts_module._throttle_ip(request())
    assert error.value.status_code == 429
    # Own window for another caller behind the same PoP.
    tts_module._throttle_ip(_request([('X-Forwarded-For', f'{OTHER_EDGE}, {J177_POP}'),
                                      ('X-Real-IP', OTHER_EDGE)]))


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
def test_reading_anon_src_is_the_source_not_caller_hops_or_the_pop(monkeypatch, edge):
    monkeypatch.setattr(settings, 'READING_ANON_SALT', 'salt-x')

    def anon_src(headers):
        return reading_student._hash_anon_src(reading_student._client_ip(_request(headers)))

    expected = reading_student._hash_anon_src(edge)
    rng = random.Random(5)
    for spoof in _random_hops(5, 40):
        assert anon_src([('X-Forwarded-For', f'{spoof}, {edge}')]) == expected
        assert anon_src(list(_edge_headers(edge, rng).items())) == expected
    assert anon_src([('X-Forwarded-For', OTHER_EDGE)]) != expected
    # PC-J520: two sources behind one PoP no longer share an anon_src.
    assert anon_src([('X-Forwarded-For', f'{OTHER_EDGE}, {J177_POP}'),
                     ('X-Real-IP', OTHER_EDGE)]) != anon_src([('X-Forwarded-For', f'{edge}, {J177_POP}'),
                                                              ('X-Real-IP', edge)])
