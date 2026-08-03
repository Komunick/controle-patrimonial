# Controle Patrimonial no Linux Mint (VirtualBox)

Este pacote executa o sistema local e o sincronizador do relay como serviços
`systemd`. O relay público continua no Render; portanto, a VM não precisa de IP
público e só faz conexões de saída HTTPS.

O link enviado ao colaborador é sempre público:

```text
https://controle-patrimonial-relay-epi.onrender.com/assinar.html?t=<token>
```

Ele funciona em 4G/5G e em redes externas. A porta 8080 nunca aparece no link.

```text
celular -> HTTPS -> relay no Render
                        ^  |
                        |  v
Linux Mint :8080 <- sincronizador (a cada 60 segundos)
```

## Regra de segurança

**É estritamente proibido desligar ou reiniciar a VM para instalar ou ativar
esta integração.** Também é proibido encerrar processos, alterar firewall,
rede, serviços ou aplicações fora dos dois serviços abaixo:

- `controle-patrimonial.service`;
- `controle-patrimonial-relay-sync.service`.

O instalador respeita essa regra: não contém comandos de desligamento,
reinicialização, `systemctl restart`, `kill`, `pkill` ou `killall`. Se a porta
8080 estiver ocupada, ele preserva o processo existente e não inicia os novos
serviços.

## Requisitos

- Linux Mint com `systemd`;
- Node.js 24 LTS instalado para o usuário ou para todo o sistema;
- relay já implantado no Render;
- URL HTTPS do relay e o mesmo `RELAY_SEGREDO` usado no Render;
- usuário Linux comum, sem privilégios, para executar o Node;
- código em caminho sem espaços, preferencialmente
  `/opt/controle-patrimonial/patrimonio-web`.

Antes de liberar acesso pela rede, troque a senha inicial do operador `admin`.
A porta 8080 usa HTTP e deve permanecer em rede local confiável ou VPN; nunca a
publique diretamente na internet.

Confirme antes de instalar:

```bash
node --version
command -v node
systemctl --version
```

O instalador não instala nem atualiza Node.js, pacotes, Guest Additions,
firewall ou componentes do sistema operacional. Ele aceita Node 24/22 em
`~/.nvm/versions/node` e prefere a versão 24 mais recente do usuário.

## Recursos recomendados da VM

Para uma instalação pequena ou média:

- 2 vCPUs;
- 2 GB de RAM;
- 20 GB de disco virtual dinâmico;
- controladora de disco padrão do VirtualBox;
- horário sincronizado no convidado Linux.

Use o disco virtual Linux para os dados. Não coloque
`/var/lib/controle-patrimonial` em uma pasta compartilhada `vboxsf`: o banco
usa `fsync` e troca atômica de arquivos, que funcionam melhor em um sistema de
arquivos Linux local, como ext4.

## Rede do VirtualBox

O modo NAT é suficiente para o sincronizador acessar o Render. Para abrir o
sistema a partir do computador hospedeiro, configure uma regra de
redirecionamento da porta 8080 do hospedeiro para a porta 8080 da VM.

Se computadores da rede local também precisarem acessar o sistema, use uma
interface em modo Bridge e controle o acesso pela rede corporativa. Não exponha
a porta 8080 no roteador da internet: os links públicos de assinatura passam
exclusivamente pelo relay HTTPS.

O instalador não altera NAT, Bridge, DNS, endereço IP nem firewall.

## Instalação

Entre na pasta `patrimonio-web` e execute:

```bash
sudo bash ./linux/instalar-linux-mint.sh --usuario "$USER"
```

Opcionalmente, informe a URL sem colocá-la no prompt interativo:

```bash
sudo bash ./linux/instalar-linux-mint.sh \
  --usuario "$USER" \
  --relay-url https://seu-relay.onrender.com
```

O instalador pedirá `RELAY_SEGREDO` sem mostrar os caracteres. Use exatamente o
mesmo segredo configurado no Render. Sem `--relay-url`, ele usa automaticamente
`https://controle-patrimonial-relay-epi.onrender.com`.

Ele realiza somente estas ações:

1. valida Linux Mint, `systemd`, Node.js e os arquivos do sistema;
2. cria `/var/lib/controle-patrimonial` para banco, anexos e backups;
3. cria `/etc/controle-patrimonial` para os arquivos de ambiente;
4. instala as duas unidades em `/etc/systemd/system`;
5. inicia os serviços somente se a porta 8080 estiver livre;
6. somente depois dessa validação, habilita os serviços para o próximo boot.

Nenhum segredo é gravado no repositório. Os arquivos em `/etc` usam permissão
`600` e pertencem a `root`. O `systemd` lê o ambiente antes de iniciar o
processo sem privilégios.

Para apenas instalar os arquivos, sem iniciar nada:

```bash
sudo bash ./linux/instalar-linux-mint.sh \
  --usuario "$USER" \
  --somente-configurar
```

Nesse modo os serviços também não são habilitados para o boot.

## Migração da VM Windows existente

Não mantenha dois bancos locais e dois sincronizadores como autoridades ao
mesmo tempo. Embora o relay seja idempotente, alterações patrimoniais feitas em
bancos independentes não são mescladas automaticamente.

Para preparar uma migração, execute primeiro com `--somente-configurar`. Assim a
VM Linux não inicia com dados de exemplo e não disputa assinaturas com a VM
Windows. Depois:

1. o administrador obtém uma cópia consistente da pasta de dados da instalação
   Windows, incluindo banco, backups, anexos de EPI e fotos;
2. confere que `/var/lib/controle-patrimonial` é o destino exato e que ainda não
   contém uma base que precise ser preservada;
3. copia os dados durante uma janela de migração controlada;
4. ajusta a propriedade dos arquivos para o usuário Linux escolhido;
5. valida o banco e só então decide a troca de autoridade entre as VMs.

O Claude Cowork não está autorizado a parar a VM Windows, encerrar seu servidor
ou fazer essa troca de autoridade. Essa decisão permanece manual com o
administrador. Nunca desligue uma VM para copiar ou ativar a integração.

## Verificação sem alterações

O verificador é somente leitura:

```bash
bash ./linux/verificar-linux-mint.sh
```

Também é possível consultar separadamente:

```bash
systemctl status controle-patrimonial.service --no-pager
systemctl status controle-patrimonial-relay-sync.service --no-pager
curl --fail http://127.0.0.1:8080/healthz
journalctl -u controle-patrimonial.service -n 50 --no-pager
journalctl -u controle-patrimonial-relay-sync.service -n 50 --no-pager
```

Os logs ficam no `journald`, que faz rotação conforme a política do Linux; não
há arquivo de log crescendo indefinidamente dentro do projeto.

## Quando já existe algo na porta 8080

O instalador não tenta descobrir, encerrar ou substituir o processo. Ele
instala os arquivos, mostra o alerta e termina sem iniciar nem habilitar os
serviços.

O administrador deve identificar a ocupação em modo somente leitura:

```bash
sudo ss -ltnp 'sport = :8080'
```

Não use `kill`, `pkill`, `killall` ou reinicialização da VM. Se a porta pertence
a uma instalação anterior do próprio Controle Patrimonial, planeje a migração
e a ativação em uma janela segura.

Se a porta pertence ao Controle Patrimonial que já está funcionando e a única
peça ausente é a sincronização com o relay, use o modo de compatibilidade:

```bash
sudo bash ./linux/instalar-linux-mint.sh \
  --usuario "$USER" \
  --somente-sincronizador
```

Esse modo valida a API local, instala e inicia apenas
`controle-patrimonial-relay-sync.service`. Ele não instala, para, reinicia ou
habilita `controle-patrimonial.service` e não interfere no processo que já ocupa
a porta 8080.

Depois de até 60 segundos, o endpoint público `/healthz` deve mostrar pelo menos
um termo quando houver entrega pendente. Um relay com `"termos":0` está online,
mas ainda não recebeu dados da VM.

## Atualizações e ativação controlada

Rodar novamente o instalador atualiza arquivos de ambiente e unidades, mas não
reinicia serviços que já estejam ativos. Isso evita indisponibilidade surpresa.

Quando uma reinicialização de **somente um desses dois serviços** for realmente
necessária, ela deve ser decidida e executada manualmente pelo administrador,
em janela controlada. Nunca reinicie a VM para aplicar variáveis de ambiente.

## Dados e backup

Por padrão, os dados definitivos ficam em:

```text
/var/lib/controle-patrimonial/patrimonio.json
/var/lib/controle-patrimonial/backups/
/var/lib/controle-patrimonial/epi-anexos/
/var/lib/controle-patrimonial/inspecao-fotos/
```

Inclua toda a pasta `/var/lib/controle-patrimonial` no backup externo da VM.
Snapshots do VirtualBox não substituem backup dos dados e nunca devem ser
criados por um agente sem autorização explícita do administrador.

## Remoção somente da integração Linux

Se o administrador decidir remover esta instalação, limite a ação aos dois
serviços nomeados e preserve `/var/lib/controle-patrimonial` para recuperação.
Nunca use curingas em comandos de remoção e nunca remova outros serviços.

## Claude Cowork

Para uma instalação assistida, copie integralmente o conteúdo de
[`DEPLOY-CLAUDE-COWORK-LINUX-MINT.md`](DEPLOY-CLAUDE-COWORK-LINUX-MINT.md).
O prompt repete as restrições de segurança e não autoriza o agente a desligar a
VM, reiniciar serviços existentes ou alterar outros sistemas.
