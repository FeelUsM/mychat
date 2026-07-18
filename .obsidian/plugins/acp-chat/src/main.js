const { Plugin, Notice } = require("obsidian")
const { parseDocument, extractMessages } = require("./parser.js")
const { DEFAULT_SETTINGS, getAgentConfig } = require("./config.js")
const { AcpDialogueSettingTab } = require("./settings.js")
const { ensureNoteAcpConfig } = require("./note-config.js")
const { AgentProcess } = require("./acp/process.js")
const { AcpClient } = require("./acp/client.js")
const { buildOpenAiMessages } = require("./messages.js")
const { buildAppendix } = require("./writer.js")
//const { showPermissionModal } = require("./ui/modal-permission.js")

class AcpDialoguePlugin extends Plugin {
	async onload() {
		await this.loadSettings()
		this.addSettingTab(new AcpDialogueSettingTab(this.app, this))

		this.agentProcess = null
		this.acpClient = null

		this.addRibbonIcon("brain-circuit", "Complete", () => {
			this.handleComplete()
		})

		this.addCommand({
			id: "acp-dialogue-complete",
			name: "Complete",
			callback: () => {
				this.handleComplete()
			},
		})
	}

	onunload() {
		if (this.agentProcess) {
			this.agentProcess.stop()
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	// Держит процесс агента запущенным всё время работы Obsidian: стартует
	// лениво при первом Complete, дальше переиспользуется; если процесс упал -
	// AgentProcess.isRunning() вернёт false и следующий start() пересоздаст его
	// (заодно пересоздаём AcpClient, потому что старое соединение привязано
	// к stdin/stdout уже мёртвого процесса).
	async ensureAgentReady(agentConfig) {
		if (!this.agentProcess) {
			this.agentProcess = new AgentProcess(agentConfig, {
				onExit: () => {
					new Notice("Процесс агента неожиданно завершился")
				},
			})
		}

		const wasRunning = this.agentProcess.isRunning()
		const child = this.agentProcess.start()

		if (!wasRunning || !this.acpClient) {
			this.acpClient = new AcpClient({
//				requestPermission: (params) => showPermissionModal(this.app, params),
				onSessionUpdate: (params) => {
					// Пока просто логируем - живую запись в файл по мере
					// стриминга добавим отдельным этапом.
					console.log("[acp-dialogue] session/update:", params)
				},
			})
			this.acpClient.connect(child)
		}

		await this.acpClient.ensureInitialized()
	}

	async handleComplete() {
		const file = this.app.workspace.getActiveFile()
		if (!file) {
			new Notice("Нет активного файла")
			return
		}

		const agentConfig = getAgentConfig(this.settings)
		if (!agentConfig.path) {
			new Notice("Не задан путь к агенту в настройках плагина")
			return
		}

		const noteConfig = await ensureNoteAcpConfig(this.app, file)

		const text = await this.app.vault.read(file)
		const blocks = parseDocument(text, {
			assistantHeadings: noteConfig.assistantHeadings,
			reasoningHeadings: noteConfig.reasoningHeadings,
		})
		const extracted = extractMessages(blocks, { sendReasoning: noteConfig.sendReasoning })

		// Небольшая защита от случайного повторного нажатия Complete без
		// нового вопроса: если после отбрасывания пустого приглашения
		// последний блок всё равно не пользовательский - отправлять нечего.
		if (extracted.length === 0 || extracted[extracted.length - 1].role !== "user") {
			new Notice("Нет нового вопроса пользователя для отправки")
			return
		}

		const messages = buildOpenAiMessages(extracted, noteConfig)

		try {
			await this.ensureAgentReady(agentConfig)
		} catch (err) {
			new Notice(`Не удалось запустить агента: ${err.message}`)
			return
		}

		new Notice("Отправляю запрос агенту…")
		console.log("[acp-dialogue] параметры для агента:", noteConfig.params)
		console.log("[acp-dialogue] сообщения для агента:", messages)

		let result
		try {
			result = await this.acpClient.resetAndPrompt(file.path, messages, noteConfig.params)
		} catch (err) {
			console.error("[acp-dialogue] ошибка запроса к агенту:", err)
			new Notice(`Ошибка агента: ${err.message}`)
			return
		}

		console.log("[acp-dialogue] сообщения от агента:", result)
//		const appendix = buildAppendix(result, noteConfig)
//		await this.app.vault.append(file, appendix)

		new Notice("Готово")
	}
}

module.exports = AcpDialoguePlugin