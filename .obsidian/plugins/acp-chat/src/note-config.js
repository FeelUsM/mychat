// Все настройки логики диалога для конкретной заметки читаются из её
// frontmatter. Пространство имён выражено префиксами (а не вложенным
// объектом), потому что frontmatter-редактор Obsidian не поддерживает
// произвольные object/dict-поля - только числа, строки, списки строк,
// date/datetime:
//
// ---
// a_sendReasoning: false
// a_userHeading: Пользователь
// a_assistantHeadings:
//   - Ассистент
//   - Assistant
// a_reasoningHeadings:
//   - Размышления ассистента
// ap_temperature: 0.2
// ap_seed: 67
// ---
//
// System prompt отдельного поля не имеет - см. parser.js: им служит текст
// перед первым заголовком в самом документе (за вычетом YAML frontmatter).
//
// Поля "ap_*" - открытый список: каждое такое поле идёт как есть (без
// префикса) в params, которые уходят в параметры вызова LLM (temperature,
// seed, top_p, ...). Если полей "ap_*" во frontmatter вообще нет - пишутся
// дефолтные (сейчас только ap_temperature).
//
// Если конкретное "a_*"-поле отсутствует - дописывается в файл значением
// по умолчанию. Если поле присутствует, но не проходит проверку типа -
// в файле оно не трогается (не затираем то, что написал пользователь),
// но в работу идёт значение по умолчанию, и пользователю показывается
// Notice с тем, какой тип ожидался и какое значение сейчас использовано.

const { Notice } = require("obsidian")

const A_PREFIX = "a_"
const PARAMS_PREFIX = "ap_"

const DEFAULT_PARAMS = {
	temperature: 0.2,
}

// type: "string" | "boolean" | "string[]"
const FIELDS = [
	{ field: "sendReasoning", type: "boolean", default: false },
	{ field: "userHeading", type: "string", default: "Пользователь" },
	{ field: "assistantHeadings", type: "string[]", default: ["Ассистент", "Assistant"] },
	{ field: "reasoningHeadings", type: "string[]", default: ["Размышления ассистента"] },
]

const DEFAULT_NOTE_CONFIG = FIELDS.reduce(
	(acc, f) => {
		acc[f.field] = f.default
		return acc
	},
	{ params: DEFAULT_PARAMS }
)

function cloneDefault(value) {
	// structuredClone тоже подошёл бы, но JSON.parse(JSON.stringify(...))
	// работает везде одинаково и для наших данных (строки/bool/массивы строк/
	// плоский объект params) этого достаточно.
	return JSON.parse(JSON.stringify(value))
}

function typeLabel(type) {
	if (type === "string") {
		return "строкой"
	}
	if (type === "boolean") {
		return "true или false"
	}
	if (type === "string[]") {
		return "непустым списком строк"
	}
	return type
}

function isValid(type, value) {
	if (type === "string") {
		return typeof value === "string"
	}
	if (type === "boolean") {
		return typeof value === "boolean"
	}
	if (type === "string[]") {
		return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
	}
	return true
}

// Дополняет frontmatter заметки недостающими a_*/ap_*-полями (реально
// записывает в файл через штатный Obsidian API, не трогая остальной
// frontmatter) и возвращает итоговый эффективный конфиг. Если какое-то
// поле присутствует, но не того типа - сразу показывает Notice и
// подставляет в резолвленный конфиг значение по умолчанию; саму заметку
// при этом не трогает.
async function ensureNoteAcpConfig(app, file) {
	let resolved = null

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		resolved = {}

		for (const f of FIELDS) {
			const key = A_PREFIX + f.field

			if (!(key in frontmatter)) {
				frontmatter[key] = cloneDefault(f.default)
				resolved[f.field] = cloneDefault(f.default)
				continue
			}

			const value = frontmatter[key]
			if (isValid(f.type, value)) {
				resolved[f.field] = value
			} else {
				new Notice(
					`[acp-dialogue] Поле "${key}" должно быть ${typeLabel(f.type)}, а сейчас там ${JSON.stringify(value)} - используется значение по умолчанию ${JSON.stringify(f.default)}`
				)
				resolved[f.field] = cloneDefault(f.default)
			}
		}

		const paramKeys = Object.keys(frontmatter).filter((key) => key.startsWith(PARAMS_PREFIX))
		if (paramKeys.length === 0) {
			for (const [name, value] of Object.entries(DEFAULT_PARAMS)) {
				frontmatter[PARAMS_PREFIX + name] = value
			}
			resolved.params = cloneDefault(DEFAULT_PARAMS)
		} else {
			const params = {}
			for (const key of paramKeys) {
				params[key.slice(PARAMS_PREFIX.length)] = frontmatter[key]
			}
			resolved.params = params
		}
	})

	return resolved
}

module.exports = { DEFAULT_NOTE_CONFIG, ensureNoteAcpConfig }