# mychat
coding of coding agent

## архитектура
- тулы: запускаем mcp-сервера в контейнере и коннектимся к ним
- агент - крутится на хосте
- UI - obsidian коннектится к агенту по модифицированному acp
## файлы

- secret_keys.json - ключи от провайдеров
- providers.py - получение для провайдера : basurl, дефолтная модель, ключ
- models/{provider_name}.json - модели, предоставляемые провайдером
- models/free.txt - бесплатные модели от разных провайдеров

- chat1.py - простое тестирование openai API
- chat2.py - расширенное тестирование opanai API (список моделей, reasoning, детали ответа)
- mcp1.py - пример подключения к mcp-серверу
- chat_mcp.py - чат с инструментами

- acp1.py - простой acp агент (backend для obsidian)
- acp_mcp.py - acp агент c доступом к mcp и простым agent loop
в acp добавлен кастомный метод `_mychat/session/reset_and_prompt` - получает весь чат и отправляет его в LLM, после чего стримит ответ как обычный метод `session/prompt`

- .obsidian/plugins/mychat/* - плагин obsidian, концепция которого описана ниже

```bash
docker run -it ffs-build:3
docker run --rm -itv /home/feelus/tmp/mychat/models:/home/ubuntu -p 3001:3001 -p 3002:3002 -p 3003:3003 -p 3004:3004 -p 3005:3005 -u 1000 ffs-build:3
docker run --rm -itv /home/feelus/tmp/mychat/models:/home/ubuntu -v /home/feelus/tmp/mychat/secret.d:/home/secretsvc -p 3001:3001 -p 3002:3002 -p 3003:3003 -p 3004:3004 -p 3005:3005 -u 1000 ffs-build:secret
```
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
- duckduckgo
```bash
uvx duckduckgo-mcp-server

npx -y supergateway \
  --stdio "uvx duckduckgo-mcp-server" \
  --outputTransport streamableHttp --port 3004 >mcp-duckduckgo.log 2>&1 &
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
# концепция более детально
основная цель сделать работу ллм наиболее наглядной
для этого markdown файлы и диалоги помещаем в хранилище obsidian
таким образом obsidian превращается в IDE: одно хранилище на один проект

одно из следствий: возможность редактировать диалоги целиком (включая все предыдущие сообщения и пользователя и ЛЛМ) а не только редактировать последнее сообщение или форкать диалог в одной точке посередине

все инструменты доступны только по mcp и предполагается использовать их в контейнере для безопасности
(не вижу смысла вручную городить заборы, которые всё равно будут дырявыми)
также это запрещает агентам доступ для редактирования логов их работы
плюс есть инструменты чтения и записи хранилища
плюс есть инструменты для спавна субагентов

основные директории в проекте:
- chats
- memory
- skills
- mcp
- src
### chats
один md файл - один диалог
сообщения пользователя идут после заголовков 1го уровня
ответы llm идут после заголовков 2го уровня assistant, reasoning, tool, tool_call, meta
текст перед первым заголовком 1го уровня - system prompt
yaml frontmatter - параметры вызова llm
при нажатии на основную кнопку этот диалог отправляется в llm для completion-а (и цикла с тулами)
при достижении определённого размера из диалога делается выжимка, которая помещается в новый диалог в котром продолжается работа (при этом старый диалог остаётся как бы в качестве лога)
можно настроить чтобы при этом сжатии работа останавливалась и пользователь уведомлялся для ручного анализа сжатия
эта папка доступна llm только для чтения
есть спец синтаксис для вставки определённых файлов (как правило из memory или skills) перед от отправкой диалога в ллм
пользователь может создавать подпапки и группировать диалоги
### memory
основная папка для работы llm
здесь она может читать и писать AGENTS.md, TODO.md, PRD.md и любые другие файлы и папки
### skills
сюда пользователь загружает скилы
каждый скилл в свою папку, внутри каждой типичная структура скила
эта папка доступна llm только для чтения
можно попросить агента создать новый скилл в memory и вручную его сюда перенести
### mcp
предназначена в основном для пользователя
пользователь создаёт файл name.md, в файле указывает только yaml frontmatter в котором задаёт url mcp сервера
после вызова команды show_mcp в этот файл загружается описание инструментов mcp-сервера (описание инструментов mcp сервера хранится в самом mcp сервере, сюда загружается только для наглядного отображения для пользователя)
эта папка доступна llm только для чтения
плюс здесь хранятся описания внутренних инструментов (чтения и записи хранилища и инструмента для спавна субагентов)
### src
сюда мапится папка с исходниками из контейнера
её ллм могут читать и писать, но выполнять команды могут только в контейнере
## пока не до конца придумано
сделать внутренний git репозиторий (репозиторий на всё, а папка .git например внутри .obsidian) и после каждого сообщения от assistant или нажатии на кнопку запуска делать коммит, а в заголовок добавлять hash и дату-время коммита, чтобы потом можно было откатиться

сделать папку `agents` которая не входит в основной репозиторий в которой для каждого агента создаётся git worktree, внутри которого папку src надо как-то отобразить в контейнер и там где-то разместить
## пока не придумано
rag
