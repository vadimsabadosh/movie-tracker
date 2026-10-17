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

Node.js 24 (TypeScript виконується напряму, без збірки), `@modelcontextprotocol/sdk`, `zod`, `yaml`; з ПР № 7 — `@lancedb/lancedb` і `@huggingface/transformers` для семантичного пошуку (ADR-012).

| Файл | Зміст |
|------|-------|
| `src/server.ts` | Реєстрація інструментів MCP, stdio-транспорт |
| `src/vault.ts` | Логіка ingestion / retrieval над клоном vault |
| `src/notes.ts` | Формат нотатки: frontmatter, wiki-посилання, валідація назв |
| `src/git.ts` | Виклики git |
| `src/semantic.ts` | Chunking за розділами `##`, embeddings, векторний індекс LanceDB (ПР № 7) |
| `src/config.ts` | Шляхи vault та індексу, режим пошуку — спільні для сервера й `reindex` |
| `src/reindex.ts` | `npm run reindex` — повна перебудова індексу |
| `eval/*.ts` | Порівняльне тестування keyword vs semantic (`docs/rag-evaluation/`) |
| `test/vault.test.ts` | Тести на тимчасовому vault із bare-remote |
| `test/semantic.test.ts` | Chunking, інкрементальна синхронізація, фільтри (фейковий embedder, без моделі) |

### Інструменти

| Інструмент | Тип | Опис |
|------------|-----|------|
| `ingest_note` | ingestion | Створює чи оновлює нотатку за конвенціями vault, додає нову нотатку в MOC, комітить і пушить |
| `get_note` | retrieval | Нотатка за назвою чи alias: frontmatter, тіло, backlinks |
| `search_notes` | retrieval | З ПР № 7 — семантичний пошук: N найближчих за змістом розділів нотаток (назва, розділ, текст до 700 символів, косинусна близькість); фільтри за типом і тегом. Сигнатура та сама. Резерв — пошук за ключовими словами (назва ×5, aliases ×4, теги ×2, тіло ×1): `VAULT_SEARCH=keyword` або автоматично, якщо модель чи індекс недоступні |

Вхід `ingest_note`: `title`, `type` (`concept` / `component` / `decision` / `glossary`), `content` (обов'язковий лише для нової нотатки), необов'язкові `aliases`, `tags`, `requirements`, `links`, `properties`, `relations`, `source`, `add_to_moc`.

`relations` (ПР № 4) — типізовані зв'язки онтології (`depends_on`, `implements`, `governed_by`, `part_of`, `supersedes`), що перевіряються за доменом і діапазоном; `get_note` повертає їх у `relations.outgoing` і обернені — у `relations.incoming`. Див. `docs/ontology.md`.

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
npm test          # 24 тести: тимчасовий vault і індекс із фейковим embedder
npm run typecheck
npm run reindex   # перебудувати семантичний індекс (необов'язково: сервер оновлює його сам)
npm run eval      # порівняння retrieval keyword vs semantic → docs/rag-evaluation/
```

Семантичний індекс (ПР № 7, ADR-012) — похідний артефакт у `harness/vault-mcp/.index/` (у `.gitignore`): `lancedb/` (~220 КБ на 38 нотаток) і `models/` (модель `Xenova/multilingual-e5-small` int8, ~145 МБ, завантажується один раз). Сервер підключається одразу, а індексує у фоні; перед кожним пошуком повторно вбудовуються лише нотатки, текст яких змінився (хеш), тож правки через `ingest_note` чи `git pull` видно без перезапуску. Змінні: `VAULT_SEARCH` (`semantic` | `keyword`), `VAULT_INDEX_DIR`, `VAULT_EMBED_MODEL`.

У Claude Code: `/mcp` показує статус обох серверів; інструменти мають назви `mcp__vault__*` і `mcp__github__*`.

## 5. Перевірка через агентну IDE

Усі виклики нижче зроблено агентом у Claude Code безпосередньо інструментами `mcp__github__*` і `mcp__vault__*` — без bash-обгорток і без доступу до файлів vault. Дата: 2026-10-16.

### 5.1. Обидва сервери доступні

| Виклик | Результат |
|--------|-----------|
| `vault.get_note("MOC - movie-tracker")` | MOC з frontmatter і backlinks |
| `github.list_commits(movie-tracker, sha=pr3)` | 4 коміти гілки `pr3` |
| `github.list_pull_requests(state=all)` | `[]` — PR у репозиторії немає, тому джерелом даних слугують коміти |

### 5.2. Від змін у GitHub до нотаток у vault (завдання 4)

Дані отримано через `github.list_commits` і `github.get_commit` (список змінених файлів і статистика), доповнено вмістом цих файлів і передано в `vault.ingest_note` з `source: github:movie-tracker@<sha>`.

| Коміт застосунку | Завершена задача | Нотатка у vault | Статус | Коміт vault |
|------------------|------------------|-----------------|--------|-------------|
| `43a0aa6` | MCP-сервер vault (ПР № 3) | `Components/Vault MCP Server` | `created` | `92e19cb` |
| `43a0aa6` | Підключення GitHub MCP лише для читання (ПР № 3) | `Decisions/ADR-006 Read-Only GitHub MCP as Data Source` | `created` | `5bef408` |
| `dc15f72` | Вимоги до застосунку (ПР № 1) | `Glossary/Requirement ID` | `created` | `3de6a27` |

Коміти `cd03936` і `69b64c7` (тестові зміни `main.ts`) свідомо пропущено: знання в них немає.

Кожен виклик повернув `pushed: true`, `mocUpdated: true`, `warnings: []`. `get_note("MOC - movie-tracker")` показує кожну нову нотатку один раз у своєму розділі. `search_notes("github token read-only")` ставить ADR-006 першою. `git ls-remote` репозиторію vault: `refs/heads/pr3` = `3de6a27`, тобто всі три коміти на віддаленому репозиторії.

### 5.3. Ідемпотентність і валідація (завдання 3)

| Виклик | Очікувано | Отримано |
|--------|-----------|----------|
| Повторний `ingest_note("Requirement ID", …)` з тими самими аргументами | без змін | `unchanged`, без коміту |
| `ingest_note("vault mcp server", …)`: назва в іншому регістрі, підмножина aliases і tags | та сама нотатка, без дубліката | `unchanged`, шлях `Components/Vault MCP Server.md` |
| `ingest_note("ADR Bad Name", type=decision, requirements=["REQ-1"])` | відмова до будь-яких змін | помилка `decision title must look like "ADR-006 Short Title"`, без коміту |

Висновки:
- Дублікатів не виникає: пошук нотатки не залежить від регістру, а списки у frontmatter об'єднуються як множини. Тому виклик з підмножиною aliases чи tags дає той самий файл.
- Повторний виклик не створює порожніх комітів і не змінює `updated`.
- Некоректний вхід відхиляється до `git pull`, тож vault лишається незмінним.

### 5.4. Права токена GitHub

- Агент бачить лише інструменти читання (`list_commits`, `get_commit`, `list_pull_requests`, `pull_request_read`, `get_file_contents`, `search_code`…), бо так налаштовано заголовками `X-MCP-Readonly` і `X-MCP-Toolsets`. Інструментів створення PR, комітів чи issues у списку немає.
- Токен fine-grained і бачить лише `movie-tracker`. Тому перевірити push у `movie-tracker-vault` через GitHub MCP неможливо, і для цього використано `git ls-remote`. Так і задумано: у vault пише лише сервер `vault`.
