# -*- coding: utf-8 -*-
"""Fala com os terminais dos agentes pelo tmux: ler a tela e mandar teclas.

Cada agente do `agentes.json` aponta para um terminal tmux pelo campo `"terminal"`
(o nome da sessão, `sessao:janela.painel` ou o id do painel, como `%3`). Sem o campo,
vale o próprio nome do agente. Só biblioteca padrão.
"""
import re
import subprocess

ESPERA_TMUX = 8

# Os escapes que o painel usa para teclas cruas: \n é Enter, \e é Esc, \x7f é apagar.
RE_TECLAS = re.compile(r"(\\n|\\e|\\x7f)")
TECLA_DO_TMUX = {"\\n": "Enter", "\\e": "Escape", "\\x7f": "BSpace"}


class Tmux:
    """O tmux de verdade. Os testes usam um falso com os mesmos dois métodos (ver e teclar)."""

    def __init__(self, mapa=None):
        self.alvos = {}
        for agente in (mapa or {}).get("agentes", []):
            self.alvos[agente["nome"]] = agente.get("terminal") or agente["nome"]

    def alvo(self, nome):
        return self.alvos.get(nome, nome)

    def painel(self, nome):
        """O id do painel do tmux (como `%3`) do agente, ou None se o terminal não existe."""
        try:
            p = subprocess.run(["tmux", "display-message", "-p", "-t", self.alvo(nome), "#{pane_id}"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               timeout=ESPERA_TMUX)
        except (OSError, subprocess.TimeoutExpired):
            return None
        achado = p.stdout.decode("utf-8", "replace").strip()
        return achado if p.returncode == 0 and achado.startswith("%") else None

    def tela(self, nome):
        """(texto, None) ou (None, motivo). A tela visível do terminal, sem alterar nada."""
        try:
            p = subprocess.run(["tmux", "capture-pane", "-p", "-t", self.alvo(nome)], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=ESPERA_TMUX)
        except FileNotFoundError:
            return None, "tmux não está instalado (ou não está no PATH)"
        except subprocess.TimeoutExpired:
            return None, "o tmux não respondeu em %d s" % ESPERA_TMUX
        except OSError as erro:
            return None, "o tmux não rodou: %s" % erro
        if p.returncode != 0:
            return None, "terminal não encontrado no tmux: %s" % self.alvo(nome)
        return p.stdout.decode("utf-8", "replace"), None

    def ver(self, nome):
        texto, _ = self.tela(nome)
        return texto

    def teclar(self, nome, bruto):
        """Manda teclas ao terminal. `bruto` usa \\n (Enter), \\e (Esc) e \\x7f (apagar); o resto é texto."""
        alvo = self.alvo(nome)
        for pedaco in RE_TECLAS.split(bruto):
            if not pedaco:
                continue
            if pedaco in TECLA_DO_TMUX:
                comando = ["tmux", "send-keys", "-t", alvo, TECLA_DO_TMUX[pedaco]]
            else:
                comando = ["tmux", "send-keys", "-t", alvo, "-l", "--", pedaco]
            try:
                p = subprocess.run(comando, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=ESPERA_TMUX)
            except (OSError, subprocess.TimeoutExpired):
                return False
            if p.returncode != 0:
                return False
        return True
