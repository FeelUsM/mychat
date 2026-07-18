const { spawn } = require("child_process")

// Управляет одним долгоживущим процессом агента: спавнится при первом
// обращении (start), переиспользуется дальше, полностью останавливается
// в stop() (например при onunload плагина). Если процесс упал сам по себе -
// isRunning() вернёт false и следующий start() пересоздаст его.
class AgentProcess {
	constructor(agentConfig, callbacks) {
		this.agentConfig = agentConfig
		this.onStderrLine = (callbacks && callbacks.onStderrLine) || (() => {})
		this.onExit = (callbacks && callbacks.onExit) || (() => {})
		this.child = null
	}

	isRunning() {
		return this.child !== null && this.child.exitCode === null && !this.child.killed
	}

	start() {
		if (this.isRunning()) {
			return this.child
		}
		if (!this.agentConfig.path) {
			throw new Error("Не задан путь к агенту в настройках плагина")
		}

		const child = spawn(this.agentConfig.path, this.agentConfig.args, {
			env: Object.assign({}, process.env, this.agentConfig.env),
			stdio: ["pipe", "pipe", "pipe"],
		})

		let stderrBuffer = ""
		child.stderr.on("data", (chunk) => {
			stderrBuffer += chunk.toString("utf8")
			let idx
			while ((idx = stderrBuffer.indexOf("\n")) !== -1) {
				const line = stderrBuffer.slice(0, idx)
				stderrBuffer = stderrBuffer.slice(idx + 1)
				if (line.trim() !== "") {
					console.error("[acp-dialogue] agent stderr:", line)
					this.onStderrLine(line)
				}
			}
		})

		child.on("exit", (code, signal) => {
			console.warn(`[acp-dialogue] agent process exited (code=${code}, signal=${signal})`)
			if (this.child === child) {
				this.child = null
			}
			this.onExit(code, signal)
		})

		child.on("error", (err) => {
			console.error("[acp-dialogue] agent process error:", err)
		})

		this.child = child
		return child
	}

	stop() {
		if (this.child) {
			this.child.kill()
			this.child = null
		}
	}
}

module.exports = { AgentProcess }