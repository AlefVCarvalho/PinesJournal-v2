# Pine's Journal

O **Pine's Journal** é uma aplicação web progressiva (PWA) para organização pessoal de tarefas, prazos e tags. O projeto foi desenvolvido para funcionar tanto no desktop quanto no celular, com uma interface responsiva que pode ser instalada como aplicativo diretamente pelo navegador.

A aplicação utiliza **HTML, CSS e JavaScript nativos no frontend** e uma **API em Python com FastAPI**, executada em **Cloudflare Workers**. Os dados são persistidos no **Cloudflare D1**, enquanto um **Service Worker** é responsável pelo cache da aplicação, instalação como PWA, notificações Web Push e badges de tarefas pendentes quando o sistema oferece suporte.

O objetivo do projeto é manter uma base simples e organizada, separando claramente interface, regras da API, persistência de dados e notificações, sem depender de frameworks JavaScript no frontend.

### Video demonstrativo do sistema

https://github.com/user-attachments/assets/958d94f6-756b-470b-8e04-512b6378d430


## Funcionamento e arquitetura

O frontend é servido como conteúdo estático pelo Cloudflare. Requisições para `/api/*` são encaminhadas ao Worker Python, que executa a aplicação FastAPI e acessa o banco D1.

Cada navegador ou dispositivo que habilita notificações registra uma `PushSubscription`. Essa inscrição é armazenada no D1 junto com horário e informações necessárias para o envio. O Cron Trigger executa a rotina de verificação e a tabela de entregas impede que o mesmo resumo diário seja enviado repetidamente para o mesmo dispositivo.

As notificações utilizam **Web Push com VAPID**, sem dependência de Firebase. A chave pública pode ser entregue ao navegador, mas a chave privada permanece somente nos secrets do Worker ou no arquivo local `.dev.vars`.

## Tecnologias utilizadas

- HTML;
- CSS;
- JavaScript ES Modules;
- Service Worker e Web App Manifest;
- Python (3.13+);
- FastAPI;
- Cloudflare Workers;
- Cloudflare Static Assets;
- Cloudflare D1;
- Web Push;
- VAPID;
- Wrangler / Pywrangler;
- Node.js (apenas para geração das chaves VAPID)

## Organização do projeto

A estrutura pública do repositório é organizada da seguinte forma:

```text
PinesJournal/
├── README.md
├── .gitignore
├── pyproject.toml
├── wrangler.example.toml
│
├── src/
│   ├── main.py
│   ├── models.py
│   ├── repository.py
│   ├── notification_service.py
│   └── webpush.py
│
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── service-worker.js
│   ├── manifest.webmanifest
│   ├── _headers
│   ├── robots.txt
│   ├── favicon.ico
│   │
│   ├── js/
│   │   ├── app.js
│   │   └── api.js
│   │
│   ├── assets/
│   │   ├── header_mark.png
│   │   ├── lista.svg
│   │   ├── calendario.svg
│   │   ├── bloco.svg
│   │   └── configuracoes.svg
│   │
│   └── icons/
│       ├── app_icon.ico
│       ├── apple-touch-icon.png
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── icon-maskable-192.png
│       └── icon-maskable-512.png
│
├── migrations/
│   ├── 0001_initial.sql
│   └── 0002_notifications.sql
│
├── tools/
│   └── generate_vapid.mjs
│
└── docs/
    └── media/
        └── .gitkeep
```

## Função de cada arquivo

### Arquivos da raiz

| Arquivo | Função |
| --- | --- |
| `README.md` | Documentação principal do projeto. Explica propósito, funcionamento, estrutura, configuração e execução. |
| `.gitignore` | Impede que arquivos locais, ambientes virtuais, configurações privadas, bancos, backups e chaves sejam enviados ao Git. |
| `pyproject.toml` | Define o projeto Python, versão mínima do Python e dependências usadas pelo backend e pelo ambiente de desenvolvimento. |
| `wrangler.example.toml` | Modelo público da configuração do Cloudflare Worker, Static Assets, D1 e Cron Trigger. Deve ser copiado para `wrangler.toml` e preenchido com os dados da conta que fará o deploy. |

### Backend — `src/`

| Arquivo | Função |
| --- | --- |
| `src/main.py` | Ponto principal do backend. Cria a aplicação FastAPI, registra as rotas da API, adiciona cabeçalhos de segurança e conecta o FastAPI ao ambiente do Cloudflare Worker. |
| `src/models.py` | Define e valida os payloads recebidos pela API, incluindo tarefas, tags, conclusão de tarefas, inscrições Push e preferências de notificação. |
| `src/repository.py` | Centraliza o acesso ao Cloudflare D1. Contém consultas e operações de criação, leitura, atualização e exclusão de tarefas, tags e inscrições de notificação. Também gera informações usadas nos resumos de tarefas. |
| `src/notification_service.py` | Contém as regras das notificações. Monta mensagens, considera o horário configurado por dispositivo, envia testes e executa a rotina agendada de lembretes. |
| `src/webpush.py` | Implementa o envio Web Push. Faz a criptografia do payload, criação da autenticação VAPID e comunicação com o endpoint Push registrado pelo navegador. |

### Frontend — `public/`

| Arquivo | Função |
| --- | --- |
| `public/index.html` | Estrutura principal da interface. Contém as áreas de tarefas, calendário, bloco, configurações, formulários e diálogos utilizados pela aplicação. |
| `public/styles.css` | Define o visual da aplicação, temas, responsividade, componentes, modais, cartões de tarefa, calendário e adaptação para telas menores. |
| `public/js/app.js` | Controla o estado e as interações da interface. Gerencia tarefas, pesquisa, filtros, ordenação, calendário, tags, temas, instalação da PWA, notificações e atualização de badges. |
| `public/js/api.js` | Cliente HTTP do frontend. Centraliza as chamadas para as rotas `/api/*`, o tratamento das respostas e erros da API. |
| `public/service-worker.js` | Faz o cache do shell da aplicação, intercepta arquivos estáticos, recebe eventos Web Push, exibe notificações e atualiza o badge do aplicativo quando disponível. |
| `public/manifest.webmanifest` | Define nome, ícones, cores, comportamento e demais metadados necessários para instalação da aplicação como PWA. |
| `public/_headers` | Define cabeçalhos HTTP de segurança para os arquivos estáticos, incluindo CSP, proteção contra frames e restrições de permissões do navegador. |
| `public/robots.txt` | Solicita que mecanismos de busca não indexem a aplicação. |
| `public/favicon.ico` | Ícone utilizado pelo navegador na aba e em contextos compatíveis com favicon. |

### Recursos visuais — `public/assets/`

| Arquivo | Função |
| --- | --- |
| `public/assets/header_mark.png` | Marca gráfica utilizada na interface do Pine's Journal. |
| `public/assets/lista.svg` | Ícone da visualização de lista de tarefas. |
| `public/assets/calendario.svg` | Ícone da visualização de calendário. |
| `public/assets/bloco.svg` | Ícone da área de bloco/anotações. |
| `public/assets/configuracoes.svg` | Ícone da área de configurações. |

### Ícones da PWA — `public/icons/`

| Arquivo | Função |
| --- | --- |
| `public/icons/app_icon.ico` | Ícone principal da aplicação em formato ICO. |
| `public/icons/apple-touch-icon.png` | Ícone utilizado ao adicionar a aplicação à tela inicial em dispositivos Apple. |
| `public/icons/icon-192.png` | Ícone padrão de 192×192 pixels utilizado pelo manifesto e pela PWA. |
| `public/icons/icon-512.png` | Ícone padrão de 512×512 pixels utilizado pelo manifesto e pela instalação da PWA. |
| `public/icons/icon-maskable-192.png` | Versão maskable de 192×192 pixels para sistemas que recortam automaticamente o formato do ícone. |
| `public/icons/icon-maskable-512.png` | Versão maskable de 512×512 pixels para ícones adaptativos em resoluções maiores. |

### Banco de dados — `migrations/`

| Arquivo | Função |
| --- | --- |
| `migrations/0001_initial.sql` | Cria a estrutura inicial do D1: tabelas de tarefas, tags, relação entre tarefas e tags, configurações e seus índices. |
| `migrations/0002_notifications.sql` | Adiciona as tabelas de inscrições Web Push e controle de entregas de notificações, além dos índices necessários. |

As tarefas e tags usam identificadores UUID, evitando dependência de IDs sequenciais e facilitando futuras estratégias de sincronização entre dispositivos.

### Ferramentas — `tools/`

| Arquivo | Função |
| --- | --- |
| `tools/generate_vapid.mjs` | Gera o par de chaves VAPID utilizado pelo Web Push e grava os valores em arquivos locais destinados a secrets e variáveis de desenvolvimento. |

### Documentação visual — `docs/media/`

| Arquivo/Pasta | Função |
| --- | --- |
| `docs/media/` | Local destinado a screenshots, GIFs e imagens utilizadas para demonstrar visualmente o projeto no README. |
| `docs/media/.gitkeep` | Mantém a pasta `media` versionada mesmo enquanto ela estiver vazia. |

## Configuração local

### 1. Instalar as dependências Python

O projeto utiliza `uv` para gerenciar o ambiente Python.

```bash
uv sync
```

### 2. Criar a configuração local do Wrangler

O repositório contém somente um modelo público da configuração:

```bash
cp wrangler.example.toml wrangler.toml
```

No Windows PowerShell:

```powershell
Copy-Item wrangler.example.toml wrangler.toml
```

Depois, edite `wrangler.toml` e informe os dados do seu próprio banco D1. O `database_id` presente no arquivo de exemplo é apenas um placeholder.

O arquivo `wrangler.toml` real é ignorado pelo Git para evitar a publicação acidental de identificadores e configurações específicas da conta.

### 3. Aplicar as migrations no D1 local

```bash
uv run pywrangler d1 migrations apply pinesjournal --local
```

### 4. Iniciar o ambiente de desenvolvimento

```bash
uv run pywrangler dev
```

Por padrão, o ambiente local costuma ficar disponível em:

```text
http://localhost:8787
```

## Configuração das notificações Web Push

Para utilizar as notificações, gere um par de chaves VAPID:

```bash
node tools/generate_vapid.mjs --secrets vapid-secrets.json --dev-vars .dev.vars
```

O script cria:

- `VAPID_PUBLIC_KEY`, que pode ser disponibilizada ao navegador;
- `VAPID_PRIVATE_KEY`, que deve permanecer privada.

O arquivo `.dev.vars` e os arquivos `vapid-secrets*.json` estão no `.gitignore` e não devem ser enviados ao repositório.

Em produção, a chave privada deve ser configurada como secret do Worker. O `VAPID_SUBJECT` deve ser ajustado na configuração para representar um contato válido do responsável pela aplicação.
