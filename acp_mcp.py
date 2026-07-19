"""
Простейший агент по протоколу Agent Client Protocol (ACP),
который отвечает через OpenAI-совместимый API и умеет вызывать
инструменты с MCP-серверов, переданных в кастомном методе
"_mychat/session/reset_and_prompt".

Смотреть логи в реальном времени:
	tail -f acp1.log
"""

import asyncio
import json
import logging
import os
import re
import traceback
from contextlib import AsyncExitStack
from copy import copy
from pathlib import Path
from typing import Any

from acp import (
	PROTOCOL_VERSION,
	Agent,
	InitializeResponse,
	NewSessionResponse,
	PromptResponse,
	run_agent,
	text_block,
	update_agent_message,
	update_agent_thought,
)
from acp.interfaces import Client
from acp.schema import (
	AgentCapabilities,
	AudioContentBlock,
	ClientCapabilities,
	EmbeddedResourceContentBlock,
	HttpMcpServer,
	Implementation,
	ImageContentBlock,
	McpServerStdio,
	ResourceContentBlock,
	SseMcpServer,
	TextContentBlock,
)
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from openai import AsyncOpenAI

LOG_FILE = "/home/feelus/acp1.log"
logging.basicConfig(
	level=logging.INFO,
	format="%(asctime)s %(levelname)s %(message)s",
	handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
logging.info("=== agent starting, logging to %s ===", LOG_FILE)
logging.info("cwd: %s ===", os.getcwd())

# Конфигурация
from providers import get_provider_by_name
provider_name = "openrouter"
#provider_name = "github"
#provider_name = "naga"
#provider_name = "freemodel"
#provider_name = "mistral"
#provider_name = "aihubmix" # не заработал
#provider_name = "pateway"
#provider_name = "groq"
#provider_name = "cerebras"
BASE_URL, API_KEY, MODEL = get_provider_by_name(provider_name)
logging.info("BASE_URL: %s", BASE_URL)
logging.info("MODEL: %s", MODEL)

MAX_AGENT_LOOP_ITERATIONS = 15


def extract_text(block: Any) -> str:
	"""Достаёт текст из блока промпта, остальные типы (картинки и т.п.) игнорируем."""
	if isinstance(block, TextContentBlock):
		return block.text
	return ""


def isiterable(some_object):
	try:
		iter(some_object)
		return True
	except TypeError:
		return False


def _debug_log_messages(messages: list[dict[str, Any]]) -> None:
	for mes in messages:
		tmp = copy(mes)
		tmp.pop("role", None)
		tmp.pop("content", None)
		if tmp:
			logging.debug("<- %r : %r ## %r", mes.get("role"), mes.get("content"), tmp)
		else:
			logging.debug("<- %r : %r", mes.get("role"), mes.get("content"))


async def emergency_close_connection(exit_stack: AsyncExitStack, exc: BaseException) -> BaseException:
	"""
	Передаёт исключение в __aexit__, чтобы все внутренние контекстные менеджеры
	(включая task group у streamablehttp_client) получили уведомление об ошибке
	и не подняли её же повторно при обычном aclose().
	"""
	try:
		await exit_stack.__aexit__(type(exc), exc, exc.__traceback__)
	except BaseException as cleanup_exc:
		exc = cleanup_exc
	if isinstance(exc, BaseExceptionGroup):
		return exc.exceptions[0]
	raise exc


class McpConnection:
	"""Одно живое соединение с MCP-сервером + закешированный список его тулов."""

	__slots__ = ("url", "name", "exit_stack", "session", "tools")

	def __init__(self, url: str, name: str, exit_stack: AsyncExitStack, session: ClientSession, tools: list):
		self.url = url
		self.name = name
		self.exit_stack = exit_stack
		self.session = session
		self.tools = tools


# для тестирования
# {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}
# {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp","mcpServers":[]}}
# {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"0","prompt":[{"type":"text","text":"Привет! Ответь одним словом."}]}}
# {"jsonrpc":"2.0","id":5,"method":"_mychat/session/reset_and_prompt","params":{"sessionId":"0","params":{"model":"gpt-4o-mini"},"messages":[{"role":"user","content":"Сколько файлов в текущей папке?"}],"mcpServers":[{"name":"fs","type":"http","url":"http://localhost:3001/mcp","headers":[]}]}}
class OpenAIAgent(Agent):
	_conn: Client

	def __init__(self) -> None:
		self._client = AsyncOpenAI(
			base_url=BASE_URL,
			api_key=API_KEY,
		)
		self._histories: dict[str, list[dict[str, str]]] = {}

		# MCP: постоянные соединения, живущие до смерти процесса или до
		# отключения самого сервера. Ключ — url (по нему и идентифицируем
		# сервер, имя может отличаться между запросами).
		self._mcp_connections: dict[str, McpConnection] = {}
		self._mcp_connect_locks: dict[str, asyncio.Lock] = {}

	def on_connect(self, conn: Client) -> None:
		self._conn = conn

	async def initialize(
		self,
		protocol_version: int,
		client_capabilities: ClientCapabilities | None = None,
		client_info: Implementation | None = None,
		**kwargs: Any,
	) -> InitializeResponse:
		logging.info("initialize: protocol_version=%s -> PROTOCOL_VERSION=%s", protocol_version, PROTOCOL_VERSION)
		return InitializeResponse(
			protocol_version=PROTOCOL_VERSION,
			agent_capabilities=AgentCapabilities(),
			agent_info=Implementation(
				name="acp1",
				title="acp1",
				version="0.1.0",
			),
		)

	async def new_session(
		self,
		cwd: str,
		additional_directories: list[str] | None = None,
		mcp_servers: list[HttpMcpServer | SseMcpServer | McpServerStdio] | None = None,
		**kwargs: Any,
	) -> NewSessionResponse:
		session_id = str(len(self._histories))
		self._histories[session_id] = []
		logging.info("new_session: %s", session_id)
		return NewSessionResponse(session_id=session_id, modes=None)

	# ------------------------------------------------------------------
	# MCP: подключение по требованию + сборка тулов под конкретный запрос
	# ------------------------------------------------------------------

	def _get_mcp_lock(self, url: str) -> asyncio.Lock:
		lock = self._mcp_connect_locks.get(url)
		if lock is None:
			lock = self._mcp_connect_locks[url] = asyncio.Lock()
		return lock

	async def _ensure_mcp_connected(self, url: str, name: str) -> None:
		"""Подключается к серверу, если он ещё не подключён. Ничего не бросает
		наружу — при ошибке просто логирует и оставляет сервер недоступным
		(он будет молча пропущен при сборке тулов на этот запрос)."""
		async with self._get_mcp_lock(url):
			existing = self._mcp_connections.get(url)
			if existing is not None:
				# сервер уже подключён — просто освежаем имя под текущий запрос
				existing.name = name
				return

			exit_stack = AsyncExitStack()
			try:
				read_stream, write_stream, _ = await exit_stack.enter_async_context(
					streamablehttp_client(url)
				)
				session = await exit_stack.enter_async_context(
					ClientSession(read_stream, write_stream)
				)
				await session.initialize()
				tools_result = await session.list_tools()
			except BaseException as exc:
				exc = await emergency_close_connection(exit_stack, exc)
				logging.warning("mcp connect failed: %s (%s) -> %r", name, url, exc)
				return

			self._mcp_connections[url] = McpConnection(
				url=url, name=name, exit_stack=exit_stack, session=session, tools=tools_result.tools,
			)
			logging.info("mcp connected: %s (%s), %d tool(s)", name, url, len(tools_result.tools))

	@staticmethod
	def _sanitize_name(s: str) -> str:
		# OpenAI требует имена тулов вида ^[a-zA-Z0-9_-]+$
		return re.sub(r"[^a-zA-Z0-9_-]", "_", s) or "x"

	def _make_openai_tool_name(self, server_name: str, tool_name: str, used: dict) -> str:
		candidate = f"{self._sanitize_name(server_name)}__{self._sanitize_name(tool_name)}"
		base, i = candidate, 2
		while candidate in used:
			candidate = f"{base}_{i}"
			i += 1
		return candidate

	def _build_tools(self, mcp_servers: list[dict]) -> tuple[list[dict], dict[str, tuple[str, str]]]:
		"""Собирает openai-схему тулов и маппинг openai_name -> (url, real_name)
		только из серверов, перечисленных В ЭТОМ запросе (не из всех когда-либо
		подключённых)."""
		openai_tools: list[dict] = []
		tool_map: dict[str, tuple[str, str]] = {}
		for entry in mcp_servers:
			url = entry["url"]
			conn = self._mcp_connections.get(url)
			if conn is None:
				continue  # подключение не удалось — молча пропускаем сервер
			for tool in conn.tools:
				openai_name = self._make_openai_tool_name(conn.name, tool.name, tool_map)
				tool_map[openai_name] = (url, tool.name)
				openai_tools.append({
					"type": "function",
					"function": {
						"name": openai_name,
						"description": tool.description or "",
						"parameters": tool.inputSchema or {"type": "object", "properties": {}},
					},
				})
		return openai_tools, tool_map

	async def _call_mcp_tool(self, openai_name: str, arguments_json: str, tool_map: dict) -> str:
		if openai_name not in tool_map:
			return f"Ошибка: неизвестный тул {openai_name}"
		url, real_name = tool_map[openai_name]
		conn = self._mcp_connections.get(url)
		if conn is None:
			return f"Ошибка: сервер {url} недоступен"

		try:
			args = json.loads(arguments_json or "{}")
		except json.JSONDecodeError:
			return f"Ошибка: не удалось распарсить аргументы: {arguments_json!r}"

		try:
			result = await conn.session.call_tool(real_name, args)
		except BaseException as exc:
			exc = await emergency_close_connection(conn.exit_stack, exc)
			self._mcp_connections.pop(url, None)
			return f"Ошибка: сервер {url} отключился ({exc!r})"

		parts = []
		for block in result.content:
			parts.append(getattr(block, "text", str(block)))
		return "\n".join(parts) if parts else "(пустой результат)"

	# ------------------------------------------------------------------
	# Стриминг одного шага + agent loop с тулами
	# ------------------------------------------------------------------

	async def _stream_once(
		self,
		session_id: str,
		messages: list[dict[str, Any]],
		tools: list[dict] | None,
		**create_kwargs: Any,
	) -> tuple[str, list[dict[str, Any]]]:
		"""Один проход стриминга: шлёт messages (+ tools, если есть) в LLM,
		стримит текст/reasoning клиенту через session/update. Возвращает
		(текст_ответа, tool_calls) — tool_calls непустой, если модель
		захотела вызвать инструмент(ы)."""
		create_kwargs.setdefault("model", MODEL)
		logging.info("_stream_once: tools=%d create_kwargs=%r", len(tools or []), create_kwargs)
		_debug_log_messages(messages)

		stream = await self._client.chat.completions.create(
			messages=messages,
			stream=True,
			tools=tools or None,
			tool_choice="auto" if tools else None,
			**create_kwargs,
		)

		reply_parts: list[str] = []
		tool_call_chunks: dict[int, dict[str, Any]] = {}

		async for chunk in stream:
			if not chunk.choices:
				if chunk.usage:
					logging.info("usage: %r", chunk.usage)
				continue

			delta = chunk.choices[0].delta

			if delta.content:
				reply_parts.append(delta.content)
				await self._conn.session_update(session_id, update_agent_message(text_block(delta.content)))

			if getattr(delta, "reasoning", None):
				await self._conn.session_update(session_id, update_agent_thought(text_block(delta.reasoning)))

			if delta.tool_calls:
				for tc in delta.tool_calls:
					slot = tool_call_chunks.setdefault(tc.index, {"id": None, "name": None, "arguments": ""})
					if tc.id:
						slot["id"] = tc.id
					if tc.function and tc.function.name:
						slot["name"] = tc.function.name
					if tc.function and tc.function.arguments:
						slot["arguments"] += tc.function.arguments

		tool_calls = [
			{
				"id": slot["id"],
				"type": "function",
				"function": {"name": slot["name"], "arguments": slot["arguments"]},
			}
			for _, slot in sorted(tool_call_chunks.items())
		]
		return "".join(reply_parts), tool_calls

	async def _run_agent_loop(
		self,
		session_id: str,
		messages: list[dict[str, Any]],
		tools: list[dict[str, Any]],
		tool_map: dict[str, tuple[str, str]],
		**create_kwargs: Any,
	) -> str:
		"""Гоняет модель, пока она вызывает тулы; messages мутируется по месту
		(в него дописываются ходы assistant/tool). Возвращает финальный текст."""
		text = ""
		for iteration in range(MAX_AGENT_LOOP_ITERATIONS):
			text, tool_calls = await self._stream_once(session_id, messages, tools, **create_kwargs)

			if not tool_calls:
				messages.append({"role": "assistant", "content": text})
				return text

			messages.append({
				"role": "assistant",
				"content": text or None,
				"tool_calls": tool_calls,
			})

			for tc in tool_calls:
				logging.info("tool call: %s(%s)", tc["function"]["name"], tc["function"]["arguments"])
				result_text = await self._call_mcp_tool(tc["function"]["name"], tc["function"]["arguments"], tool_map)
				logging.info("tool result: %.500r", result_text)
				messages.append({
					"role": "tool",
					"tool_call_id": tc["id"],
					"content": result_text,
				})
			# и снова наверх цикла — даём модели увидеть результаты тулов

		logging.warning("session[%s]: достигнут лимит %d итераций agent loop", session_id, MAX_AGENT_LOOP_ITERATIONS)
		return text

	# ------------------------------------------------------------------
	# ACP-методы
	# ------------------------------------------------------------------

	async def prompt(
		self,
		session_id: str,
		prompt: list[
			TextContentBlock
			| ImageContentBlock
			| AudioContentBlock
			| ResourceContentBlock
			| EmbeddedResourceContentBlock
		],
		**kwargs: Any,
	) -> PromptResponse:
		history = self._histories.setdefault(session_id, [])

		user_text = "".join(extract_text(block) for block in prompt)
		logging.info("prompt[%s]", session_id)
		history.append({"role": "user", "content": user_text})

		try:
			await self._run_agent_loop(session_id, history, tools=[], tool_map={})
			return PromptResponse(stop_reason="end_turn")
		except Exception:
			# полный трейсбек в файл, а в чат — короткое читаемое сообщение
			# вместо глухого "Internal error" от ACP-клиента
			logging.exception("prompt[%s] failed", session_id)
			history.pop()
			error_text = f"⚠️ Ошибка агента: {traceback.format_exc(limit=1).splitlines()[-1]}"
			await self._conn.session_update(session_id, update_agent_message(text_block(error_text)))
			return PromptResponse(stop_reason="end_turn")

	async def ext_method(self, method: str, params: Any, **kwargs: Any) -> Any:
		"""
		Хук для кастомных (не входящих в спеку ACP) методов вида "_namespace/...".
		SDK передаёт сюда имя extension-метода уже БЕЗ ведущего "_"
		(на проводе он есть — "_mychat/...", это лишь маркер для роутинга).
		"""
		if method == "mychat/session/reset_and_prompt":
			return await self._reset_and_prompt(params)

		logging.warning("ext_method: unknown method %r", method)
		raise NotImplementedError(f"Unknown extension method: {method}")

	async def _reset_and_prompt(self, params: Any) -> dict[str, Any]:
		"""
		Обрабатывает "_mychat/session/reset_and_prompt": НЕ трогает self._histories,
		отправляет пришедшие messages в LLM с пришедшими params как есть,
		по необходимости подключается к mcp-серверам из запроса, даёт модели
		их тулы и прогоняет agent loop, стримя ответ клиенту точно так же,
		как обычный prompt().
		"""
		data = params.model_dump(by_alias=False) if hasattr(params, "model_dump") else dict(params)

		session_id = data["sessionId"]
		create_kwargs = dict(data.get("params") or {})
		messages = list(data.get("messages") or [])
		mcp_servers = list(data.get("mcpServers") or [])

		logging.info(
			"reset_and_prompt[%s] <- %d messages, %d mcp servers, create_kwargs=%r",
			session_id, len(messages), len(mcp_servers), create_kwargs,
		)

		try:
			# подключаемся (если ещё не подключены) ко всем серверам из запроса;
			# type/headers пока игнорируем — всегда считаем Streamable HTTP
			await asyncio.gather(*[
				self._ensure_mcp_connected(s["url"], s.get("name", s["url"]))
				for s in mcp_servers
			])
			tools, tool_map = self._build_tools(mcp_servers)

			reply = await self._run_agent_loop(session_id, messages, tools, tool_map, **create_kwargs)
			logging.info("reset_and_prompt[%s] -> %r", session_id, reply)
			return {"stopReason": "end_turn"}
		except Exception:
			logging.exception("reset_and_prompt[%s] failed", session_id)
			error_text = f"⚠️ Ошибка агента: {traceback.format_exc(limit=1).splitlines()[-1]}"
			await self._conn.session_update(session_id, update_agent_message(text_block(error_text)))
			return {"stopReason": "end_turn"}

	async def cancel(self, session_id: str, **kwargs: Any) -> None:
		logging.info("cancel: %s", session_id)


async def main() -> None:
	await run_agent(OpenAIAgent())


if __name__ == "__main__":
	try:
		asyncio.run(main())
	except BaseException as e:
		logging.critical("crash exception: %r \n %r", e, traceback.format_exc(limit=1).splitlines()[-1])
		raise