// Персистентные настройки плагина (this.plugin.settings) и функции,
// превращающие их в конфиги, которые понимают parser.js и будущий acp/process.js.
// Вынесено отдельно от settings.js, чтобы не тянуть require("obsidian")
// туда, где нужна только чистая логика (и чтобы это было тестируемо в node).

const DEFAULT_SETTINGS = {
	agentPath: "",
	agentArgs: "",
	agentEnv: "",
	userHeading: "Пользователь",
	assistantHeading: "Ассистент, Assistant",
	reasoningHeading: "Размышления ассистента",
}

function parseLines(text) {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
}

function parseCsv(text) {
	return text
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item !== "")
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

// Настройки заголовков -> конфиг для parser.js.
function getHeadingsConfig(settings) {
	return {
		userHeading: settings.userHeading.trim() || "Пользователь",
		assistantHeading: parseCsv(settings.assistantHeading),
		reasoningHeading: parseCsv(settings.reasoningHeading),
	}
}

// Настройки агента -> параметры для child_process.spawn (Этап 4).
function getAgentSpawnConfig(settings) {
	return {
		path: settings.agentPath.trim(),
		args: parseLines(settings.agentArgs),
		env: parseEnv(settings.agentEnv),
	}
}

module.exports = {
	DEFAULT_SETTINGS,
	parseLines,
	parseCsv,
	parseEnv,
	getHeadingsConfig,
	getAgentSpawnConfig,
}