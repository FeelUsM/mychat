'''
пример подключения к mcp-серверу
важные тонкости с asyncio и исключениями
'''

import asyncio
from aioconsole import ainput

from contextlib import AsyncExitStack
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

MCP_SERVER_URL = "http://localhost:3001/mcp"

async def open_connection(exit_stack: AsyncExitStack):
	try:
		read_stream, write_stream, _ = await exit_stack.enter_async_context(
			streamablehttp_client(MCP_SERVER_URL)
		)
		session = await exit_stack.enter_async_context(
			ClientSession(read_stream, write_stream)
		)
		await session.initialize()
		return session
	except BaseException as exc:
		exc = await emergency_close_connection(exit_stack, exc)
		print(f"Не удалось подключиться к {MCP_SERVER_URL}: {exc!r}")
		return None

async def emergency_close_connection(exit_stack: AsyncExitStack, exc: BaseException) -> BaseException:
	# Отдаём исключение в exit_stack.__aexit__, а не просто зовём aclose() -
	# иначе task group внутри streamablehttp_client не поймёт, что отмена уже
	# обработана, и поднимет исходную ошибку ещё раз при закрытии.
	try:
		await exit_stack.__aexit__(type(exc), exc, exc.__traceback__)
	except BaseException as cleanup_exc:
		exc = cleanup_exc
    if isinstance(exc, BaseExceptionGroup):
        return exc.exceptions[0]
    else:
        raise exc

async def close_connection(exit_stack: AsyncExitStack):
	await exit_stack.aclose()


async def main():
	exit_stack = AsyncExitStack()

	session = await open_connection(exit_stack)

	while True:
		user_input = input('\nВы: ')
		if user_input == 'exit':
			break
		if session is not None:
			try:
				tools = await session.list_tools()
				for tool in tools.tools:
					print(tool.name)
			except BaseException as exc:
				exc = await emergency_close_connection(exit_stack, exc)
				print(f"server disconnected {MCP_SERVER_URL}: {exc!r}")
				session = None

	await close_connection(exit_stack)


asyncio.run(main())
