# Spec 003 — Frota como aba própria, painéis separados, acessos por aba e bloqueio de alteração

**Status**: implementada · **Branch**: `feat/frota-aba-propria-permissoes` · **Data**: 2026-09-24

## Pedidos

1. Melhorar a lista de movimentações do painel: criar a coluna de **unidades** com a quantidade
   que entrou ou saiu em cada lançamento.
2. Separar o painel administrativo da Frota do painel de Materiais. **Frota** deixa de ser sub-aba
   de Materiais e vira aba própria, com o seu painel; **Materiais** fica com o dele.
3. Em **Operadores**, controle de quem pode acessar, visualizar, editar e excluir em cada aba.
4. Botão **− Saída** em vermelho.
5. Opção por operador que **bloqueia alteração de itens existentes**: ele só cadastra e dá entrada ou saída.

## Navegação

- Menu: `Materiais` (sub-aba `Painel administrativo` → `#/materiais/painel`) e `Frota` (`#/frota`,
  sub-aba `Painel administrativo` → `#/frota/painel`). O endereço antigo `#/materiais/frota` redireciona.
- Abas sem acesso somem do menu; abrir o endereço delas leva à primeira aba liberada. No login,
  um endereço sem acesso vai direto para a primeira aba liberada, sem aviso.

## Acessos por aba

- Níveis, em ordem: `nenhum` (Sem acesso) < `ver` (Visualizar) < `criar` (Cadastrar: itens novos,
  entrada e saída) < `editar` (alterar o que já existe) < `excluir`.
- Catálogo `abas` em `/api/config`: chave, rótulo, grupo, níveis válidos, padrão e texto de ajuda
  por nível. Painel, Pesquisa, Etiquetas, Auditoria e os dois painéis administrativos são só `ver`;
  Home Office, EPIs e Inspeção 5S não têm `editar`; Configurações não tem `criar` nem `excluir`.
- Padrão (operadores antigos, sem `perms` salvas): o comportamento anterior — exclusão só onde já
  era livre; painéis administrativos sem acesso; **Configurações passa a `ver`** (antes qualquer
  operador podia restaurar backup, o que contrariava o README).
- `user.perms` guarda o nível por aba; `user.bloquear_alteracao` limita tudo a `criar`.
  `/api/users` e a sessão devolvem `perms` (configurado), `bloquear_alteracao` e `acesso` (efetivo).
- Nomes de operador passam a ser únicos: o `X-Operator` leva o nome, que identifica o operador.

### Conferência no servidor (store.js)

Toda rota que altera dados passa por `acaoExigida()` antes de executar. Classes:

| Rota | criar | editar | excluir |
|---|---|---|---|
| assets / peripherals | POST item, POST sub-item | PUT, donos | DELETE |
| people, rooms | POST | PUT | DELETE |
| homeoffice | saída e devolução | — | DELETE |
| epi | entrega, termo assinado | — | cancelar |
| materiais, frota | POST, ajuste (entrada/saída) | PUT | DELETE |
| inventory | conferir | desfazer conferência | reiniciar |
| inspections | rascunho próprio | — | controle total (outros e concluídas) |
| config | — | PUT | — |
| users | só administrador | | |

`/api/export` exige Configurações ≥ Visualizar e `/api/import` exige Editar (conferido no server.js).
A assinatura pública de EPI (`/api/epi/assinar`) continua livre. GET não é barrado no servidor:
as telas escondem as abas sem acesso (o login continua sendo identificação, não segurança forte).

### Telas

- Botões e formulários levam `data-req="aba:nível"`; uma folha de estilo gerada a partir do acesso
  efetivo esconde o que o operador não pode usar.
- Operadores: coluna **Acessos** com resumo; formulário largo com a matriz, atalhos (Padrão, Só
  visualizar, Tudo liberado, Nenhum acesso, clique no nome da coluna, copiar de outro operador) e a
  opção de bloqueio, que apaga as colunas Editar/Excluir e mostra o efeito em cada aba.
- Mudança de acesso chega por tempo real (SSE): o menu e os botões do operador se ajustam na hora.
- Auditoria descreve a mudança (ex.: `Materiais: Editar → Visualizar; bloqueio de alteração ligado`).

## Movimentações e painéis

- `audit()` aceita `meta` com `qtd` (com sinal), `unidade`, `estoque`, `placa`, `motivo` e `inicial`.
  Registros antigos são lidos do texto dos detalhes (`movimentoDe()`), sem migração (princípio III).
- `GET /api/movimentos?tipo=material|frota` devolve as movimentações estruturadas.
- `renderPainelEstoque(tipo)`: período (7/30/90 dias, 12 meses, tudo), cartões (itens, abaixo do
  mínimo, entradas e saídas no período em unidades, veículos atendidos na Frota), reposição, frota
  por categoria, consumo por veículo, entradas e saídas por item e movimentações com Unidades,
  Estoque após, Veículo e Motivo. Exporta para Excel.
- Unidades diferentes (un, L, kg…) nunca são somadas entre si.

## Verificação (princípio VI)

Servidor de desenvolvimento isolado (porta 5260, `PAT_DATA_DIR` próprio) e teste direto do store numa
cópia da base de teste: níveis, bloqueio, recusa de ações, auditoria da mudança, leitura das
movimentações antigas e novas, painéis, atualização de acesso em tempo real, celular e tema claro.
