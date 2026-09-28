# Spec 005 — Frota: veículos e histórico de manutenções

**Status**: implementada · **Branch**: `feat/frota-manutencoes` · **Data**: 2026-09-24

## Pedido

"Quero colocar algo assim na frota" (referência: anúncio de *Histórico de manutenções* com tabela
data/veículo/serviço/km/tipo, indicadores por mês, linha do tempo e consulta por veículo).
"Vai ter a planilha ou cadastro de cada veículo e aí os números."

## O que foi feito

### Frota ▸ Veículos (`#/frota/veiculos`) — a lista vem do TMS
- Pedido complementar: "os veículos que devem aparecer neste sistema são todos que estão
  cadastrados no tms.braziltransports.com.br".
- O servidor entra no TMS com uma conta de integração (`PAT_TMS_EMAIL`/`PAT_TMS_SENHA`, perfil
  Coordenador de frota), chama `POST /api/auth/sign-in`, lê `GET /api/master-data/vehicles` e
  `GET /api/master-data/trailers` (com `includeArchived=true`) e sai (`/api/auth/sign-out`). Roda ao
  iniciar, a cada `PAT_TMS_INTERVALO_MIN` minutos (padrão 15) e no botão "Sincronizar com o TMS"
  (`POST /api/veiculos/sincronizar`, trava de 30 s). Situação em `GET /api/veiculos/sincronizacao`.
- O TMS manda em placa, tipo (códigos do TMS), status, propriedade, RENAVAM, chassi, ANTT,
  proprietário e capacidade. Aqui só se completam nº da frota, marca, modelo, ano, km e observações.
- Cadastro, importação e exclusão de veículos foram tirados: `POST /api/veiculos`, `/importar` e
  `DELETE` respondem que os veículos vêm do TMS. O nível Cadastrar/Excluir da aba Veículos sumiu.
- Veículo que já existia aqui com a mesma placa é ligado ao do TMS (mantém o histórico). O que foi
  arquivado no TMS ou sumiu de lá sai da lista padrão ("Mostrar arquivados e fora do TMS").
- Falha na sincronização (login recusado, senha provisória, sem permissão, TMS fora do ar) fica
  registrada e aparece numa barra na aba Veículos; a lista da última sincronização boa continua.
- Ficha (`#/frota/veiculos/<id>`): cartões (manutenções, preventivas, corretivas, custo, última,
  km rodado desde a última), gráfico por mês dos últimos 12 meses (com tabela), serviços feitos,
  linha do tempo vertical e peças aplicadas (saídas do estoque da Frota com a placa).

### Frota ▸ Manutenções (`#/frota/manutencoes`)
- Registro: veículo, data (não pode ser futura), km, serviço (com sugestões), tipo preventiva ou
  corretiva, custo, oficina e observações. O km do veículo sobe quando a manutenção traz km maior.
- Importação do histórico (.xlsx ou CSV): veículo pela placa ou pelo nº da frota ("015" = "15"),
  datas do Excel ou em texto (dd/mm/aaaa), tipo abreviado (P/C), custo como número ou "R$ 1.234,56".
  Linha repetida (mesmo veículo, data, serviço e km) é ignorada — dá para importar de novo.
- Painel: filtros de período (3/6/12 meses, este ano, ano passado, tudo), veículo, tipo e busca;
  cartões; gráfico de colunas empilhadas por mês (com tabela e dica ao passar o mouse); serviços mais
  frequentes; veículos com mais manutenções; linha do tempo; histórico com editar/excluir; Excel.

### Gráficos (skill de visualização de dados)
- Preventiva = azul `#2a78d6`/`#3987e5`, Corretiva = laranja `#eb6834`/`#d95926` (claro/escuro).
  O par passou no validador de paleta contra as superfícies do sistema nos dois temas; o verde da
  marca com laranja foi reprovado (daltonismo, ΔE 3,9) e não foi usado.
- Colunas de até 24px, ponta arredondada, 2px entre os pedaços, grade em fio fino, legenda sempre,
  rótulo direto na última coluna, tabela equivalente e dica acessível por teclado.

## Dados, API e permissões

- Coleções novas `DB.veiculos` e `DB.manutencoes` (aditivas, via `ensureShape`).
- Rotas: `GET /api/veiculos` (`?todos=1` inclui arquivados e fora do TMS), `GET/PUT /api/veiculos/:id`
  (o GET traz o histórico; o PUT só aceita os dados de manutenção), `GET /api/veiculos/sincronizacao`,
  `POST /api/veiculos/sincronizar`, `GET/POST /api/manutencoes`, `POST /api/manutencoes/importar`,
  `GET/PUT/DELETE /api/manutencoes/:id`.
- Abas novas na matriz de acessos: `veiculos` (Visualizar ou Editar os dados de manutenção) e
  `manutencoes` (registro e importação = Cadastrar; correção = Editar; exclusão = Excluir), ambas com
  padrão Visualizar. O bloqueio de alteração vale aqui.
- Auditoria: `criar`/`editar`/`excluir` por registro e uma linha `importar` por planilha.
- Backup em planilha ganha as abas Veículos e Manutenções.

## Verificação (princípio VI)

- Teste direto do `store.js` numa cópia da base: cadastro, placa repetida/inválida, ano inválido,
  importação com repetidas e erros, atualização sem apagar, manutenções, data futura, km do
  veículo, importação por nº da frota, duplicadas, exclusão bloqueada, permissões e bloqueio.
- TMS simulado (mesmas rotas e cookies do Supabase divididos em .0/.1): sincronização ao iniciar
  (8 itens, 5 ligados pela placa com histórico, 3 novos, 1 fora do TMS), botão "Sincronizar"
  (status mudado e reboque novo), conta sem permissão (barra de erro, lista anterior mantida).
- No navegador (servidor isolado): importação de 18 manutenções (15 registradas, 1 repetida
  ignorada, 2 erros), painel de Manutenções com gráfico, dica e tabela, ficha do veículo com dados
  do TMS, formulário de registro, temas claro e escuro e celular.
