# Prompt de refatoração arquitetural do backend

## Objetivo

Quero **refatorar apenas a arquitetura/organização do backend**, **sem reescrever o projeto inteiro**, **sem mudar a regra de negócio existente** e **sem quebrar as rotas atuais**.

A ideia é reorganizar o código para ficar mais modular, inspirado em uma separação por contextos de domínio, mantendo o comportamento atual do sistema.

---

## Contexto da mudança

Hoje o projeto backend já existe e já funciona. A intenção **não é recriar do zero**.

Quero apenas:

* reorganizar pastas e arquivos;
* separar melhor os contextos do sistema;
* isolar rotas, services, controllers e repositories por módulo;
* criar uma área `shared` para itens realmente compartilhados;
* manter compatibilidade com o que já existe;
* fazer uma migração **gradual e segura**.

---

## O que deve ser feito

A IA deve propor e aplicar uma **refatoração incremental** no backend com foco em arquitetura modular.

### Diretrizes principais

1. **Não alterar a regra de negócio atual**.
2. **Não reescrever tudo do zero**.
3. **Não trocar stack, framework, ORM ou banco**, a menos que isso seja estritamente desnecessário.
4. **Preservar endpoints existentes**, sempre que possível.
5. **Fazer mudanças pequenas e progressivas**.
6. **Evitar mudanças destrutivas**.
7. **Melhorar apenas a arquitetura e organização do código**.

---

## Arquitetura desejada

A estrutura deve ser organizada por **módulos/contextos**, por exemplo:

```text
src/
  modules/
    world/
    dashboard/
    shared/
```

### Ideia dos módulos

* `world/`: tudo que pertence ao contexto do “mundo”, paisagem, renderização, cenários, dados específicos dessa parte do sistema.
* `dashboard/`: tudo que pertence ao contexto de dashboard, área do cliente, painel administrativo, métricas, usuários, relatórios etc.
* `shared/`: apenas itens realmente compartilhados, como auth, middlewares, helpers, errors, conexão com banco, tipos comuns e utilitários.

---

## Estrutura esperada por módulo

Cada módulo deve ter sua própria organização interna.

Exemplo:

```text
src/
  modules/
    world/
      routes/
      controllers/
      services/
      repositories/
      dto/
      schemas/
      types/
      index.ts

    dashboard/
      routes/
      controllers/
      services/
      repositories/
      dto/
      schemas/
      types/
      index.ts

    shared/
      database/
      middleware/
      errors/
      utils/
      types/
```

Se fizer sentido, também pode usar estrutura por **feature interna**, por exemplo:

```text
src/modules/dashboard/features/users/
src/modules/dashboard/features/metrics/
src/modules/world/features/scenes/
```

Mas isso deve ser feito **sem exagerar**, respeitando o tamanho atual do projeto.

---

## Regras importantes

### 1. Não quebrar o projeto

A refatoração deve preservar:

* funcionamento atual;
* imports válidos;
* rotas existentes;
* inicialização do servidor;
* integrações atuais.

### 2. Não mover tudo de uma vez sem critério

A mudança deve ocorrer em etapas.

### 3. Não transformar `shared` em depósito de qualquer coisa

O `shared` deve conter apenas itens genéricos e reutilizáveis.

### 4. Evitar acoplamento entre módulos

O módulo `world` não deve depender diretamente do `dashboard`, e vice-versa, salvo casos realmente necessários e bem encapsulados.

### 5. Manter naming consistente

Padronizar nomes de arquivos, pastas e exports.

---

## Resultado esperado

Quero que a IA me entregue:

### 1. Diagnóstico da estrutura atual

* identificar os principais problemas arquiteturais atuais;
* apontar o que está muito acoplado;
* mostrar o que pode ser movido sem risco.

### 2. Proposta de nova estrutura

* sugerir a nova árvore de pastas;
* indicar o que vai para `world`, `dashboard` e `shared`;
* justificar rapidamente a organização.

### 3. Plano de migração incremental

A IA deve propor algo como:

* etapa 1: criar pastas base;
* etapa 2: mover rotas;
* etapa 3: mover controllers;
* etapa 4: mover services;
* etapa 5: mover repositories/dto/schemas;
* etapa 6: centralizar shared;
* etapa 7: ajustar imports e indexadores.

### 4. Refatoração prática no código

A IA deve gerar as alterações reais necessárias:

* novos caminhos de pastas;
* exemplos de arquivos movidos;
* atualização de imports;
* criação de `index.ts` por módulo, se necessário;
* centralização do registro de rotas.

### 5. Compatibilidade com o projeto existente

A IA deve sempre preferir:

* adaptar o que existe;
* reaproveitar arquivos;
* reduzir impacto estrutural;
* evitar recriação desnecessária.

---

## O que eu NÃO quero

* não quero rebuild completo do backend;
* não quero trocar toda a arquitetura para algo excessivamente complexo;
* não quero DDD/Clean Architecture completo se o projeto ainda não pede isso;
* não quero mudar a regra de negócio;
* não quero criar abstrações demais sem necessidade;
* não quero mudar tudo apenas por “boas práticas” se isso não trouxer benefício real.

---

## O que eu quero da resposta da IA

A resposta deve vir neste formato:

### Parte 1 — Leitura da arquitetura atual

* análise do estado atual;
* quais arquivos/pastas representam cada contexto;
* problemas encontrados.

### Parte 2 — Proposta arquitetural

* nova estrutura sugerida;
* separação por módulos;
* definição do `shared`.

### Parte 3 — Plano de migração

* passo a passo objetivo;
* ordem ideal das mudanças;
* cuidados para não quebrar nada.

### Parte 4 — Alterações práticas

* exemplos de código;
* estrutura de pastas final;
* como ficariam rotas, services, controllers e imports.

### Parte 5 — Refatoração mínima viável

* mostrar a menor mudança possível que já melhora bastante a arquitetura.

---

## Instrução final para a IA

Analise o backend atual e proponha uma **refatoração arquitetural incremental**, com foco em **organização modular por contexto**.

Faça isso com o menor impacto possível, **sem reescrever o sistema inteiro**, **sem mudar regra de negócio**, **sem trocar tecnologias**, e priorizando uma migração segura.

Sempre que possível, mostre:

* a estrutura atual;
* a estrutura proposta;
* o que mover;
* como mover;
* e quais arquivos devem permanecer como estão.

Se houver dúvida entre uma solução muito complexa e uma solução simples, **prefira a solução simples e pragmática**.
