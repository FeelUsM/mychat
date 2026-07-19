const { Plugin, Notice } = require("obsidian")
const { parseDocument, extractMessages, buildOpenAiMessages } = require("./parser.js")
const { DEFAULT_SETTINGS, getAgentConfig, AcpDialogueSettingTab } = require("./settings.js")
const { ensureNoteAcpConfig } = require("./note-config.js")
const { AgentProcess } = require("./acp/process.js")
const { AcpClient } = require("./acp/client.js")
const { DialogueStreamWriter } = require("./acp/writer.js")
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
				requestPermission: (params) => showPermissionModal(this.app, params),
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
		const { system, blocks } = parseDocument(text, {
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

		const messages = buildOpenAiMessages(extracted, system)

		try {
			await this.ensureAgentReady(agentConfig)
		} catch (err) {
			new Notice(`Не удалось запустить агента: ${err.message}`)
			return
		}

		// Очередь дозаписи в файл: session/update-нотификации могут приходить
		// быстрее, чем успевает завершиться предыдущий vault.append(), поэтому
		// каждый следующий append ставится в цепочку через .then(), чтобы
		// сохранить порядок и не потерять/не перемешать куски текста.
		let appendChain = Promise.resolve()
		const queueAppend = (chunk) => {
			if (!chunk) {
				return
			}
			appendChain = appendChain.then(() => this.app.vault.append(file, chunk))
		}

		const streamWriter = new DialogueStreamWriter(noteConfig)

		new Notice("Отправляю запрос агенту…")

		try {
			await this.acpClient.resetAndPrompt(file.path, messages, noteConfig.params, (update) => {
				queueAppend(streamWriter.handleUpdate(update))
			})
		} catch (err) {
			console.error("[acp-dialogue] ошибка запроса к агенту:", err)
			queueAppend(streamWriter.finish(false))
			await appendChain
			new Notice(`Ошибка агента: ${err.message}`)
			return
		}

		if (!streamWriter.hasAnyContent()) {
			console.warn("[acp-dialogue] агент не прислал ни одного текстового чанка")
			new Notice("Агент не прислал ответ (см. консоль)")
			return
		}

		queueAppend(streamWriter.finish(true))
		await appendChain

		new Notice("Готово")
	}
}

module.exports = AcpDialoguePlugin