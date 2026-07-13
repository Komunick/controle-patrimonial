# Tasks: Controle Patrimonial — plataforma de gestão (linha de base)

**Input**: spec.md e plan.md desta pasta
**Prerequisites**: constitution v1.0.0

> Gerado no espírito do `/speckit-converge`: o sistema já existe — as fases abaixo
> registram a linha de base **entregue e verificada em produção** (marcada [X]) e o
> **trabalho restante** conhecido (aberto), para as próximas sessões continuarem daqui.

## Fase 1: Fundação (entregue)

- [X] T001 Servidor Node puro com estáticos + API compartilhada (`server/server.js`, `server/db.js`)
- [X] T002 Base JSON fora da web com gravação atômica, quarentena de corrompidos e snapshots (`patrimonio-data/`)
- [X] T003 SPA por hash com sidebar, drawer, toasts, temas claro/escuro e login de operadores (`app.js`, `index.html`)
- [X] T004 Auditoria de todas as mutações + aba Auditoria
- [X] T005 Tempo real entre operadores (SSE) com proteção de contexto (inventário, formulário de inspeção)
- [X] T006 Menu lateral com rolagem própria em telas baixas; botão de tema fixo no rodapé

## Fase 2: US1 — Gestão de patrimônios (entregue)

- [X] T010 CRUD de itens com patrimônio sequencial, catálogo de tipos, valor, NF, status e condição
- [X] T011 Sub-itens (periféricos) com etiqueta própria e dono opcional
- [X] T012 Vínculos pessoa-item por turno com histórico
- [X] T013 Painel com totais/valores e pesquisa global
- [X] T014 Cadastros de Pessoas e Locais

## Fase 3: US2 — Inspeção 5S (entregue)

- [X] T020 Modelos centralizados (`MODELOS_INSPECAO`): 5S Escritório (cópia SafetyCulture, 6 páginas) e Inspeção de Segurança (5 páginas)
- [X] T021 Tela inicial só com histórico (grupos por dia, busca, filtros) + "Iniciar inspeção" (direto com 1 modelo; seletor com 2+)
- [X] T022 Formulário paginado: SIM/NÃO/N/A, observação sempre visível, fotos comprimidas no cliente, pontuação ao vivo, autosave com trava otimista (409)
- [X] T023 Conclusão validada (obrigatórias + não conformidade condicional) congelando pontuação/classificação
- [X] T024 Rascunhos retomáveis (dono/admin), descarte com limpeza de fotos no disco
- [X] T025 Relatório semanal (navegação por semanas, média) + detalhe completo por inspeção
- [X] T026 Planilha XLSX com gráficos gerada à mão no servidor: abas Inspeções, Resumo semanal, Locais (limpeza em dia/pendências, nunca inspecionados) e Pendências
- [X] T027 Compatibilidade com inspeções do formato antigo (leitura normalizada + POST legado)

## Fase 4: US3 — EPIs e materiais (entregue)

- [X] T030 Entrega com colaborador em lista (Pessoas + "Outro") e itens de catálogo (25 EPIs + "Outro") com CA/quantidade
- [X] T031 Termo em PDF gerado à mão com logo; download por blob (sem alerta do Chrome)
- [X] T032 Assinatura digital por link público com token forte (`assinar.html`) ou anexo de PDF assinado
- [X] T033 Aba Materiais: estoque com mínimo/alerta, entradas/saídas auditadas com motivo
- [X] T034 Baixa automática na entrega (com aviso de estoque insuficiente) e estorno no cancelamento

## Fase 5: US4/US6 — Etiquetas e inventário (entregue)

- [X] T040 Folhas de etiquetas 40×20 mm (A4) com logo, patrimônio e QR; impressão seletiva
- [X] T041 Rota de abertura por QR (`#/a/<patrimônio>`)
- [X] T042 Inventário por conferência com leitor de código, progresso em tempo real e desfazer

## Fase 6: US5 — Home office (entregue)

- [X] T050 Registro de saída (item + sub-itens + acessórios) com mudança de status
- [X] T051 Devolução com condição de volta e histórico

## Fase 7: Transversais (entregue)

- [X] T060 Backup/consulta em planilha Excel com TODAS as áreas (Itens, Donos, Sub-itens, Pessoas, Home Office, Locais, Inspeções 5S, Entregas de EPI, Materiais, Operadores, Auditoria) + aba oculta restaurável
- [X] T061 Gestão de operadores (admin), troca de senha, papéis
- [X] T062 Spec Kit inicializado; constitution v1.0.0; esta spec de base

## Trabalho restante (aberto)

- [ ] T100 Importar a lista completa de colaboradores para Pessoas — **aguardando o dono do projeto enviar a lista** (spec: Assumptions)
- [ ] T101 Acesso externo sem VPN — decisão pendente entre Cloudflare Tunnel + Access (recomendado) e túnel via VM Oracle (frp + Caddy); pré-requisitos: domínio e acesso SSH/console OCI (ver memória "controle-patrimonial-acesso-remoto")
- [ ] T102 Endurecer autenticação ANTES de qualquer exposição pública (constitution, Restrições de Segurança): trocar `admin/admin123`, resolver `X-Operator` contra `DB.users` no servidor, exigir admin em `/api/users`, `PUT /api/config`, `/api/import` e `/api/export` (hoje vaza `pass_hash`)
- [ ] T103 Hash de senha com KDF de verdade (PBKDF2/scrypt) e senha mínima maior — opcional em rede fechada, obrigatório se expor
- [ ] T104 Poda/rotação do `audit_log` (cresce sem limite; cada escrita reescreve o arquivo inteiro)
- [ ] T105 Auto-início do servidor no boot do Windows — rodar `INSTALAR-AUTOINICIO.bat` na máquina servidor (pendente desde 2026-06-30)
- [ ] T106 Sessão de operador com token (hoje valida só por id — caso de borda de auditoria após restore)
- [ ] T107 Backup automático da pasta `patrimonio-data/` inteira para fora da máquina (fotos e PDFs não entram na planilha)

## Dependencies & Execution Order

- T101 depende de T102 (não expor antes de endurecer) e dos insumos do usuário
  (domínio, SSH). T103/T106 acompanham T102. T100, T104, T105 e T107 são independentes.
- Novas funcionalidades: criar nova spec (`specs/002-…`) via fluxo Spec Kit em vez de
  estender esta linha de base.
