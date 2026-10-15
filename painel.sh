#!/bin/bash
# Mantém o coletor do Overview-Painel no ar.
#
# O coletor lê as telas a cada 20 segundos e os PRs a cada 3 minutos, e grava publico/dados.json
# e publico/dados.js. Se ele cair, este script sobe de novo. Nenhuma IA participa.
#
# Não há servidor: a página abre por file:// e lê o
# dados.js que fica ao lado dela. Nada escuta em porta nenhuma.
#
# Uso:
#   painel.sh                 sobe o coletor e fica no ar (Ctrl-C para parar)
#   painel.sh --sem-gh        idem, sem consultar o GitHub
#   painel.sh --telas <pasta> idem, lendo telas salvas em arquivo (teste)
# As opções vão direto para o coletor: veja `coletor --help`.
#
# Rode numa máquina onde o tmux enxergue as sessões dos agentes (o coletor lê cada painel com
# `tmux capture-pane`, só leitura).

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
TRAVA="$DIR/.painel.pid"
ESPERA=3    # segundos antes de subir o coletor de novo

case "${1:-}" in
  -h|--help|--ajuda) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

if [ -f "$TRAVA" ] && kill -0 "$(cat "$TRAVA" 2>/dev/null)" 2>/dev/null; then
  echo "painel.sh: o painel já está rodando (processo $(cat "$TRAVA")). Pare aquele antes de subir outro." >&2
  exit 1
fi
echo $$ > "$TRAVA"

filho=""
encerrar() {
  [ -n "$filho" ] && kill "$filho" 2>/dev/null
  rm -f "$TRAVA"
  echo
  echo "$(date '+%H:%M:%S')  painel parado. A página vai avisar que os dados estão velhos."
  exit 0
}
trap encerrar INT TERM HUP

command -v tmux >/dev/null 2>&1 || echo "painel.sh: aviso: o tmux não está no PATH; todos vão aparecer como \"sem leitura\". Para só ver a demonstração: ./coletor --telas telas-de-exemplo --uma-vez" >&2

echo "Overview-Painel no ar."
echo "  página:  file://$DIR/publico/index.html"
echo "  quadro:  $DIR/painel-missao e $DIR/painel-pendencia"
echo

while true; do
  "$PY" "$DIR/coletor" "$@" &
  filho=$!
  wait "$filho"
  codigo=$?
  filho=""
  echo "$(date '+%H:%M:%S')  o coletor caiu (saída $codigo). Subindo de novo em $ESPERA s." >&2
  sleep "$ESPERA"
done
