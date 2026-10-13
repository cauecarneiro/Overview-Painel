#!/bin/bash
# Comando do terminal "Painel": mantém o coletor do painel dos Vingadores no ar.
#
# O coletor lê as telas a cada 20 segundos e os PRs a cada 3 minutos, e grava publico/dados.json
# e publico/dados.js. Se ele cair, este script sobe de novo. Nenhuma IA participa.
#
# Não há servidor: a página abre por file:// (testado no portal do Maestri em 01/10/2026) e lê o
# dados.js que fica ao lado dela. Nada escuta em porta nenhuma.
#
# Uso:
#   painel.sh                 sobe o coletor e fica no ar (Ctrl-C para parar)
#   painel.sh --sem-gh        idem, sem consultar o GitHub
#   painel.sh --telas <pasta> idem, lendo telas salvas em arquivo (teste)
# As opções vão direto para o coletor: veja `coletor --help`.
#
# Rode num terminal conectado aos 13 (os 12 Vingadores e o Nick Fury): o `maestri check` só lê
# quem está conectado a este terminal.

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

command -v maestri >/dev/null 2>&1 || echo "painel.sh: aviso: maestri não está no PATH; todos vão aparecer como \"sem leitura\"." >&2

echo "Painel dos Vingadores no ar."
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
