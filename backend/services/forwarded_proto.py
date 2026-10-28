"""Keep the public scheme behind the TLS-terminating edge (SEC-20261028-01).

Railway terminates TLS and forwards plain HTTP with ``X-Forwarded-Proto:
https``. Uvicorn only honours that header from ``--forwarded-allow-ips``
(default 127.0.0.1), which never matches Railway's proxy, so the ASGI scope
said ``http``. Starlette builds absolute redirect URLs from the scope, so the
trailing-slash 307 for ``GET /api/student/permissions/`` pointed at
``http://…`` and a client following it (``curl -L``, mobile/HTTP libraries)
re-sent its bearer token in cleartext.

This middleware only ever UPGRADES the scheme (http→https, ws→wss) when the
edge reports https; it never downgrades. A forged header can therefore at most
turn a redirect into https. It deliberately leaves ``scope["client"]`` alone:
uvicorn's ProxyHeadersMiddleware with a wildcard trust list would also rewrite
the client address from caller-controlled X-Forwarded-For hops, while
RequestSafetyMiddleware and the share-link limits rely on the current
client-key rules.
"""

_UPGRADE = {"http": "https", "ws": "wss"}


class ForwardedProtoMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        scheme = scope.get("scheme")
        if scope["type"] in ("http", "websocket") and scheme in _UPGRADE:
            for name, value in scope.get("headers") or ():
                if name == b"x-forwarded-proto":
                    protos = value.decode("latin-1").lower().split(",")
                    if any(p.strip() in ("https", "wss") for p in protos):
                        scope = dict(scope, scheme=_UPGRADE[scheme])
                    break
        await self.app(scope, receive, send)
