// Глобальные (общие для всех заметок) настройки плагина - только про то, как
// запускать процесс агента. Вся логика диалога (заголовки, system prompt,
// params) - per-заметочная, живёт в frontmatter, см. note-config.js.

const { PluginSettingTab, Setting } = require("obsidian")

const DEFAULT_SETTINGS = {
	agentPath: "",
	agentArgs: "",
	agentEnv: "",
}

function parseLines(text) {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
}

function parseEnv(text) {
	const env = {}
	for (const line of parseLines(text)) {
		const idx = line.indexOf("=")
		if (idx === -1) {
			console.warn(`[acp-dialogue] Строка переменной окружения без "=" проигнорирована: "${line}"`)
			continue
		}
		const key = line.slice(0, idx).trim()
		const value = line.slice(idx + 1).trim()
		if (key === "") {
			continue
		}
		env[key] = value
	}
	return env
}

// Настройки агента -> параметры для child_process.spawn (см. acp/process.js).
function getAgentConfig(settings) {
	return {
		path: settings.agentPath.trim(),
		args: parseLines(settings.agentArgs),
		env: parseEnv(settings.agentEnv),
	}
}

class AcpDialogueSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display() {
		const { containerEl } = this
		containerEl.empty()

		containerEl.createEl("h2", { text: "ACP Dialogue" })

		new Setting(containerEl)
			.setName("Путь к исполняемому файлу агента")
			.setDesc("Например: /usr/local/bin/claude-code-acp")
			.addText((text) =>
				text.setValue(this.plugin.settings.agentPath).onChange(async (value) => {
					this.plugin.settings.agentPath = value
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl)
			.setName("Аргументы запуска")
			.setDesc("По одному аргументу на строку")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.agentArgs).onChange(async (value) => {
					this.plugin.settings.agentArgs = value
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl)
			.setName("Переменные окружения")
			.setDesc("По одной на строку, в формате KEY=value")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.agentEnv).onChange(async (value) => {
					this.plugin.settings.agentEnv = value
					await this.plugin.saveSettings()
				})
			)
	}
}

module.exports = { DEFAULT_SETTINGS, getAgentConfig, AcpDialogueSettingTab }