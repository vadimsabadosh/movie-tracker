# MCP-конектори harness (ПР № 3)

Два конектори зареєстровано в `.mcp.json` (Claude Code, project scope):

| Сервер | Тип | Призначення |
|--------|-----|-------------|
| `vault` | власний, stdio, `harness/vault-mcp/` | Єдиний канал між агентом і репозиторієм бази знань `movie-tracker-vault` |
| `github` | готовий, remote HTTP (`github/github-mcp-server`) | Джерело даних: коміти, PR, вміст репозиторію застосунку |

## 1. Розміщення репозиторіїв

```
Інженерія даних/
├── movie-tracker/          ← робоча директорія Claude Code (застосунок + harness)
└── movie-tracker-vault/    ← клон vault поза робочою директорією
```

Сервер `vault` шукає vault за шляхом `../movie-tracker-vault` відносно кореня застосунку (перевизначається змінною `VAULT_PATH`). Агент не бачить vault інструментами файлової системи — лише через інструменти MCP. Технічна заборона прямого доступу (hook) — ПР № 4.

## 2. Сервер `vault`

Node.js 24 (TypeScript виконується напряму, без збірки), `@modelcontextprotocol/sdk`, `zod`, `yaml`.

| Файл | Зміст |
|------|-------|
| `src/server.ts` | Реєстрація інструментів MCP, stdio-транспорт |
| `src/vault.ts` | Логіка ingestion / retrieval над клоном vault |
| `src/notes.ts` | Формат нотатки: frontmatter, wiki-посилання, валідація назв |
| `src/git.ts` | Виклики git |
| `test/vault.test.ts` | Тести на тимчасовому vault із bare-remote |

### Інструменти

| Інструмент | Тип | Опис |
|------------|-----|------|
| `ingest_note` | ingestion | Створює чи оновлює нотатку за конвенціями vault, додає нову нотатку в MOC, комітить і пушить |
| `get_note` | retrieval | Нотатка за назвою чи alias: frontmatter, тіло, backlinks |
| `search_notes` | retrieval | Пошук за ключовими словами (назва ×5, aliases ×4, теги ×2, тіло ×1), фільтри за типом і тегом |

Вхід `ingest_note`: `title`, `type` (`concept` / `component` / `decision` / `glossary`), `content`, необов'язкові `aliases`, `tags`, `requirements`, `links`, `properties`, `source`, `add_to_moc`.

### Цикл `ingest_note`

1. Валідація входу за конвенціями vault: ASCII-назва, `ADR-NNN …` для рішень, ID вимог `FR-*`/`NFR-*`, заборона перевизначати службові поля (`created`, `type`…). Помилка → жодних змін у репозиторії.
2. `git pull --ff-only` — отримати зміни, зроблені деінде.
3. Пошук нотатки за назвою (без урахування регістру) у всьому vault.
4. Формування тексту: frontmatter за шаблоном типу; для наявної нотатки — збереження `created` і порядку полів, об'єднання `aliases`/`tags`/`requirements`/`sources`, заміна тіла.
5. Порівняння з поточним файлом: **ідентично → `unchanged`, без коміту**. Інакше оновлюється `updated` і файл записується; нова нотатка додається до відповідного розділу MOC.
6. `git commit` лише змінених файлів (інші локальні правки у vault не зачіпаються; `source` іде в тіло коміту) → `git push`. Якщо коміт не вдався — файли відкочуються; якщо не вдався push — коміт лишається локально, у відповіді є попередження.
7. Результат: `{ status, path, commit, pushed, mocUpdated, warnings }`; `warnings` — посилання `[[…]]` на неіснуючі нотатки.

### Ідемпотентність

- Повторний виклик із тими самими аргументами повертає `unchanged` і не створює коміт.
- Назва, що відрізняється регістром, — та сама нотатка (без дублікатів).
- Списки у frontmatter об'єднуються як множини; посилання в MOC додається лише раз.
- Видалення нотаток через конектор не передбачено.

## 3. Сервер `github`

Офіційний remote-сервер `https://api.githubcopilot.com/mcp/`:

- `X-MCP-Readonly: true` — сервер не надає жодного інструмента запису;
- `X-MCP-Toolsets: repos,pull_requests` — лише коміти, вміст репозиторію й PR (без issues, actions, організацій тощо);
- токен береться зі змінної середовища `GITHUB_PAT`, у репозиторії не зберігається.

**Токен** — fine-grained personal access token:

| Параметр | Значення |
|----------|----------|
| Repository access | Only select repositories → `movie-tracker` |
| Contents | Read-only |
| Pull requests | Read-only |
| Metadata | Read-only (обов'язково) |
| Термін дії | до кінця семестру |

Обмеження діють на двох рівнях: токен не дає прав запису (GitHub відхилить будь-яку зміну), а заголовки не показують агенту інструментів запису взагалі.

## 4. Запуск і тести

```bash
cd harness/vault-mcp
npm install
npm test          # 13 тестів на тимчасовому vault
npm run typecheck
```

У Claude Code: `/mcp` показує статус обох серверів; інструменти мають назви `mcp__vault__*` і `mcp__github__*`.

## 5. Перевірка через агентну IDE

_Заповнюється після викликів через Claude Code (завдання 3–4)._
