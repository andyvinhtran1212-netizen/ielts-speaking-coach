# Client IP keys and proxy trust

Decision source: PC-J202/J183, Security Auditor addendum of 2026-10-29 18:37
(UTC+7). Last reviewed: 2026-10-30.

`backend/services/request_safety.py::client_address` supplies the telemetry
per-client budgets, `/tts` burst budget and Reading `anon_src` hash. It scans
X-Forwarded-For from right to left, skipping only addresses in
`TRUSTED_PROXY_CIDRS`. The first untrusted address keys, including private,
CGNAT, loopback and documentation addresses. An invalid or empty hop stops
the scan immediately. If no untrusted hop is selected, fallback is a valid
X-Real-IP, then the socket peer. IPv6 keys remain grouped by /64. Repeated
XFF headers join in arrival order. At most eight hops are inspected; reaching
that bound on trusted hops also falls back without examining earlier hops.

`TRUSTED_PROXY_CIDRS` is a comma-separated list of IPv4/IPv6 CIDRs in backend
configuration. The default is empty. Malformed CIDRs fail startup. No private,
Railway or Cloudflare range is trusted automatically. In particular, a
Cloudflare source may be a WARP client rather than a trusted forwarding proxy.
An overly broad allowlist lets caller-controlled hops choose the key.

PC-J227 (SA-J202-1) enforces a prefix floor: every IPv4 entry must be at
least `/8` and every IPv6 entry at least `/32`. A broader entry (`0.0.0.0/0`,
`::/0`, `0.0.0.0/1`, `10.0.0.0/7`, `2001:db8::/31`, `fc00::/7`,
`fe80::/10`, …) fails startup with a "quá rộng" error. One such entry
rejects the whole list. There is no exception list and no WARNING mode. If
Railway's internal proxy turns out to sit in ULA space, record the measured
range (`/32` or narrower, e.g. `fd12:3456::/32`), never `fc00::/7`.

PC-J368 (P3-SA-1) also requires every entry to sit inside an internal
range: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`
(CGNAT), `127.0.0.0/8`, `169.254.0.0/16`, `fc00::/7`, `fe80::/10` or `::1`,
still subject to the `/8` and `/32` floor. A public range that passes the
floor (`1.0.0.0/8`, `34.0.0.0/8` GCP, `2606:4700::/32` Cloudflare,
`2001::/32` Teredo, `64:ff9b::/96` NAT64, 6to4 `2002::/16` subnets, a bare
public IP) fails startup with a "không nằm trong dải nội bộ" error. The
list is explicit; `is_global` is not used because Python 3.11 reports Teredo
as non-global.

IPv4-mapped CIDRs (`::ffff:0:0/96` and every subnet, e.g.
`::ffff:10.0.0.0/104`) fail startup with an "IPv4-mapped" error. Hops are
unwrapped to IPv4 before matching, so those entries would never match
(SA-J202-3). Use the IPv4 CIDR instead.

Assigning `settings.TRUSTED_PROXY_CIDRS` at runtime (tests included) runs
the same validator (P3-SA-3); a rejected value leaves the old value in place.

No deployment ranges have been approved by this change. Every value set for
this variable needs its source and measurement date. Before setting it,
record the exact CIDRs, authoritative range source, verification date and
deployment path in the release evidence. Confirm the proxy appends
the previous peer correctly before allowing the scan to cross it. Synthetic
CIDRs in tests do not authorize those ranges on a deployment.

Release checks (READ-ONLY, no env change):

- Before merging a change to this validator into `staging`, read
  `TRUSTED_PROXY_CIDRS` on Railway staging. It must be unset/empty, or every
  entry must pass the rules above; otherwise the backend will not start
  after deploy. Repeat on Railway production before promotion.
- Read `FORWARDED_ALLOW_IPS` on Railway staging and production before
  promotion. It must not be `*` (SA P3-SA-2). With `*`, uvicorn's proxy
  headers set the socket peer from the caller's leftmost hop, which the peer
  fallback above would then trust. The repo has no start command or default
  for it; uvicorn's default is `127.0.0.1`.

PR #1933 remains **HOLD** for this task. Before promotion, J177 must match
Railway HTTP-log `srcIp` to the rightmost XFF hop for both ordinary and
Cloudflare/WARP sources using V0–V9 plus the 61-request burst. J179 tracks
CF-Connecting-IP spoofing through WARP; this is why X-Real-IP no longer takes
precedence over an untrusted XFF hop. Local tests cannot establish edge
behavior. The staging-only opt-in IP probe remains for J177 and must be
removed under J178 before promotion.
