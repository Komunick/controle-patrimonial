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

shopt -s nullglob
NODE_TESTE="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_TESTE" ]]; then
  CANDIDATOS_NODE=("$HOME"/.nvm/versions/node/v24.*/bin/node "$HOME"/.nvm/versions/node/v22.*/bin/node)
  if (( ${#CANDIDATOS_NODE[@]} > 0 )); then
    NODE_TESTE="$(printf '%s\n' "${CANDIDATOS_NODE[@]}" | sort -V | tail -1)"
  fi
fi
if [[ -n "$NODE_TESTE" && -x "$NODE_TESTE" ]]; then
  if "$NODE_TESTE" -e "
    async function validar() {
      try {
        const h = await fetch('http://127.0.0.1:8080/healthz', { signal: AbortSignal.timeout(5000) });
        if (h.ok && (await h.json()).ok === true) return;
      } catch (_) { /* tenta a rota compatível com a instalação legada */ }
      const r = await fetch('http://127.0.0.1:8080/api/epi/link-base', { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      if (!r.ok || !Object.prototype.hasOwnProperty.call(d, 'base')) process.exit(1);
    }
    validar().catch(() => process.exit(1));
  "; then
    ok 'Servidor local respondeu como Controle Patrimonial.'
  else
    falha 'Servidor local não respondeu como Controle Patrimonial.'
  fi
else
  falha 'Node.js não foi encontrado no PATH.'
fi

if (( FALHAS > 0 )); then
  printf '%s\n' "$FALHAS verificação(ões) falharam. Nenhuma correção automática foi executada." >&2
  exit 1
fi
printf '%s\n' 'Todas as verificações passaram. Nenhuma alteração foi realizada.'
