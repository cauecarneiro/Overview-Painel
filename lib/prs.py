# -*- coding: utf-8 -*-
"""PRs abertos e estado da CI, pelo `gh` (só leitura), e de quem é cada PR.

Um `gh pr list --json ...statusCheckRollup` por repositório traz os PRs e os checks de cada um:
é o mesmo dado do `gh pr checks`, numa chamada só.

De quem é o PR, nesta ordem:
  1. quem o Nick Fury marcou com `painel-missao "<Vingador>" --pr <n>`;
  2. o Vingador cujo worktree está na branch do PR, ou parado no commit da ponta do PR;
  3. ninguém: o PR aparece em "sem dono".
"""
import json
import os
import subprocess
from pathlib import Path

from leitor import mascarar

CAMPOS = "number,title,headRefName,headRefOid,url,isDraft,statusCheckRollup"
PASSOU = {"SUCCESS", "NEUTRAL", "SKIPPED"}
ESPERA_GH = 30
ESPERA_GIT = 5


def resumir_ci(checks):
    """Lista do statusCheckRollup -> {'estado': passou|rodando|falhou|sem_ci, contagens}."""
    passou = falhou = rodando = 0
    for c in checks or []:
        if c.get("__typename") == "StatusContext":
            estado = (c.get("state") or "").upper()
            if estado == "SUCCESS":
                passou += 1
            elif estado in ("PENDING", "EXPECTED"):
                rodando += 1
            else:
                falhou += 1
        else:
            if (c.get("status") or "").upper() != "COMPLETED":
                rodando += 1
            elif (c.get("conclusion") or "").upper() in PASSOU:
                passou += 1
            else:
                falhou += 1
    total = passou + falhou + rodando
    if total == 0:
        estado = "sem_ci"
    elif falhou:
        estado = "falhou"
    elif rodando:
        estado = "rodando"
    else:
        estado = "passou"
    return {"estado": estado, "passou": passou, "falhou": falhou, "rodando": rodando, "total": total}


def pr_do_gh(bruto, repo):
    return {
        "repo": repo,
        "numero": bruto["number"],
        "titulo": mascarar(bruto.get("title") or ""),
        "url": bruto.get("url"),
        "branch": bruto.get("headRefName"),
        "sha": bruto.get("headRefOid"),
        "rascunho": bool(bruto.get("isDraft")),
        "ci": resumir_ci(bruto.get("statusCheckRollup")),
    }


def ler_prs(repos):
    """PRs abertos de cada repositório. Levanta RuntimeError com o motivo se o gh falhar."""
    prs = []
    ambiente = dict(os.environ, GH_PROMPT_DISABLED="1", NO_COLOR="1")
    for repo in repos:
        try:
            p = subprocess.run(
                ["gh", "pr", "list", "-R", repo["gh"], "--state", "open", "--limit", "50", "--json", CAMPOS],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=ESPERA_GH, env=ambiente)
        except FileNotFoundError:
            raise RuntimeError("gh não está no PATH")
        except subprocess.TimeoutExpired:
            raise RuntimeError("gh não respondeu em %d s (%s)" % (ESPERA_GH, repo["nome"]))
        if p.returncode != 0:
            linhas = p.stderr.decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError("gh falhou em %s: %s" % (repo["nome"], mascarar(linhas[0] if linhas else "sem mensagem")))
        try:
            lista = json.loads(p.stdout.decode("utf-8"))
        except ValueError:
            raise RuntimeError("gh devolveu algo que não é JSON (%s)" % repo["nome"])
        prs.extend(pr_do_gh(b, repo["nome"]) for b in lista)
    prs.sort(key=lambda pr: (pr["repo"] != repos[0]["nome"], pr["repo"], pr["numero"]))
    return prs


def _git(pasta, *args):
    try:
        p = subprocess.run(["git", "-C", str(pasta), "--no-optional-locks"] + list(args),
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           timeout=ESPERA_GIT)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout.decode("utf-8", "replace").strip() if p.returncode == 0 else None


def ler_worktrees(mapa):
    """{Vingador: {repo: {'branch': nome ou None, 'sha': commit}}}, lido do disco, sem rede."""
    resultado = {}
    for v in mapa["vingadores"]:
        pasta = Path(os.path.expanduser(v.get("pasta") or ""))
        resultado[v["nome"]] = {}
        for repo in mapa["repos"]:
            raiz = pasta / repo["nome"]
            if not raiz.is_dir():
                continue
            sha = _git(raiz, "rev-parse", "HEAD")
            if not sha:
                continue
            branch = _git(raiz, "symbolic-ref", "--short", "-q", "HEAD")
            resultado[v["nome"]][repo["nome"]] = {"branch": branch or None, "sha": sha}
    return resultado


def distribuir(prs, worktrees, marcados):
    """Diz de quem é cada PR. `marcados`: {Vingador: [{'repo':, 'numero':}]}, vindo do quadro.

    Devolve ({Vingador: [pr]}, [pr sem dono]).
    """
    por_vingador = {}
    com_dono_marcado = set()
    for nome, lista in (marcados or {}).items():
        for item in lista or []:
            com_dono_marcado.add((item.get("repo"), item.get("numero")))
    sem_dono = []
    for pr in prs:
        chave = (pr["repo"], pr["numero"])
        donos = []
        if chave in com_dono_marcado:
            donos = [nome for nome, lista in marcados.items()
                     if any((i.get("repo"), i.get("numero")) == chave for i in lista or [])]
        else:
            for nome, repos in (worktrees or {}).items():
                wt = repos.get(pr["repo"])
                if wt and ((wt["branch"] and wt["branch"] == pr["branch"]) or wt["sha"] == pr["sha"]):
                    donos.append(nome)
        if not donos:
            sem_dono.append(pr)
        for nome in donos:
            por_vingador.setdefault(nome, []).append(pr)
    return por_vingador, sem_dono
