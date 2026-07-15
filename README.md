# mychat
coding of coding agent

## архитектура
- тулы: запускаем mcp-сервера в контейнере и коннектимся к ним
- агент - крутится на хосте
- UI - obsidian коннектится к агенту по acp
## файлы

- secret_keys.json - ключи от провайдеров
- providers.py - получение для провайдера : basurl, дефолтная модель, ключ
- models/{provider_name}.json - модели, предоставляемые провайдером
- models/free.txt - бесплатные модели от разных провайдеров

- chat1.py - простое тестирование openai API
- chat2.py - расширенное тестирование opanai API (список моделей, reasoning, детали ответа)
- mcp1.py - пример подключения к mcp-серверу
- chat_mcp.py - чат с инструментами

## подключение mcp

тестирование через stdin
```bash
npx @modelcontextprotocol/inspector npx -y @modelcontextprotocol/server-filesystem ~
```
запуск на порту
```bash
npx -y supergateway \
  --stdio "npx -y @modelcontextprotocol/server-filesystem ~" \
  --outputTransport streamableHttp --port 3001 >mcp-filesystem.log 2>&1 &
```
тестирование на порту
```bash
npx @modelcontextprotocol/inspector
```
Transport Type: StreamableHTTP
URL: http://localhost:3001/mcp
## разные mcp сервера
- файловая система
```bash
npx -y @modelcontextprotocol/server-filesystem ~

npx -y supergateway \
  --stdio "npx -y @modelcontextprotocol/server-filesystem ~" \
  --outputTransport streamableHttp --port 3001 >mcp-filesystem.log 2>&1 &
```
- shell
```bash 
ALLOW_PATTERNS=".*" uvx mcp-shell-server
# uvx mcp-server-shell, uvx shell-mcp-server - неработающее говно

ALLOW_PATTERNS=".*" npx -y supergateway \
  --stdio "uvx mcp-shell-server" \
  --outputTransport streamableHttp --port 3002 >mcp-shell.log 2>&1 &
```
- claude code
```bash
claude mcp serve

npx -y supergateway \
  --stdio "claude mcp serve" \
  --outputTransport streamableHttp --port 3003 >mcp-claude.log 2>&1 &
```
### прочие
1. Filesystem
	filesystem-mcp (различные форки и обёртки)
	desktop-commander — расширенный вариант с файловыми и системными операциями
	filesystem-plus (community)

2. Shell / Terminal
	terminal-mcp	✓
	ssh-mcp	✓ (удалённые хосты)
	Docker MCP server (официальный reference) — позволяет выполнять команды внутри контейнеров Docker.
	SSH MCP серверы — есть несколько сторонних реализаций, но единого «стандарта» пока нет.

3. Редактирование файлов
	mcp-server-editor
	mcp-server-code
		кастомные patch-серверы

4. Поиск по коду
	grep-mcp	grep/ripgrep интерфейс
	code-search-mcp	семантический поиск
	sourcegraph-mcp	поиск по большим репозиториям
	deepwiki mcp	контекст кода + Q&A

	mcp-server-ripgrep
	mcp-server-search
	mcp-server-codebase

	grep-mcp	grep/ripgrep интерфейс
	code-search-mcp	семантический поиск

5. Git
	@modelcontextprotocol/server-git	официальный
	GitHub MCP	официальный GitHub
	GitLab MCP	community
	Gitea MCP	community

6. Language Server (LSP)
	mcp-language-server	универсальный LSP bridge
	lsp-mcp	обёртка над любым LSP
	typescript-language-server-mcp	TS/JS
	rust-analyzer-mcp	Rust
	pylsp-mcp / pyright-mcp	Python

### gemma-4-31b описывает тулы claude code-а
#### 🛠 Работа с кодом и файлами
*   **`Read`**: Чтение файлов (включая PDF, изображения и Jupyter-ноутбуки).
*   **`Edit`**: Точечное редактирование текста в файлах (замена строк).
*   **`Write`**: Создание новых файлов или полная перезапись существующих.
*   **`Bash`**: Выполнение любых команд в терминале (git, npm, pytest, поиск и т.д.).
*   **`NotebookEdit`**: Специальный инструмент для редактирования ячеек в `.ipynb` файлах.

#### 🤖 Оркестрация и агенты
*   **`Agent`**: Запуск специализированных под-агентов для сложных многошаговых задач.
*   **`Workflow`**: Создание сложных автоматизированных сценариев (параллельный запуск агентов, конвейеры обработки, циклы проверки).
*   **`SendMessage`**: Общение с другими запущенными агентами.

#### 🌐 Веб и поиск
*   **`WebSearch`**: Поиск актуальной информации в интернете.
*   **`WebFetch`**: Извлечение и анализ контента с конкретных веб-страниц.

#### 📅 Планирование и автоматизация
*   **`CronCreate` / `CronList` / `CronDelete`**: Планирование задач по расписанию (напоминания, регулярные проверки).
*   **`ScheduleWakeup`**: Управление циклами само-пробуждения в режиме `/loop`.

#### 📋 Управление задачами
*   **`TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`**: Ведение структурированного списка дел (TODO-лист) для отслеживания прогресса в больших проектах.

#### 🎨 Дизайн и синхронизация
*   **`DesignSync`**: Интеграция с дизайн-системами Claude.ai для синхронизации компонентов.

#### ⚙ Системные инструменты
*   **`EnterWorktree` / `ExitWorktree`**: Работа в изолированных git-worktree для безопасного экспериментирования с кодом.
*   **`ToolSearch`**: Поиск и подключение дополнительных инструментов (MCP-серверов).
*   **`Skill`**: Запуск предустановленных навыков (через слэш-команды).
