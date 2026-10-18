# movie-tracker

REST API для особистої історії переглядів фільмів із рекомендаціями за профілем уподобань, а також harness для агентної розробки (MCP-сервер бази знань, guardrails, skills, оркестрація).

У репозиторії два застосунки:

| Застосунок | Каталог | Що це |
|------------|---------|-------|
| API movie-tracker | `src/` | Fastify + SQLite, один процес, без зовнішніх сервісів |
| MCP-сервер `vault` | `harness/vault-mcp/` | Конектор між агентом і базою знань `movie-tracker-vault` (запускає Claude Code) |

## Вимоги

- Node.js **24** або новіший (TypeScript виконується напряму, без збірки): `node --version`
- git
- Для MCP-сервера `vault` — клон `movie-tracker-vault` поруч із цим репозиторієм
- Для MCP-сервера `github` — fine-grained токен у змінній `GITHUB_PAT` (див. `docs/mcp-connector.md`, розділ 3)

## 1. API movie-tracker

```bash
npm install     # також встановлює ESLint у tools/lint (postinstall)
npm start       # http://127.0.0.1:3000
```

База даних — файл `data/movie-tracker.db`; каталог і схема створюються під час першого запуску.

| Змінна | За замовчуванням | Призначення |
|--------|------------------|-------------|
| `PORT` | `3000` | Порт HTTP-сервера (слухає лише `127.0.0.1`) |
| `DATABASE_PATH` | `data/movie-tracker.db` | Шлях до файлу SQLite; `:memory:` — база в пам'яті |

```bash
PORT=4000 DATABASE_PATH=/tmp/demo.db npm start
```

### Перевірка

```bash
curl localhost:3000/health
# {"status":"ok"}

curl -X POST localhost:3000/movies -H 'content-type: application/json' \
  -d '{"title":"Arrival","year":2016,"genres":["Sci-Fi"],"director":"Denis Villeneuve"}'

curl -X POST localhost:3000/movies/1/watch -H 'content-type: application/json' \
  -d '{"rating":9}'

curl localhost:3000/stats
curl localhost:3000/profile
curl localhost:3000/recommendations
```

### Ендпоінти

| Метод | Шлях | Призначення |
|-------|------|-------------|
| `GET` | `/health` | Перевірка, що сервер працює |
| `GET` `POST` | `/movies` | Каталог фільмів: список (фільтри, пагінація) і додавання |
| `GET` `PUT` `DELETE` | `/movies/:id` | Один фільм |
| `GET` `POST` `PUT` `DELETE` | `/movies/:id/watch` | Позначка «переглянуто» з оцінкою 1–10 |
| `GET` | `/watches` | Історія переглядів |
| `GET` | `/profile` | Профіль уподобань |
| `GET` | `/recommendations` | Рекомендації |
| `GET` | `/stats` | Статистика переглядів |
| `GET` | `/openapi.json` | Специфікація OpenAPI, згенерована зі схем маршрутів |

Повні схеми запитів і відповідей — у `/openapi.json`, вимоги — у `docs/app-requirements.md`.

### Перевірки коду

```bash
npm test             # тести (Vitest)
npm run check        # typecheck + lint + format:check + coverage — те саме, що запускають агенти
```

## 2. MCP-сервер `vault`

Сервер запускає Claude Code сам за `.mcp.json`; вручну його запускати не потрібно. Достатньо встановити залежності й покласти vault поруч:

```
Інженерія даних/
├── movie-tracker/          ← цей репозиторій
└── movie-tracker-vault/    ← клон бази знань
```

```bash
cd harness/vault-mcp
npm install
npm test             # тести на тимчасовому vault
npm run reindex      # необов'язково: повна перебудова семантичного індексу
```

Під час першого запуску сервер один раз завантажує модель embeddings (~145 МБ) у `harness/vault-mcp/.index/`.

| Змінна | За замовчуванням | Призначення |
|--------|------------------|-------------|
| `VAULT_PATH` | `../movie-tracker-vault` | Шлях до клону vault відносно кореня застосунку |
| `VAULT_SEARCH` | `semantic` | `keyword` — пошук за ключовими словами замість семантичного |
| `VAULT_PUSH` | `true` | `false` — `ingest_note` комітить, але не пушить |

Повний опис, порівняльне тестування й інші змінні — у `docs/mcp-connector.md` і `docs/rag-evaluation/README.md`.

## 3. Claude Code і harness

```bash
export GITHUB_PAT=<токен>                      # для сервера github
git config core.hooksPath harness/git-hooks    # git-guardrails (один раз на клон)
claude                                          # у корені репозиторію
```

У Claude Code команда `/mcp` показує статус серверів `vault` і `github`. Hooks агентної IDE підключено в `.claude/settings.json`, skills — у `.claude/skills/`, ролі оркестрації — у `.claude/agents/`.

| Документ | Зміст |
|----------|-------|
| `docs/guardrails.md` | Guardrails і їхня перевірка |
| `docs/skills.md` | Skills (`new-module`, `record-adr`, `orchestrate`) |
| `docs/orchestration/` | Журнали оркестрації Planner → Coder → Reviewer |
