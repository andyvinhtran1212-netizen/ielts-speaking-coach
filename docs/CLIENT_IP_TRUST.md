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

No deployment ranges have been approved by this change. Before setting this
variable, record the exact CIDRs, authoritative range source, verification
date and deployment path in the release evidence. Confirm the proxy appends
the previous peer correctly before allowing the scan to cross it. Synthetic
CIDRs in tests do not authorize those ranges on a deployment.

PR #1933 remains **HOLD** for this task. Before promotion, J177 must match
Railway HTTP-log `srcIp` to the rightmost XFF hop for both ordinary and
Cloudflare/WARP sources using V0–V9 plus the 61-request burst. J179 tracks
CF-Connecting-IP spoofing through WARP; this is why X-Real-IP no longer takes
precedence over an untrusted XFF hop. Local tests cannot establish edge
behavior. The staging-only opt-in IP probe remains for J177 and must be
removed under J178 before promotion.
