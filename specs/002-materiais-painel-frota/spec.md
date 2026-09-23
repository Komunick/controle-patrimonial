# Spec 002 — Materiais: sub-abas Painel administrativo e Frota

**Status**: implementada · **Branch**: `feat/materiais-painel-frota` · **Data**: 2026-09-23

## Pedido

Na aba **Materiais** do Controle Patrimonial, adicionar duas sub-abas logo abaixo dela:

1. **Painel administrativo** — visão de gestão do estoque.
2. **Frota** — cadastro dos itens de manutenção dos caminhões (pneus, faróis e demais
   itens de manutenção e afins), com controle de estoque.

## Requisitos

### Navegação
- O menu lateral passa a aceitar `children` num item; os filhos aparecem indentados
  sob a aba-mãe (`.nav-sub` / `a.sub`). Rotas: `#/materiais/painel` e `#/materiais/frota`.
- `Painel administrativo` só aparece (e só abre) para operadores com papel `admin`.
  Um operador comum que digitar a rota é devolvido para `#/materiais`.

### Frota (`#/materiais/frota`)
- Cadastro de item com: nome (obrigatório, até 120), categoria (catálogo
  `frotaCategorias`), unidade de medida (`frotaUnidades`), quantidade inicial,
  estoque mínimo (opcional), marca/modelo, aplicação (veículos/eixos), observações.
- Nome único **dentro da categoria** (sem diferenciar maiúsculas).
- Entrada e saída de estoque com motivo; a saída aceita a **placa do veículo**.
  Estoque nunca fica negativo.
- Busca por nome/marca/aplicação, filtro por categoria e "só abaixo do mínimo".
- Excluir exige administrador (mesma regra dos materiais).

### Painel administrativo (`#/materiais/painel`)
- Cartões: materiais cadastrados, itens de frota, unidades em estoque, itens que
  precisam de reposição, entradas e saídas nos últimos 30 dias.
- **Reposição necessária**: materiais e itens de frota no mínimo ou abaixo, com a
  falta e um botão "+ Entrada" que abre o mesmo formulário das abas de origem.
- **Frota por categoria**: itens, unidades e quantos estão abaixo do mínimo.
- **Movimentações de estoque**: registros da auditoria de `material` e `frota`
  (até 500), com busca e filtros por tipo, ação e período (7/30/90 dias/tudo).
- **Exportar estoque (Excel)**: abas Materiais, Frota e Movimentações (as filtradas).

## Dados e API (store.js, compartilhado com o servidor)

- Nova coleção `DB.frota_itens` (aditiva; `ensureShape` cria a lista vazia e o
  contador `seq.frota_itens` em bases antigas — princípio III).
- Registro: `{ id, nome, categoria, unidade, quantidade, minimo, marca, aplicacao,
  obs, created_at, updated_at }`.
- Rotas: `GET/POST /api/frota`, `GET/PUT/DELETE /api/frota/:id`,
  `POST /api/frota/:id/ajuste` (`delta`, `motivo`, `placa`).
- Auditoria (princípio V): entidade `frota` com ações `criar`, `editar`, `excluir`,
  `entrada`, `saida`; a saída grava a placa nos detalhes.
- `GET /api/audit` passa a aceitar lista separada por vírgula em `entity` e
  `action` (ex.: `entity=material,frota`) — compatível com o uso anterior.
- Catálogo (`/api/config`): `frotaCategorias` e `frotaUnidades`.
- Backup em planilha ganha a aba **Frota**; a restauração já carrega a coleção
  pelo JSON completo embutido.

## Verificação (princípio VI)

Servidor de desenvolvimento isolado (porta 5260, `PAT_DATA_DIR` próprio) com o fluxo
exercitado de ponta a ponta: cadastro, entrada, saída com placa, filtros, painel,
exportação e restrição de acesso do painel a administradores.
