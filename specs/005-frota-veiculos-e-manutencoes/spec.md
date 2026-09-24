# Spec 005 — Frota: veículos e histórico de manutenções

**Status**: implementada, verificação parcial · **Branch**: `feat/frota-manutencoes` · **Data**: 2026-09-24

## Pedido

"Quero colocar algo assim na frota" (referência: anúncio de *Histórico de manutenções* com tabela
data/veículo/serviço/km/tipo, indicadores por mês, linha do tempo e consulta por veículo).
"Vai ter a planilha ou cadastro de cada veículo e aí os números."

## O que foi feito

### Frota ▸ Veículos (`#/frota/veiculos`)
- Cadastro: placa (única, normalizada: `abc-1d23` → `ABC1D23`; aceita ABC1234 e Mercosul ABC1D23),
  nº da frota, tipo (cavalo, truck, toco, carreta, van, carro de apoio, outro), marca, modelo, ano,
  km atual, situação (ativo, em manutenção, inativo) e observações.
- Importação de planilha (.xlsx ou CSV, com modelo para baixar): cabeçalhos reconhecidos por nome
  (com ou sem acento), tipos e situações escritos livremente viram as opções do sistema; cria as
  placas novas e, se marcado (exige Editar), completa as que já existem sem apagar nada. Relatório
  por linha: cadastrado, atualizado, ignorado (repetido/existente) ou erro com o motivo.
- Veículo com histórico não pode ser excluído (vira "Inativo").
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
- Rotas: `GET/POST /api/veiculos`, `POST /api/veiculos/importar`, `GET/PUT/DELETE /api/veiculos/:id`
  (o GET traz o histórico), `GET/POST /api/manutencoes`, `POST /api/manutencoes/importar`,
  `GET/PUT/DELETE /api/manutencoes/:id`.
- Abas novas na matriz de acessos: `veiculos` e `manutencoes` (padrão Visualizar). Cadastro e
  importação = Cadastrar; correção = Editar; exclusão = Excluir. O bloqueio de alteração vale aqui.
- Auditoria: `criar`/`editar`/`excluir` por registro e uma linha `importar` por planilha.
- Backup em planilha ganha as abas Veículos e Manutenções.

## Verificação (princípio VI)

- Teste direto do `store.js` numa cópia da base: cadastro, placa repetida/inválida, ano inválido,
  importação com repetidas e erros, atualização sem apagar, manutenções, data futura, km do
  veículo, importação por nº da frota, duplicadas, exclusão bloqueada, permissões e bloqueio.
- No navegador (servidor isolado): importação de 7 veículos (6 cadastrados, 1 placa inválida) e de
  18 manutenções (15 registradas, 1 repetida ignorada, 2 erros).
- **Pendente**: conferir no navegador o painel de Manutenções, a ficha do veículo, o formulário de
  registro, o gráfico nos dois temas e no celular, e a visão de um operador só com Visualizar.
