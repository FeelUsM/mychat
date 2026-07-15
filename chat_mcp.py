"""
Простой агент: подключается к нескольким MCP-серверам (Streamable HTTP)
на localhost, собирает их тулы в один список, отдаёт LLM (через OpenAI-
совместимый API), и в agent loop прогоняет tool calls туда-обратно,
пока модель не даст финальный текстовый ответ.

Установка зависимостей:
	pip install mcp openai
"""

from aioconsole import ainput
from pprint import pprint
import asyncio
import json
import re
from contextlib import AsyncExitStack

from openai import OpenAI
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from providers import get_provider_by_name

# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------

provider_name = "cerebras"
BASE_URL, API_KEY, MODEL = get_provider_by_name(provider_name)
print("---", provider_name, "---")
print("===", MODEL, "===")

# Именованные MCP-серверы: {имя: url}. Имя используется как namespace-префикс
# для тулов (см. _sanitize_name) — так тул "search" на сервере "docs" превращается
# в openai-имя "docs__search" и не путается с "search" на сервере "web".
MCP_SERVERS: dict[str, str] = {
	"filesystem": "http://localhost:3001/mcp",
	"shell": "http://localhost:8002/mcp",
	"claudecode": "http://localhost:3003/mcp",
}

client = OpenAI(base_url=BASE_URL, api_key=API_KEY)

SYSTEM_PROMPT = "Ты полезный ассистент с доступом к инструментам. Отвечай кратко."


# ---------------------------------------------------------------------------
# Вспомогательная функция для безопасного закрытия отдельного AsyncExitStack
# ---------------------------------------------------------------------------

async def emergency_close_connection(exit_stack: AsyncExitStack, exc: BaseException) -> BaseException:
	"""Передаёт исключение в __aexit__, чтобы все внутренние контекстные менеджеры
	(включая task group) получили уведомление об ошибке и не поднимали её повторно."""
	try:
		await exit_stack.__aexit__(type(exc), exc, exc.__traceback__)
	except BaseException as cleanup_exc:
		exc = cleanup_exc
	if isinstance(exc, BaseExceptionGroup):
		return exc.exceptions[0]
	else:
		raise exc

# ---------------------------------------------------------------------------
# MCP: подключение к серверам и сбор тулов
# ---------------------------------------------------------------------------

class ToolRegistry:
	"""Держит открытые MCP-сессии (каждая в своём AsyncExitStack) и маппинг
	openai_tool_name -> (server_name, real_tool_name)."""

	def __init__(self):
		# Для каждого сервера – свой exit_stack и своя сессия
		self.exit_stacks: dict[str, AsyncExitStack] = {}
		self.sessions: dict[str, ClientSession] = {}          # server_name -> session
		self.tool_map: dict[str, tuple[str, str]] = {}        # openai_name -> (server_name, real_name)
		self.openai_tools: list[dict] = []                    # схема для chat.completions

	@staticmethod
	def _sanitize(s: str) -> str:
		# OpenAI требует имена вида ^[a-zA-Z0-9_-]+$ — вычищаем всё остальное
		s = re.sub(r"[^a-zA-Z0-9_-]", "_", s)
		return s or "x"

	def _make_openai_name(self, server_name: str, tool_name: str) -> str:
		candidate = f"{self._sanitize(server_name)}__{self._sanitize(tool_name)}"
		# На случай если два разных (server, tool) после санитайза схлопнутся в одно имя
		base, i = candidate, 2
		while candidate in self.tool_map:
			candidate = f"{base}_{i}"
			i += 1
		return candidate

	async def connect_mcp_server(self, server_name: str, url: str):
		"""Подключается к одному серверу. В случае ошибки немедленно освобождает его стек."""
		exit_stack = AsyncExitStack()
		try:
			read_stream, write_stream, _ = await exit_stack.enter_async_context(
				streamablehttp_client(url)
			)
			session = await exit_stack.enter_async_context(
				ClientSession(read_stream, write_stream)
			)
			await session.initialize()

			# Всё успешно – сохраняем
			self.exit_stacks[server_name] = exit_stack
			self.sessions[server_name] = session

			tools_result = await session.list_tools()
			for tool in tools_result.tools:
				openai_name = self._make_openai_name(server_name, tool.name)
				self.tool_map[openai_name] = (server_name, tool.name)
				llm_tool = {
					"type": "function",
					"function": {
						"name": openai_name,
						"description": tool.description or "",
						"parameters": tool.inputSchema or {"type": "object", "properties": {}},
					},
				}
				self.openai_tools.append(llm_tool)
				print('---', openai_name, '---')
				pprint(tool) # json.dumps(tool, indent=4))
				print(json.dumps(llm_tool, indent=4))
			print(f"[mcp] {server_name} ({url}): найдено {len(tools_result.tools)} тул(ов)")

		except BaseException as exc:
			exc = await emergency_close_connection(exit_stack, exc)
			print(f"[mcp] {server_name} ({url}): не удалось подключиться ({exc!r}) — пропускаю")
			# Не добавляем сервер ни в какие словари – стек уже закрыт

	async def close(self):
		for exit_stack in self.exit_stacks.values():
			await exit_stack.aclose()
		self.exit_stacks.clear()
		self.sessions.clear()

	def _remove_server(self, server_name: str):
		"""Удаляет сервер и все его тулы из реестра."""
		# Удаляем тулы
		to_remove = [name for name, (srv, _) in self.tool_map.items() if srv == server_name]
		for name in to_remove:
			del self.tool_map[name]
		self.openai_tools = [t for t in self.openai_tools if t["function"]["name"] not in to_remove]
		# Удаляем сессию
		self.sessions.pop(server_name, None)
		# Удаляем exit_stack (уже закрыт или закроется ниже)
		self.exit_stacks.pop(server_name, None)

	async def call_tool(self, openai_name: str, arguments: dict) -> str:
		if openai_name not in self.tool_map:
			return f"Ошибка: неизвестный тул {openai_name}"
		server_name, real_name = self.tool_map[openai_name]
		session = self.sessions.get(server_name)
		if session is None:
			return f"Ошибка: сервер {server_name} больше не доступен"

		try:
			result = await session.call_tool(real_name, arguments)
		except BaseException as exc:
			# Соединение с сервером оборвалось – закрываем именно его стек
			exit_stack = self.exit_stacks.get(server_name)
			if exit_stack is not None:
				exc = await emergency_close_connection(exit_stack, exc)
			# Удаляем сервер из реестра, чтобы не пытаться вызвать его снова
			self._remove_server(server_name)
			return f"Ошибка: сервер {server_name} отключился ({exc!r})"

		# Нормальный ответ
		parts = []
		for block in result.content:
			if hasattr(block, "text"):
				parts.append(block.text)
			else:
				parts.append(str(block))
		return "\n".join(parts) if parts else "(пустой результат)"


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

async def run_agent(registry: ToolRegistry):
	messages = [{"role": "system", "content": SYSTEM_PROMPT}]

	print("Чат с LLM + MCP-тулами (введите 'exit' или 'учше' для выхода)")
	while True:
		try:
			user_input = await ainput("\nВы: ")
		except (KeyboardInterrupt, asyncio.CancelledError):
			break
		if user_input.lower() in ["exit", "учше"]:
			break

		messages.append({"role": "user", "content": user_input})

		# Внутренний цикл: гоняем модель, пока она вызывает тулы
		while True:
			# Если после разрывов не осталось тулов, убираем tools из запроса
			tools_param = registry.openai_tools if registry.openai_tools else None
			response = client.chat.completions.create(
				model=MODEL,
				messages=messages,
				tools=tools_param,
				tool_choice="auto" if tools_param else None,
				temperature=0.0,
			)
			msg = response.choices[0].message

			if not msg.tool_calls:
				messages.append({"role": "assistant", "content": msg.content})
				print(f"Ассистент: {msg.content}")
				break

			# Модель хочет вызвать один или несколько тулов
			messages.append({
				"role": "assistant",
				"content": msg.content,
				"tool_calls": [
					{
						"id": tc.id,
						"type": "function",
						"function": {
							"name": tc.function.name,
							"arguments": tc.function.arguments,
						},
					}
					for tc in msg.tool_calls
				],
			})

			for tc in msg.tool_calls: # xочется распараллелить, но 
				# LLMка может например попросить изменить конфиг демона а потом перезапустить его
				# и будет странно если оно выполнится в обратном порядке
				try:
					args = json.loads(tc.function.arguments or "{}")
				except json.JSONDecodeError:
					print(f"!!!!!!! cannot parse arguments for {tc.function.name} !!!!!!!")
					print(tc.function.arguments)
					print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
					args = {}
				print(f"[tool call] {tc.function.name}({args})")
				tool_result = await registry.call_tool(tc.function.name, args)
				print(tool_result)
				print("---------------")
				messages.append({
					"role": "tool",
					"tool_call_id": tc.id,
					"content": tool_result,
				})
			# и снова наверх цикла — даём модели увидеть результаты тулов


async def main():
	registry = ToolRegistry()
	# Последовательно подключаем серверы (каждый в своём стеке)
	for server_name, url in MCP_SERVERS.items():
		await registry.connect_mcp_server(server_name, url)
	# Запускаем все одновременно и ждем завершения всех
	#await asyncio.gather(*[
	#   registry.connect_mcp_server(name, url)
	#   for name, url in MCP_SERVERS.items()
	#])

	print(f"[mcp] всего доступно тулов: {len(registry.openai_tools)}")
	try:
		await run_agent(registry)
	finally:
		await registry.close()


if __name__ == "__main__":
	asyncio.run(main())