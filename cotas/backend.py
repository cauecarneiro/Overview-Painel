"""Backend local de cotas, somente stdlib e consultas administrativas das CLIs."""

import argparse
import copy
import hashlib
import json
import math
import os
import re
import selectors
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, wait as wait_futures
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from discovery import InjectedDiscovery, MaestriDiscovery
from sessions import SessionMetadata

INTERVALS = {'codex': 300, 'claude': 300, 'antigravity': 1200}
EXECUTABLES = {'codex': 'codex', 'claude': 'claude', 'antigravity': 'agy'}


def normalize_email(value):
    if not isinstance(value, str):
        return None
    value = value.strip().casefold()
    return value if re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', value) else None


def parse_antigravity_email(output):
    emails = set()
    for line in output.splitlines():
        match = re.search(r'OAuth: authenticated successfully as (\S+)\s*$', line)
        if match:
            email = normalize_email(match[1])
            if email:
                emails.add(email)
    return emails.pop() if len(emails) == 1 else None


def filtered_log(path, pattern):
    # Filter at the file boundary: Python receives only the requested identifiers.
    result = subprocess.run(['/usr/bin/awk', pattern, str(path)], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, timeout=2, check=True)
    return result.stdout


def timestamp(value):
    if value is None:
        return None
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('timestamp requires timezone')
        return parsed.timestamp()
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('invalid timestamp')
    return value


def window(used, reset, minutes):
    if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used) or used < 0:
        raise ValueError('invalid utilization')
    return {'used_percent': used, 'remaining_percent': max(0, 100 - used),
            'resets_at': timestamp(reset), 'window_minutes': minutes}


def normalize(harness, data):
    if harness == 'codex':
        limits = data.get('rateLimits')
        if not isinstance(limits, dict):
            raise ValueError('missing rate limits')
        pool = {'id': limits.get('limitId') or 'codex', 'five_hour': None, 'weekly': None}
        for item in (limits.get('primary'), limits.get('secondary')):
            if item is None:
                continue
            minutes = item['windowDurationMins']
            key = {300: 'five_hour', 10080: 'weekly'}.get(minutes)
            if key is None or pool[key] is not None:
                raise ValueError('unexpected quota window')
            pool[key] = window(item['usedPercent'], item.get('resetsAt'), minutes)
        return [pool]
    if harness == 'claude':
        limits = data.get('rate_limits')
        pool = {'id': 'main', 'five_hour': None, 'weekly': None}
        if limits is None:
            return [pool]
        for item in limits['limits'] or []:
            key = {'session': 'five_hour', 'weekly_all': 'weekly'}.get(item.get('kind'))
            if key:
                if pool[key] is not None:
                    raise ValueError('duplicate quota window')
                pool[key] = window(item['percent'], item.get('resets_at'), 300 if key == 'five_hour' else 10080)
            elif item.get('kind') == 'weekly_scoped':
                # Painel dos Vingadores: a semanal própria de um modelo (a do Fable), que a status line não mostra.
                model = ((item.get('scope') or {}).get('model') or {}).get('display_name')
                if isinstance(model, str) and model.strip():
                    pool.setdefault('scoped', {})[model.strip()] = window(item['percent'], item.get('resets_at'), 10080)
        return [pool]
    if harness == 'antigravity':
        groups = data.get('command', {}).get('data', {}).get('groups')
        if not isinstance(groups, list):
            raise ValueError('missing quota groups')
        pools = {}
        for group in groups:
            for bucket in group.get('buckets', []):
                identity = bucket.get('id', '')
                parts = identity.rsplit('-', 1)
                if len(parts) != 2 or parts[0] not in ('gemini', '3p') or parts[1] not in ('5h', 'weekly'):
                    continue
                fraction = bucket['remaining_fraction']
                if isinstance(fraction, bool) or not isinstance(fraction, (int, float)) or not 0 <= fraction <= 1:
                    raise ValueError('invalid remaining fraction')
                pool = pools.setdefault(parts[0], {'id': parts[0], 'five_hour': None, 'weekly': None})
                key = 'five_hour' if parts[1] == '5h' else 'weekly'
                if pool[key] is not None:
                    raise ValueError('duplicate quota window')
                pool[key] = window(100 * (1 - fraction), bucket.get('reset_time'), 300 if key == 'five_hour' else 10080)
        if not pools:
            raise ValueError('no recognized quota')
        return [pools[key] for key in ('gemini', '3p') if key in pools]
    raise ValueError('unknown harness')


def parse_cli_output(harness, output):
    if harness == 'claude':
        report, result = None, None
        for line in output.splitlines():
            message = json.loads(line)
            if 'usage_report' in message:
                report = message['usage_report']
            if message.get('type') == 'result':
                result = message
        if report is None or result is None or result.get('is_error') or result.get('num_turns', 0) != 0:
            raise ValueError('missing usage report')
        if any(result.get('usage', {}).get(key, 0) for key in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')):
            raise ValueError('unexpected inference')
        return normalize(harness, report)
    data = json.loads(output)
    if data.get('error') or any(data.get('usage', {}).get(key, 0) for key in ('input_tokens', 'output_tokens', 'thinking_tokens', 'total_tokens')):
        raise ValueError('invalid quota response')
    return normalize(harness, data)


def stop_process(process):
    # Only the newly spawned query group is signalled, never an existing terminal.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def codex_query(executable, env, timeout):
    process = subprocess.Popen([executable, 'app-server', '--stdio'], env=env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    deadline = time.monotonic() + timeout
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = b''

    def send(message):
        process.stdin.write((json.dumps(message) + '\n').encode())
        process.stdin.flush()

    def response(identity):
        nonlocal buffer
        while True:
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                message = json.loads(line)
                if message.get('id') == identity:
                    if 'error' in message:
                        raise ValueError('RPC query failed')
                    return message['result']
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise TimeoutError('query timeout')
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                raise ValueError('RPC stream closed')
            buffer += chunk
            if len(buffer) > 8 * 1024 * 1024:
                raise ValueError('RPC response too large')

    try:
        send({'id': 1, 'method': 'initialize', 'params': {
            'clientInfo': {'name': 'quota_dashboard', 'version': '0.1'},
            'capabilities': {'experimentalApi': True}}})
        response(1)
        send({'method': 'initialized', 'params': {}})
        send({'id': 2, 'method': 'account/read', 'params': {'refreshToken': False}})
        try:
            identity = response(2).get('account') or {}
        except ValueError:
            identity = {}
        send({'id': 3, 'method': 'account/rateLimits/read', 'params': {}})
        return {'pools': normalize('codex', response(3)),
                'email': normalize_email(identity.get('email')), 'plan': identity.get('planType')}
    finally:
        selector.close()
        stop_process(process)
        process.stdin.close()
        process.stdout.close()


def collect(account, executable=None, timeout=40):
    if not account.account_dir:
        raise ValueError('unidentified account')
    executable = executable or shutil.which(EXECUTABLES[account.harness])
    if not executable:
        raise FileNotFoundError('CLI unavailable')
    env = os.environ.copy()
    if account.harness == 'codex':
        env['CODEX_HOME'] = account.account_dir
        return codex_query(executable, env, timeout)
    deadline = time.monotonic() + timeout
    identity = {}
    if account.harness == 'claude':
        env.pop('CLAUDE_CONFIG_DIR', None)
        try:
            identity = json.loads(run_cli([executable, 'auth', 'status', '--json'], env, deadline))
        except (ValueError, TimeoutError):
            pass
        command = [executable, '--safe-mode', '--no-session-persistence', '-p', '/usage',
                   '--output-format', 'stream-json', '--verbose']
        output = run_cli(command, env, deadline)
        return {'pools': parse_cli_output('claude', output),
                'email': normalize_email(identity.get('email')), 'plan': identity.get('subscriptionType')}
    with tempfile.TemporaryDirectory(prefix='quota-agy-') as temporary:
        log = Path(temporary) / 'query.log'
        command = [executable, '-p', '/quota', '--output-format', 'json', '--print-timeout', '25s',
                   '--log-file', str(log)]
        output = run_cli(command, env, deadline)
        try:
            email = parse_antigravity_email(filtered_log(log,
                '/OAuth: authenticated successfully as / { print substr($0, index($0, "OAuth:")) }'))
        except (OSError, subprocess.SubprocessError):
            email = None
        return {'pools': parse_cli_output('antigravity', output), 'email': email, 'plan': None}


def run_cli(command, env, deadline):
    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               start_new_session=True, text=True)
    try:
        try:
            output, _ = process.communicate(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as error:
            raise TimeoutError('query timeout') from error
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)
        return output
    finally:
        stop_process(process)
        process.stdout.close()


class CodexSnapshots:
    """Incremental reader; file mtime is never used as the quota observation time."""

    def __init__(self):
        self.files = {}
        self.latest = {}
        self.lock = threading.Lock()

    def __call__(self, account):
        if account.harness != 'codex' or not account.account_dir:
            return None
        with self.lock:
            root = Path(account.account_dir) / 'sessions'
            for path in root.rglob('*.jsonl'):
                try:
                    stat = path.stat()
                    old = self.files.get(path)
                    offset, pending = (old['offset'], old['pending']) if old else (0, b'')
                    if old and (old['inode'] != stat.st_ino or stat.st_size < offset
                                or (stat.st_size == offset and stat.st_mtime_ns != old['mtime'])):
                        offset, pending = 0, b''
                    with path.open('rb') as stream:
                        stream.seek(offset)
                        chunk = stream.read(4 * 1024 * 1024)
                    offset += len(chunk)
                    lines = (pending + chunk).split(b'\n')
                    pending = lines.pop()
                    self.files[path] = {'inode': stat.st_ino, 'offset': offset,
                                        'mtime': stat.st_mtime_ns, 'pending': pending}
                except OSError:
                    continue
                for line in lines:
                    try:
                        event = json.loads(line)
                        payload = event.get('payload', {})
                        limits = payload.get('rate_limits')
                        if event.get('type') != 'event_msg' or payload.get('type') != 'token_count' or not isinstance(limits, dict):
                            continue
                        observed = timestamp(event['timestamp'])
                        active_shape = {'limitId': limits.get('limit_id'), 'primary': None, 'secondary': None}
                        for key in ('primary', 'secondary'):
                            source = limits.get(key)
                            if source is not None:
                                active_shape[key] = {'usedPercent': source['used_percent'],
                                                     'windowDurationMins': source['window_minutes'],
                                                     'resetsAt': source.get('resets_at')}
                        pools = normalize('codex', {'rateLimits': active_shape})
                        if observed is None or not any(p['five_hour'] or p['weekly'] for p in pools):
                            continue
                        previous = self.latest.get(account.key)
                        if previous is None or observed > previous[0]:
                            self.latest[account.key] = (observed, pools)
                    except (ValueError, KeyError, TypeError, AttributeError, OverflowError):
                        continue
            return self.latest.get(account.key)


def valid_title(value):
    return (isinstance(value, str) and len(value.strip()) <= 40
            and not any(unicodedata.category(char) == 'Cc' for char in value))


class Dashboard:
    def __init__(self, workspace, discovery, collector=collect, passive_reader=None, preferences_path=None):
        self.workspace = workspace if isinstance(workspace, dict) else {'name': Path(workspace).name, 'path': workspace}
        self.discovery = discovery
        self.collector = collector
        self.passive_reader = passive_reader or CodexSnapshots()
        self.metadata_reader = SessionMetadata()
        self.rows = {}
        self.accounts = []
        self.discovery_error = None
        self.discovery_at = None
        self.lock = threading.RLock()
        self.preferences_path = Path(preferences_path) if preferences_path is not None else Path(__file__).with_name('preferences.json')
        with self.lock:
            try:
                titles = json.loads(self.preferences_path.read_text(encoding='utf-8'))
                if not isinstance(titles, dict) or any(
                    harness not in INTERVALS or not isinstance(names, dict) or any(
                        normalize_email(email) != email or not valid_title(title) or not title
                        or title != title.strip() for email, title in names.items())
                    for harness, names in titles.items()):
                    raise ValueError('invalid preferences')
                self.titles = titles
            except (OSError, ValueError, UnicodeError):
                self.titles = {}
        self.discovery_lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=4)
        self.antigravity = {'querying': False, 'next_refresh_at': 0, 'failures': 0,
                            'email': None, 'pools': [], 'observed_at': None,
                            'error': None, 'error_detail': None}

    def _discover(self, now):
        with self.discovery_lock:
            if self.discovery_at is not None and now - self.discovery_at < 30:
                return
            try:
                accounts = self.discovery()
                with self.lock:
                    self.accounts = accounts
                    self.workspace = getattr(self.discovery, 'workspace', self.workspace)
                    self.discovery_error = None
            except Exception:
                with self.lock:
                    self.discovery_error = 'discovery_failed'
            self.discovery_at = now

    @staticmethod
    def _update(row, observed, pools, source):
        if row['observed_at'] is None or observed > row['observed_at']:
            row.update(observed_at=observed, pools=pools, source=source)

    def _groups(self):
        groups = {}
        for account in self.accounts:
            row = self.rows.get(account.key, {})
            email = row.get('email')
            identity = (account.harness, email) if email else (account.harness, account.key)
            groups.setdefault(identity, []).append(account)
        return list(groups.values())

    def _query(self, account, peers, fixed_now):
        try:
            result = self.collector(account)
            error = None
            detail = None
        except Exception as exception:
            error = 'timeout' if isinstance(exception, TimeoutError) else 'query_failed'
            if isinstance(exception, TimeoutError):
                detail = 'timeout'
            elif isinstance(exception, subprocess.CalledProcessError):
                detail = f'exit {exception.returncode}'
            elif isinstance(exception, (ValueError, KeyError, TypeError)):
                detail = 'parse'
            elif isinstance(exception, FileNotFoundError):
                detail = 'unavailable'
            else:
                detail = 'query'
        finished = time.time() if fixed_now is None else fixed_now
        with self.lock:
            row = self.rows[account.key]
            interval = INTERVALS[account.harness]
            if error is None:
                email = normalize_email(result.get('email'))
                # An explicit login change must not retain a previous account's quota.
                if row['email'] and email and row['email'] != email:
                    row.update(observed_at=None, pools=[], source=None)
                row.update(email=email, plan=result.get('plan'), identity_at=finished)
                self._update(row, finished, result['pools'], 'active')
                failures = 0
            else:
                failures = min(12, max(self.rows[a.key]['failures'] for a in peers) + 1)
                interval = min(interval * 2 ** failures, 3600)
            for peer in peers:
                self.rows[peer.key].update(querying=False, error=error, error_detail=detail, failures=failures,
                                          next_refresh_at=finished + interval)

    def _query_antigravity(self, account, fixed_now):
        try:
            result = self.collector(account)
            email = normalize_email(result['email'])
            pools = result['pools']
            if not isinstance(pools, list):
                raise ValueError('invalid quota pools')
            error, detail = None, None
        except Exception as exception:
            error = 'timeout' if isinstance(exception, TimeoutError) else 'query_failed'
            detail = ('timeout' if isinstance(exception, TimeoutError) else
                      f'exit {exception.returncode}' if isinstance(exception, subprocess.CalledProcessError) else
                      'parse' if isinstance(exception, (ValueError, KeyError, TypeError)) else
                      'unavailable' if isinstance(exception, FileNotFoundError) else 'query')
        finished = time.time() if fixed_now is None else fixed_now
        with self.lock:
            state = self.antigravity
            if error is None:
                state.update(email=email, pools=pools, observed_at=finished)
                state['failures'] = 0
            else:
                state['failures'] = min(12, state['failures'] + 1)
            interval = min(1200 * 2 ** state['failures'], 3600)
            state.update(querying=False, error=error, error_detail=detail,
                         next_refresh_at=finished + interval)

    def refresh(self, now=None, wait=True):
        current = time.time() if now is None else now
        self._discover(current)
        with self.lock:
            if self.discovery_error:
                return
            accounts = list(self.accounts)
        for account in accounts:
            with self.lock:
                row = self.rows.setdefault(account.key, {'pools': [], 'observed_at': None, 'source': None,
                    'querying': False, 'error': None, 'error_detail': None, 'failures': 0, 'next_refresh_at': current,
                    'email': account.email, 'plan': None, 'identity_at': None, 'metadata': None})
                if account.harness == 'antigravity':
                    row['email'] = account.email
            try:
                passive = self.passive_reader(account) if account.harness == 'codex' else None
            except Exception:
                passive = None
            try:
                metadata = self.metadata_reader(account)
            except Exception:
                metadata = None
            with self.lock:
                row['metadata'] = metadata
                if passive:
                    self._update(row, passive[0], passive[1], 'passive')
        futures = []
        with self.lock:
            for peers in self._groups():
                if peers[0].harness == 'antigravity':
                    continue
                rows = [self.rows[a.key] for a in peers]
                if any(r['querying'] for r in rows) or current < max(r['next_refresh_at'] for r in rows):
                    continue
                representative = next((a for a in peers if a.account_dir), None)
                if representative:
                    for row in rows:
                        row['querying'] = True
                    futures.append(self.executor.submit(self._query, representative, peers, now))
            agy_accounts = [a for a in accounts if a.harness == 'antigravity' and a.account_dir]
            if (agy_accounts and not self.antigravity['querying']
                    and current >= self.antigravity['next_refresh_at']):
                self.antigravity['querying'] = True
                futures.append(self.executor.submit(self._query_antigravity, agy_accounts[0], now))
        if wait:
            wait_futures(futures)

    def state(self, now=None):
        current = time.time() if now is None else now
        with self.lock:
            accounts = []
            for peers in self._groups():
                account = peers[0]
                rows = [self.rows.get(a.key, {}) for a in peers]
                latest = max(rows, key=lambda r: r.get('observed_at') or 0)
                identity = max(rows, key=lambda r: r.get('identity_at') or 0)
                email = identity.get('email')
                metadata = max((r['metadata'] for r in rows if r.get('metadata')),
                               key=lambda m: m['observed_at'], default={})
                observed = latest.get('observed_at')
                age = max(0, current - observed) if observed is not None else None
                pools = copy.deepcopy(latest.get('pools', []))
                source = latest.get('source')
                if account.harness == 'antigravity':
                    observed = self.antigravity['observed_at'] if email and email == self.antigravity['email'] else None
                    age = max(0, current - observed) if observed is not None else None
                    pools = copy.deepcopy(self.antigravity['pools']) if observed is not None else []
                    source = 'active' if observed is not None else None
                windows = [p.get(key) for p in pools for key in ('five_hour', 'weekly')]
                expired = any(w is not None and w['resets_at'] is not None and w['resets_at'] <= current for w in windows)
                if not any(w is not None for w in windows):
                    status = 'sem dados'
                elif expired or age >= INTERVALS[account.harness]:
                    status = 'desatualizado'
                elif any(w is None for w in windows):
                    status = 'parcial'
                else:
                    status = 'ok'
                account_id = account.harness + ':' + hashlib.sha256(email.encode()).hexdigest()[:16] if email else account.key
                row = {'id': account_id, 'harness': account.harness,
                       'email': email, 'plan': identity.get('plan'),
                       'title': self.titles.get(account.harness, {}).get(email) if email else None,
                       'account': email or 'conta não identificada',
                       'account_dirs': sorted({a.account_dir for a in peers if a.account_dir}),
                       'terminals': sorted({t for a in peers for t in a.terminals}),
                       'model': metadata.get('model'), 'effort': metadata.get('effort'),
                       'session_observed_at': metadata.get('observed_at'),
                       'status': status, 'age_seconds': age, 'pools': pools,
                       'querying': any(r.get('querying', False) for r in rows),
                       'observed_at': observed, 'source': source,
                       'error': next((r['error'] for r in rows if r.get('error')), None),
                       'error_detail': next((r.get('error_detail') for r in rows if r.get('error')), None),
                       'next_refresh_at': max((r.get('next_refresh_at', current) for r in rows), default=None)
                                          if any(a.account_dir for a in peers) else None}
                if account.harness == 'antigravity':
                    row.update(querying=self.antigravity['querying'],
                               error=self.antigravity['error'], error_detail=self.antigravity['error_detail'],
                               next_refresh_at=self.antigravity['next_refresh_at'] if any(a.account_dir for a in peers) else None,
                               keychain_limited=bool(email and self.antigravity['email']
                                                     and email != self.antigravity['email']))
                accounts.append(row)
            return {'workspace': copy.deepcopy(self.workspace), 'updated_at': current,
                    'discovery_error': self.discovery_error, 'accounts': accounts}

    def set_title(self, payload):
        if not isinstance(payload, dict) or set(payload) != {'harness', 'email', 'title'}:
            raise ValueError('invalid title request')
        harness, email, title = payload['harness'], normalize_email(payload['email']), payload['title']
        if not isinstance(harness, str) or harness not in INTERVALS or not email or not valid_title(title):
            raise ValueError('invalid title request')
        title = title.strip()
        with self.lock:
            if not any(a.harness == harness and self.rows.get(a.key, {}).get('email') == email for a in self.accounts):
                raise ValueError('unproven account')
            titles = copy.deepcopy(self.titles)
            if title:
                titles.setdefault(harness, {})[email] = title
            else:
                titles.get(harness, {}).pop(email, None)
                if not titles.get(harness):
                    titles.pop(harness, None)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.preferences_path.parent,
                                                 prefix='.preferences-', suffix='.tmp', delete=False) as stream:
                    temporary = Path(stream.name)
                    json.dump(titles, stream, ensure_ascii=False, allow_nan=False)
                    stream.write('\n')
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.preferences_path)
                self.titles = titles
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        return title or None

    def close(self):
        self.executor.shutdown(wait=True)


def make_server(dashboard, port=8765):
    static = Path(__file__).parent / 'static'
    assets = {'/': ('index.html', 'text/html'), '/styles.css': ('styles.css', 'text/css'),
              '/app.js': ('app.js', 'text/javascript'), '/quota.mjs': ('quota.mjs', 'text/javascript'),
              '/tilt.mjs': ('tilt.mjs', 'text/javascript')}

    class Handler(BaseHTTPRequestHandler):
        def do_PUT(self):
            if urlsplit(self.path).path != '/api/preferences/title':
                self.send_error(404)
                return
            host = self.headers.get('Host')
            allowed = {f'localhost:{self.server.server_port}', f'127.0.0.1:{self.server.server_port}'}
            content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if host not in allowed or self.headers.get('Origin') != f'http://{host}' or content_type != 'application/json':
                self.send_error(403)
                return
            try:
                length = int(self.headers.get('Content-Length', ''))
                if length < 0 or self.headers.get('Transfer-Encoding'):
                    raise ValueError('invalid body length')
                if length > 1024:
                    self.send_error(413)
                    return
                self.connection.settimeout(5)
                payload = json.loads(self.rfile.read(length).decode('utf-8'))
                title = dashboard.set_title(payload)
            except (ValueError, UnicodeError, TypeError):
                self.send_error(400)
                return
            except OSError:
                self.send_error(500)
                return
            body = json.dumps({'title': title}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/state':
                body = json.dumps(dashboard.state(), ensure_ascii=False, allow_nan=False).encode()
                content_type = 'application/json'
            elif path in assets:
                filename, content_type = assets[path]
                body = (static / filename).read_bytes()
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type + '; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            pass

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser(description='Backend local de cotas por CLI')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--accounts-json', type=Path)
    parser.add_argument('--maestri-root', type=Path)
    args = parser.parse_args()
    discovery = InjectedDiscovery(args.accounts_json) if args.accounts_json else MaestriDiscovery(args.maestri_root)
    dashboard = Dashboard(discovery.workspace, discovery)
    server = make_server(dashboard, args.port)
    stopped = threading.Event()

    def tick():
        while not stopped.is_set():
            dashboard.refresh(wait=False)
            stopped.wait(5)

    worker = threading.Thread(target=tick, daemon=True)
    worker.start()
    print(f'http://localhost:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopped.set()
        worker.join()
        server.server_close()
        dashboard.close()


if __name__ == '__main__':
    main()
