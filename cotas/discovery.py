"""Descoberta Maestri; somente IDs e diretórios de conta chegam ao Python."""

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

ALLOWED_ENV = {'MAESTRI_TERMINAL_ID', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'HOME'}


@dataclass
class Account:
    harness: str
    account_dir: str | None
    terminals: list[str]
    email: str | None = None

    def __post_init__(self):
        if self.account_dir:
            self.account_dir = str(Path(self.account_dir).expanduser().resolve())
        self.terminals = sorted(set(self.terminals))

    @property
    def key(self):
        identity = (f'{self.account_dir}|{self.email}' if self.harness == 'antigravity' and self.email
                    else self.account_dir or '|'.join(self.terminals))
        return self.harness + ':' + hashlib.sha256(identity.encode()).hexdigest()[:16]


def read_antigravity_email(pid, home):
    """Identify a running CLI by its open session log, never by login files."""
    if not home:
        return None
    try:
        opened = subprocess.run(['lsof', '-p', str(pid), '-Fn'], capture_output=True,
                                text=True, check=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    root = (Path(home) / '.gemini/antigravity-cli/log').resolve()
    paths = {Path(line[1:]) for line in opened.splitlines() if line.startswith('n')}
    logs = [path for path in paths if path.name.startswith('cli-') and path.suffix == '.log'
            and path.resolve().parent == root]
    emails = set()
    for log in logs:
        try:
            filtered = subprocess.run(['/usr/bin/awk',
                '/OAuth: authenticated successfully as / { print substr($0, index($0, "OAuth:")) }',
                str(log)], capture_output=True, text=True, check=True, timeout=2).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        for line in filtered.splitlines():
            match = re.fullmatch(r'OAuth: authenticated successfully as ([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)', line.strip())
            if match:
                emails.add(match[1].casefold())
    return emails.pop() if len(emails) == 1 else None


def process_harness(executable):
    name = Path(executable).name
    if name in ('codex', 'claude', 'agy'):
        return {'agy': 'antigravity'}.get(name, name)
    if '/claude/versions/' in executable:
        return 'claude'
    return None


def parse_process_list(output, environments):
    processes = []
    for line in output.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) != 2 or not fields[0].isdigit():
            continue
        pid, executable = fields
        harness = process_harness(executable)
        if not harness:
            continue
        env = {}
        for entry in environments.get(pid, '').splitlines():
            key, separator, value = entry.partition('=')
            if separator and key in ALLOWED_ENV:
                env[key] = value
        if env.get('MAESTRI_TERMINAL_ID'):
            processes.append({'pid': int(pid), 'harness': harness, 'env': env})
    return processes


# ps feeds awk directly: the backend never receives or logs the full environment.
# Values with spaces are preserved until the next environment assignment.
ENV_FILTER = r'''
{
    keep = 0; value = "";
    for (i = 1; i <= NF; i++) {
        if ($i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
            if (keep) print value;
            keep = ($i ~ /^(MAESTRI_TERMINAL_ID|CODEX_HOME|CLAUDE_CONFIG_DIR|HOME)=/);
            value = $i;
        } else if (keep) {
            value = value " " $i;
        }
    }
    if (keep) print value;
}
'''


def read_processes():
    listed = subprocess.run(
        ['/bin/ps', '-axo', 'pid=,comm='], check=True,
        capture_output=True, text=True, timeout=10,
    ).stdout
    environments = {}
    for line in listed.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit() or not process_harness(parts[1]):
            continue
        with subprocess.Popen(
            ['/bin/ps', 'eww', '-p', parts[0], '-o', 'command='],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        ) as process:
            try:
                filtered = subprocess.run(
                    ['/usr/bin/awk', ENV_FILTER], stdin=process.stdout,
                    capture_output=True, text=True, check=True, timeout=5,
                )
                process.stdout.close()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                continue
        environments[parts[0]] = filtered.stdout
    return parse_process_list(listed, environments)


def node_harness(terminal):
    kind = terminal.get('agentType', '')
    if kind in ('codex', 'claude', 'claude_code', 'antigravity_cli'):
        return {'claude_code': 'claude', 'antigravity_cli': 'antigravity'}.get(kind, kind)
    text = (terminal.get('name', '') + ' ' + terminal.get('command', '')).lower()
    for word, harness in [('codex', 'codex'), ('claude', 'claude'), ('antigravity', 'antigravity'), ('agy', 'antigravity')]:
        if word in text:
            return harness
    return None


def discover_accounts(terminals, processes):
    grouped = {}
    antigravity_emails = {}
    for terminal in terminals:
        if terminal.get('status') != 'running' or terminal.get('isUnloaded', False):
            continue
        matches = [p for p in processes if p['env'].get('MAESTRI_TERMINAL_ID') == terminal['id']]
        identities = set()
        for process in matches:
            harness, env = process['harness'], process['env']
            home = env.get('HOME')
            directory = None
            if harness == 'codex':
                directory = env.get('CODEX_HOME') or (str(Path(home) / '.codex') if home else None)
            elif harness == 'claude':
                directory = env.get('CLAUDE_CONFIG_DIR') or (str(Path(home) / '.claude') if home else None)
            elif harness == 'antigravity':
                directory = home
            if directory and Path(directory).is_absolute():
                directory = str(Path(directory).resolve())
            else:
                directory = None
            email = None
            if harness == 'antigravity':
                pid = process['pid']
                if 'email' in process:
                    email = process['email']
                elif pid not in antigravity_emails:
                    try:
                        antigravity_emails[pid] = read_antigravity_email(pid, home)
                    except (OSError, subprocess.SubprocessError, ValueError):
                        antigravity_emails[pid] = None
                if 'email' not in process:
                    email = antigravity_emails[pid]
            identities.add((harness, directory, email))
        if len(identities) == 1:
            harness, directory, email = identities.pop()
        else:
            harness, directory, email = node_harness(terminal), None, None
        if not harness:
            continue
        name = terminal.get('name') or terminal['id']
        account = Account(harness, directory, [name], email)
        if account.key in grouped:
            previous = grouped[account.key]
            previous.terminals = sorted(set(previous.terminals + account.terminals))
            # Claude has one account; a proven process is sufficient for its single card.
            if previous.account_dir is None and directory:
                previous.account_dir = directory
        else:
            grouped[account.key] = account
    return sorted(grouped.values(), key=lambda a: (a.harness, a.account_dir or '', a.terminals))


class MaestriDiscovery:
    def __init__(self, root=None, process_reader=read_processes):
        self.root = Path(root or Path.home() / '.maestri')
        self.process_reader = process_reader
        self.workspace = {'name': 'Maestri', 'path': None}

    def __call__(self):
        app = json.loads((self.root / 'app-state.json').read_text())['payload']
        workspace_id = app['activeWorkspaceId']
        if not isinstance(workspace_id, str) or Path(workspace_id).name != workspace_id or workspace_id in ('.', '..'):
            raise ValueError('invalid workspace id')
        payload = json.loads((self.root / 'workspaces' / workspace_id / 'workspace.json').read_text())['payload']
        terminals = []
        for node in payload['nodes']:
            terminal = node.get('content', {}).get('terminal', {}).get('_0')
            if terminal:
                terminals.append(terminal)
        processes = self.process_reader()
        accounts = discover_accounts(terminals, processes)
        self.workspace = {'id': workspace_id, 'name': payload['name'], 'path': payload['workingDirectory']}
        return accounts


class InjectedDiscovery:
    def __init__(self, path):
        self.path = Path(path)
        self.workspace = {'name': 'Injetado', 'path': None}

    def __call__(self):
        data = json.loads(self.path.read_text())
        grouped = {}
        for terminal in data['terminals']:
            harness = terminal['harness']
            if harness not in ('codex', 'claude', 'antigravity'):
                raise ValueError('invalid harness')
            directory = terminal.get('account_dir')
            if directory and not Path(directory).expanduser().is_dir():
                raise ValueError('account directory does not exist')
            account = Account(harness, directory, [terminal['name']])
            if account.key in grouped:
                grouped[account.key].terminals = sorted(set(grouped[account.key].terminals + account.terminals))
            else:
                grouped[account.key] = account
        self.workspace = data['workspace']
        return list(grouped.values())
