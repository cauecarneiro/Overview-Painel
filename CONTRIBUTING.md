# Contribuindo

Obrigado por querer melhorar o quota-board. Algumas regras simples:

- **Sem dependências.** O pacote roda só com o Node 18+ e a biblioteca padrão. Uma dependência nova precisa de um motivo forte.
- **Sem token.** Toda consulta a uma CLI tem de ser administrativa: nada que passe por modelo. Se a resposta trouxer token contado, ela é recusada (veja `parseCliOutput` em `lib/cli.js`), e isso tem de continuar assim.
- **Nada sai da máquina.** O servidor escuta só em 127.0.0.1 e o quota-board não lê sessões, conversas nem arquivos de configuração.
- **Testes.** `node --test` tem de passar. Parser novo vem com uma fixture sintética (e-mails `@example.com`, nunca os seus).
- **Dados pessoais.** Antes de abrir um PR, confira que não há e-mail, caminho de usuário, nome de conta ou saída real de CLI no diff. Issues com saída de CLI: troque e-mails e caminhos por `<...>`.

## Como rodar

```
git clone https://github.com/cauecarneiro/Overview-Painel.git
cd Overview-Painel
node --test
node bin/quota-board.js            # abre http://127.0.0.1:8765
node bin/quota-board.js --once     # consulta uma vez e imprime o JSON
```

## Onde fica cada coisa

| Arquivo | O que faz |
|---|---|
| `lib/cli.js` | As consultas às CLIs e a normalização para o formato comum (pools com 5 h e semanal) |
| `lib/board.js` | Descoberta das contas, agenda das consultas e o estado pronto para a página |
| `lib/server.js` | Servidor local: página e `/api/state` |
| `bin/quota-board.js` | Linha de comando e opções |
| `public/` | A página: cards, verso, tema |
| `test/` | Testes com `node:test` |

## Ideias abertas

- Outras CLIs com comando de cota (abra uma issue com o comando e a saída anonimizada).
- Tradução da interface (hoje em português).
- Modelo e esforço da sessão mais recente de cada conta, se der para ler sem tocar em conversas.
