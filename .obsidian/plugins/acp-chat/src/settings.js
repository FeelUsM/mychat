const { PluginSettingTab, Setting } = require("obsidian")

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

		containerEl.createEl("h3", { text: "Заголовки в документе" })

		new Setting(containerEl)
			.setName("Заголовок пользователя (H1)")
			.setDesc("Текст заголовка 1-го уровня не проверяется по смыслу, но выводится как приглашение")
			.addText((text) =>
				text.setValue(this.plugin.settings.userHeading).onChange(async (value) => {
					this.plugin.settings.userHeading = value
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl)
			.setName("Заголовки ассистента (H2)")
			.setDesc("Через запятую, регистр важен")
			.addText((text) =>
				text.setValue(this.plugin.settings.assistantHeading).onChange(async (value) => {
					this.plugin.settings.assistantHeading = value
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl)
			.setName("Заголовки размышлений (H2)")
			.setDesc("Через запятую, регистр важен")
			.addText((text) =>
				text.setValue(this.plugin.settings.reasoningHeading).onChange(async (value) => {
					this.plugin.settings.reasoningHeading = value
					await this.plugin.saveSettings()
				})
			)
	}
}

module.exports = { AcpDialogueSettingTab }