<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: todos criados nesta adoção (template estava vazio)
- Added sections: Princípios I–VI; Restrições de Segurança; Fluxo de Trabalho; Governance
- Removed sections: nenhuma
- Templates requiring updates:
  ✅ .specify/templates/plan-template.md (genérico; "Constitution Check" é preenchido por plano — compatível)
  ✅ .specify/templates/spec-template.md (genérico — compatível)
  ✅ .specify/templates/tasks-template.md (genérico — compatível)
- Follow-up TODOs: nenhum
-->

# Controle Patrimonial (Brazil Transports) — Constitution

## Core Principles

### I. Zero dependências externas

O sistema roda com Node.js puro no servidor e JavaScript puro no navegador. É PROIBIDO
adicionar dependências que exijam `npm install`, processo de build ou acesso à internet
para funcionar. Bibliotecas de apoio só entram como arquivo local versionado em
`patrimonio-web/vendor/`. Formatos de saída (PDF, XLSX) são gerados à mão no próprio
código quando necessários.

Racional: o sistema precisa subir em qualquer máquina Windows copiando duas pastas,
funcionar sem internet e continuar reparável daqui a anos sem ecossistema quebrado.

### II. A base compartilhada é sagrada

Os dados vivem num único arquivo JSON no servidor (`patrimonio-data/`), sempre FORA da
pasta servida na web. Arquivo de dados corrompido NUNCA é sobrescrito ou re-semeado: vai
para quarentena e o servidor aborta. Toda gravação é atômica (arquivo temporário + fsync
+ rename) e há snapshots automáticos rotativos. Anexos binários (fotos de inspeção, PDFs
de EPI) são arquivos em `patrimonio-data/`, referenciados por nome na base — e o backup
completo exige copiar a pasta inteira, não só o JSON.

Racional: é a base de trabalho compartilhada da equipe inteira; perda ou vazamento de
dados é o pior defeito possível do sistema.

### III. Compatibilidade retroativa dos dados

Mudanças de esquema DEVEM ser aditivas. Registros gravados por versões antigas continuam
legíveis para sempre: campos ausentes são normalizados na leitura (padrão `inspView`/
`ensureShape`), nunca por migração destrutiva. Rotas antigas da API são mantidas
enquanto houver dado ou cliente que dependa delas.

Racional: a base de produção nunca para para migrar, e um restore de backup antigo tem
que funcionar no código novo.

### IV. Interface em português simples

Toda a interface, mensagens de erro e documentos gerados são em pt-BR, na linguagem de
quem opera (não jargão técnico). Mensagens de erro dizem o que aconteceu E o que fazer.
Fluxos priorizam listas e botões em vez de digitação livre quando existe cadastro.

Racional: os usuários são a equipe operacional da transportadora, não pessoas de TI.

### V. Auditoria de toda mutação

Toda criação, alteração e exclusão de dados DEVE registrar no log de auditoria quem fez
(operador), quando, em qual entidade e um resumo legível do quê. Ações destrutivas pedem
confirmação explícita na interface e, quando sensíveis, exigem papel de administrador.

Racional: patrimônio, EPIs e estoque são temas de responsabilização — a pergunta "quem
mexeu nisso?" sempre precisa de resposta.

### VI. Verificar antes de publicar

Nenhuma mudança vai para produção sem antes rodar num servidor de desenvolvimento
isolado (porta e pasta de dados próprias — nunca contra `patrimonio-data/` de produção)
com o fluxo exercitado de ponta a ponta. Deploy é: código no disco + reinício do
processo (o loop do `start-server.bat` religa sozinho). Lembrar que arquivos estáticos
valem imediatamente, mas API só após reinício — evitar janelas com frontend novo e API
velha.

Racional: a produção é compartilhada e serve direto da pasta de trabalho; testar em
produção é testar nos dados reais da empresa.

## Restrições de Segurança

- O login de operadores é **identificação**, não segurança forte (hash simples,
  `X-Operator` auto-declarado). O desenho pressupõe rede privada (ZeroTier) e equipe
  pequena confiável.
- Exposição fora da rede privada EXIGE camada extra de autenticação na frente do
  sistema (ex.: Cloudflare Access ou proxy com senha) e troca das credenciais padrão.
- Links públicos por token (assinatura de EPI) são a única superfície pública aceita e
  devem continuar com tokens fortes gerados no servidor.
- Código do servidor e dados nunca são serviveis pela web (rotas bloqueadas).

## Fluxo de Trabalho

- Branch `dev` para o trabalho; merge fast-forward para `main` e push ao GitHub quando o
  dono do projeto pedir.
- Novas funcionalidades relevantes seguem o fluxo Spec Kit: constitution → specify →
  plan → tasks → implement (specs em `specs/`).
- Commits em pt-BR no padrão `tipo(escopo): descrição` (ex.: `feat(inspecao): …`).

## Governance

Esta constitution prevalece sobre outras práticas do projeto. Emendas são feitas por
commit que atualize este arquivo com bump de versão semântico (MAJOR: remoção ou
redefinição de princípio; MINOR: princípio ou seção nova; PATCH: esclarecimentos) e
registro no Sync Impact Report. Revisões de código e planos de implementação DEVEM
verificar conformidade com os princípios I–VI; violações precisam de justificativa
explícita na seção Complexity Tracking do plano.

**Version**: 1.0.0 | **Ratified**: 2026-07-13 | **Last Amended**: 2026-07-13
