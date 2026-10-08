#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Board, discoverAccounts } = require('../lib/board');
const { createServer } = require('../lib/server');
const pkg = require('../package.json');

const HELP = `quota-board ${pkg.version}: as cotas do Claude Code, do Codex e do Antigravity, num painel local.

Uso:
  quota-board                        abre o painel em http://127.0.0.1:8765
  npx quota-board --once             consulta tudo uma vez, imprime JSON e sai
  npx quota-board --port 9000        outra porta
  npx quota-board --no-open          não abre o navegador

Contas além da padrão (repita a opção para cada pasta):
  --claude-config-dir <pasta>        outra pasta de configuração do Claude Code (como CLAUDE_CONFIG_DIR)
  --codex-home <pasta>               outra pasta do Codex (como CODEX_HOME)
  --antigravity-home <pasta>         outro HOME do Antigravity (uma conta por HOME)
  --config <arquivo>                 JSON com {"claude": [...], "codex": [...], "antigravity": [...], "port": N}
                                     (padrão: ~/.config/quota-board/config.json, se existir)

As consultas são comandos administrativos da própria CLI (claude -p /usage, codex app-server,
agy -p /quota): nenhum token é gasto e nada sai desta máquina.`;

function parseArgs(argv) {
  const options = { claude: [], codex: [], antigravity: [], port: null, open: true, once: false, help: false, version: false, config: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${arg} precisa de um valor`); return argv[++i]; };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--once' || arg === '--json') options.once = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--port') options.port = Number(next());
    else if (arg === '--config') options.config = next();
    else if (arg === '--claude-config-dir') options.claude.push(next());
    else if (arg === '--codex-home') options.codex.push(next());
    else if (arg === '--antigravity-home') options.antigravity.push(next());
    else throw new Error(`opção desconhecida: ${arg}`);
  }
  return options;
}

function loadConfig(file) {
  const target = file || path.join(os.homedir(), '.config', 'quota-board', 'config.json');
  if (!fs.existsSync(target)) { if (file) throw new Error(`config não encontrado: ${target}`); return { claude: [], codex: [], antigravity: [], port: null }; }
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  return { claude: data.claude || [], codex: data.codex || [], antigravity: data.antigravity || [], port: data.port || null };
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref(); } catch (_) { /* sem navegador */ }
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(HELP); process.exit(2); }
  if (options.help) { console.log(HELP); return; }
  if (options.version) { console.log(pkg.version); return; }
  const config = loadConfig(options.config);
  const accountsOptions = { claude: [...config.claude, ...options.claude], codex: [...config.codex, ...options.codex], antigravity: [...config.antigravity, ...options.antigravity] };
  const accounts = discoverAccounts(accountsOptions);
  const board = new Board(accounts);
  if (!accounts.length) console.error('Nenhuma CLI encontrada no PATH (claude, codex, agy). O painel abre vazio.');

  if (options.once) {
    await board.refresh({ force: true });
    console.log(JSON.stringify(board.state(), null, 2));
    return;
  }
  const port = options.port || config.port || 8765;
  const server = createServer(board);
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`quota-board no ar em ${url}  (${accounts.length} conta${accounts.length === 1 ? '' : 's'}; Ctrl-C para parar)`);
    for (const a of accounts) console.log(`  ${a.harness.padEnd(11)} ${a.dir}`);
    if (options.open) openBrowser(url);
  });
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `a porta ${port} já está em uso (use --port)` : e.message); process.exit(1); });
  const tick = () => board.refresh().catch(() => {});
  tick();
  setInterval(tick, 20000);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
