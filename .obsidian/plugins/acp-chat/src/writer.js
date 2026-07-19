// Стриминговая запись ответа агента в заметку. В отличие от разового
// buildAppendix (который видел весь текст сразу и мог заранее решить сдвиг
// заголовков), здесь текст приходит чанками произвольного размера - поэтому
// решение о сдвиге принимается ЛЕНИВО, по первому заголовку, который
// реально встретится в потоке:
//   - если первый встреченный заголовок - H1, сдвиг фиксируется как +2;
//   - если первый встреченный заголовок - H2 (и до него не было H1), +1.
// Это не на 100% то же самое, что "просканировать весь ответ и сдвинуть
// по наличию H1": в редком случае, когда в потоке сначала встречается H2,
// а H1 - только позже, эта версия не сможет задним числом поднять уже
// написанные строки на +2. Компромисс осознанный ради возможности писать
// в файл по мере поступления текста.

const { matchFenceMarker, matchHeading } = require("./markdown-scan.js")

function extractText(content) {
	if (!content) {
		return ""
	}
	if (typeof content === "string") {
		return content
	}
	if (content.type === "text" && typeof content.text === "string") {
		return content.text
	}
	return ""
}

// Копит входящие чанки одной секции (reasoning или assistant), отдаёт
// наружу только полностью собранные строки (последнюю, возможно неполную,
// строку держит у себя до следующего push()/finish()), попутно отслеживая
// fenced code block (чтобы не сдвигать "#" внутри него) и решение о сдвиге.
class StreamingSection {
	constructor() {
		this.buffer = ""
		this.fence = null
		this.shift = null
		this.finished = false
	}

	push(chunkText) {
		if (this.finished || chunkText === "") {
			return ""
		}
		this.buffer += chunkText
		const lines = this.buffer.split("\n")
		this.buffer = lines.pop()
		if (lines.length === 0) {
			return ""
		}
		return lines.map((line) => this.processLine(line)).join("\n") + "\n"
	}

	// Отдаёт остаток буфера (незавершённую строку, если она есть) и помечает
	// секцию завершённой - повторные вызовы ничего не делают.
	finish() {
		if (this.finished) {
			return ""
		}
		this.finished = true
		const line = this.buffer
		this.buffer = ""
		if (line === "") {
			return ""
		}
		return this.processLine(line)
	}

	processLine(line) {
		const f = matchFenceMarker(line)
		if (f) {
			if (!this.fence) {
				this.fence = { char: f.char, len: f.len }
			} else if (f.char === this.fence.char && f.len >= this.fence.len && f.rest.trim() === "") {
				this.fence = null
			}
			return line
		}
		if (this.fence) {
			return line
		}
		const heading = matchHeading(line)
		if (!heading) {
			return line
		}
		if (this.shift === null) {
			this.shift = heading.level === 1 ? 2 : 1
		}
		const newLevel = Math.min(heading.level + this.shift, 6)
		return "#".repeat(newLevel) + " " + heading.text
	}
}

// Связывает две StreamingSection (reasoning + assistant) с заголовками из
// noteConfig, решает когда какой заголовок дописать в файл, отдаёт наружу
// только готовые к записи строки текста (сама ничего не пишет в vault -
// I/O и порядок записи - забота вызывающего кода, см. main.js).
class DialogueStreamWriter {
	constructor(noteConfig) {
		this.noteConfig = noteConfig
		this.reasoning = new StreamingSection()
		this.assistant = new StreamingSection()
		this.reasoningHeadingWritten = false
		this.assistantHeadingWritten = false
	}

	// update: содержимое поля "update" из session/update-нотификации ACP,
	// то есть { sessionUpdate: "agent_thought_chunk" | "agent_message_chunk" | ..., content }.
	// Возвращает текст, который нужно дописать в файл прямо сейчас (может
	// быть пустой строкой).
	handleUpdate(update) {
		if (!update || typeof update !== "object") {
			return ""
		}

		if (update.sessionUpdate === "agent_thought_chunk") {
			const text = extractText(update.content)
			if (text === "") {
				return ""
			}
			let out = ""
			if (!this.reasoningHeadingWritten) {
				out += `\n## ${this.noteConfig.reasoningHeadings[0]}\n`
				this.reasoningHeadingWritten = true
			}
			out += this.reasoning.push(text)
			return out
		}

		if (update.sessionUpdate === "agent_message_chunk") {
			const text = extractText(update.content)
			if (text === "") {
				return ""
			}
			let out = ""
			if (!this.assistantHeadingWritten) {
				// Если reasoning шёл прямо перед этим - закрываем его хвост
				// перед тем как начать раздел ассистента.
				out += this.reasoning.finish()
				out += `\n## ${this.noteConfig.assistantHeadings[0]}\n`
				this.assistantHeadingWritten = true
			}
			out += this.assistant.push(text)
			return out
		}

		// tool_call / tool_call_update / plan / user_message_chunk / usage_update
		// и прочее - пока игнорируем, см. отдельный будущий этап про отображение
		// вызовов инструментов.
		return ""
	}

	// Вызывается после того, как запрос к агенту завершился (успешно или с
	// ошибкой) - дописывает хвосты незавершённых строк. Если передан
	// addPrompt=true - добавляет ещё и новый пустой user-блок-приглашение.
	finish(addPrompt) {
		let out = ""
		out += this.reasoning.finish()
		out += this.assistant.finish()
		if (addPrompt) {
			out += `\n\n# ${this.noteConfig.userHeading}\n\n`
		}
		return out
	}

	hasAnyContent() {
		return this.reasoningHeadingWritten || this.assistantHeadingWritten
	}
}

module.exports = { DialogueStreamWriter, StreamingSection, extractText }