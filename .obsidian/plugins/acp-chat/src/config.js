// Персистентные настройки плагина (this.plugin.settings, глобальные для всех
// заметок) - только про то, как запускать процесс агента. Все настройки логики
// диалога (заголовки, system prompt, params) теперь живут per-заметочно
// в frontmatter, см. note-config.js.

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

// Настройки агента -> параметры для child_process.spawn (Этап 4).
function getAgentConfig(settings) {
	return {
		path: settings.agentPath.trim(),
		args: parseLines(settings.agentArgs),
		env: parseEnv(settings.agentEnv),
	}
}

module.exports = {
	DEFAULT_SETTINGS,
	parseLines,
	parseEnv,
	getAgentConfig,
}