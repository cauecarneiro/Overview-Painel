"""Somente modelo/esforço da sessão local mais recente; nenhum texto é exposto."""

import json
import re
import subprocess
from datetime import datetime
from pathlib import Path


def record_time(value, fallback):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.timestamp() if parsed.tzinfo else fallback
    except (ValueError, AttributeError):
        return fallback


def text(value):
    return value if isinstance(value, str) and value.strip() else None


class SessionMetadata:
    def __init__(self):
        self.cache = {}

    def __call__(self, account):
        if not account.account_dir:
            return None
        root = Path(account.account_dir)
        folder, pattern = {'codex': ('sessions', '*.jsonl'),
                           'claude': ('projects', '*.jsonl'),
                           'antigravity': ('.gemini/antigravity-cli/log', 'cli-*.log')}[account.harness]
        candidates = []
        for path in (root / folder).rglob(pattern):
            try:
                stat = path.stat()
                candidates.append((stat.st_mtime_ns, str(path), path, stat))
            except OSError:
                continue
        for _, _, path, stat in sorted(candidates, reverse=True):
            version = (stat.st_mtime_ns, stat.st_size, stat.st_ino)
            key = (account.harness, str(path))
            cached = self.cache.get(key)
            if cached and cached[0] == version:
                result = cached[1]
            else:
                result = self.read(account.harness, path, stat)
                self.cache[key] = (version, result)
            if result is not None:
                return result
        return None

    def read(self, harness, path, stat):
        result = {'model': None, 'effort': None, 'observed_at': stat.st_mtime}
        try:
            if harness == 'antigravity':
                # Keep only the selected model and timestamp, never other log lines.
                output = subprocess.run(['/usr/bin/awk',
                    '/Propagating selected model override to backend: label=/ { print }', str(path)],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=2, check=True).stdout
                for line in output.splitlines():
                    match = re.search(r'Propagating selected model override to backend: label="([^"]+)"', line)
                    if not match:
                        continue
                    label = match[1]
                    effort = re.search(r' \((Low|Medium|High|Xhigh|Max)\)$', label, re.I)
                    result['model'] = label[:effort.start()] if effort else label
                    result['effort'] = effort[1].casefold() if effort else None
                    date = re.match(r'cli-(\d{4})\d{4}_', path.name)
                    stamp = re.match(r'I(\d{2})(\d{2}) (\d{2}:\d{2}:\d{2}\.\d+)', line)
                    if date and stamp:
                        result['observed_at'] = datetime.fromisoformat(
                            f'{date[1]}-{stamp[1]}-{stamp[2]}T{stamp[3]}').timestamp()
            else:
                with path.open() as stream:
                    for line in stream:
                        try:
                            event = json.loads(line)
                            if harness == 'codex' and event.get('type') == 'turn_context':
                                payload = event.get('payload', {})
                                model = text(payload.get('model'))
                                if model and model.startswith('codex-auto-'):
                                    return None
                                effort = text(payload.get('effort')) or text(payload.get('reasoning_effort'))
                            elif harness == 'claude' and event.get('type') == 'assistant':
                                model = text(event.get('message', {}).get('model'))
                                effort = text(event.get('perTurnEffort')) or text(event.get('effort'))
                            else:
                                continue
                            result = {'model': model, 'effort': effort if model else None,
                                      'observed_at': record_time(event.get('timestamp'), stat.st_mtime)}
                        except (ValueError, TypeError, AttributeError):
                            continue
        except (OSError, ValueError, subprocess.SubprocessError):
            result = {'model': None, 'effort': None, 'observed_at': stat.st_mtime}
        return result
