# Controle Patrimonial — versão Web (100% navegador)

> Para operar com banco compartilhado e servidor Node em uma VM VirtualBox com
> Linux Mint, use o pacote de produção em
> [`linux/README.md`](linux/README.md). Ele inclui serviços `systemd`,
> sincronização com o relay público e instalação sem reiniciar a VM ou afetar
> outros sistemas.

Sistema de controle de patrimônio com **QR Code** que roda **inteiramente no navegador**: não precisa de Node, servidor nem instalação. Basta abrir o `index.html`.

O backend foi substituído por uma camada de dados em JavaScript que guarda tudo no **armazenamento local do navegador** (`localStorage`). O QR Code e a planilha de backup também são gerados no próprio navegador.

---

## Como rodar

### Opção 1 — abrir direto (mais simples)
Dê um duplo clique em **`index.html`** (ou arraste para uma aba do navegador). Tudo funciona: login, cadastro de itens, sub-itens, donos/turnos, inventário, etiquetas e auditoria.

### Opção 2 — servir por HTTP/HTTPS
Sirva a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000   # depois acesse http://localhost:8000
# ou:  npx serve .
```

### Opção 3 — publicar (Netlify)
Como é só HTML/CSS/JS estático, dá para publicar em qualquer host. No Netlify, arraste a pasta para o Netlify Drop (sem build, sem comando).

---

## Entrar no sistema (login de operadores)

O sistema abre numa **tela de login**. Cada operador entra com seu **login e senha**.

- **Primeiro acesso:** use **`admin`** / **`admin123`**. Depois cadastre os operadores reais e troque a senha do admin.
- A **data e a hora de cada login** vão para a **Auditoria**, assim como toda alteração feita pelo operador (quem fez, o quê, quando).
- O operador logado aparece no rodapé da barra lateral, com o botão **Sair**.

### Operadores (somente administradores)
Na aba **Operadores**, um administrador pode **cadastrar, editar e remover** operadores, definir **login e senha**, e o **papel**:

- **Administrador** — acessa tudo, inclusive Operadores e Configurações.
- **Operador** — acessa o restante do sistema (itens, pessoas, inventário, etiquetas, auditoria).

> Importante: como o sistema roda **só no navegador**, o login serve para **identificar o operador** e registrar quem fez cada ação — não é uma segurança forte (os dados ficam no navegador e podem ser exportados). As senhas são guardadas com hash (não em texto puro).

---

## Onde ficam os dados (e backup em Excel)

Os dados ficam salvos **no próprio navegador**, naquele dispositivo (chave `patrimonio.db.v1`). Eles **persistem** entre fechamentos, mas:

- São **por navegador/dispositivo** — não sincronizam entre máquinas.
- Somem se você **limpar os dados do navegador** ou usar uma janela anônima.

Por isso, em **Configurações ▸ Cópia de segurança**:

- **Baixar planilha de backup** gera um arquivo **Excel (`.xlsx`)** com abas legíveis (Itens, Donos, Sub-itens, Pessoas, Operadores, Auditoria) — você pode abrir e consultar normalmente.
- **Restaurar de uma planilha** lê uma planilha **gerada aqui** e substitui os dados atuais do navegador.

> Para **alterar** os dados, use o próprio sistema. Mudanças feitas direto na planilha **não voltam** na restauração (a restauração usa a cópia fiel embutida no arquivo).

Recomendação: baixe um backup de tempos em tempos e ao migrar de máquina. Na primeira abertura o sistema vem com **dados de exemplo**; pode apagá-los e cadastrar os reais (ou restaurar um backup por cima).

---

## O que o sistema faz

- **Itens** (aba única): tudo é cadastrado e listado aqui — equipamentos (notebooks, celulares…) e patrimônio diverso (mesas, cadeiras, TVs, roteadores…). Filtros por categoria, tipo, status e dono.
  - Equipamentos podem ter **vários donos com turno** (manhã / noite / integral) e **sub-itens** vinculados (headset, mouse, teclado, carregadores…).
- **Pessoas**, com os itens e sub-itens sob responsabilidade de cada uma.
- **Valor** e **data da compra** em todos os itens; o painel soma o patrimônio total.
- **Patrimônio sequencial automático** com **QR Code**. O **prefixo é personalizável** (veja Configurações).
- **Cadastro em lote e tipos livres**: ao cadastrar dá pra informar uma **Quantidade** (cria vários itens idênticos de uma vez, cada um com seu patrimônio sequencial) e escolher **"Outro tipo (especificar)"** para registrar tipos fora do catálogo.
- **Inventário** (conferência física): **digite o patrimônio e tecle Enter** (ou clique em **Conferir** na lista) para marcar os bens presentes. Mostra o progresso (% conferido), separa **pendentes** × **conferidos**, registra quem conferiu e quando, e tem **Reiniciar inventário**. Conferir um sub-item marca o item ao qual ele pertence.
- **Etiquetas** para impressão — cada etiqueta traz a **logo da empresa**, o QR Code, o nome e o número do patrimônio.
- **Auditoria** de todas as ações, incluindo **login/logout** com data e hora.

---

## Configurações

Na aba **Configurações** você ajusta, sem mexer em código:

- **Empresa:** nome que aparece nas etiquetas e no sistema.
- **Patrimônio · numeração:** o **prefixo** do número de patrimônio (letras/números, até 8 caracteres). Ex.: trocar para **`BRA`** faz os próximos itens virarem **`BRA-000001`**, **`BRA-000002`**… Os itens já cadastrados **mantêm** o número atual.
- **Cópia de segurança:** baixar/restaurar a planilha de backup (Excel).

---

## Personalizar a aparência

O sistema já vem com a identidade visual da **Brazil Transports** (logo, cores e favicon).

- **Trocar o logo:** substitua `assets/logo.png` (de preferência fundo branco/transparente). Os ícones da aba ficam em `assets/favicon-32/64/180.png`.
- **Cores:** variáveis no início do `styles.css` (`--accent` verde, `--gold-bright` ouro, `--navy` azul-marinho).

Para começar do zero (sem os dados de exemplo), abra o console do navegador e rode `Patrimonio.reset()`, ou restaure um backup seu.

---

## Estrutura dos arquivos

```
.
├── index.html                  # página única
├── styles.css                  # estilos (cores da marca nas variáveis do topo)
├── app.js                      # interface (SPA em JS puro)
├── store.js                    # "banco" no navegador + rotas + login + QR
├── assets/
│   ├── logo.png                # logo Brazil Transports (barra, login e etiquetas)
│   └── favicon-32/64/180.png   # ícones da aba do navegador
└── vendor/
    ├── qrcode-generator.js     # geração de QR Code (offline)
    └── xlsx.mini.min.js        # leitura/escrita da planilha de backup (offline)
```

Nenhuma dependência de rede: as bibliotecas estão embutidas na pasta `vendor/`.

---

## Acesso rápido

| | |
|---|---|
| Primeiro login | **admin** / **admin123** (troque depois) |
| Criar itens | aba **Itens** ▸ **+ Novo item** |
| Mudar o prefixo (ex.: BRA) | aba **Configurações** |
| Backup | aba **Configurações** ▸ baixar/restaurar planilha |
| Operadores | aba **Operadores** (somente administradores) |
