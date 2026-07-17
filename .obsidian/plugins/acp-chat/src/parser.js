// Разбор markdown-документа заметки в список блоков диалога.
// Никакого markdown-парсера (remark и т.п.) намеренно не используется -
// достаточно построчного сканера, который отслеживает только:
//   - заголовки уровня 1 и 2 вне fenced code block;
//   - границы fenced code block (учитывая вложенные блоки разной длины/символа).

function matchFenceMarker(line) {
	const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
	if (!m) {
		return null
	}
	return { indent: m[1], char: m[2][0], len: m[2].length, rest: m[3] }
}

function matchHeading(line) {
	const m = line.match(/^(#{1,6})\s+(.*)$/)
	if (!m) {
		return null
	}
	return { level: m[1].length, text: m[2].trim() }
}

function resolveH2Role(text, config) {
	if (config.assistantHeadings.includes(text)) {
		return "assistant"
	}
	if (config.reasoningHeadings.includes(text)) {
		return "reasoning"
	}
	return null
}

// Возвращает список блоков вида { role, rawHeading, content }.
// role: "user" | "assistant" | "reasoning" | null (null - неизвестный H2, игнорируется дальше).
function parseDocument(text, config) {
	const lines = text.split("\n")
	const blocks = []
	let fence = null
	let current = null
	const preambleLines = []

	function pushLine(line) {
		if (current) {
			current.lines.push(line)
		} else {
			preambleLines.push(line)
		}
	}

	function startBlock(role, rawHeading) {
		if (current) {
			blocks.push(current)
		}
		current = { role, rawHeading, lines: [] }
	}

	for (const line of lines) {
		const f = matchFenceMarker(line)

		if (f) {
			if (!fence) {
				// Открываем новый fenced-блок (даже если это на самом деле "закрытие"
				// более широкого блока - при fence === null мы всегда внутри текста,
				// поэтому любой маркер здесь - открытие).
				fence = { char: f.char, len: f.len }
			} else if (f.char === fence.char && f.len >= fence.len && f.rest.trim() === "") {
				// Закрывающий маркер: тот же символ, длина не короче открывающего,
				// после маркера в строке ничего кроме пробелов нет.
				fence = null
			}
			pushLine(line)
			continue
		}

		if (fence) {
			pushLine(line)
			continue
		}

		const heading = matchHeading(line)

		if (heading && heading.level === 1) {
			startBlock("user", heading.text)
			continue
		}

		if (heading && heading.level === 2) {
			const role = resolveH2Role(heading.text, config)
			if (!role) {
				console.warn(`[acp-dialogue] Неизвестный заголовок 2-го уровня "${heading.text}", блок будет проигнорирован`)
			}
			startBlock(role, heading.text)
			continue
		}

		// Заголовки 3-го уровня и глубже, и вообще любой текст вне заголовков 1/2
		// уровня - это просто содержимое текущего блока.
		pushLine(line)
	}

	if (current) {
		blocks.push(current)
	}

	const preambleText = preambleLines.join("\n").trim()
	if (preambleText !== "") {
		console.warn("[acp-dialogue] Текст перед первым заголовком проигнорирован:", preambleText)
	}

	return blocks.map((block) => ({
		role: block.role,
		rawHeading: block.rawHeading,
		content: block.lines.join("\n").trim(),
	}))
}

// Превращает блоки в список сообщений, которые пойдут агенту:
//   - неизвестные (role === null) блоки отбрасываются;
//   - reasoning-блоки отбрасываются, если config.sendReasoning не включён;
//   - если последнее сообщение - пустой user-блок, оно не отправляется
//     (это просто приглашение для следующего ввода пользователя).
function extractMessages(blocks, config) {
	const known = blocks.filter((b) => b.role === "user" || b.role === "assistant" || b.role === "reasoning")

	if (known.length > 0) {
		const last = known[known.length - 1]
		if (last.role === "user" && last.content === "") {
			known.pop()
		}
	}

	const messages = []
	for (const block of known) {
		if (block.role === "reasoning" && !(config && config.sendReasoning)) {
			continue
		}
		messages.push({ role: block.role, content: block.content })
	}

	return messages
}

module.exports = { parseDocument, extractMessages }