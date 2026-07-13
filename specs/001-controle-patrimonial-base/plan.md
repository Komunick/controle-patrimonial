# Implementation Plan: Controle Patrimonial — plataforma de gestão (linha de base)

**Branch**: `dev` (trabalho) → `main` (estável) | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-controle-patrimonial-base/spec.md`

> Plano **as-built**: o sistema já está implementado e em produção. Este documento
> registra a arquitetura real para servir de referência às próximas funcionalidades
> (que devem seguir o fluxo specify → plan → tasks a partir daqui). Artefatos de fase
> (research.md, data-model.md, quickstart.md, contracts/) não foram gerados
> separadamente: o essencial está consolidado neste arquivo.

## Summary

SPA em JavaScript puro (sem framework) servida por um servidor Node.js sem dependências
externas. Toda a lógica de dados vive em `store.js`, que roda dentro do servidor (via
sandbox `vm`) trocando `localStorage` por um arquivo JSON compartilhado. Módulos:
patrimônio (itens/sub-itens/pessoas/locais), inspeção 5S com modelos paginados e fotos,
EPIs com termo PDF + assinatura digital por link e estoque de materiais, etiquetas com
QR, inventário por conferência, home office, auditoria, operadores e backup/restauração
em planilha. Geradores próprios de PDF (termo de EPI) e XLSX com gráficos (relatório de
inspeções), ambos montados à mão no servidor.

## Technical Context

**Language/Version**: JavaScript (ES2019+) no navegador; Node.js puro no servidor (sem transpilação, sem build)

**Primary Dependencies**: nenhuma instalável — apenas vendor local (`qrcode-generator`, `xlsx.mini` para o backup) e módulos nativos do Node (`http`, `fs`, `zlib`, `crypto`, `vm`)

**Storage**: arquivo JSON único (`patrimonio-data/patrimonio.json`) com gravação atômica + fsync e snapshots rotativos; anexos (fotos de inspeção, PDFs de EPI) como arquivos em `patrimonio-data/`

**Testing**: verificação manual de ponta a ponta num servidor de desenvolvimento isolado (config `patrimonio-dev`, porta 8081, `PAT_DATA_DIR` próprio) + revisões multi-agente nos módulos críticos

**Target Platform**: servidor Windows (loop de reinício via `start-server.bat`); clientes em navegador desktop/celular pela rede ZeroTier (porta 8080)

**Project Type**: aplicação web (SPA estática + API HTTP no mesmo servidor)

**Performance Goals**: dezenas de operadores simultâneos; atualização entre clientes em segundos (SSE); relatórios gerados em <10 s

**Constraints**: sem internet obrigatória; sem npm/build; dados nunca serviveis pela web; compatibilidade retroativa de dados (constitution III)

**Scale/Scope**: centenas a poucos milhares de registros por entidade; 14 abas; 3 sistemas irmãos na mesma máquina (patrimônio 8080, chamados 8090, TI 8085)

## Constitution Check

*GATE: aprovado — plano as-built conforme constitution v1.0.0.*

| Princípio | Situação |
|---|---|
| I. Zero dependências externas | ✅ Node/JS puros; vendor local; PDF e XLSX gerados à mão |
| II. Base compartilhada é sagrada | ✅ JSON fora da web; quarentena de corrompidos; gravação atômica; snapshots |
| III. Compatibilidade retroativa | ✅ `ensureShape`/`inspView`; rotas legadas mantidas (ex.: POST antigo de inspeção) |
| IV. Português simples | ✅ UI, erros e documentos em pt-BR |
| V. Auditoria de toda mutação | ✅ `audit()` em todas as rotas de escrita; aba Auditoria |
| VI. Verificar antes de publicar | ✅ dev isolado (8081) + reinício de produção como deploy |

Violações a justificar: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/001-controle-patrimonial-base/
├── spec.md              # Especificação de base (as-built)
├── plan.md              # Este arquivo
├── checklists/
│   └── requirements.md  # Checklist de qualidade da spec (aprovado)
└── tasks.md             # Linha de base entregue + trabalho restante
```

### Source Code (repository root)

```text
patrimonio-web/                  # app servido na web
├── index.html                   # casco da SPA (tema, sidebar, drawer)
├── app.js                       # toda a interface (rotas por hash, telas, drawers)
├── store.js                     # lógica de dados e rotas /api/* (roda no servidor via vm)
├── qr.js                        # QR code no navegador
├── styles.css                   # estilos (temas claro/escuro, impressão de etiquetas)
├── assinar.html                 # página pública de assinatura de EPI (por token)
├── vendor/                      # bibliotecas locais versionadas
├── assets/                      # logo e favicons
├── server/
│   ├── server.js                # HTTP: estáticos + /api/* + PDF/XLSX/fotos + SSE
│   └── db.js                    # carrega store.js em sandbox vm; JSON em disco
├── start-server.bat             # loop de reinício (deploy = matar o node)
└── INSTALAR-AUTOINICIO.bat      # tarefa de auto-início no boot (pendente de rodar)

patrimonio-data/                 # FORA da pasta servida
├── patrimonio.json              # base única compartilhada
├── backups/                     # snapshots automáticos rotativos
├── epi-anexos/                  # PDFs assinados de EPI
└── inspecao-fotos/              # fotos de evidência das inspeções
```

**Structure Decision**: um único projeto com app estático + API no mesmo servidor
Node, e a camada de dados compartilhada entre navegador e servidor via `store.js`
sandboxed — mantém zero dependências e um só artefato de deploy.

## Modelo de dados (como construído)

Entidades no JSON (todas com `id` sequencial por tabela e datas locais
`AAAA-MM-DD HH:MM:SS`):

- `assets` (itens), `peripherals` (sub-itens), `assignments` (vínculos pessoa-item),
  `people`, `rooms`, `homeoffice`, `users`, `audit_log`, `inventory` (conferência),
  `settings` (empresa/prefixo), `seq` (contadores).
- `inspections`: rascunho (`status: em_andamento`, `respostas`, `fotos`) → concluída
  (`items`, `score`, `classificacao`, `paginas_score`, `header`, `concluida_em`);
  registros antigos sem `status` são normalizados na leitura. Modelos em
  `MODELOS_INSPECAO` (store.js).
- `epi_entregas`: `pendente → assinado | cancelado`; itens com CA/quantidade;
  `baixas` (para estorno de estoque); assinatura digital (PNG) ou PDF anexado.
- `materiais`: estoque de EPIs (quantidade, mínimo, movimentações auditadas).

Contratos: rotas REST-like em `/api/*` (JSON), definidas em `store.js` e complementadas
no `server.js` para binários (PDF do termo, fotos de inspeção, planilha XLSX, anexos).
Tempo real por SSE em `/api/events` (rerender com proteção de contexto).
