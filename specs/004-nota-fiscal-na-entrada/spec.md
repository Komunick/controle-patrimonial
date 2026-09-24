# Spec 004 — Nota fiscal (foto ou PDF) anexada à entrada de estoque

**Status**: implementada · **Branch**: `feat/nf-anexo-entrada` · **Data**: 2026-09-24

## Pedido

Criar uma opção de anexar imagem ou PDF da nota fiscal na entrada dos itens.

Interpretação: vale para a **entrada de estoque** de Materiais e de Frota (botão "+ Entrada",
inclusive o "+ Entrada" da reposição nos painéis) e para o **cadastro de item novo com estoque
inicial**, que também é uma entrada. Os itens de patrimônio (aba Itens) ficam de fora: não têm
entrada de estoque, só o número da nota no cadastro.

## Comportamento

- Campo opcional "Nota fiscal (foto ou PDF)" no formulário de entrada e no de cadastro. Mostra o
  nome e o tamanho do arquivo, uma miniatura quando é foto e o botão para remover.
- Foto: reduzida no navegador para no máximo 2400 px no maior lado, em JPEG (legível e leve).
  PDF: vai como está, até 10 MB.
- A entrada e a nota são gravadas juntas. Se a entrada falhar (validação ou falta de permissão),
  o arquivo é apagado na hora — não sobra arquivo solto.
- A nota só pode ir numa entrada (quantidade positiva). Saída com nota é recusada.
- Formatos aceitos: JPG, PNG, WebP e PDF, conferidos pelo conteúdo do arquivo (não só pelo nome).

## Onde aparece

- Painel administrativo (Materiais e Frota): selo **📎 NF** na coluna Motivo das movimentações,
  que abre a nota numa nova aba; filtro **Só com nota fiscal**; coluna "Nota fiscal anexada" na
  planilha exportada.
- Auditoria: o texto do registro termina com "NF anexada".

## Dados e servidor

- Arquivos em `patrimonio-data/nf-anexos/` (fora da pasta publicada), com nome gerado no servidor:
  `nf-<material|frota>-<data>-<12 hex aleatórios>.<pdf|jpg|png|webp>`.
- `server.js` intercepta `POST /api/materiais`, `POST /api/frota` e `POST /api/(materiais|frota)/:id/ajuste`
  quando o corpo traz `nf.base64`: valida, grava e repassa ao `store.js` só o nome, pelo `extra` da
  requisição. O corpo enviado pelo navegador nunca define o arquivo (um nome forjado é ignorado).
- `store.js` registra em `meta.nf` da movimentação: `{ arquivo, nome, tipo, tamanho }`. Aditivo:
  movimentações antigas continuam sem nota (princípio III).
- `GET /api/estoque/nf/<arquivo>` devolve o arquivo (nome conferido por padrão, caminho normalizado,
  `nosniff`). Segue o padrão das fotos de inspeção e dos PDFs de EPI: aberto por link, protegido pelo
  nome impossível de adivinhar.
- Permissão: anexar exige o mesmo nível da entrada ("Cadastrar" na aba), já conferido pelo servidor.

## Verificação (princípio VI)

Servidor de desenvolvimento isolado (porta 5260, `PAT_DATA_DIR` próprio):

- entrada de material com PDF, entrada de frota com foto (reduzida para JPG), cadastro de item de
  frota com nota do estoque inicial;
- link 📎 NF abre o arquivo com o tipo certo; filtro "Só com nota fiscal";
- recusas: nota numa saída, PDF falso, formato HEIC, operador sem permissão (arquivo apagado) e
  nome de arquivo forjado no corpo (ignorado).
