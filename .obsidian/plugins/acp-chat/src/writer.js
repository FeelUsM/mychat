// Формирует текст, который дописывается в конец заметки после получения
// ответа от агента: опциональный reasoning-блок, assistant-блок, и новый
// пустой user-блок-приглашение.
//
// Правило сдвига заголовков (зафиксировано в обсуждении):
//   - если в тексте ответа встречается заголовок 1-го уровня - все заголовки
//     в этом тексте сдвигаются на +2 (H1 -> H3, H2 -> H4, ...);
//   - иначе если встречается заголовок 2-го уровня (и нет H1) - сдвиг +1;
//   - иначе сдвига нет.
// Сдвиг фиксированный, не зависит от вложенности fenced code block (там
// заголовки и так не считаются заголовками благодаря общему сканеру).

const { scanLines } = require("./markdown-scan.js")

function computeShift(text) {
	let hasH1 = false
	let hasH2 = false

	scanLines(text, (line, info) => {
		if (info.inFence || !info.heading) {
			return
		}
		if (info.heading.level === 1) {
			hasH1 = true
		} else if (info.heading.level === 2) {
			hasH2 = true
		}
	})

	if (hasH1) {
		return 2
	}
	if (hasH2) {
		return 1
	}
	return 0
}

function shiftHeadings(text, shift) {
	if (shift <= 0) {
		return text
	}

	const outputLines = []
	scanLines(text, (line, info) => {
		if (info.inFence || !info.heading) {
			outputLines.push(line)
			return
		}
		const newLevel = Math.min(info.heading.level + shift, 6)
		outputLines.push("#".repeat(newLevel) + " " + info.heading.text)
	})

	return outputLines.join("\n")
}

function shiftedBlock(text) {
	const shift = computeShift(text)
	return shiftHeadings(text, shift)
}

// result: { content: string, reasoning?: string } - ответ агента.
// noteConfig: эффективный per-заметочный конфиг (см. note-config.js) - нужны
// assistantHeadings, reasoningHeadings, userHeading.
function buildAppendix(result, noteConfig) {
	const parts = []

	if (result.reasoning && result.reasoning.trim() !== "") {
		const heading = noteConfig.reasoningHeadings[0]
		parts.push(`## ${heading}\n\n${shiftedBlock(result.reasoning.trim())}`)
	}

	const assistantHeading = noteConfig.assistantHeadings[0]
	parts.push(`## ${assistantHeading}\n\n${shiftedBlock((result.content || "").trim())}`)

	parts.push(`# ${noteConfig.userHeading}\n\n`)

	return "\n\n" + parts.join("\n\n")
}

module.exports = { buildAppendix, computeShift, shiftHeadings }