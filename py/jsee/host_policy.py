"""Host policy precedes routes/body reads and stays outside model/schema data."""
import base64
import hashlib
import hmac
import ipaddress
import os
import re
from urllib.parse import urlsplit

METHODS = ('GET', 'HEAD', 'POST', 'OPTIONS')
REQUEST_HEADERS = ('authorization', 'content-type')


def origin_value(value):
    if not isinstance(value, str) or not re.fullmatch(r'https?://(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]+)?', value):
        return None
    try:
        url = urlsplit(value)
        hostname = url.hostname
        if ':' in hostname:
            hostname = '[' + ipaddress.IPv6Address(hostname).compressed + ']'
        elif re.fullmatch(r'(?:[0-9]+|0[xX][0-9a-fA-F]+)', hostname.rstrip('.').split('.')[-1]):
            # Match browser URL serialization: short/hex/zero-padded IPv4 is not an origin.
            hostname = str(ipaddress.IPv4Address(hostname))
        port = url.port
        if port == (443 if url.scheme == 'https' else 80):
            port = None
        normalized = url.scheme + '://' + hostname + (':' + str(port) if port is not None else '')
        return value if normalized == value else None
    except ValueError:
        return None


class HostPolicy:
    def __init__(self, *, auth_token=None, auth_token_env=None, cors_origins=None, canonical=False):
        if auth_token_env is not None:
            if auth_token is not None:
                raise ValueError('Use only one of auth-token and auth-token-env')
            if not isinstance(auth_token_env, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', auth_token_env):
                raise ValueError('auth-token-env must name an environment variable')
            if auth_token_env not in os.environ:
                raise ValueError('auth-token-env variable is not set')
            auth_token = os.environ[auth_token_env]
        if auth_token is not None and (not isinstance(auth_token, str) or len(auth_token) > 4096 or not re.fullmatch(r'[A-Za-z0-9._~+/-]+=*', auth_token)):
            raise ValueError('auth-token must be a nonempty Bearer token (at most 4096 characters)')
        self.token_hash = hashlib.sha256(auth_token.encode()).digest() if auth_token is not None else None
        self.origins = ([] if canonical or self.token_hash else ['*']) if cors_origins is None else list(cors_origins) if isinstance(cors_origins, (list, tuple)) else [cors_origins]
        if self.origins == ['none']:
            self.origins = []
        if any(origin != '*' and not origin_value(origin) for origin in self.origins):
            raise ValueError('cors-origin must be an HTTP(S) origin, none, or *')
        if '*' in self.origins and (self.token_hash or len(self.origins) != 1):
            raise ValueError('Wildcard CORS requires no authentication and no other origins')

    def authorize(self, authorization=''):
        if self.token_hash is None:
            return True
        if not isinstance(authorization, str) or len(authorization) > 8192:
            return False
        match = re.fullmatch(r'(Bearer|Basic) +([^\s]+)', authorization, re.IGNORECASE)
        if not match:
            return False
        value = match[2]
        if match[1].lower() == 'basic':
            try:
                raw = base64.b64decode(value, validate=True)
                if base64.b64encode(raw).decode() != value or not raw.startswith(b'jsee:'):
                    return False
                value = raw[5:].decode('utf-8')
            except (ValueError, UnicodeError):
                return False
        return hmac.compare_digest(self.token_hash, hashlib.sha256(value.encode()).digest())

    def evaluate(self, method, incoming, scheme='http'):
        origin = incoming.get('origin')
        headers = {'Vary': 'Origin'}
        if self.token_hash:
            headers['Cache-Control'] = 'no-store'
        def reject(status, error):
            return status, {**headers, 'Cache-Control': 'no-store'}, error
        if '*' in self.origins:
            headers['Access-Control-Allow-Origin'] = '*'
        elif origin is not None:
            # Forwarded headers are untrusted; TLS proxies declare the public origin.
            same = origin_value(scheme + '://' + incoming.get('host', ''))
            if not origin_value(origin) or origin != same and origin not in self.origins:
                return reject(403, 'Origin is not allowed')
            headers['Access-Control-Allow-Origin'] = origin
            if self.token_hash:
                headers['Access-Control-Allow-Credentials'] = 'true'
        headers['Access-Control-Expose-Headers'] = 'Content-Disposition'
        if method == 'OPTIONS' and origin is not None and incoming.get('access-control-request-method'):
            requested = [v.strip().lower() for v in incoming.get('access-control-request-headers', '').split(',') if v.strip()]
            if incoming['access-control-request-method'] not in METHODS or any(name not in REQUEST_HEADERS for name in requested):
                return reject(403, 'Preflight is not allowed')
            # Preflight has no credentials and grants no access to the actual request.
            headers['Access-Control-Allow-Methods'] = ', '.join(METHODS)
            headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            return 204, headers, None
        if not self.authorize(incoming.get('authorization', '')):
            headers['WWW-Authenticate'] = 'Basic realm="JSEE", charset="UTF-8", Bearer realm="JSEE"'
            return reject(401, 'Authentication required')
        return (204 if method == 'OPTIONS' else None), headers, None

    def openapi(self, spec):
        if self.token_hash is None:
            return spec
        components = spec.get('components', {})
        return {**spec, 'components': {**components, 'securitySchemes': {
            **components.get('securitySchemes', {}), 'jseeBearer': {'type': 'http', 'scheme': 'bearer'},
            'jseeBasic': {'type': 'http', 'scheme': 'basic'}}}, 'security': [{'jseeBearer': []}, {'jseeBasic': []}]}


def from_options(options):
    return HostPolicy(canonical=options.get('canonical', False),
                      **{key: options.pop(key) for key in ('auth_token', 'auth_token_env', 'cors_origins') if key in options})


def add_cli_options(parser):
    parser.add_argument('--auth-token', help='Shared Bearer token; browser login uses username jsee')
    parser.add_argument('--auth-token-env', help='Read the shared token from this environment variable')
    parser.add_argument('--cors-origin', dest='cors_origins', action='append', help='Allowed HTTP(S) origin; repeat, or use none or *')
