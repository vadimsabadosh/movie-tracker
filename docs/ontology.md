# Онтологія бази знань movie-tracker (ПР № 4)

Онтологія застосунку виражена без OWL/RDF — через типи нотаток, теги, папки vault і **типізовані зв'язки** у frontmatter. Конвенції записані тут (в репозиторії застосунку, бо їх перевіряє код конектора `harness/vault-mcp`) і в нотатці vault `ADR-007 Typed Relations in Frontmatter`.

## 1. Типи сутностей

Тип сутності = поле `type` у frontmatter = папка vault. Тип визначає обов'язкові поля шаблону.

| Тип | Папка | Що описує | Специфічні поля | Приклади |
|-----|-------|-----------|-----------------|----------|
| `concept` | `Concepts/` | Сутність предметної області | `requirements` | Movie, Watch Entry, Recommendation |
| `component` | `Components/` | Модуль кодової бази чи harness | `layer`, `source_path`, `status`, `requirements` | Routes Layer, Recommender, Vault MCP Server |
| `decision` | `Decisions/` | Архітектурне рішення (ADR) | `id`, `status`, `date`, `supersedes`, `superseded_by` | ADR-001 … ADR-007 |
| `glossary` | `Glossary/` | Термін, не сутність домену | — | MCP, Guardrail, Requirement ID |
| `moc` | корінь | Точка входу, навігація | — | MOC - movie-tracker |

Поза онтологією: `Templates/` (шаблони) і файли без `type` (README).

## 2. Таксономія тегів

Тег типу (`concept`, `component`, …) додається автоматично. Решта тегів класифікує сутності всередині типу:

| Вимір | Теги | Для типів |
|-------|------|-----------|
| Підобласть домену | `domain`, `history`, `recommendation`, `data`, `validation` | concept, component |
| Роль у коді | `layer`, `infrastructure` | component |
| Харнес | `harness`, `mcp` | component, decision, glossary |
| Вид рішення | `adr` | decision |

Шар компонента додатково фіксує поле `layer`: `routes`, `services`, `repositories`, `recommendation`, `infrastructure`, `harness`.

## 3. Типи зв'язків

Звичайне `[[посилання]]` фіксує лише факт згадування. Типізований зв'язок — поле frontmatter, значення якого — список wiki-посилань:

| Зв'язок | Домен (від) | Діапазон (до) | Обернений | Значення | Приклад |
|---------|-------------|---------------|-----------|----------|---------|
| `depends_on` | component | component | `used_by` | Викликає або потребує під час роботи | Services Layer → Repositories Layer |
| `implements` | component | concept, decision | `implemented_by` | Реалізує сутність домену чи рішення | Recommender → Recommendation |
| `governed_by` | component, concept | decision | `governs` | Обмежений рішенням ADR | Routes Layer → ADR-001 |
| `part_of` | concept | concept | `has_part` | Є складовою іншої сутності | Rating → Watch Entry |
| `supersedes` | decision | decision | `superseded_by` | Замінює попереднє рішення | — (поки немає) |

Обернені зв'язки **не зберігаються** (крім `superseded_by` у шаблоні ADR — щоб у застарілому ADR було видно заміну без інструментів): їх обчислює `get_note` у полі `relations.incoming`.

## 4. Конвенція запису

```yaml
---
type: component
layer: services
depends_on: ["[[Repositories Layer]]", "[[Recommender]]"]
implements: ["[[Watch History]]"]
governed_by: ["[[ADR-001 Layered Architecture]]"]
---
```

- Значення — список рядків `"[[Назва нотатки]]"` у лапках (YAML інакше сприйме `[[` як вкладений список). Obsidian показує їх у Properties як посилання й враховує в Graph view.
- Назва — точна назва файлу, не alias.
- Тіло нотатки може описувати той самий зв'язок словами; джерело правди для скриптів і агента — frontmatter.
- Зв'язки пишуться лише через `ingest_note(..., relations: {...})`. Пряме поле в `properties` відхиляється.

## 5. Перевірка онтології конектором

`ingest_note` відхиляє виклик (без змін у репозиторії), якщо:

- зв'язок не з переліку (`uses`, `calls` …);
- тип нотатки-джерела не входить у домен зв'язку (`depends_on` від concept);
- ціль не існує або її тип не входить у діапазон (`governed_by` → component);
- нотатка посилається сама на себе.

Списки зв'язків об'єднуються як множини: повтор того самого зв'язку дає `unchanged`. Видалення зв'язку через конектор не передбачено, як і видалення нотаток.

Реалізація: `RELATIONS` у `harness/vault-mcp/src/notes.ts`, перевірка — `resolveRelations` у `src/vault.ts`, тести — `test/vault.test.ts` («typed relations»).
