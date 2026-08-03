# Prompt de deploy — Claude Cowork — VirtualBox Linux Mint

Copie todo o bloco abaixo para o Claude Cowork. Não remova as regras de
segurança, mesmo que a instalação pareça simples.

---

Você fará o deploy assistido do Controle Patrimonial e do sincronizador de
assinaturas de EPI em uma VM VirtualBox com Linux Mint.

## REGRA MÁXIMA E INEGOCIÁVEL

É **ESTRITAMENTE PROIBIDO** desligar, reiniciar, suspender ou encerrar a VM.
Também é **ESTRITAMENTE PROIBIDO** executar qualquer ação que possa interromper
ou comprometer outros sistemas que estejam rodando nela.

Você não tem autorização para:

- executar `reboot`, `shutdown`, `poweroff`, `halt`, `init 0` ou equivalentes;
- reiniciar o Linux para aplicar configuração;
- executar `kill`, `killall`, `pkill` ou encerrar processos por PID;
- parar ou reiniciar serviços preexistentes;
- interromper a porta 8080 ou substituir à força quem estiver usando a porta;
- executar `systemctl restart` ou `systemctl stop` durante este procedimento;
- alterar firewall, nftables, iptables, UFW, DNS, rota, NAT, Bridge ou IP;
- alterar configurações do VirtualBox ou instalar Guest Additions;
- executar atualização geral do sistema, `apt upgrade` ou troca global do Node;
- criar, remover ou restaurar snapshots da VM;
- modificar bancos, diretórios ou serviços de outros sistemas;
- usar curingas em operações de remoção, movimentação ou permissão;
- apagar dados, logs ou backups existentes;
- contornar login, 2FA, CAPTCHA, `sudo` ou qualquer confirmação humana.

Se qualquer etapa parecer exigir uma dessas ações, **PARE** e explique ao
administrador. Não tente um atalho e não amplie o escopo por conta própria.

## Resultado autorizado

Ao final, e somente se todas as verificações forem seguras:

1. o relay público continuará hospedado no Render;
2. `controle-patrimonial.service` estará configurado no Linux Mint;
3. `controle-patrimonial-relay-sync.service` estará configurado no Linux Mint;
4. os dados ficarão em `/var/lib/controle-patrimonial`;
5. os segredos ficarão em `/etc/controle-patrimonial`, fora do Git;
6. a página pública continuará sendo
   `https://URL-DO-RELAY/assinar.html?t=<token>`;
7. nenhum outro serviço ou processo será alterado;
8. a VM não será desligada ou reiniciada.

Os únicos serviços incluídos no seu escopo são:

- `controle-patrimonial.service`;
- `controle-patrimonial-relay-sync.service`.

Nem mesmo esses serviços podem ser parados ou reiniciados se já estiverem
ativos. Uma eventual ativação posterior será decidida manualmente pelo
administrador em uma janela segura.

## Forma de trabalho no Cowork

- Explique cada fase antes de agir.
- Prefira inspeções somente leitura.
- Mostre o comando exato antes de qualquer uso de `sudo`.
- Peça ao usuário para digitar pessoalmente senha, 2FA e `RELAY_SEGREDO`.
- Nunca copie segredos para a conversa, arquivos temporários do Cowork, notas ou
  área de transferência persistente.
- Não deixe processos auxiliares ou terminais executando sem controle.
- Pare em cada checkpoint descrito neste prompt.
- Se a tela ou o terminal não corresponder ao esperado, não improvise.
- Nunca interprete silêncio do usuário como autorização para uma ação crítica.

## Escopo de arquivos permitido

No repositório, você pode apenas ler e usar:

- `patrimonio-web/server/server.js`;
- `patrimonio-web/server/db.js`;
- `patrimonio-web/server/sincroniza-relay.js`;
- `patrimonio-web/linux/`;
- `patrimonio-web/relay/`;
- `render.yaml`.

Na VM, a instalação pode criar ou atualizar somente:

- `/etc/controle-patrimonial/sistema.env`;
- `/etc/controle-patrimonial/relay.env`;
- `/etc/systemd/system/controle-patrimonial.service`;
- `/etc/systemd/system/controle-patrimonial-relay-sync.service`;
- `/var/lib/controle-patrimonial/`.

Não altere arquivos de outros projetos. Não mude proprietários ou permissões
fora desses caminhos. Não mova o repositório sem autorização explícita.

## Fase 1 — inventário somente leitura

Antes de qualquer mudança, mostre e, após aprovação, execute apenas consultas:

```bash
cat /etc/os-release
uname -m
ps -p 1 -o comm=
node --version
command -v node
git status --short --branch
systemctl is-active controle-patrimonial.service
systemctl is-active controle-patrimonial-relay-sync.service
sudo ss -ltnp 'sport = :8080'
```

O último comando usa `sudo` somente para identificar o proprietário da porta.
Ele não pode ser seguido por qualquer comando de encerramento.

Confirme:

- distribuição identificada como Linux Mint;
- PID 1 identificado como `systemd`;
- arquitetura compatível com o Node instalado;
- Node 22 LTS ou 24 LTS, preferencialmente 24;
- repositório sem mudanças locais desconhecidas;
- situação atual dos dois serviços autorizados;
- situação atual da porta 8080.

Se o Node estiver ausente ou inadequado, **PARE**. Não instale, não atualize e
não remova pacotes sem um novo consentimento explícito do administrador.

Se houver mudanças locais desconhecidas no Git, **PARE**. Não execute reset,
checkout forçado, clean, stash, merge ou pull que possa sobrescrever trabalho.

Se a porta 8080 estiver ocupada, registre o nome do processo e **PARE antes da
ativação**. É estritamente proibido encerrar esse processo ou reiniciar a VM.

### CHECKPOINT 1

Apresente o diagnóstico ao administrador. Aguarde confirmação explícita antes
de abrir Render, atualizar arquivos ou usar o instalador.

## Fase 2 — conferir os artefatos

Sem alterar a VM, confirme que estão presentes:

```text
patrimonio-web/linux/instalar-linux-mint.sh
patrimonio-web/linux/verificar-linux-mint.sh
patrimonio-web/linux/controle-patrimonial.service.in
patrimonio-web/linux/controle-patrimonial-relay-sync.service.in
patrimonio-web/linux/README.md
patrimonio-web/relay/server.js
patrimonio-web/server/sincroniza-relay.js
render.yaml
```

Leia `patrimonio-web/linux/README.md` integralmente. Não use os instaladores do
Windows (`.ps1`, `.cmd` ou `.bat`) no Linux Mint.

Você pode executar validações sem escrita operacional:

```bash
node --check patrimonio-web/server/server.js
node --check patrimonio-web/server/db.js
node --check patrimonio-web/server/sincroniza-relay.js
node --check patrimonio-web/relay/server.js
bash -n patrimonio-web/linux/instalar-linux-mint.sh
bash -n patrimonio-web/linux/verificar-linux-mint.sh
```

Os testes do relay podem criar somente arquivos temporários dentro da área de
teste e devem removê-los ao concluir:

```bash
cd patrimonio-web/relay
npm test
```

Não use essa autorização para instalar dependências globais ou atualizar npm.

### CHECKPOINT 2

Apresente os resultados. Se algum teste falhar, **PARE**. Não reinicie serviços
nem a VM para tentar corrigir a falha.

## Fase 3 — relay no Render

Abra o painel do Render na sessão já autenticada do usuário. Se houver login,
2FA ou CAPTCHA, devolva o controle ao usuário.

Use o Blueprint do `render.yaml` ou confira o serviço já existente:

- Root Directory: `patrimonio-web/relay`;
- Start Command: `npm start`;
- Health Check Path: `/healthz`;
- variável obrigatória: `RELAY_SEGREDO`;
- URL pública obrigatoriamente HTTPS.

Quando o painel solicitar `RELAY_SEGREDO`, peça ao usuário para gerar ou colar
pessoalmente um valor aleatório com pelo menos 32 bytes. Não mostre, não leia em
voz alta, não registre e não coloque o segredo em URL ou comando compartilhado.

Confirme somente que o serviço respondeu:

```text
https://URL-DO-RELAY/healthz
```

Não faça alterações na VM durante o deploy do Render. Uma falha no Render não
autoriza qualquer reinicialização, alteração de rede ou intervenção em outros
sistemas locais.

### CHECKPOINT 3

Peça ao usuário para confirmar que guardou:

- a URL HTTPS do relay;
- o `RELAY_SEGREDO` em gerenciador seguro.

Não prossiga enquanto o usuário não confirmar.

## Fase 4 — preparação Linux Mint

Volte ao terminal da VM. Reconfirme, em modo somente leitura:

```bash
systemctl is-active controle-patrimonial.service
systemctl is-active controle-patrimonial-relay-sync.service
sudo ss -ltnp 'sport = :8080'
```

Essa reconfirmação não permite encerrar processos. Se o estado mudou, **PARE**
e reporte ao administrador.

Pergunte se esta é uma instalação nova ou uma migração da VM Windows. Em uma
migração, é proibido ativar dois bancos e dois sincronizadores como autoridades
ao mesmo tempo. Use obrigatoriamente `--somente-configurar`; a cópia dos dados e
a troca de autoridade ficarão para o administrador em uma janela separada. Não
pare, reinicie ou desligue a VM Windows.

Mostre o comando de instalação antes de executá-lo:

```bash
cd /CAMINHO/DO/REPOSITORIO/patrimonio-web
sudo bash ./linux/instalar-linux-mint.sh \
  --usuario "USUARIO_LINUX" \
  --relay-url https://URL-DO-RELAY
```

Para migração, acrescente:

```text
--somente-configurar
```

Não inclua o segredo na linha de comando. O instalador solicitará o valor de
forma oculta; devolva o teclado ao usuário para que ele digite pessoalmente.

O instalador foi projetado para:

- tocar apenas nos dois serviços autorizados;
- não reiniciar serviço ativo;
- não encerrar processo na porta 8080;
- não mudar firewall ou rede;
- não desligar ou reiniciar a VM;
- parar com segurança quando detectar conflito.

Não modifique o script para remover essas proteções. Não acrescente `--force`,
comandos de encerramento ou reinicialização.

### CHECKPOINT 4

Depois da execução, mostre a saída completa sem revelar o segredo. Se o
instalador informar que a porta está ocupada ou que um serviço já estava ativo,
considere isso uma proteção bem-sucedida. **Não tente forçar a ativação.**

## Fase 5 — verificação somente leitura

Execute somente:

```bash
cd /CAMINHO/DO/REPOSITORIO/patrimonio-web
bash ./linux/verificar-linux-mint.sh
systemctl status controle-patrimonial.service --no-pager
systemctl status controle-patrimonial-relay-sync.service --no-pager
journalctl -u controle-patrimonial.service -n 50 --no-pager
journalctl -u controle-patrimonial-relay-sync.service -n 50 --no-pager
```

Não use `journalctl -f` sem limite de tempo. Não mostre conteúdo dos arquivos
de ambiente, pois contêm o segredo.

Se os serviços não estiverem ativos porque a porta estava ocupada ou porque foi
usado `--somente-configurar`, reporte como “configurado, aguardando ativação
manual”. Isso não autoriza `systemctl restart`, `systemctl stop`, encerramento de
processos ou reboot.

Se estiverem ativos, confirme:

- `http://127.0.0.1:8080/healthz` retorna `{ "ok": true }`;
- o sincronizador registra ciclos sem revelar segredo;
- `PAT_LINK_ASSINATURA` aponta para a URL do relay;
- o relay responde em `/healthz`.

## Fase 6 — teste funcional controlado

Somente com autorização explícita do administrador, use um termo de teste:

1. crie ou selecione um termo pendente no sistema;
2. aguarde o ciclo de até 60 segundos;
3. confirme que o link copiado usa o domínio HTTPS do relay;
4. abra o link em viewport de celular;
5. confirme nome, itens, canvas, documento e aceite;
6. assine apenas o termo de teste;
7. aguarde o sincronizador importar a assinatura;
8. confirme o status assinado no sistema local.

Não use dados reais sem autorização. Não repita uma assinatura já confirmada.
Não exponha token, documento ou assinatura no relatório ou em capturas de tela.

Uma falha funcional não autoriza reiniciar VM, rede ou outros serviços.

## Relatório final obrigatório

Entregue um relatório curto com:

- URL do relay, sem incluir segredo;
- versão do Linux Mint e do Node;
- estado de cada um dos dois serviços autorizados;
- resultado de `/healthz` local e remoto;
- resultado dos testes;
- localização dos dados e dos backups;
- confirmação de que os arquivos de ambiente usam permissão `600`;
- qualquer etapa deixada para ativação manual;
- confirmação textual: “A VM não foi desligada ou reiniciada; nenhum processo,
  serviço, firewall, rede ou sistema fora do escopo foi alterado.”

Nunca inclua `RELAY_SEGREDO`, tokens de termos, documentos ou assinaturas no
relatório.

## Invariante final

Durante todo o trabalho permanece **ESTRITAMENTE PROIBIDO** desligar ou
reiniciar a VM, encerrar processos, interromper a porta 8080, parar/reiniciar
serviços preexistentes ou tomar qualquer atitude que comprometa os outros
sistemas em execução. Em caso de dúvida, pare e peça orientação ao
administrador.

---
