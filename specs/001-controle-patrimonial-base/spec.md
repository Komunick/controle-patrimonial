# Feature Specification: Controle Patrimonial — plataforma de gestão (linha de base)

**Feature Branch**: `001-controle-patrimonial-base`

**Created**: 2026-07-13

**Status**: Implementado (especificação de base de sistema existente)

**Input**: User description: "site de gestão de patrimônios, inspeção 5S, controle de EPI's, etiquetagem dos patrimônios e cadastro de itens que forem enviado para home office."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gestão de patrimônios (Priority: P1)

A equipe cadastra todos os bens da empresa (equipamentos de TI, mobiliário, rede,
eletrodomésticos etc.) com número de patrimônio único, tipo, marca/modelo, valor, nota
fiscal, estado e local. Cada item pode ter sub-itens (periféricos) e ser vinculado a
uma ou mais pessoas responsáveis, por turno. O painel mostra totais, valores e itens em
atenção.

**Why this priority**: é a razão de existir do sistema — sem o cadastro central de
bens, nenhum dos demais módulos tem base.

**Independent Test**: cadastrar um item com valor e local, vincular a uma pessoa e
verificar que ele aparece na lista, na pesquisa e nos totais do painel.

**Acceptance Scenarios**:

1. **Given** um operador logado, **When** cadastra um item com tipo e valor, **Then** o
   item recebe número de patrimônio único sequencial e aparece na lista e no painel.
2. **Given** um item cadastrado, **When** o operador vincula uma pessoa com turno,
   **Then** a ficha do item mostra o responsável e a pessoa mostra o item.
3. **Given** um item com sub-itens, **When** o operador consulta a ficha, **Then** vê os
   periféricos com seus próprios números de patrimônio.

---

### User Story 2 - Inspeção 5S com modelo padronizado (Priority: P2)

O inspetor abre a aba de inspeções (que mostra apenas o histórico), toca em "Iniciar
inspeção", escolhe um modelo (Auditoria 5S de escritório ou Inspeção de Segurança) e
preenche página por página: identificação (local, turno, data, inspetor), perguntas
SIM/NÃO/N/A com observação e fotos de evidência, pontuação ao vivo por seção. Ao
concluir, a inspeção é congelada com pontuação e classificação. Rascunhos podem ser
continuados depois. Um relatório semanal resume data, inspetor e pontuação de cada
inspeção com a média da semana, e uma planilha Excel com gráficos detalha inspeções,
semanas, situação por local e pendências.

**Why this priority**: substitui a ferramenta paga (SafetyCulture) e o papel, criando
rotina de qualidade auditável nos locais da empresa.

**Independent Test**: iniciar uma inspeção, responder tudo com um "NÃO" em limpeza,
anexar foto, concluir e verificar pontuação, histórico, relatório semanal e a planilha
com o local listado com pendência.

**Acceptance Scenarios**:

1. **Given** a aba de inspeções, **When** o inspetor inicia uma inspeção, **Then** um
   rascunho "em andamento" aparece no histórico e pode ser continuado por quem o criou.
2. **Given** perguntas obrigatórias sem resposta, **When** tenta concluir, **Then** o
   sistema aponta as pendências e não conclui.
3. **Given** uma resposta "NÃO" em qualquer pergunta, **When** vai concluir, **Then** a
   descrição da não conformidade passa a ser obrigatória.
4. **Given** inspeções concluídas na semana, **When** abre o relatório semanal, **Then**
   vê cada inspeção (data, inspetor, pontuação) e a média semanal; a planilha baixada
   tem abas de inspeções, resumo semanal, locais e pendências, com gráficos.

---

### User Story 3 - Controle de EPIs com assinatura digital e estoque (Priority: P2)

O responsável registra a entrega de EPIs escolhendo o colaborador numa lista e os itens
num catálogo (sem digitação), gera o termo em PDF com a logo da empresa e envia ao
colaborador, que assina digitalmente por link público (ou devolve o PDF assinado, que é
anexado). A aba Materiais mantém o estoque de EPIs com quantidades, mínimo com alerta e
entradas/saídas com motivo; a entrega dá baixa automática e o cancelamento estorna.

**Why this priority**: obrigação trabalhista (comprovação de entrega de EPI) hoje
resolvida sem papel, com controle de estoque integrado.

**Independent Test**: cadastrar um material com estoque, registrar uma entrega desse
item, verificar a baixa no estoque e o termo em PDF; cancelar e verificar o estorno.

**Acceptance Scenarios**:

1. **Given** um colaborador e itens escolhidos das listas, **When** salva a entrega,
   **Then** o termo em PDF é gerado e o estoque dos itens correspondentes é baixado.
2. **Given** um link de assinatura enviado, **When** o colaborador assina na tela,
   **Then** a entrega fica "Assinada" com nome, data e assinatura arquivados.
3. **Given** uma entrega pendente cancelada por um administrador, **When** confirma,
   **Then** o estoque é estornado e o link deixa de valer.

---

### User Story 4 - Etiquetagem dos patrimônios (Priority: P2)

O operador seleciona itens e imprime etiquetas padronizadas (40×20 mm em folha A4) com
a logo, o número de patrimônio e um QR code. Ao escanear o QR com o celular, a ficha do
item abre direto no sistema.

**Why this priority**: liga o mundo físico ao cadastro — sem etiqueta, inventário e
rastreio viram adivinhação.

**Independent Test**: gerar a folha de etiquetas de um item, escanear o QR e verificar
que a ficha correta abre.

**Acceptance Scenarios**:

1. **Given** itens cadastrados, **When** o operador abre a aba Etiquetas e seleciona
   itens, **Then** a impressão sai no formato correto com QR e patrimônio legíveis.
2. **Given** uma etiqueta colada, **When** alguém escaneia o QR, **Then** o sistema abre
   a ficha daquele item.

---

### User Story 5 - Home office (Priority: P3)

Quando um equipamento sai da empresa com um colaborador, o operador registra a saída
(item, sub-itens levados, acessórios, pessoa, observações). O status do item muda para
"Home Office" e, na devolução, registra-se a condição de volta e o status retorna.

**Why this priority**: rastreia bens fora da empresa, área de maior risco de perda.

**Independent Test**: registrar a saída de um notebook com carregador, verificar status
e histórico; registrar a devolução e verificar a condição registrada.

**Acceptance Scenarios**:

1. **Given** um item ativo, **When** registra a saída para home office, **Then** o
   status do item muda e o registro guarda pessoa, data e o que foi levado.
2. **Given** um item em home office, **When** registra a devolução com condição,
   **Then** o status volta ao anterior e o histórico guarda a devolução.

---

### User Story 6 - Inventário físico por conferência (Priority: P3)

Periodicamente a equipe percorre a empresa conferindo os itens (escaneando etiquetas ou
buscando pelo número). O sistema mostra o progresso (conferidos × pendentes) e quem
conferiu cada item.

**Why this priority**: fecha o ciclo da gestão patrimonial validando o cadastro contra
a realidade.

**Independent Test**: iniciar um inventário, conferir um item via leitura do código e
ver o progresso atualizado.

**Acceptance Scenarios**:

1. **Given** um inventário iniciado, **When** um item é escaneado/conferido, **Then**
   ele sai da lista de pendentes e o progresso atualiza para todos os operadores.

---

### Edge Cases

- Duas sessões editando o mesmo rascunho de inspeção: a segunda gravação conflitante é
  rejeitada e o formulário recarrega (trava otimista), sem sobrescrever em silêncio.
- Entrega de EPI com estoque insuficiente: baixa até zerar e avisa o operador; nunca
  deixa estoque negativo.
- Registros antigos (formatos anteriores de inspeção/entrega) continuam abrindo no
  histórico e nos relatórios.
- Arquivo de dados corrompido no servidor: vai para quarentena e o sistema não sobe por
  cima (sem re-semear).
- Colaborador de EPI fora do cadastro de Pessoas: entrada manual "Outro" continua
  possível.
- Local excluído do cadastro: inspeções antigas dele permanecem legíveis (nome
  congelado no registro).
- Queda do servidor no meio de uma gravação: o arquivo de dados nunca fica pela metade
  (gravação atômica).

## Requirements *(mandatory)*

### Functional Requirements

**Patrimônio e pessoas**

- **FR-001**: O sistema DEVE cadastrar itens com número de patrimônio único e
  sequencial, tipo (catálogo), categoria, marca/modelo, nº de série, valor, data de
  compra, nota fiscal, estado, status e local.
- **FR-002**: O sistema DEVE permitir sub-itens (periféricos) vinculados a um item pai,
  com etiqueta própria.
- **FR-003**: O sistema DEVE vincular itens a pessoas com turno (manhã/noite/integral)
  e manter histórico de vínculos.
- **FR-004**: O sistema DEVE oferecer pesquisa global e painel com totais, valores por
  categoria e itens em atenção.

**Inspeção 5S**

- **FR-010**: A tela inicial de inspeções DEVE mostrar somente o histórico; inspeções
  novas nascem apenas do botão "Iniciar inspeção".
- **FR-011**: Modelos de inspeção DEVEM ser definidos centralmente (páginas, perguntas
  SIM/NÃO/N/A, campos de identificação, fotos), com escolha do modelo quando houver
  mais de um.
- **FR-012**: O preenchimento DEVE ser paginado, com pontuação ao vivo por seção
  (SIM=1 ponto; N/A fora do denominador), observação por pergunta e fotos de evidência.
- **FR-013**: Rascunhos DEVEM ser salvos automaticamente no servidor e retomáveis por
  quem os iniciou (ou administrador), com proteção contra gravações conflitantes.
- **FR-014**: A conclusão DEVE validar obrigatórias, exigir descrição de não
  conformidade quando houver "NÃO" e congelar pontuação, classificação e respostas.
- **FR-015**: O sistema DEVE fornecer relatório semanal (data, inspetor, pontuação por
  inspeção, média semanal) e exportação em planilha com abas de inspeções, resumo
  semanal, situação por local (incluindo limpeza em dia/pendências e locais nunca
  inspecionados) e pendências detalhadas, com gráficos.

**EPIs e materiais**

- **FR-020**: A entrega de EPI DEVE selecionar o colaborador de uma lista (cadastro de
  Pessoas, com opção de digitar) e os itens de um catálogo (com opção "Outro"), com CA
  e quantidade.
- **FR-021**: O sistema DEVE gerar o termo de entrega em PDF com a logo e permitir
  confirmação por assinatura digital via link público com token forte, ou por anexo do
  PDF assinado.
- **FR-022**: A aba Materiais DEVE manter estoque por item (quantidade, mínimo com
  alerta) com entradas/saídas manuais justificadas e auditadas.
- **FR-023**: Entregas DEVEM dar baixa automática no estoque de itens homônimos (com
  aviso quando faltar) e cancelamentos DEVEM estornar.

**Etiquetas e inventário**

- **FR-030**: O sistema DEVE gerar folhas de etiquetas 40×20 mm (A4) com logo, número
  de patrimônio e QR code que abre a ficha do item.
- **FR-031**: O inventário DEVE permitir conferência por leitura de código ou busca,
  com progresso compartilhado em tempo real e registro de quem conferiu.

**Home office**

- **FR-040**: O sistema DEVE registrar saída de itens para home office (com sub-itens e
  acessórios) mudando o status do item, e a devolução com condição de volta.

**Transversais**

- **FR-050**: Toda mutação de dados DEVE ser auditada (operador, data, entidade,
  resumo) e consultável na aba Auditoria.
- **FR-051**: Operadores DEVEM autenticar-se com login/senha; ações sensíveis
  (exclusões, cancelamentos, gestão de operadores) exigem papel de administrador.
- **FR-052**: Os dados DEVEM viver no servidor compartilhado, com atualização em tempo
  real entre operadores, backups automáticos e exportação/restauração em planilha.
- **FR-053**: A interface DEVE funcionar em desktop e celular (menu lateral rolável em
  telas baixas) nos temas claro e escuro, em pt-BR.

### Key Entities

- **Item (patrimônio)**: bem da empresa; nº de patrimônio, tipo, categoria, valor,
  status, estado, local; tem sub-itens e vínculos com pessoas.
- **Sub-item (periférico)**: acessório com etiqueta própria, pertence a um item.
- **Pessoa**: colaborador; recebe itens, EPIs e registros de home office.
- **Local (sala)**: lugar físico; alvo das inspeções 5S.
- **Modelo de inspeção**: páginas e perguntas que padronizam uma inspeção.
- **Inspeção**: execução de um modelo num local; rascunho → concluída; respostas,
  fotos, pontuação, classificação.
- **Entrega de EPI**: itens entregues a um colaborador; pendente → assinada/cancelada;
  termo PDF e assinatura.
- **Material**: item de estoque (EPIs e afins); quantidade, mínimo, movimentações.
- **Registro de home office**: item fora da empresa com uma pessoa; saída → devolução.
- **Operador**: usuário do sistema (operador ou administrador).
- **Evento de auditoria**: registro imutável de quem fez o quê e quando.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um operador cadastra um item completo e imprime sua etiqueta em menos de
  3 minutos.
- **SC-002**: Uma inspeção 5S completa (23 perguntas + fotos) é concluída pelo celular
  em menos de 15 minutos, sem papel em nenhuma etapa.
- **SC-003**: Uma entrega de EPI sai registrada com termo pronto para assinatura em
  menos de 2 minutos, sem digitar nomes de itens.
- **SC-004**: O relatório semanal e a planilha completa ficam prontos em menos de 10
  segundos e respondem "quais locais estão em dia e quais não" sem consulta manual.
- **SC-005**: 100% das alterações de dados são atribuíveis a um operador na auditoria.
- **SC-006**: Nenhuma perda de dados em queda de energia ou travamento (gravação
  atômica + backups automáticos verificáveis).
- **SC-007**: A equipe inteira (≈ dezenas de operadores) usa o sistema simultaneamente
  pela rede privada com atualizações visíveis em segundos.

## Assumptions

- Uso interno por equipe pequena e confiável, via rede privada (ZeroTier); exposição
  pública futura exigirá camada extra de autenticação (ver constitution).
- Volume de dados cabe confortavelmente num arquivo único (centenas a poucos milhares
  de registros por entidade).
- O login identifica o operador para auditoria; não é defesa contra ator interno
  malicioso.
- Fotos e PDFs ficam como arquivos no servidor, referenciados pela base; backup
  completo = copiar a pasta de dados inteira.
- pt-BR é o único idioma necessário.
- A lista completa de colaboradores será importada para o cadastro de Pessoas quando o
  dono do projeto enviá-la.
