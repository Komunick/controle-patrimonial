#!/usr/bin/env bash
set -uo pipefail

# Diagnóstico somente leitura. Não inicia, para, reinicia nem altera serviços.
readonly SERVICO_SISTEMA='controle-patrimonial.service'
readonly SERVICO_SYNC='controle-patrimonial-relay-sync.service'
FALHAS=0

ok() { printf 'OK: %s\n' "$*"; }
falha() { printf 'FALHA: %s\n' "$*" >&2; FALHAS=$((FALHAS + 1)); }

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == 'linuxmint' ]] && ok "Linux Mint detectado (${VERSION_CODENAME:-versão não informada})." || falha 'O sistema não foi identificado como Linux Mint.'
else
  falha '/etc/os-release não pôde ser lido.'
fi

for servico in "$SERVICO_SISTEMA" "$SERVICO_SYNC"; do
  systemctl is-enabled --quiet "$servico" && ok "$servico habilitado no boot." || falha "$servico não está habilitado."
  systemctl is-active --quiet "$servico" && ok "$servico ativo." || falha "$servico não está ativo."
done

for arquivo in /etc/controle-patrimonial/sistema.env /etc/controle-patrimonial/relay.env; do
  if [[ -e "$arquivo" ]]; then
    modo="$(stat -c '%a' "$arquivo" 2>/dev/null || true)"
    [[ "$modo" == '600' ]] && ok "$arquivo protegido com modo $modo." || falha "$arquivo deve usar permissão 600; atual: ${modo:-desconhecida}."
  else
    falha "$arquivo não existe."
  fi
done

if command -v node >/dev/null 2>&1; then
  if node -e "fetch('http://127.0.0.1:8080/healthz', { signal: AbortSignal.timeout(5000) }).then(async r => { const d = await r.json(); if (!r.ok || d.ok !== true) process.exit(1); }).catch(() => process.exit(1));"; then
    ok 'Servidor local respondeu corretamente em /healthz.'
  else
    falha 'Servidor local não respondeu corretamente em /healthz.'
  fi
else
  falha 'Node.js não foi encontrado no PATH.'
fi

if (( FALHAS > 0 )); then
  printf '%s\n' "$FALHAS verificação(ões) falharam. Nenhuma correção automática foi executada." >&2
  exit 1
fi
printf '%s\n' 'Todas as verificações passaram. Nenhuma alteração foi realizada.'
