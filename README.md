# quota-board

[English below](#english)

Um painel local com as cotas das suas contas de **Claude Code**, **Codex** e **Antigravity**: a janela
de 5 horas, a semanal (em sete gomos, com o cursor "agora"), a hora de renovar e o detalhe de cada
janela no verso do card.

Os números vêm da própria CLI de cada ferramenta, por comandos administrativos que ela responde sem
passar por modelo: **nenhum token é gasto** e **nada sai da sua máquina** (o servidor só escuta em
127.0.0.1). Nenhuma IA participa.

```
npx github:cauecarneiro/Overview-Painel
```

Abre `http://127.0.0.1:8765` no navegador. `Ctrl-C` para parar. Precisa só do Node 18 ou mais novo e do git.
Para deixar instalado como comando `quota-board`:

```
npm install -g github:cauecarneiro/Overview-Painel
```

## O que é consultado

| Ferramenta | Comando | Intervalo |
|---|---|---|
| Claude Code | `claude --safe-mode --no-session-persistence -p /usage --output-format stream-json` e `claude auth status --json` | 5 min |
| Codex | `codex app-server` (JSON-RPC: `account/read`, `account/rateLimits/read`) | 5 min |
| Antigravity | `agy -p /quota --output-format json` | 20 min |

A resposta só é aceita quando a CLI confirma que não gastou token (no Claude Code, `num_turns 0` e
todos os contadores em zero). Se uma consulta falhar, a última leitura boa fica na tela e a próxima
tentativa espera o dobro, até 1 hora.

Cada CLI precisa estar instalada e com login feito. A que não estiver no `PATH` simplesmente não
aparece.

## Mais de uma conta

Uma conta por pasta de configuração. Repita a opção para cada pasta:

```
npx github:cauecarneiro/Overview-Painel --codex-home ~/.codex-trabalho --codex-home ~/.codex-pessoal
npx github:cauecarneiro/Overview-Painel --claude-config-dir ~/.claude-outra   # experimental: a CLI do Claude Code só mostra a cota da conta da pasta padrão em alguns casos
npx github:cauecarneiro/Overview-Painel --antigravity-home ~/casa-b        # o Antigravity guarda o login por HOME
```

Ou um arquivo `~/.config/quota-board/config.json` (lido sozinho, se existir):

```json
{ "claude": ["~/.claude-outra"], "codex": ["~/.codex-trabalho"], "antigravity": ["~/casa-b"], "port": 8765 }
```

## Outras opções

```
--once        consulta tudo uma vez, imprime o estado em JSON e sai (bom para scripts)
--port N      outra porta
--no-open     não abre o navegador
--config F    outro arquivo de configuração
```

`GET /api/state` devolve o mesmo JSON do `--once`; `POST /api/refresh` força uma consulta.

## Observações

- O `agy -p /quota` sobe os servidores MCP configurados na pasta do Antigravity e leva uns 5 s; ele
  também deixa um log pequeno em `~/.gemini/antigravity-cli/log` a cada consulta. É da CLI, não
  do quota-board.
- O quota-board não lê sessões, conversas nem arquivos de configuração: só o que as CLIs respondem.

## Origem e licença

As consultas às CLIs e o desenho dos cards vêm do
[cotas-dashboard](https://github.com/fbtostadev/cotas-dashboard) (MIT), portados para Node e
adaptados (verso do card no clique, gomos da semanal, sem backend em Python). MIT, veja `LICENSE`.

## Contribuindo

Issues e PRs são bem-vindos: veja `CONTRIBUTING.md`. Regras de ouro: sem dependências, sem token,
nada sai da máquina, e nenhum dado pessoal (e-mail, caminho, saída real de CLI) em issues ou diffs.

---

## English

**quota-board** is a local dashboard for your **Claude Code**, **Codex** and **Antigravity** quotas:
the 5-hour window, the weekly window (split in seven days, with a "now" cursor), reset times and a
per-window detail on the back of each card.

Numbers come from each tool's own CLI through administrative commands that never hit a model:
**no tokens are spent** and **nothing leaves your machine** (the server binds to 127.0.0.1 only).

```
npx github:cauecarneiro/Overview-Painel
```

Opens `http://127.0.0.1:8765`. `Ctrl-C` stops it. Needs only Node 18+ and git. To install it as a
`quota-board` command: `npm install -g github:cauecarneiro/Overview-Painel`.

| Tool | Command | Interval |
|---|---|---|
| Claude Code | `claude --safe-mode --no-session-persistence -p /usage --output-format stream-json` and `claude auth status --json` | 5 min |
| Codex | `codex app-server` (JSON-RPC: `account/read`, `account/rateLimits/read`) | 5 min |
| Antigravity | `agy -p /quota --output-format json` | 20 min |

A reply is only accepted when the CLI confirms no tokens were used. On failure the last good reading
stays on screen and the next attempt backs off (doubling, up to 1 hour). CLIs missing from `PATH`
simply do not show up.

More accounts, one per config folder: `--codex-home <dir>`, `--antigravity-home <dir>`,
`--claude-config-dir <dir>` (experimental), or `~/.config/quota-board/config.json`:

```json
{ "claude": [], "codex": ["~/.codex-work"], "antigravity": ["~/home-b"], "port": 8765 }
```

Other flags: `--once` (print the state as JSON and exit), `--port N`, `--no-open`, `--config F`.
`GET /api/state` returns the same JSON; `POST /api/refresh` forces a query. The UI is in Portuguese
for now; translations welcome (see `CONTRIBUTING.md`).

CLI queries and card design come from [cotas-dashboard](https://github.com/fbtostadev/cotas-dashboard)
(MIT), ported to Node and adapted. MIT licensed.
