#!/usr/bin/env bash
set -Eeuo pipefail

# Instala somente o Controle Patrimonial e seu sincronizador no systemd.
# É estritamente proibido desligar/reiniciar a VM ou afetar outros serviços.

readonly SERVICO_SISTEMA='controle-patrimonial.service'
readonly SERVICO_SYNC='controle-patrimonial-relay-sync.service'
readonly PASTA_ETC='/etc/controle-patrimonial'
readonly PASTA_DADOS='/var/lib/controle-patrimonial'

RELAY_URL_INFORMADA=''
SISTEMA_URL='http://127.0.0.1:8080'
USUARIO_SERVICO="${SUDO_USER:-}"
SOMENTE_CONFIGURAR=0

uso() {
  printf '%s\n' \
    'Uso: sudo bash ./linux/instalar-linux-mint.sh [opções]' \
    '' \
    '  --relay-url URL       URL HTTPS pública do relay' \
    '  --sistema-url URL     URL local; padrão http://127.0.0.1:8080' \
    '  --usuario USUARIO     usuário sem privilégios que executará o Node' \
    '  --somente-configurar  instala arquivos, mas não inicia serviços' \
    '  --ajuda               mostra esta ajuda' \
    '' \
    'O segredo sempre é solicitado sem aparecer na tela.'
}

erro() {
  printf 'ERRO: %s\n' "$*" >&2
  exit 1
}

aviso() {
  printf 'ATENÇÃO: %s\n' "$*" >&2
}

info() {
  printf '%s\n' "$*"
}

while (( $# > 0 )); do
  case "$1" in
    --relay-url)
      (( $# >= 2 )) || erro 'Falta o valor de --relay-url.'
      RELAY_URL_INFORMADA="$2"
      shift 2
      ;;
    --sistema-url)
      (( $# >= 2 )) || erro 'Falta o valor de --sistema-url.'
      SISTEMA_URL="$2"
      shift 2
      ;;
    --usuario)
      (( $# >= 2 )) || erro 'Falta o valor de --usuario.'
      USUARIO_SERVICO="$2"
      shift 2
      ;;
    --somente-configurar)
      SOMENTE_CONFIGURAR=1
      shift
      ;;
    --ajuda|-h)
      uso
      exit 0
      ;;
    *)
      erro "Opção desconhecida: $1"
      ;;
  esac
done

(( EUID == 0 )) || erro 'Execute com sudo. O script só altera os dois serviços novos e suas pastas dedicadas.'
[[ -r /etc/os-release ]] || erro 'Não foi possível identificar a distribuição Linux.'
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == 'linuxmint' ]] || erro "Este instalador é exclusivo para Linux Mint; sistema detectado: ${ID:-desconhecido}."
[[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" == 'systemd' ]] || erro 'O systemd não está ativo como PID 1.'
command -v systemctl >/dev/null 2>&1 || erro 'systemctl não foi encontrado.'
command -v install >/dev/null 2>&1 || erro 'O comando install não foi encontrado.'
command -v ss >/dev/null 2>&1 || erro 'O comando ss é obrigatório para verificar a porta 8080 com segurança.'

[[ -n "$USUARIO_SERVICO" ]] || erro 'Informe --usuario quando executar diretamente como root.'
[[ "$USUARIO_SERVICO" =~ ^[a-z_][a-z0-9_.-]*[$]?$ ]] || erro 'Nome de usuário inválido.'
id "$USUARIO_SERVICO" >/dev/null 2>&1 || erro "O usuário $USUARIO_SERVICO não existe."
(( $(id -u "$USUARIO_SERVICO") != 0 )) || erro 'O serviço não pode executar como root. Informe um usuário Linux comum.'
GRUPO_SERVICO="$(id -gn "$USUARIO_SERVICO")"
[[ "$GRUPO_SERVICO" =~ ^[a-z_][a-z0-9_.-]*[$]?$ ]] || erro 'Nome do grupo primário inválido.'

PASTA_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PASTA_WEB="$(cd "$PASTA_SCRIPT/.." && pwd -P)"
[[ "$PASTA_WEB" != *[[:space:]]* ]] || erro 'Mova patrimonio-web para um caminho Linux sem espaços ou caracteres de controle.'
[[ -f "$PASTA_WEB/server/server.js" ]] || erro 'server/server.js não foi encontrado.'
[[ -f "$PASTA_WEB/server/sincroniza-relay.js" ]] || erro 'server/sincroniza-relay.js não foi encontrado.'

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || erro 'Node.js não foi encontrado. Instale uma versão LTS compatível antes de continuar.'
NODE_BIN="$(readlink -f "$NODE_BIN")"
[[ -x "$NODE_BIN" ]] || erro "Node.js não é executável: $NODE_BIN"
command -v runuser >/dev/null 2>&1 || erro 'O comando runuser não foi encontrado.'
runuser -u "$USUARIO_SERVICO" -- "$NODE_BIN" -e '' >/dev/null 2>&1 || erro "O usuário $USUARIO_SERVICO não consegue executar $NODE_BIN."
NODE_MAJOR="$("$NODE_BIN" -p "Number(process.versions.node.split('.')[0])")"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || erro 'Não foi possível identificar a versão do Node.js.'
(( NODE_MAJOR == 22 || NODE_MAJOR == 24 )) || erro 'Use Node.js 22 LTS ou 24 LTS; Node 24 LTS é recomendado.'

if [[ -z "$RELAY_URL_INFORMADA" ]]; then
  read -r -p 'URL HTTPS pública do relay: ' RELAY_URL_INFORMADA
fi
RELAY_URL_INFORMADA="${RELAY_URL_INFORMADA%/}"
[[ "$RELAY_URL_INFORMADA" =~ ^https://[^[:space:]]+$ ]] || erro 'A URL do relay deve ser HTTPS e não pode conter espaços.'
SISTEMA_URL="${SISTEMA_URL%/}"
[[ "$SISTEMA_URL" =~ ^https?://[^[:space:]]+$ ]] || erro 'SISTEMA_URL deve ser uma URL HTTP ou HTTPS válida.'

read -r -s -p 'RELAY_SEGREDO configurado no Render: ' RELAY_SEGREDO_INFORMADO
printf '\n'
(( ${#RELAY_SEGREDO_INFORMADO} >= 32 )) || erro 'RELAY_SEGREDO deve ter pelo menos 32 caracteres aleatórios.'
[[ "$RELAY_SEGREDO_INFORMADO" =~ ^[A-Za-z0-9._~+/=-]+$ ]] || erro 'RELAY_SEGREDO contém caracteres não aceitos pelo arquivo de ambiente.'

TEMPORARIO="$(mktemp -d)"
trap 'rm -rf -- "$TEMPORARIO"' EXIT
umask 077

printf '%s\n' \
  'PORT=8080' \
  'HOST=0.0.0.0' \
  "PAT_DATA_DIR=$PASTA_DADOS" \
  "PAT_LINK_ASSINATURA=$RELAY_URL_INFORMADA" \
  > "$TEMPORARIO/sistema.env"

printf '%s\n' \
  "RELAY_URL=$RELAY_URL_INFORMADA" \
  "RELAY_SEGREDO=$RELAY_SEGREDO_INFORMADO" \
  "SISTEMA_URL=$SISTEMA_URL" \
  > "$TEMPORARIO/relay.env"
unset RELAY_SEGREDO_INFORMADO

escapar_sed() {
  printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

USUARIO_SED="$(escapar_sed "$USUARIO_SERVICO")"
GRUPO_SED="$(escapar_sed "$GRUPO_SERVICO")"
PASTA_SED="$(escapar_sed "$PASTA_WEB")"
NODE_SED="$(escapar_sed "$NODE_BIN")"

for modelo in controle-patrimonial.service controle-patrimonial-relay-sync.service; do
  sed \
    -e "s|@@USUARIO@@|$USUARIO_SED|g" \
    -e "s|@@GRUPO@@|$GRUPO_SED|g" \
    -e "s|@@PASTA_WEB@@|$PASTA_SED|g" \
    -e "s|@@NODE@@|$NODE_SED|g" \
    "$PASTA_SCRIPT/$modelo.in" > "$TEMPORARIO/$modelo"
done

# Somente as pastas e os arquivos próprios desta integração são instalados.
install -d -m 0750 -o "$USUARIO_SERVICO" -g "$GRUPO_SERVICO" "$PASTA_DADOS"
install -d -m 0750 -o root -g "$GRUPO_SERVICO" "$PASTA_ETC"

# ---------------------------------------------------------------------
# MIGRAÇÃO DA BASE EXISTENTE
#
# A unit define PAT_DATA_DIR=/var/lib/controle-patrimonial e endurece o
# serviço com ProtectHome=read-only. Sem copiar a base atual para lá, o
# sistema subiria com um patrimonio.json vazio e todo o patrimônio, os
# colaboradores e os termos de EPI sumiriam da tela — o arquivo antigo
# continuaria no disco, porém invisível para a aplicação.
#
# Esta etapa NUNCA sobrescreve dados: se o destino já tiver base, ela é
# preservada. Nada é apagado da origem em nenhuma hipótese.
# ---------------------------------------------------------------------
PASTA_DADOS_ORIGEM="${PAT_DATA_DIR_ORIGEM:-$(cd "$PASTA_WEB/.." && pwd -P)/patrimonio-data}"
ARQUIVO_ORIGEM="$PASTA_DADOS_ORIGEM/patrimonio.json"
ARQUIVO_DESTINO="$PASTA_DADOS/patrimonio.json"

if [[ -s "$ARQUIVO_DESTINO" ]]; then
  aviso "Já existe base em $ARQUIVO_DESTINO; ela foi PRESERVADA e nada foi copiado."
elif [[ -s "$ARQUIVO_ORIGEM" ]]; then
  info "Base atual encontrada em $ARQUIVO_ORIGEM"

  "$NODE_BIN" -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$ARQUIVO_ORIGEM" \
    || erro "A base em $ARQUIVO_ORIGEM não é um JSON válido. Nada foi copiado; verifique antes de prosseguir."

  CARIMBO="$(date +%Y%m%d-%H%M%S)"
  COPIA_SEGURANCA="$ARQUIVO_ORIGEM.antes-da-migracao-$CARIMBO"
  cp -p -- "$ARQUIVO_ORIGEM" "$COPIA_SEGURANCA" \
    || erro 'Não foi possível criar a cópia de segurança da base. Abortado sem alterar nada.'
  info "Cópia de segurança da origem: $COPIA_SEGURANCA"

  cp -p -- "$ARQUIVO_ORIGEM" "$ARQUIVO_DESTINO" \
    || erro 'Falha ao copiar a base para o novo diretório. Abortado.'

  cmp -s -- "$ARQUIVO_ORIGEM" "$ARQUIVO_DESTINO" \
    || erro 'A cópia da base não conferiu byte a byte. Abortado; a origem permanece intacta.'
  info 'Base copiada e conferida byte a byte.'

  if [[ -d "$PASTA_DADOS_ORIGEM/backups" ]]; then
    install -d -m 0750 -o "$USUARIO_SERVICO" -g "$GRUPO_SERVICO" "$PASTA_DADOS/backups"
    cp -pr -- "$PASTA_DADOS_ORIGEM/backups/." "$PASTA_DADOS/backups/" 2>/dev/null || true
    info 'Backups históricos copiados.'
  fi

  chown -R "$USUARIO_SERVICO:$GRUPO_SERVICO" "$PASTA_DADOS"
  info "A origem $PASTA_DADOS_ORIGEM foi mantida intacta como segunda via."
else
  aviso "Nenhuma base foi encontrada em $ARQUIVO_ORIGEM."
  aviso 'Se este NÃO é um servidor novo, pare agora: iniciar o serviço criaria uma base vazia.'
  aviso 'Use --sistema-url/--relay-url com PAT_DATA_DIR_ORIGEM=/caminho/correto para apontar a base real.'
  read -r -p 'Digite NOVO para confirmar que é uma instalação sem dados anteriores: ' CONFIRMA_VAZIO
  [[ "$CONFIRMA_VAZIO" == 'NOVO' ]] || erro 'Abortado a pedido. Nada foi iniciado nem habilitado.'
fi
install -m 0600 -o root -g root "$TEMPORARIO/sistema.env" "$PASTA_ETC/sistema.env"
install -m 0600 -o root -g root "$TEMPORARIO/relay.env" "$PASTA_ETC/relay.env"
install -m 0644 -o root -g root "$TEMPORARIO/$SERVICO_SISTEMA" "/etc/systemd/system/$SERVICO_SISTEMA"
install -m 0644 -o root -g root "$TEMPORARIO/$SERVICO_SYNC" "/etc/systemd/system/$SERVICO_SYNC"

systemctl daemon-reload

porta_8080_ocupada() {
  ss -H -ltn | awk '$4 ~ /:8080$/ { encontrada=1 } END { exit encontrada ? 0 : 1 }'
}

SISTEMA_PRONTO=0
if (( SOMENTE_CONFIGURAR == 1 )); then
  info 'Arquivos instalados. --somente-configurar impediu a habilitação no boot e qualquer inicialização.'
elif systemctl is-active --quiet "$SERVICO_SISTEMA"; then
  SISTEMA_PRONTO=1
  aviso "$SERVICO_SISTEMA já estava ativo e NÃO foi reiniciado."
  aviso 'As novas variáveis serão lidas apenas em uma reinicialização controlada desse serviço pelo administrador.'
elif porta_8080_ocupada; then
  aviso 'A porta 8080 já está ocupada. Nenhum processo foi encerrado e os serviços não serão iniciados.'
  aviso 'Identifique o serviço existente e escolha uma janela segura; nunca reinicie a VM para resolver isso.'
else
  systemctl start "$SERVICO_SISTEMA"
  systemctl is-active --quiet "$SERVICO_SISTEMA" || erro "O serviço não iniciou. Consulte: journalctl -u $SERVICO_SISTEMA"
  SISTEMA_PRONTO=1
  info "$SERVICO_SISTEMA iniciado sem interromper outros processos."
fi

if (( SOMENTE_CONFIGURAR == 0 && SISTEMA_PRONTO == 1 )); then
  if systemctl is-active --quiet "$SERVICO_SYNC"; then
    aviso "$SERVICO_SYNC já estava ativo e NÃO foi reiniciado."
  else
    systemctl start "$SERVICO_SYNC"
    systemctl is-active --quiet "$SERVICO_SYNC" || erro "O sincronizador não iniciou. Consulte: journalctl -u $SERVICO_SYNC"
    info "$SERVICO_SYNC iniciado."
  fi
  # Só habilitamos o boot depois que a situação atual foi considerada segura.
  systemctl enable "$SERVICO_SISTEMA" "$SERVICO_SYNC" >/dev/null
  info 'Os dois serviços foram habilitados para o próximo boot administrado.'
fi

info ''
info 'Instalação Linux Mint concluída dentro do escopo autorizado.'
info "Dados: $PASTA_DADOS"
info "Configuração protegida: $PASTA_ETC"
info 'Logs: journalctl -u controle-patrimonial.service -u controle-patrimonial-relay-sync.service'
info 'A VM não foi desligada ou reiniciada; firewall, rede e outros serviços não foram alterados.'
