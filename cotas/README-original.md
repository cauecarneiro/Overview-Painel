# Dashboard local de cotas

Dashboard HTML/CSS/JS sem dependências, servido por um backend Python com biblioteca padrão. A descoberta seleciona os terminais ativos do workspace e acha os diretórios de login. As consultas comprovam o e-mail; a API agrupa por `(harness, e-mail)`, mesmo quando a conta usa vários diretórios. Sem e-mail comprovado, mantém o diretório separado e mostra `conta não identificada`. A cota consultada é global da conta.

`GET /api/state` retorna workspace, horário de atualização e contas com harness, `email`, `plan`, `account_dirs`, terminais, pools, percentuais usados/restantes, horário de reset, idade da observação e estado de erro/desatualização. Cada conta expõe `querying` (bool), `observed_at` e `source` (`active` ou `passive`; nulo antes da primeira observação). Ausência de fonte é representada por dados nulos e estado `sem dados`, nunca por zero. `model` e `effort` vêm da sessão mais recente comprovada entre os diretórios da conta; se faltarem, ficam nulos. A interface consulta a API a cada 5 s; resumo e tokens de sessão ficam fora desta entrega.

Os coletores usam somente as CLIs: Codex `account/read` e `account/rateLimits/read` no mesmo app-server; Claude `auth status --json` e `/usage` em `stream-json`; Antigravity `/quota` com `--log-file` temporário, uma vez por máquina (ver abaixo). Do log do Antigravity, um filtro extrai somente `OAuth: authenticated successfully as <e-mail>`; o temporário é removido inclusive em erro/timeout. Não leem arquivos de autenticação, `google_accounts.json`, JWTs ou estados da Orquestra. A CLI pode persistir seus próprios logs ao consultar. Plano Antigravity fica nulo se a rota não o comprovar.

Consultas independem do polling HTTP: 5 minutos por conta Codex/Claude, 20 minutos para a consulta única do Antigravity. Um coletor por vez por conta; timeout e backoff em falha (até 1 hora). Esses intervalos são escolhas conservadoras, não limites oficialmente garantidos. Resets vencidos são marcados como desatualizados, sem presumir cota livre. Não há geração de modelo nas rotas verificadas.

## Reuso e integração em um monitor maior

Este módulo foi feito para ser **incorporado** a um dashboard maior. Dois caminhos, do mais simples ao mais profundo (o primeiro é o recomendado; nenhum dos dois foi testado dentro de outro projeto ainda):

1. **Sidecar (recomendado).** Rode o backend em porta própria (`python3 backend.py --port <porta>`, escuta só `127.0.0.1`) e consuma `GET /api/state` a partir do monitor maior, por `fetch` ou por proxy do seu servidor, ou embuta a página `/` num `iframe`. Não exige tocar no código e funciona com qualquer stack do host.
2. **Código embutido.** Copie a pasta para dentro do host (por exemplo `quotas/`) e use os módulos:

| Módulo | Papel | Como reusar |
|---|---|---|
| `discovery.py` | Descobre as contas em uso. `MaestriDiscovery` lê o Maestri; `InjectedDiscovery` lê um JSON. | **Ponto de troca principal:** qualquer objeto chamável que devolva uma lista de `Account(harness, account_dir, terminals, email)` e tenha o atributo `workspace` serve. O host injeta o próprio inventário de contas. |
| `backend.py` | Coletores por CLI (Codex, Claude, Antigravity), agendamento, backoff e o servidor HTTP. | `Dashboard(workspace, discovery, collector=collect, passive_reader=None, preferences_path=None)` aceita coletor, leitor passivo e caminho das preferências injetados. `make_server(dashboard, port)` monta o servidor; `dashboard.state()` devolve o dicionário do `/api/state` sem HTTP. |
| `sessions.py` | Modelo e esforço da sessão local mais recente. | Independente; só lê arquivos locais das CLIs. |
| `static/quota.mjs` | Lógica pura da interface (cursor, alerta, duração, conteúdo do popover, formato do modelo). Sem DOM. | Reutilizável em qualquer front-end, e é a parte mais bem testada (`node --test`). |
| `static/tilt.mjs`, `static/app.js`, `static/styles.css` | Efeito de tilt, renderização e estilo do card. | Acoplados ao HTML desta página; reuse como referência ou copie junto com `index.html`. |

**Contrato de dados** (`GET /api/state`): `{workspace, updated_at, discovery_error, accounts[]}`. Cada conta traz `id`, `harness` (`codex`, `claude` ou `antigravity`), `email`, `plan`, `title`, `account`, `account_dirs`, `terminals`, `model`, `effort`, `status`, `age_seconds`, `querying`, `observed_at`, `source`, `error`, `next_refresh_at` e `pools[]`, onde cada pool tem `id` e as janelas `five_hour` e `weekly` com `used_percent`, `remaining_percent`, `resets_at` e `window_minutes`. Valor sem fonte é `null` e a interface mostra "sem dados".

**O que o host precisa saber antes do merge**
- **Caminhos absolutos na interface:** a página busca `/styles.css`, `/app.js`, `/tilt.mjs`, `/quota.mjs`, `/api/state` e `/api/preferences/title`, e o backend serve uma lista fixa de arquivos. Para montar sob um prefixo (por exemplo `/quotas/`), troque por URLs relativas e ajuste o mapa `assets` do backend.
- **CSS global:** `styles.css` define variáveis em `:root` e estilos genéricos (`.card`, `body`). Dentro de outra página, namespace as classes ou isole num `iframe` ou Shadow DOM.
- **Preferências:** os títulos dos cards ficam em `preferences.json` ao lado do código e fora do git. Aponte para a pasta de dados do host com o parâmetro `preferences_path` de `Dashboard(...)`.
- **Segurança que deve ser preservada:** escuta somente em `127.0.0.1`; o `PUT /api/preferences/title` valida `Host`, `Origin` e `Content-Type`; nenhuma credencial é lida (só o e-mail do log da CLI e o que as CLIs informam); a descoberta filtra o ambiente dos processos para quatro variáveis. Se o host expuser o painel em rede, o `PUT` precisa da autenticação do host.
- **Plataforma:** macOS. Usa `/bin/ps`, `awk`, `lsof` e, para o Antigravity, o Keychain do login. Em Linux a descoberta de terminais e o Antigravity não foram verificados.
- **Dependem de CLIs externas:** `codex` (com `app-server`), `claude` (com `/usage`) e `agy` (com `/quota`). Mudança de formato nas CLIs quebra o parser da respectiva conta; as demais continuam.
- **Testes a levar junto:** `node --test test_*.mjs` (JS puro) e `python3 -m unittest discover -p 'test_*.py'`. Os fixtures em `fixtures/` são higienizados.

## Licença

MIT, ver [`LICENSE`](LICENSE). O titular dos direitos é quem publicou o repositório; ao incorporar a um projeto com outra licença, o titular pode relicenciar o próprio código.

## Executar

Requer Python 3.10+ e as CLIs `codex`, `claude` e `agy` já instaladas/autenticadas. Não há dependências Python externas.

```sh
python3 dashboard/backend.py --port 8765
curl http://127.0.0.1:8765/api/state
node --test dashboard/test_quota.mjs
python3 -m unittest discover -s dashboard -p 'test_*.py' -v
```

O servidor escuta somente `127.0.0.1`. Serve a interface em `/` e somente seus arquivos estáticos conhecidos; aceita escrita apenas de títulos em `PUT /api/preferences/title`, sem acessar caminhos arbitrários. O estado inicial pode mostrar `sem dados` enquanto a primeira coleta acontece. O cache vive em memória; reiniciar o servidor inicia novas consultas.

## Descoberta

O adaptador aplica o algoritmo de descoberta comprovado no projeto de origem, sem usar nenhum relatório como lista estática de PIDs. Lê o workspace ativo de `~/.maestri/app-state.json` e seus terminais em `workspaces/<id>/workspace.json`. A associação ao workspace é a pertença do terminal ao canvas, não o cwd do processo: o inventário confirmou que terminais do mesmo workspace trabalham em pastas diferentes. O nome e caminho retornados são os do workspace Maestri.

Só considera nós de terminal marcados `running` e não descarregados. Liga o processo ao ID interno do terminal por `MAESTRI_TERMINAL_ID`. A saída de `ps eww` é filtrada no próprio pipeline: somente `MAESTRI_TERMINAL_ID`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` e `HOME` chegam ao Python. O ambiente inteiro nunca é exibido ou armazenado; nenhum arquivo de autenticação é lido. Codex usa `CODEX_HOME` ou `<HOME>/.codex`; Claude usa o login padrão aprovado; Antigravity usa o HOME do processo. Um terminal sem processo identificado fica sem conta comprovada. O adaptador não tenta adivinhar contas a partir de aliases. Redescoberta a cada 30 s. Falha na descoberta mantém o último estado com `discovery_error` e suspende novas coletas até a próxima descoberta válida.

Para testes ou uso explícito sem Maestri, `--accounts-json arquivo.json` injeta os diretórios. Formato:

```json
{
  "workspace": {"name": "Exemplo", "path": "/caminho/do/workspace"},
  "terminals": [
    {"name": "Codex A", "harness": "codex", "account_dir": "/caminho/do/CODEX_HOME"},
    {"name": "Claude", "harness": "claude", "account_dir": "/home/usuario/.claude"},
    {"name": "Gemini", "harness": "antigravity", "account_dir": "/home/do/perfil"}
  ]
}
```

Antigravity e o Keychain: o `agy` autentica primeiro pela entrada única `(gemini, antigravity)` do Keychain de login do macOS, que guarda a conta que renovou o token por último; o HOME não a isola. Por isso a conta de cada terminal Antigravity vem do log da sessão do próprio processo: o `cli-*.log` que o PID mantém aberto (`lsof -p <PID>`), filtrado para a linha `OAuth: authenticated successfully as <e-mail>`. A descoberta chama `lsof` só para os PIDs Antigravity dos terminais ativos do workspace; falha de `lsof` deixa a identidade sem e-mail, sem derrubar a descoberta. Esse e-mail decide os cards. A consulta `/quota` roda uma vez por máquina, e o resultado vai somente para o card do e-mail que essa execução registrou no próprio `--log-file`. Em falha da consulta, o último snapshot comprovado permanece com backoff até 1 hora. Card Antigravity de outra conta mostra `sem dados` na cota e, no hover, "A CLI só consulta a conta ativa no Keychain". O dashboard não contorna o Keychain (nada de interceptar `/usr/bin/security`, `JETSKI_OAUTH_TOKEN` ou keychains por perfil) e não lê `antigravity-oauth-token`.

Diretórios injetados precisam existir. `account_dir: null` significa diretório não identificado e não executa consulta. Para Antigravity, `account_dir` é o HOME do processo, usado para achar logs de sessão e metadados de modelo. O perfil cujo HOME está sob `~/orquestra/state/agy-homes/` é apenas um diretório de login já existente: o dashboard não lê ledger ou snapshots da Orquestra. Claude usa o login padrão da CLI, removendo qualquer override de `CLAUDE_CONFIG_DIR` herdado.

## Coleta e erros

Uma consulta em andamento impede sobreposição para a mesma conta. Contas distintas podem ser consultadas por até quatro workers. Timeout padrão de 40 s; Antigravity também recebe `--print-timeout 25s`. Processos de consulta são iniciados em grupo próprio, encerrado no timeout/conclusão. Não se enviam prompts de linguagem natural, `turn/start` ou comandos arbitrários de terminais.

Para Codex e Claude, a primeira coleta identifica cada diretório; até identificar e-mails iguais, podem existir consultas simultâneas de diretórios ainda não associados. Depois da identificação, apenas um diretório representante faz a consulta ativa por conta. Todas as fontes passivas dos diretórios Codex associados continuam acompanhadas. No Antigravity, a identidade do terminal vem do log aberto por seu PID e uma única consulta de cota atende a máquina. E-mails são comparados sem espaços externos e sem distinção de caixa. Percentuais de uma conta nunca são somados: vence o snapshot mais recente. Cada grupo reúne os terminais e diretórios associados. Sem e-mail comprovado no log da consulta Antigravity, nenhum card recebe esse resultado.

Primeira falha dobra o intervalo base; falhas seguintes dobram até 1 h. Sucesso restaura o intervalo normal. Os intervalos contam a partir da conclusão. Erros retornam códigos genéricos e `error_detail` curto (`timeout`, `exit N`, `parse`, `unavailable` ou `query`), nunca mensagens de exceção ou stdout/stderr brutos. Sucesso limpa os dois campos. Percentuais antigos são preservados; reset vencido ou observação vencida marca `desatualizado`, sem alterar os valores. Janelas ausentes ficam nulas (`parcial` quando só parte da cota veio). A API não dispara consultas e pode ser lida pela página a cada 5 s.

Entre consultas ativas do Codex, um leitor incremental acompanha `sessions/**/*.jsonl` daquele `CODEX_HOME`. Usa somente os eventos `token_count` com `rate_limits`; a hora da observação é o `timestamp` do evento, não o mtime do arquivo. O snapshot mais recente vence entre ativo/passivo. Uma linha incompleta aguarda a próxima leitura; timestamps/JSON inválidos não derrubam o leitor. As leituras passivas não alteram o agendamento ativo nem somam percentuais, e não filtram por cwd.

Fixtures em `fixtures/` são recortes das saídas reais da etapa 2c, sem identificadores pessoais, texto de sessões ou credenciais.

## Modelo e esforço

O leitor usa o arquivo de sessão/log mais recente por mtime em cada diretório, sem filtrar cwd. Sessões automáticas do Codex identificadas pelo modelo `codex-auto-*` (como `codex-auto-review`) são ignoradas integralmente: seleciona a próxima sessão elegível, ou retorna ausência de metadados se só houver automáticas. Codex: último `turn_context`, campos `model` e `effort`/`reasoning_effort` comprovados na CLI instalada. Claude: última mensagem assistant com `message.model`; esforço em `perTurnEffort`/`effort` somente quando registrado. Antigravity: último log CLI e linha de modelo selecionado; esforço só é extraído quando explícito no rótulo, como `(High)`. Nenhum valor padrão de esforço é presumido.

Entre diretórios do mesmo e-mail, seleciona o registro com timestamp mais recente (ou mtime do arquivo quando o registro não traz horário). Modelo/esforço ausentes na sessão mais recente ficam nulos, sem reutilizar esforço de outra sessão. Leituras são cacheadas pelo arquivo e sua versão; não expõem conteúdo da conversa. A API conserva os identificadores de modelo originais.

## Interface

Abra `http://localhost:8765/`. O cabeçalho mostra somente o nome do workspace e o número de contas em uso. Um card por conta mostra harness, e-mail/plano e modelo/esforço quando comprovados. Antigravity mostra gemini nas barras e 3p nos detalhes, sem somar pools.

A barra de 5h é grossa, com percentual usado e `reabre em 40m`, `3h 24m` ou `6d 23h`, conforme a duração; a semanal é fina, da mesma largura e com percentual. Preenchimento é o consumo, nunca o restante. O cursor agora vem do relógio da máquina, independente das observações/polling: `(agora - (resets_at - window_minutes × 60)) / (window_minutes × 60)`, limitado a 0–100%. `quotaTiming` em `static/quota.mjs` é pura e também decide o alerta: usado > cursor + 5 pontos ou usado > 90%, com comparação estrita (cursor em 30%: 35% fica neutro, 35,01% fica em alerta). Sem horário/duração comprovados, não inventa posição: mostra sem dados para o tempo e oculta o cursor.

O popover destaca Tempo até reabrir e reset no formato `qua 14/10 07:14`, seguido de Cota usada e Cota livre. Outra janela e janelas do pool 3p aparecem em blocos separados de duas linhas: rótulo, duração e reset; depois mini indicador com cota usada/livre. Durações a partir de 24 h usam dias e horas, sem minutos; idade, ritmo, erros e limitação do Keychain permanecem nos detalhes. Ponteiro parado abre após 600 ms (movimento acima de 4 px reinicia); trocar de popover até 500 ms após fechar pula espera e entrada. Foco por teclado e toque abrem imediatamente; Esc e toque fora fecham. Há tolerância de 100 ms para atravessar o vão e saída de 110 ms. Entrada usa transform e opacity, escala 0,94 e 180 ms com bounce 0,3; redução de movimento usa só opacity em 120 ms. O painel `?ajuste=1` também ajusta esses valores de entrada, dwell e janela quente. Reset vencido mostra reabertura a confirmar, sem presumir cota livre. Dado desatualizado esmaece o card e mostra `há X min`; falhas mantêm o último valor. Querying usa apenas um pulso sutil, respeitando redução de movimento, sem spinner ou texto. Falha de conexão HTTP preserva os cards e indica que não foi possível atualizar.

Cartões brancos sobre cinza frio, acento discreto por harness, fonte de sistema local e números tabulares. Cantos suaves do tipo squircle desenhados por SVG com curvas cúbicas contínuas, também no WebKit do portal; não dependem de suporte a `corner-shape`. Raio e padding do card são iguais (24 px) em qualquer largura, com o mesmo padding nos quatro lados; raio interno é `max(0, raio externo − padding)`. Barras de 5h e Semana medem 10 px e 5 px de altura, com a mesma largura. Cards da mesma linha da grade têm a mesma altura (esticam até o mais alto), com o conteúdo alinhado ao topo; sem altura mínima fixa nem espaço reservado para status vazio. A geometria e a hierarquia compactas estão implementadas; sombras permanecem contratadas no `AGENTS.md` para os próximos passos. Só os dígitos alterados do percentual animam, em 220 ms, com transições interrompíveis; redução de movimento usa fade de 120 ms. Durante a consulta, um anel próprio pulsa em opacity e desaparece suavemente ao terminar. Com o popover aberto, o contorno na barra de origem indica o tempo restante e Tempo inclui segundos abaixo de 24 h; um único timer atualiza esse contador e para ao fechar. Sem menus, abas, fontes, bibliotecas ou requests externos no navegador.

Tilt do card: um card por vez inclina em 3D sob o ponteiro, em JS e CSS puros; `?ajuste=1` abre um painel temporário para afinar ângulo, escala, perspectiva, efeito, brilho e transição. Parâmetros e regras no `AGENTS.md`, seção Card. O ponteiro é lido no invólucro estacionário `.card-slot` (nunca no card transformado), o tilt atualiza uma vez por quadro e o brilho e a elevação só mudam `transform` e `opacity`.

Nome do modelo na tag: legível por regra fixa (`gpt-6-sol` → GPT 6 Sol, `claude-sonnet-5-5` → Sonnet 5.5; Antigravity já vem legível; id desconhecido aparece cru). Detalhe no `AGENTS.md`.

## Títulos locais

O lápis Renomear card abre um input inline: Enter ou perda de foco salva; Esc cancela; título vazio restaura o harness. Nomes próprios mostram o harness em uma sobrancelha. Durante a edição, tilt fica congelado e popovers não abrem. A interface atualiza o título antes da resposta e reverte com uma mensagem curta se a gravação falhar.

`PUT /api/preferences/title` recebe `{harness, email, title}`. Exige `Content-Type: application/json`, Host local na porta do servidor e Origin HTTP idêntica ao Host. O corpo é limitado a 1024 bytes; título passa por trim, aceita até 40 caracteres e rejeita caracteres de controle. O e-mail normalizado precisa estar comprovado em uma conta ativa do mesmo harness. Sem e-mail, não há lápis nem renomeação persistente.

`preferences.json` é um arquivo local ignorado pelo git, com títulos separados por harness e e-mail normalizado (`{"codex": {"dev@example.com": "Produção"}}`). É a única persistência do dashboard; arquivo ausente/corrompido é tratado como vazio. Leitura e escrita usam o lock do dashboard; gravação usa temporário na mesma pasta e `os.replace`, sem alterar arquivos dos agentes. `/api/state` expõe `title` como string ou null. Trocas de e-mail não migram títulos.
