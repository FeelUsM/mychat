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
class AcpClient {
	constructor({ requestPermission, onSessionUpdate }) {
		this.requestPermission = requestPermission
		this.onSessionUpdate = onSessionUpdate || (() => {})
		this.connection = null
		this.initializePromise = null
	}

	// child - объект child_process, уже запущенный (см. AgentProcess.start()).
	connect(child) {
		const input = Writable.toWeb(child.stdin)
		const output = Readable.toWeb(child.stdout)
		const stream = ndJsonStream(input, output)

		this.connection = new ClientSideConnection(
			() => ({
				sessionUpdate: async (params) => {
					this.onSessionUpdate(params)
				},
//				requestPermission: async (params) => {
//					return this.requestPermission(params)
//				},
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
//					fs: { readTextFile: false, writeTextFile: false },
				},
			})
		}
		await this.initializePromise
	}

	// sessionId: путь к файлу внутри vault (используется агентом как
	// идентификатор диалога/контекста, по нашей собственной договорённости -
	// в стандартном ACP это был бы sessionId настоящей сессии, здесь это
	// просто ключ, который наш агент волен использовать как захочет).
	// messages: OpenAI-style [{role, content, reasoning?}], см. acp/messages.js.
	// params: произвольные параметры вызова LLM (temperature, seed, ...).
	async resetAndPrompt(sessionId, messages, params) {
		await this.ensureInitialized()
		return this.connection.request(RESET_AND_PROMPT_METHOD, {
			sessionId,
			messages,
			params,
		})
	}
}

module.exports = { AcpClient, RESET_AND_PROMPT_METHOD }