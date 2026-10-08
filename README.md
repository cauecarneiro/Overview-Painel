# quota-board

[English below](#english)

Um painel local que mostra quanto você já usou da cota das suas contas de **Claude Code**, **Codex** e
**Antigravity**: a janela de 5 horas, a semanal (dividida em sete dias, com um cursor "agora"), a hora
em que cada uma renova e o detalhe de cada janela no verso do card.

Os números vêm da própria CLI de cada ferramenta, por comandos administrativos que ela responde sem
passar por modelo. Por isso:

- **nenhum token é gasto**, nem da sua cota nem de nenhuma conta;
- **nada sai da sua máquina**: o painel só escuta em `127.0.0.1` e não envia nada para a internet;
- **nenhuma IA participa**: é um programa comum que pergunta e desenha.

## Antes de começar: o que você precisa

| O quê | Por quê | Como conferir |
|---|---|---|
| **Node.js 18 ou mais novo** | o painel é um programa Node, sem dependências | `node -v` |
| **git** | o jeito de instalar abaixo baixa o código do GitHub | `git --version` |
| **Pelo menos uma CLI instalada e com login feito**: Claude Code (`claude`), Codex (`codex`) ou Antigravity (`agy`) | é de lá que vêm os números | `claude --version`, `codex --version`, `agy --version` |

Se não tiver o Node, instale em [nodejs.org](https://nodejs.org) (botão "LTS"). No macOS também serve
`brew install node`.

**Fazer o login em cada CLI** (uma vez só, se ainda não fez):

```
claude auth login        # Claude Code
codex login              # Codex
agy                      # Antigravity: abra e entre com a sua conta
```

Você não precisa ter as três. A que não estiver instalada simplesmente não aparece no painel.

Testado em macOS e Linux. No Windows ainda não foi testado: se tentar, conte na issue como foi.

## Instalar e usar

**Jeito mais simples: sem instalar nada.** Um comando baixa e abre o painel:

```
npx github:cauecarneiro/Overview-Painel
```

Na primeira vez demora alguns segundos (ele baixa o código). Depois abre o navegador em
`http://127.0.0.1:8765`. Para fechar, volte ao terminal e aperte `Ctrl-C`.

**Se for usar sempre:** instale uma vez e chame pelo nome curto.

```
npm install -g github:cauecarneiro/Overview-Painel
quota-board
```

Para atualizar depois, rode o `npm install -g` de novo. Para remover: `npm uninstall -g quota-board`.

**Se você fez um fork** (ou quer mexer no código):

```
git clone https://github.com/cauecarneiro/Overview-Painel.git
cd Overview-Painel
node bin/quota-board.js
```

(Se você fez um fork, troque `cauecarneiro` pelo seu usuário nos comandos acima.)

## O que você vai ver

Um card por conta. Cada card tem:

- **5h**: a barra grossa, com quanto da janela de 5 horas já foi usado e em quanto tempo ela reabre;
- **Semana**: a barra fina, dividida em sete gomos (um por dia). Passe o mouse num gomo para ver o dia.
  O traço vertical é o "agora": se o preenchimento passou do traço, você está gastando mais rápido
  que o ritmo da janela;
- **Clique no card** para virar e ver o detalhe daquela janela (tempo até reabrir com segundos, hora
  do reset, usada e livre). Clique de novo, aperte `Voltar` ou `Esc` para voltar;
- no Claude Code, uma barra semanal extra para o modelo que tiver cota própria; no Antigravity, uma
  janela para o Gemini e outra para Claude/GPT.

No alto: **Atualizar** consulta as CLIs agora, e **Tema** alterna claro e escuro.
O número fica vermelho quando passa de 90%.

## Como funciona (e o que é consultado)

| Ferramenta | Comando que o painel roda | A cada |
|---|---|---|
| Claude Code | `claude --safe-mode --no-session-persistence -p /usage --output-format stream-json` e `claude auth status --json` | 5 min |
| Codex | `codex app-server` (pergunta `account/read` e `account/rateLimits/read`) | 5 min |
| Antigravity | `agy -p /quota --output-format json` | 20 min |

A resposta só é aceita se a CLI confirmar que não gastou token (no Claude Code: zero turnos e todos
os contadores de token em zero). Se uma consulta falhar, a última leitura boa continua na tela e a
próxima tentativa espera o dobro do tempo, até 1 hora. O painel não lê suas conversas, sessões nem
arquivos de configuração: só o que as CLIs respondem.

## Mais de uma conta

O painel usa a pasta padrão de cada CLI. Para somar outras contas, aponte as pastas delas (repita a
opção para cada uma):

```
npx github:cauecarneiro/Overview-Painel --codex-home ~/.codex-trabalho --codex-home ~/.codex-pessoal
npx github:cauecarneiro/Overview-Painel --antigravity-home ~/casa-b
npx github:cauecarneiro/Overview-Painel --claude-config-dir ~/.claude-outra   # experimental
```

Ou grave de uma vez em `~/.config/quota-board/config.json`, que é lido sozinho:

```json
{ "claude": [], "codex": ["~/.codex-trabalho"], "antigravity": ["~/casa-b"], "port": 8765 }
```

Cada pasta é uma conta: o `--codex-home` funciona como a variável `CODEX_HOME` do Codex; o
`--antigravity-home` é um `HOME` separado, porque o Antigravity guarda o login por `HOME`.
O `--claude-config-dir` é experimental: a CLI do Claude Code nem sempre mostra a cota da conta de
uma pasta diferente da padrão.

## Todas as opções

```
quota-board                  abre o painel (http://127.0.0.1:8765)
quota-board --once           consulta tudo uma vez, imprime o estado em JSON e sai (bom para scripts)
quota-board --port 9000      outra porta
quota-board --no-open        não abre o navegador
quota-board --config <arq>   outro arquivo de configuração
quota-board --help           ajuda
quota-board --version        versão
```

Com o painel no ar, `GET http://127.0.0.1:8765/api/state` devolve o mesmo JSON do `--once`, e
`POST /api/refresh` força uma consulta.

## Se algo não funcionar

| O que você vê | O que fazer |
|---|---|
| `Nenhuma CLI encontrada no PATH` | instale pelo menos uma CLI (`claude`, `codex` ou `agy`) e abra um terminal novo; confira com `claude --version` |
| Card sem números ("sem dados") | faça o login da CLI daquela ferramenta (veja acima) e clique em **Atualizar** |
| "última consulta não concluída" no card | a CLI não respondeu a tempo (rede ou login vencido); o painel tenta de novo sozinho, com espera crescente |
| "inativo há N min" no card | as leituras pararam de chegar; veja a mensagem de erro no verso do card |
| `a porta 8765 já está em uso` | use `--port 9000` (ou outro número) |
| `command not found: npx` ou `node` | instale o Node.js (veja o começo) |
| `git` não encontrado ao rodar o `npx github:...` | instale o git: [git-scm.com](https://git-scm.com) |
| Antigravity demora uns segundos | normal: o `agy -p /quota` sobe os servidores MCP configurados na pasta dele antes de responder |

## Privacidade, em uma frase

O painel executa as CLIs que já estão na sua máquina, mostra o resultado numa página que só você
abre, e não guarda nem envia nada. O código é pequeno e está todo aqui para você conferir.

## Contribuindo

Issues e PRs são bem-vindos: veja [CONTRIBUTING.md](CONTRIBUTING.md). Regras de ouro: sem
dependências, sem token, nada sai da máquina, e nenhum dado pessoal (e-mail, caminho, saída real de
CLI) em issues ou diffs. Para reportar um problema de segurança, veja [SECURITY.md](SECURITY.md).

## Origem e licença

As consultas às CLIs e o desenho dos cards vêm do
[cotas-dashboard](https://github.com/fbtostadev/cotas-dashboard) (MIT), portados para Node e
adaptados (verso do card no clique, gomos da semanal, sem backend em Python). MIT, veja `LICENSE`.

---

## English

**quota-board** is a local dashboard showing how much of your quota you have used on your **Claude
Code**, **Codex** and **Antigravity** accounts: the 5-hour window, the weekly window (split in seven
days, with a "now" cursor), reset times, and a per-window detail on the back of each card.

Numbers come from each tool's own CLI through administrative commands that never hit a model, so
**no tokens are spent**, **nothing leaves your machine** (the server binds to `127.0.0.1` only) and
**no AI is involved**.

### Requirements

- **Node.js 18+** (`node -v`) and **git** (`git --version`).
- At least one CLI installed **and logged in**: `claude auth login`, `codex login`, or `agy`
  (open it and sign in). A CLI missing from your `PATH` simply does not show up.
- Tested on macOS and Linux. Windows is untested.

### Install and run

No install, one command:

```
npx github:cauecarneiro/Overview-Painel
```

It opens `http://127.0.0.1:8765` in your browser. `Ctrl-C` in the terminal stops it.

To keep it as a command:

```
npm install -g github:cauecarneiro/Overview-Painel
quota-board
```

Update by running the `npm install -g` again; remove with `npm uninstall -g quota-board`.
If you forked the repo, replace `cauecarneiro` with your username. Hacking on it:

```
git clone https://github.com/cauecarneiro/Overview-Painel.git
cd Overview-Painel && node bin/quota-board.js
```

### Using it

One card per account. The thick bar is the 5-hour window, the thin one the weekly window (seven
segments, hover one to see the day; the vertical tick is "now"). Click a card to flip it and see that
window's details; click again, press `Esc` or `Voltar` to flip back. **Atualizar** queries the CLIs
now, **Tema** toggles light and dark. The UI is in Portuguese for now; translations are welcome.

### What is queried

| Tool | Command | Interval |
|---|---|---|
| Claude Code | `claude --safe-mode --no-session-persistence -p /usage --output-format stream-json` and `claude auth status --json` | 5 min |
| Codex | `codex app-server` (JSON-RPC: `account/read`, `account/rateLimits/read`) | 5 min |
| Antigravity | `agy -p /quota --output-format json` | 20 min |

A reply is only accepted when the CLI confirms no tokens were used. On failure the last good reading
stays on screen and the next attempt backs off (doubling, up to 1 hour). The dashboard never reads
your conversations, sessions or config files.

### More accounts

One account per config folder; repeat the flag for each one:
`--codex-home <dir>`, `--antigravity-home <dir>` (a separate `HOME`, since Antigravity keeps its login
per `HOME`), `--claude-config-dir <dir>` (experimental). Or put them in
`~/.config/quota-board/config.json`:

```json
{ "claude": [], "codex": ["~/.codex-work"], "antigravity": ["~/home-b"], "port": 8765 }
```

Other flags: `--once` (print the state as JSON and exit), `--port N`, `--no-open`, `--config F`,
`--help`, `--version`. `GET /api/state` returns the same JSON; `POST /api/refresh` forces a query.

### Troubleshooting

- *No CLI found in PATH*: install one of `claude`, `codex`, `agy` and open a new terminal.
- *Card shows "sem dados" (no data)*: log in to that CLI, then hit **Atualizar**.
- *Port 8765 in use*: pass `--port 9000`.
- *`npx github:...` fails*: make sure `git` and Node 18+ are installed.
- *Antigravity takes a few seconds*: `agy -p /quota` starts the MCP servers configured in its folder first.

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed; CLI queries and card
design come from [cotas-dashboard](https://github.com/fbtostadev/cotas-dashboard) (MIT).
