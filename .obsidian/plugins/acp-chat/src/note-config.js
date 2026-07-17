// Per-заметочные настройки читаются из frontmatter заметки, пространство имён "acp":
//
// ---
// acp:
//   system: |
//     Ты хороший помощник
//   sendReasoning: false
//   params:
//     temperature: 0.7
//     seed: 1234
// ---
//
// Namespace выбран специально, чтобы не конфликтовать с полями других плагинов.

const DEFAULT_NOTE_CONFIG = {
	system: "Ты полезны ассистент отвечай кратко",
	sendReasoning: false,
	userHeading: "Пользователь",
	assistantHeadings: ["Ассистент","Assistant"],
	reasoningHeadings: ["Размышления ассистента"],
	params: {
		temperature: 0.2
	},
}

function getNoteAcpConfig(app, file) {
	const cache = app.metadataCache.getFileCache(file)
	const acp = cache && cache.frontmatter && cache.frontmatter.acp

	if (!acp || typeof acp !== "object") {
		return Object.assign({}, DEFAULT_NOTE_CONFIG)
	}

	return {
		system: typeof acp.system === "string" ? acp.system : DEFAULT_NOTE_CONFIG.system,
		sendReasoning: typeof acp.sendReasoning === "boolean" ? acp.sendReasoning : DEFAULT_NOTE_CONFIG.sendReasoning,
		params: acp.params && typeof acp.params === "object" ? acp.params : DEFAULT_NOTE_CONFIG.params,
	}
}

module.exports = { DEFAULT_NOTE_CONFIG, getNoteAcpConfig }