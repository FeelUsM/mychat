const { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } = require("@agentclientprotocol/sdk")
const { Readable, Writable } = require("stream")

// Имя кастомного JSON-RPC метода. Префикс "_" - по рекомендации самого ACP
// (см. "Category names beginning with _ are free for custom use, like other
// ACP extension methods"), дальше - произвольное имя нашего протокола поверх
// ACP. Это НЕ часть спеки: понимает его только наш собственный агент.
const RESET_AND_PROMPT_METHOD = "_mychat/session/reset_and_prompt"

// Обёртка над ClientSideConnection из SDK. Держит одно соединение на один
// живой процесс агента (см. process.js): initialize() вызывается один раз
// после спавна, дальше на каждый Complete шлём RESET_AND_PROMPT_METHOD -
// без session/new и без session/prompt, потому что вся история диалога
// (включая отредактированные пользователем прошлые ответы) в любом случае
// пересобирается заново из файла и передаётся целиком.
//
// currentOnUpdate - единственный активный обработчик стрима на данный
// момент. Это безопасно, потому что генерация всего одна на весь vault
// одновременно (см. договорённость про "одна генерация на весь vault") -
// если это ограничение снимут, сюда нужно будет добавить роутинг по
// sessionId вместо одного общего колбэка.
class AcpClient {
	constructor({ requestPermission }) {
		this.requestPermission = requestPermission
		this.connection = null
		this.initializePromise = null
		this.currentOnUpdate = null
	}

	// child - объект child_process, уже запущенный (см. AgentProcess.start()).
	connect(child) {
		const input = Writable.toWeb(child.stdin)
		const output = Readable.toWeb(child.stdout)
		const stream = ndJsonStream(input, output)

		this.connection = new ClientSideConnection(
			() => ({
				sessionUpdate: async (params) => {
					if (this.currentOnUpdate) {
						this.currentOnUpdate(params.update)
					}
				},
				requestPermission: async (params) => {
					return this.requestPermission(params)
				},
			}),
			stream
		)
		this.initializePromise = null
	}

	async ensureInitialized() {
		if (!this.initializePromise) {
			this.initializePromise = this.connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			})
		}
		await this.initializePromise
	}

	// sessionId: путь к файлу внутри vault (используется агентом как
	// идентификатор диалога/контекста - в стандартном ACP это был бы
	// sessionId настоящей сессии, здесь это просто ключ, который наш
	// собственный агент волен использовать как захочет).
	// messages: OpenAI-style [{role, content, reasoning?}], см. parser.js.
	// params: произвольные параметры вызова LLM (temperature, seed, ...).
	// onUpdate(update): вызывается на каждый session/update, пока запрос
	// в процессе - update это params.update из нотификации ACP.
	async resetAndPrompt(sessionId, messages, params, onUpdate) {
		await this.ensureInitialized()
		this.currentOnUpdate = onUpdate || null
		try {
			return await this.connection.request(RESET_AND_PROMPT_METHOD, {
				sessionId,
				messages,
				params,
				mcpServers:[
					/*{
						name:"claude_code",
						type:"http",
						url:"http://localhost:3003/mcp",
						headers: [],
					}*/
					{
						name:"filesystem",
						type:"http",
						url:"http://localhost:3001/mcp",
						headers: [],
					}
				]
			})
		} finally {
			this.currentOnUpdate = null
		}
	}
}

module.exports = { AcpClient, RESET_AND_PROMPT_METHOD }