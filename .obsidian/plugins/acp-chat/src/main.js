const { Plugin, Notice } = require("obsidian")
const { parseDocument, extractMessages } = require("./parser.js")



/////////////////////////////////////////////
// main.js
/////////////////////////////////////////////
// Временные настройки по умолчанию. На Этапе 3 переедут в PluginSettingTab
// и в frontmatter заметки (пространство имён acp: ...).
const DEFAULT_CONFIG = {
	userHeading: "Пользователь",
	assistantHeading: ["Ассистент", "Assistant"],
	reasoningHeading: ["Размышления ассистента"],
	sendReasoning: true,
}

class AcpDialoguePlugin extends Plugin {
	async onload() {
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

	async handleComplete() {
		const file = this.app.workspace.getActiveFile()
		if (!file) {
			new Notice("Нет активного файла")
			return
		}

		const text = await this.app.vault.read(file)
		const blocks = parseDocument(text, DEFAULT_CONFIG)
		const messages = extractMessages(blocks, DEFAULT_CONFIG)

		console.log("[acp-dialogue] распарсенные блоки:", blocks)
		console.log("[acp-dialogue] сообщения для агента:", messages)

		new Notice(`Блоков: ${blocks.length}, сообщений для агента: ${messages.length}`)
	}
}

module.exports = AcpDialoguePlugin