'''
простое тестирование openai API
подключаемся, отправлем диалог
добавляем ответ ЛЛМ, добавляем ответ пользователя, отправлем диалог
'''
import os
from openai import OpenAI
import re

# Конфигурация
from providers import get_provider_by_name

provider_name = "omniroute"
#provider_name = "openrouter"
#provider_name = "github"
#provider_name = "naga"
#provider_name = "freemodel"
#provider_name = "mistral"
#provider_name = "aihubmix" # не заработал
#provider_name = "pateway"
#provider_name = "groq"
#provider_name = "cerebras"
BASE_URL, API_KEY, MODEL = get_provider_by_name(provider_name)

# Инициализация клиента
client = OpenAI(
	base_url=BASE_URL,
	api_key=API_KEY
)

print("---",provider_name,"---")
if provider_name=='openrouter':
	# Получаем список моделей
	models = client.models.list()
	print("Доступные модели:")
	for model in models.data:
		print(f"- {model.id}")
	print("---",MODEL,"---")

# История диалога
messages = []
if provider_name!="aerolink":
	messages.append({
	"role": "system",
	"content": "Ты полезный ассистент. Отвечай кратко."
})

def chat(user_input: str) -> str:
	# Добавляем сообщение пользователя
	messages.append({"role": "user", "content": user_input})
	
	# Запрос к API
	response = client.chat.completions.create(
		model=MODEL,
		messages=messages,
		temperature=0.7
	)
	
	# Получаем ответ ассистента
	assistant_message = response.choices[0].message.content
	messages.append({"role": "assistant", "content": assistant_message})
	
	return assistant_message

# Основной цикл
if __name__ == "__main__":
	print("Чат с LLM (введите 'exit' для выхода)")
	while True:
		user_input = input("\nВы: ")
		if user_input.lower() == "exit":
			break
		
		response = chat(user_input)
		print(f"Ассистент: {response}")