// Все настройки логики диалога для конкретной заметки читаются из её
// frontmatter, пространство имён "acp":
//
// ---
// acp:
//   system: |
//     Ты полезны ассистент. Отвечай кратко
//   sendReasoning: false
//   userHeading: "Пользователь"
//   assistantHeadings: ["Ассистент", "Assistant"]
//   reasoningHeadings: ["Размышления ассистента"]
//   params:
//     temperature: 0.2
// ---
//
// Namespace выбран специально, чтобы не конфликтовать с полями других плагинов.
// Если acp целиком или отдельные поля внутри него отсутствуют во frontmatter
// заметки - недостающее дописывается в файл значениями из DEFAULT_NOTE_CONFIG.

const DEFAULT_NOTE_CONFIG = {
	system: "Ты полезны ассистент. Отвечай кратко",
	sendReasoning: false,
	userHeading: "Пользователь",
	assistantHeadings: ["Ассистент", "Assistant"],
	reasoningHeadings: ["Размышления ассистента"],
	params: {
		temperature: 0.2,
	},
}

function cloneDefault(value) {
	return JSON.parse(JSON.stringify(value))
}

function normalizeField(acp, key) {
	const value = acp[key]
	const fallback = DEFAULT_NOTE_CONFIG[key]

	if (key === "assistantHeadings" || key === "reasoningHeadings") {
		if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")) {
			return value
		}
		return cloneDefault(fallback)
	}

	if (key === "sendReasoning") {
		return typeof value === "boolean" ? value : fallback
	}

	if (key === "userHeading" || key === "system") {
		return typeof value === "string" ? value : fallback
	}

	if (key === "params") {
		return value && typeof value === "object" && !Array.isArray(value) ? value : cloneDefault(fallback)
	}

	return value
}

// Дополняет frontmatter заметки недостающими acp-полями (реально записывает
// в файл, через штатный Obsidian API - чтобы не портить остальной frontmatter
// и не пересобирать YAML руками) и возвращает итоговый эффективный конфиг.
async function ensureNoteAcpConfig(app, file) {
	let resolved = null

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter.acp || typeof frontmatter.acp !== "object") {
			frontmatter.acp = {}
		}
		const acp = frontmatter.acp

		for (const key of Object.keys(DEFAULT_NOTE_CONFIG)) {
			if (!(key in acp)) {
				acp[key] = cloneDefault(DEFAULT_NOTE_CONFIG[key])
			}
		}

		resolved = {}
		for (const key of Object.keys(DEFAULT_NOTE_CONFIG)) {
			resolved[key] = normalizeField(acp, key)
		}
	})

	return resolved
}

module.exports = { DEFAULT_NOTE_CONFIG, ensureNoteAcpConfig }