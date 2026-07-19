// Разбор markdown-документа заметки в список блоков диалога + сборка
// OpenAI-style messages[] для отправки агенту. Использует общий построчный
// сканер (markdown-scan.js), сам не содержит логики fenced-блоков.

const { scanLines, stripFrontmatter } = require("./markdown-scan.js")

function resolveH2Role(text, config) {
	if (config.assistantHeadings.includes(text)) {
		return "assistant"
	}
	if (config.reasoningHeadings.includes(text)) {
		return "reasoning"
	}
	return null
}

// Возвращает { system, blocks }.
//   system - текст перед первым заголовком (H1 или H2), за вычетом YAML
//     frontmatter в начале файла - используется как system prompt.
//   blocks - список { role, rawHeading, content }, role: "user" | "assistant"
//     | "reasoning" | null (null - неизвестный H2, игнорируется дальше).
// Заголовки 2-го уровня, встретившиеся до первого H1 (user-сообщения),
// не запрещены - они просто становятся assistant/reasoning блоками без
// предшествующего user-блока.
function parseDocument(text, config) {
	const withoutFrontmatter = stripFrontmatter(text)

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

	scanLines(withoutFrontmatter, (line, info) => {
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

	return {
		system: preambleLines.join("\n").trim(),
		blocks: blocks.map((block) => ({
			role: block.role,
			rawHeading: block.rawHeading,
			content: block.lines.join("\n").trim(),
		})),
	}
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

// Собирает OpenAI-style messages[] для кастомного метода
// "_mychat/session/reset_and_prompt" из результата extractMessages() и
// system prompt (преамбулы документа, см. parseDocument). Reasoning-блок,
// идущий непосредственно перед assistant-блоком, сворачивается в поле
// "reasoning" этого же assistant-сообщения (как у некоторых
// OpenAI-совместимых reasoning-моделей: role: "assistant", content,
// reasoning). Если reasoning идёт без последующего assistant-блока - он
// теряется: в норме такого быть не должно, потому что reasoning всегда
// предшествует ответу ассистента.
function buildOpenAiMessages(extractedMessages, system) {
	const messages = []

	if (system && system.trim() !== "") {
		messages.push({ role: "system", content: system.trim() })
	}

	let pendingReasoning = null

	for (const item of extractedMessages) {
		if (item.role === "user") {
			pendingReasoning = null
			messages.push({ role: "user", content: item.content })
			continue
		}

		if (item.role === "reasoning") {
			pendingReasoning = item.content
			continue
		}

		if (item.role === "assistant") {
			const message = { role: "assistant", content: item.content }
			if (pendingReasoning !== null) {
				message.reasoning = pendingReasoning
			}
			pendingReasoning = null
			messages.push(message)
			continue
		}
	}

	return messages
}

module.exports = { parseDocument, extractMessages, buildOpenAiMessages }