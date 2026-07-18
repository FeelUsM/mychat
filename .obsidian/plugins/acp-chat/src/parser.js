// Разбор markdown-документа заметки в список блоков диалога.
// Использует общий построчный сканер (markdown-scan.js), сам не содержит
// логики fenced-блоков.

const { scanLines } = require("./markdown-scan.js")

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
	const blocks = []
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

	scanLines(text, (line, info) => {
		if (info.inFence || !info.heading) {
			pushLine(line)
			return
		}

		if (info.heading.level === 1) {
			startBlock("user", info.heading.text)
			return
		}

		if (info.heading.level === 2) {
			const role = resolveH2Role(info.heading.text, config)
			if (!role) {
				console.warn(`[acp-dialogue] Неизвестный заголовок 2-го уровня "${info.heading.text}", блок будет проигнорирован`)
			}
			startBlock(role, info.heading.text)
			return
		}

		// Заголовки 3-го уровня и глубже - это просто содержимое текущего блока.
		pushLine(line)
	})

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

// Превращает блоки в список сообщений в порядке документа:
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