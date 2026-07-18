// Собирает OpenAI-style messages[] для кастомного метода
// "_mychat/session/reset_and_prompt" из результата extractMessages()
// (см. parser.js) и per-заметочного конфига (system prompt, userHeading тут
// не нужен - он только для записи в файл).
//
// Решение (наше, не было явно оговорено): reasoning-блок, идущий
// непосредственно перед assistant-блоком, сворачивается в поле "reasoning"
// этого же assistant-сообщения (как это делают некоторые OpenAI-совместимые
// API с reasoning-моделями: role: "assistant", content, reasoning). Если
// reasoning почему-то идёт без последующего assistant-блока - он теряется:
// такое не должно происходить при нормальной структуре документа, потому
// что reasoning содержательно всегда идёт перед ответом ассистента.
function buildOpenAiMessages(extractedMessages, noteConfig) {
	const messages = []

	if (noteConfig.system && noteConfig.system.trim() !== "") {
		messages.push({ role: "system", content: noteConfig.system })
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

module.exports = { buildOpenAiMessages }