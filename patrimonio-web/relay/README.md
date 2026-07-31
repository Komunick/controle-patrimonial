# Relay de assinatura de EPI

Este diretório contém o serviço público que recebe termos da VM, mostra a
página de assinatura ao motorista e devolve as assinaturas ao sistema local.
O serviço usa apenas módulos nativos do Node.js e persiste tudo em um arquivo
JSON. Não é necessário instalar Express, SQLite nem qualquer outro pacote.

O fluxo fica assim:

```text
sistema local :8080 -> sincroniza-relay.js -> relay HTTPS -> celular do motorista
sistema local :8080 <- sincroniza-relay.js <- assinatura guardada no relay
```

## Variáveis

### Relay na nuvem

- `RELAY_SEGREDO`: segredo compartilhado com a VM; obrigatório.
- `PORT`: porta HTTP; o Render a define automaticamente.
- `HOST`: endereço de escuta; padrão `0.0.0.0`.
- `RELAY_DATA_DIR`: pasta do `relay.json`; padrão `relay/data`.

### Sincronizador na VM

- `RELAY_URL`: URL HTTPS do relay, sem necessidade de barra final.
- `RELAY_SEGREDO`: exatamente o mesmo valor configurado no relay.
- `SISTEMA_URL`: padrão `http://127.0.0.1:8080`.

`PAT_LINK_ASSINATURA` deve receber o mesmo valor de `RELAY_URL`. Assim o botão
**Copiar link de assinatura** gera `https://seu-relay/assinar.html?t=<token>`.

## Teste local

Use Node.js 18 ou mais recente:

```powershell
cd patrimonio-web\relay
$env:RELAY_SEGREDO = 'troque-por-um-segredo-longo-e-aleatorio'
$env:PORT = '3000'
node server.js
```

Em outro terminal, `Invoke-RestMethod http://127.0.0.1:3000/healthz` deve
responder `{ ok: true }`. Os testes automatizados rodam com `npm test`.

## Deploy no Render

O `render.yaml` na raiz do repositório já declara um Web Service Node no plano
Free e usa `patrimonio-web/relay` como diretório raiz.

1. Envie estas alterações ao repositório GitHub.
2. No Render, escolha **New > Blueprint** e conecte o repositório.
3. Confirme o serviço descrito em `render.yaml`.
4. Quando solicitado, informe `RELAY_SEGREDO`. Use um valor aleatório com pelo
   menos 32 bytes e guarde-o para configurar a VM.
5. Depois do deploy, copie a URL `https://...onrender.com` e abra `/healthz`.

Para gerar um segredo no PowerShell:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes)
$rng.Dispose()
```

Também é possível criar o serviço manualmente com estas opções:

- Root Directory: `patrimonio-web/relay`
- Build Command: `npm install --omit=dev`
- Start Command: `npm start`
- Health Check Path: `/healthz`
- Environment: `RELAY_SEGREDO=<seu segredo>`

### Persistência no plano gratuito

O relay grava em JSON em disco, mas o disco do Web Service Free do Render é
efêmero. O sincronizador acessa o serviço a cada minuto e reenvia termos locais
pendentes após um reinício. Ainda existe uma janela de risco: se o Render
reiniciar depois de o motorista assinar e antes da próxima importação, essa
assinatura pode se perder e precisará ser refeita.

Para uso definitivo, anexe um Persistent Disk em `/var/data`, defina
`RELAY_DATA_DIR=/var/data` e use uma instância que aceite disco persistente.
No Render, Persistent Disk não está disponível no plano Free. Não trate o JSON
efêmero gratuito como arquivo legal definitivo; a cópia definitiva passa a ser
o sistema local assim que o sincronizador importa a assinatura. Consulte as
[limitações oficiais do plano Free](https://render.com/docs/free) e a
[documentação de Persistent Disks](https://render.com/docs/disks).

## Instalar o sincronizador na VM Windows

Copie/atualize a pasta `patrimonio-web` na VM. Em um PowerShell aberto como
Administrador, execute:

```powershell
cd C:\caminho\para\patrimonio-web
Set-ExecutionPolicy -Scope Process Bypass
.\server\instalar-sincronizador-relay.ps1
```

O instalador pede a URL e o segredo sem exibi-lo, grava as variáveis de máquina,
define `PAT_LINK_ASSINATURA`, cria a tarefa agendada
`ControlePatrimonialRelayEpi` (conta SYSTEM, ao iniciar o Windows) e a inicia.
O log fica em `patrimonio-web\sincroniza-relay.log`.

Reinicie a tarefa/serviço que executa `server.js`, ou reinicie a VM, para o
sistema local ler a nova `PAT_LINK_ASSINATURA`. Depois confira:

```powershell
Get-ScheduledTaskInfo -TaskName ControlePatrimonialRelayEpi
Get-Content .\sincroniza-relay.log -Tail 30
```

Para remover apenas o auto-início do sincronizador:

```powershell
Stop-ScheduledTask -TaskName ControlePatrimonialRelayEpi
Unregister-ScheduledTask -TaskName ControlePatrimonialRelayEpi -Confirm:$false
```

## Contrato HTTP

- `POST /api/termos` — exige `x-segredo`; criar novamente o mesmo termo e token
  devolve sucesso sem duplicar. Conteúdo diferente com o mesmo token devolve
  HTTP 409 para não alterar um documento já apresentado ao motorista.
- `GET /api/termo?token=...` — consulta pública usada por `assinar.html`.
- `POST /api/assinar` — público por token; exige aceite, nome e PNG válido e só
  aceita uma assinatura.
- `GET /api/assinaturas?pendentes=1` — exige `x-segredo`.
- `POST /api/assinaturas/<token>/baixada` — exige `x-segredo` e é idempotente.

O relay registra o IP encaminhado pela plataforma, não expõe listagem pública e
envia `Cache-Control: no-store` e cabeçalhos restritivos na página do termo.
