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

	async def _stream_reply(self, session_id: str, messages: list[dict[str, Any]], **create_kwargs: Any) -> str:
		"""
		Общий цикл: шлёт messages в OpenAI, стримит текстовые дельты клиенту
		через session/update, возвращает итоговый склеенный текст ответа.
		create_kwargs пробрасываются в chat.completions.create() как есть
		(model, temperature, max_tokens и т.п.) — если там нет "model",
		подставляется MODEL по умолчанию.
		"""
		create_kwargs.setdefault("model", MODEL)
		stream = await self._client.chat.completions.create(
			messages=messages,
			stream=True,
			**create_kwargs,
		)
 
		reply_parts: list[str] = []
		async for chunk in stream:
			# Azure-бэкенды (в т.ч. models.github.ai) иногда шлют служебный
			# чанк с content-filter метаданными и пустым choices — пропускаем его
			if not chunk.choices:
				continue
			delta = chunk.choices[0].delta.content
			if delta:
				reply_parts.append(delta)
				await self._conn.session_update(session_id, update_agent_message(text_block(delta)))
 
		return "".join(reply_parts)
 
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
			reply = await self._stream_reply(session_id, history)
			history.append({"role": "assistant", "content": reply})
			logging.info("prompt[%s] -> %r", session_id, reply)
 
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
		ВАЖНО: точное имя этого метода и форма params зависят от версии SDK —
		сверься командой:
			python3 -c "import acp; print([m for m in dir(acp.Agent) if not m.startswith('_')])"
		и поправь сигнатуру/имя при необходимости.
		"""
		# SDK передаёт сюда имя extension-метода уже БЕЗ ведущего "_"
		# (на проводе он есть — "_mychat/...", это лишь маркер для роутинга)
		if method == "mychat/session/reset_and_prompt":
			return await self._reset_and_prompt(params)
 
		logging.warning("ext_method: unknown method %r", method)
		raise NotImplementedError(f"Unknown extension method: {method}")
 
	async def _reset_and_prompt(self, params: Any) -> dict[str, Any]:
		"""
		Обрабатывает "_mychat/session/reset_and_prompt": НЕ трогает self._histories,
		отправляет пришедшие messages в LLM с пришедшими params как есть и
		стримит ответ клиенту точно так же, как обычный prompt().
		"""
		# params может прийти как pydantic-модель или как dict — приводим к dict
		data = params.model_dump(by_alias=False) if hasattr(params, "model_dump") else dict(params)
 
		session_id = data["sessionId"]
		create_kwargs = dict(data.get("params") or {})
		messages = list(data.get("messages") or [])
 
		logging.info(
			"reset_and_prompt[%s] <- %d messages, create_kwargs=%r",
			session_id, len(messages), create_kwargs,
		)
 
		try:
			reply = await self._stream_reply(session_id, messages, **create_kwargs)
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
	asyncio.run(main())