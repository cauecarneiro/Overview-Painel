# Overview-Painel

Painel local para acompanhar, numa tela só, vários agentes de IA rodando em terminais (Claude Code, Codex e
Antigravity): o que cada um está fazendo, quanto resta de cota, quais PRs estão abertos e o que depende de uma
pessoa. Nenhuma IA participa do painel: ele só **lê** as telas dos terminais e **grava** um arquivo que a página
mostra.

- Coletor em Python (sem dependências além da biblioteca padrão).
- Página estática (`publico/index.html`), aberta por `file://`: nada escuta em porta pública.
- Botão de **atualizar tudo**: reconcilia o quadro com o que está nos terminais e no GitHub (no máximo uma
  vez a cada 10 segundos, só em `127.0.0.1`).
- Cotas lidas pela própria CLI de cada ferramenta (sem gastar token) ou pela barra de status do terminal.

## Como usar

1. Descreva o seu time: copie `vingadores.exemplo.json` para `vingadores.json` e troque nomes, contas, pastas e
   repositórios. Sem `vingadores.json`, o painel usa o arquivo de exemplo.
2. Suba o coletor num terminal que enxergue os agentes:

   ```bash
   ./painel.sh              # laço: telas a cada 20 s, PRs a cada 3 min
   ./painel.sh --sem-gh     # sem consultar o GitHub
   ```

   O coletor lê cada terminal com `maestri check "<nome>"` (só leitura) e grava `publico/dados.js` e
   `publico/dados.json`. Para ensaiar sem o Maestri, use telas salvas: `./coletor --telas telas-de-exemplo --uma-vez`.
3. Abra `publico/index.html` no navegador.

### Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `PAINEL_GH_ORG` | Organização do GitHub usada para repositórios listados sem `dono/` no `vingadores.json`. |
| `PAINEL_REPO_PADRAO` | Repositório cujo número de PR aparece sem o nome (padrão `app-frontend`). |
| `PAINEL_QUADRO` | Caminho do `quadro.json` (missão, situação, previsão e pendências). |

O GitHub é consultado pelo `gh` já logado na sua máquina; o painel não guarda token.

### Quadro

O quadro (`quadro.json`) é editado por dois comandos pequenos:

```bash
./painel-missao "Nome do agente" --missao "o que está fazendo" --situacao trabalhando --previsao 22h40
./painel-pendencia --help
```

## Testes

```bash
python3 -B -m unittest discover -s testes
```

`testes/telas/` e `telas-de-exemplo/` guardam telas **sintéticas** de terminal, com texto genérico, usadas para
testar o leitor.

## Privacidade

Nada sai da máquina. Os arquivos gerados (`publico/dados.*`, `quadro.json`, `estado.json`, `vingadores.json`)
ficam fora do git (veja `.gitignore`). Veja também `SECURITY.md`.

## Créditos e licença

- As consultas às CLIs e o desenho dos cards vêm do
  [cotas-dashboard](https://github.com/fbtostadev/cotas-dashboard), de fbtostadev (MIT), copiado em `cotas/` com a
  licença original. O que mudou está em `cotas/ORIGEM.txt`.
- Licença deste repositório: MIT (`LICENSE`).

> Histórico: a primeira versão deste repositório era um pacote em Node (quota-board 0.1.0). Ela continua no
> histórico do git; esta é a versão em Python que passou a ser a usada no dia a dia.
