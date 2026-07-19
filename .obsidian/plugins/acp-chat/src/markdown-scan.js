// Общие примитивы построчного сканирования markdown, без использования
// полноценного markdown-парсера. Используется и парсером входящего документа
// (parser.js), и писателем ответа агента (../acp/writer.js) - там тоже нужно
// уметь отличать "заголовок" от "текста внутри fenced code block".

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

// Если текст начинается с YAML frontmatter (первая строка "---", далее до
// следующей "---"/"..." строки-разделителя), возвращает текст без него.
// Если frontmatter'а нет или он не закрыт - возвращает текст как есть.
function stripFrontmatter(text) {
	const lines = text.split("\n")
	if (lines[0] !== "---") {
		return text
	}
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---" || lines[i] === "...") {
			return lines.slice(i + 1).join("\n")
		}
	}
	return text
}

// Идёт по строкам текста, вызывая callback(line, info) для каждой строки, где
// info.inFence - было ли это внутри fenced-блока ДО обработки этой строки
// (то есть сама строка с открывающим/закрывающим маркером получает inFence
// для состояния "до" неё), info.heading - результат matchHeading, если строка
// является заголовком вне fence, иначе null.
function scanLines(text, callback) {
	const lines = text.split("\n")
	let fence = null

	for (const line of lines) {
		const wasInFence = fence !== null
		const f = matchFenceMarker(line)

		if (f) {
			if (!fence) {
				fence = { char: f.char, len: f.len }
			} else if (f.char === fence.char && f.len >= fence.len && f.rest.trim() === "") {
				fence = null
			}
			callback(line, { inFence: wasInFence, heading: null })
			continue
		}

		if (wasInFence) {
			callback(line, { inFence: true, heading: null })
			continue
		}

		const heading = matchHeading(line)
		callback(line, { inFence: false, heading })
	}
}

module.exports = { matchFenceMarker, matchHeading, scanLines, stripFrontmatter }