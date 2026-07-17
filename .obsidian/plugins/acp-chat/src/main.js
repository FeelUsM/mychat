const { Plugin, Notice } = require("obsidian")
const { parseDocument, extractMessages } = require("./parser.js")
const { DEFAULT_SETTINGS, getHeadingsConfig, getAgentSpawnConfig } = require("./config.js")
const { AcpDialogueSettingTab } = require("./settings.js")
const { getNoteAcpConfig } = require("./note-config.js")

class AcpDialoguePlugin extends Plugin {
	async onload() {
		await this.loadSettings()

		this.addSettingTab(new AcpDialogueSettingTab(this.app, this))

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
		// Этап 4: здесь будем убивать долгоживущий процесс агента.
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	async handleComplete() {
		const file = this.app.workspace.getActiveFile()
		if (!file) {
			new Notice("Нет активного файла")
			return
		}

		const spawnConfig = getAgentSpawnConfig(this.settings)
		if (!spawnConfig.path) {
			new Notice("Не задан путь к агенту в настройках плагина")
			return
		}

		const headingsConfig = getHeadingsConfig(this.settings)
		const noteConfig = getNoteAcpConfig(this.app, file)

		const text = await this.app.vault.read(file)
		const blocks = parseDocument(text, headingsConfig)
		const messages = extractMessages(blocks, { sendReasoning: noteConfig.sendReasoning })

		console.log("[acp-dialogue] распарсенные блоки:", blocks)
		console.log("[acp-dialogue] сообщения для агента:", messages)
		console.log("[acp-dialogue] system prompt:", noteConfig.system)
		console.log("[acp-dialogue] params:", noteConfig.params)
		console.log("[acp-dialogue] agent spawn config:", spawnConfig)

		new Notice(`Блоков: ${blocks.length}, сообщений для агента: ${messages.length}`)
	}
}

module.exports = AcpDialoguePlugin