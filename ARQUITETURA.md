# Organização do Projeto Jardim das Conquistas Backend

## Estrutura de Pastas e Responsabilidades

### src/
- **main.ts**: Inicializa a aplicação NestJS e configura CORS.
- **app.module.ts**: Módulo principal, registra controllers e providers globais.
- **app.controller.ts**: Controller básico de healthcheck (rota /).
- **app.service.ts**: Serviço básico de exemplo.

#### assets/worlds/
- SVGs dos mundos, usados como fonte para geração de anchors e layout.

#### prisma/
- **client.ts**: Instancia e exporta o Prisma Client para acesso ao banco de dados.

#### supabase/
- **supabase.service.ts**: Serviço para integração com Supabase (armazenamento de arquivos, etc).
- **test-supabase.controller.ts**: Controller de teste para listar arquivos no Supabase.

#### worlds/
- **svg-parser.ts**: Funções utilitárias para parse e manipulação de SVG, extração de anchors, transforms, etc.
- **svg-renderer.ts**: Mede e renderiza SVGs usando Puppeteer para obter layout real.
- **trees-import.service.ts**: Serviço para importar árvores do Supabase e construir o catálogo de árvores.
- **worlds-config.service.ts**: Serviço para gerenciar configurações de mundo (anchors, viewBox, etc) no banco.
- **worlds.anchors.controller.ts**: Endpoints para buscar e atualizar anchors/configuração de um mundo.
- **worlds.controller.ts**: Controller "vazio" (rotas especializadas migradas para outros controllers).
- **worlds.events.controller.ts**: Endpoints para eventos de crescimento, progresso e histórico das árvores plantadas.
- **worlds.gateway.ts**: WebSocket Gateway para eventos em tempo real dos mundos (ex: árvore plantada).
- **worlds.planted.controller.ts**: Endpoints para listar, deletar e limpar árvores plantadas em um mundo.
- **worlds.svg.controller.ts**: Endpoints para upload/download do SVG do mundo.
- **worlds.trees.controller.ts**: Endpoints para importar catálogo de árvores, listar e limpar catálogo.

### Outras pastas
- **test/**: Testes automatizados e2e.
- **prisma/**: Migrations e schema do banco.
- **scripts/**: Scripts utilitários para diagnóstico e testes locais.

---

Cada controller/service está focado em uma responsabilidade única, seguindo o padrão NestJS. Toda lógica de manipulação de SVG, anchors e importação de árvores está centralizada no backend.
