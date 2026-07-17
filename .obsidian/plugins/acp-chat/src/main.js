const { Plugin, Notice } = require("obsidian")
const { parseDocument, extractMessages } = require("./parser.js")
const { DEFAULT_SETTINGS, getAgentConfig } = require("./config.js")
const { AcpDialogueSettingTab } = require("./settings.js")
const { ensureNoteAcpConfig } = require("./note-config.js")

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

		const agentConfig = getAgentConfig(this.settings)
		if (!agentConfig.path) {
			new Notice("Не задан путь к агенту в настройках плагина")
			return
		}

		// Дописывает в frontmatter заметки недостающие acp-поля (значениями
		// из DEFAULT_NOTE_CONFIG) и возвращает итоговый эффективный конфиг.
		const noteConfig = await ensureNoteAcpConfig(this.app, file)

		const text = await this.app.vault.read(file)
		const blocks = parseDocument(text, {
			assistantHeadings: noteConfig.assistantHeadings,
			reasoningHeadings: noteConfig.reasoningHeadings,
		})
		const messages = extractMessages(blocks, { sendReasoning: noteConfig.sendReasoning })

		console.log("[acp-dialogue] распарсенные блоки:", blocks)
		console.log("[acp-dialogue] сообщения для агента:", messages)
		console.log("[acp-dialogue] note config:", noteConfig)
		console.log("[acp-dialogue] agent config:", agentConfig)

		new Notice(`Блоков: ${blocks.length}, сообщений для агента: ${messages.length}`)
	}
}

module.exports = AcpDialoguePlugin