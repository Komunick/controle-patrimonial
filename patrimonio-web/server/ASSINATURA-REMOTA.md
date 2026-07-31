# Assinatura de EPI fora da rede local

Permite que o motorista abra o link de assinatura **de qualquer lugar** (4G, casa,
estrada), sem VPN e sem abrir porta no roteador. O caminho é:

```
celular do motorista ──internet──> túnel Cloudflare ──> proxy-assinatura.js (porta 8791)
                                                          └─> sistema patrimonial (porta 8080)
```

O `proxy-assinatura.js` deixa passar **somente** as três rotas públicas da
assinatura (`/assinar.html`, `GET /api/epi/termo`, `POST /api/epi/assinar`).
Login, painel, cadastros e API de operadores **não** ficam acessíveis pela
internet. Cada link carrega um token de 40 caracteres, único por entrega, que
deixa de valer se a entrega for cancelada e só aceita uma assinatura.

## 1. Subir o proxy (na VM, junto com o sistema)

```bat
node server\proxy-assinatura.js
```

Para iniciar sempre junto com o sistema, acrescente ao `start-server.bat` (antes
do `node server\server.js`):

```bat
start "proxy-assinatura" /min node server\proxy-assinatura.js
```

## 2. Túnel Cloudflare

### Teste rápido (URL provisória, muda a cada execução)

```bat
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8791
```

Ele imprime um endereço `https://alguma-coisa.trycloudflare.com` — já dá para
testar do 4G. **Não use no dia a dia**: a URL muda toda vez que o túnel reinicia.

### Definitivo (URL fixa, precisa de um domínio na Cloudflare)

Com o domínio (ex.: `komunick.com`) numa conta Cloudflare gratuita:

```bat
cloudflared tunnel login
cloudflared tunnel create assinatura-epi
cloudflared tunnel route dns assinatura-epi assinatura.komunick.com
```

Crie `C:\Users\<usuario>\.cloudflared\config.yml`:

```yaml
tunnel: assinatura-epi
credentials-file: C:\Users\<usuario>\.cloudflared\<id-do-tunel>.json
ingress:
  - hostname: assinatura.komunick.com
    service: http://127.0.0.1:8791
  - service: http_status:404
```

E instale como serviço do Windows (sobe sozinho com a VM):

```bat
cloudflared service install
```

## 3. Avisar o sistema qual é o endereço público

No `start-server.bat` da VM, antes de subir o node:

```bat
set PAT_LINK_ASSINATURA=https://assinatura.komunick.com
```

Com isso, o botão **“Copiar link de assinatura”** da aba de EPIs passa a copiar
o endereço público em vez do IP da rede local. Sem a variável, tudo continua
funcionando como antes (link local).

## Alternativa: ngrok

Mesma ideia, apontando para a porta do proxy:

```bat
ngrok http 8791
```

No plano gratuito a URL muda a cada execução e o visitante vê uma página de
aviso antes do termo — o Cloudflare Tunnel não tem nenhum dos dois problemas.
