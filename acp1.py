"""
Простейший агент по протоколу Agent Client Protocol (ACP),
который отвечает через OpenAI-совместимый API.

Смотреть логи в реальном времени:
	tail -f acp1.log
"""

import asyncio
import logging
import os
import traceback
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
from openai import AsyncOpenAI

# Конфигурация
from providers import get_provider_by_name
#provider_name = "openrouter"
provider_name = "github"
#provider_name = "naga"
#provider_name = "freemodel"
#provider_name = "mistral"
#provider_name = "aihubmix" # не заработал
#provider_name = "pateway"
#provider_name = "groq"
#provider_name = "cerebras"
BASE_URL, API_KEY, MODEL = get_provider_by_name(provider_name)
LOG_FILE = "acp1.log"

def extract_text(block: Any) -> str:
	"""Достаёт текст из блока промпта, остальные типы (картинки и т.п.) игнорируем."""
	if isinstance(block, TextContentBlock):
		return block.text
	return ""

def isiterable(some_object):
	try:
	    some_object_iterator = iter(some_object)
	    return True
	except TypeError as te:
	    return False


class OpenAIAgent(Agent):
	_conn: Client

	def __init__(self) -> None:
		self._client = AsyncOpenAI(
			base_url=BASE_URL,
			api_key=API_KEY
		)
		self._histories: dict[str, list[dict[str, str]]] = {}

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
		logging.info("prompt[%s] <- %r", session_id, user_text)
		history.append({"role": "user", "content": user_text})

		try:
			stream = await self._client.chat.completions.create(
				model=MODEL,
				messages=history,
				stream=True,
			)

			reply_parts: list[str] = []
			async for chunk in stream:
				if not chunk.choices:
					continue
				delta = chunk.choices[0].delta.content
				if delta:
					reply_parts.append(delta)
					# стримим кусочки ответа клиенту по мере генерации
					await self._conn.session_update(session_id, update_agent_message(text_block(delta)))

			reply = "".join(reply_parts)
			history.append({"role": "assistant", "content": reply})
			logging.info("prompt[%s] -> %r", session_id, reply)

			return PromptResponse(stop_reason="end_turn")
		except Exception as e:
			# полный трейсбек в файл, а в чат — короткое читаемое сообщение
			# вместо глухого "Internal error" от ACP-клиента
			logging.exception("prompt[%s] failed", session_id)
			if isinstance(e,ValueError):
				logging.exception("details: %s", repr(e.args))
			history.pop()
			error_text = f"⚠️ Ошибка агента: {traceback.format_exc(limit=1).splitlines()[-1]}"
			await self._conn.session_update(session_id, update_agent_message(text_block(error_text)))
			return PromptResponse(stop_reason="end_turn")

	async def cancel(self, session_id: str, **kwargs: Any) -> None:
		logging.info("cancel: %s", session_id)


async def main() -> None:
	logging.basicConfig(
		level=logging.INFO,
		format="%(asctime)s %(levelname)s %(message)s",
		handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8")],
	)
	logging.info("=== agent starting, logging to %s ===", LOG_FILE)
	logging.info("cwd: %s ===", os.getcwd())
	await run_agent(OpenAIAgent())


if __name__ == "__main__":
	asyncio.run(main())