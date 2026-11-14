"""Admin password for the upload side (2026-11-14).

The password is never stored: only a salted PBKDF2-SHA256 hash (310,000 iterations) in ADMIN_AUTH_FILE, which lives under
database/uploads/ (outside the source tree). Login returns a random session token (in memory, expires after ADMIN_SESSION_HOURS);
the upload endpoints require 'Authorization: Bearer <token>'. Five wrong passwords from one client lock that client out for 60 s.
Set or change the password on the server with:   python -m app.auth set     (prompts; nothing is echoed)"""
from __future__ import annotations
import getpass, hashlib, hmac, json, secrets, sys, threading, time
from pathlib import Path
from . import config as C

ITER = 310_000
_tokens: dict[str, float] = {}
_fail: dict[str, list] = {}
_lock = threading.Lock()


def _file() -> Path:
    return Path(C.ADMIN_AUTH_FILE)


def configured() -> bool:
    return _file().exists()


def set_password(pw: str):
    if len(pw) < 6:
        raise ValueError('password must have at least 6 characters')
    salt = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, ITER)
    _file().parent.mkdir(parents=True, exist_ok=True)
    _file().write_text(json.dumps({'algo': 'pbkdf2_sha256', 'iterations': ITER, 'salt': salt.hex(), 'hash': h.hex(),
                                   'set_at': time.strftime('%Y-%m-%dT%H:%M:%S')}))
    with _lock:
        _tokens.clear()   # changing the password ends every session


def _verify(pw: str) -> bool:
    d = json.loads(_file().read_text())
    h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), bytes.fromhex(d['salt']), int(d['iterations']))
    return hmac.compare_digest(h.hex(), d['hash'])


def login(pw: str, client: str) -> str:
    """Returns a session token; raises PermissionError (wrong password / locked) or RuntimeError (not configured)."""
    if not configured():
        raise RuntimeError('upload admin password is not set on the server')
    now = time.time()
    with _lock:
        f = _fail.setdefault(client, [0, 0.0])
        if f[1] > now:
            raise PermissionError(f'too many wrong attempts; try again in {int(f[1] - now) + 1} s')
    ok = _verify(pw or '')
    with _lock:
        if not ok:
            f[0] += 1
            if f[0] >= 5:
                f[0], f[1] = 0, now + 60
            raise PermissionError('wrong password')
        f[0] = 0
        tok = secrets.token_urlsafe(32); _tokens[tok] = now + C.ADMIN_SESSION_HOURS * 3600
        return tok


def check(authorization: str | None) -> bool:
    if not authorization or not authorization.lower().startswith('bearer '):
        return False
    tok = authorization.split(' ', 1)[1].strip()
    with _lock:
        exp = _tokens.get(tok)
        if exp and exp > time.time():
            return True
        _tokens.pop(tok, None)
        return False


def logout(authorization: str | None):
    if authorization and authorization.lower().startswith('bearer '):
        with _lock:
            _tokens.pop(authorization.split(' ', 1)[1].strip(), None)


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'set':
    pw = sys.stdin.readline().rstrip('\n') if not sys.stdin.isatty() else getpass.getpass('New upload admin password: ')
    set_password(pw); print('upload admin password set (hash stored in', _file(), ')')
