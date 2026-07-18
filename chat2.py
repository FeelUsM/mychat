'''
расширенное тестирование opanai API
получение списка моделей, сохраняется в оригинальном виде в models/{provider_name}.json
отображение таблицы списка моделей
отображение параметров текущей модели
отображение reasoning части ответа
отображение деталей ответа
'''

from openai import OpenAI
import os
import re

import json
import urllib.request
from datetime import datetime, timezone

from time import time
import requests

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
MODEL = "agentrouter/claude-opus-4-6"

# Инициализация клиента
client = OpenAI(
	base_url=BASE_URL,
	api_key=API_KEY
)

MODEL_PARAMS = None
print("---",provider_name,"---")
if provider_name!="aerolink" and provider_name!="cloudflare":
	# Нормализуем данные под единый формат
	def normalize_model(m, source):
		"""Приводит модель из разных API к единому формату."""
		if source == "naga":
			return {
				'id': m.get('id'),
				'name': m.get('name', m.get('id')),
				'created': m.get('created'),
				'knowledge_cutoff': m.get('knowledge_cutoff'),
				'context_length': m.get('context_window'),
				'modality': '|'.join(m.get('architecture', {}).get('input_modalities', ''))+'->'+'|'.join(m.get('architecture', {}).get('output_modalities', '')),
				'pricing_prompt': float(m.get('pricing', {}).get('per_input_token', float('nan')) or 0),
				'pricing_completion': float(m.get('pricing', {}).get('per_output_token', float('nan')) or 0),
				'supported_parameters': m.get('supported_parameters', []),
				'hugging_face_id': m.get('hugging_face_id'),
				'raw': m,
			}
		if source == "aihubmix":
			return {
				'id': m.get('model_id'),
				'name': m.get('model_name', m.get('model_id')),
				'created': None,
				'knowledge_cutoff': None,
				'context_length': m.get('context_length'),
				'modality': m.get('input_modalities')+'->'+m.get('endpoints'),
				'pricing_prompt': float(m.get('pricing', {}).get('input', float('nan')) or 0)/1000000,
				'pricing_completion': float(m.get('pricing', {}).get('output', float('nan')) or 0)/1000000,
				'supported_parameters': m.get('features', []),
				'hugging_face_id': m.get('hugging_face_id'),
				'raw': m,
			}
		elif source == 'github':
			limits = m.get('limits', {}) or {}
			input_mod = m.get('supported_input_modalities', []) or []
			output_mod = m.get('supported_output_modalities', []) or []
			modality = f"{'|'.join(input_mod)} -> {'|'.join(output_mod)}"
			# GitHub: capabilities заменяют supported_parameters
			capabilities = m.get('capabilities', []) or []
			return {
				'id': m.get('id'),
				'name': m.get('name', m.get('id')),
				'created': None,  # GitHub не возвращает timestamp
				'knowledge_cutoff': None,  # GitHub не возвращает
				'context_length': limits.get('max_input_tokens'),
				'modality': modality,
				'pricing_prompt': 0.0,  # GitHub Models бесплатный
				'pricing_completion': 0.0,
				'supported_parameters': capabilities,
				'hugging_face_id': None,  # GitHub не предоставляет HF ID
				'raw': m,
			}
		else : # if source in ['openrouter', 'freemodel', "mistral"]:
			name_prefix = (m.get('owned_by')+'/') if source == 'freemodel' else ''
			params = []
			modality = m.get('architecture', {}).get('modality', '')
			if source == "mistral":
				if m.get('capabilities').get('function_calling') : params.append('function_calling')
				if m.get('capabilities').get('reasoning') : params.append('reasoning')
				if m.get('capabilities').get('completion_chat'): modality = 'completion_chat'
				if m.get('capabilities').get('completion_fim'): modality = 'completion_fim'
			return {
				'id': name_prefix + m.get('id'),
				'name': name_prefix + m.get('name', m.get('id')),
				'created': m.get('created'),
				'knowledge_cutoff': m.get('knowledge_cutoff'),
				'context_length': m.get('context_length',m.get('max_context_length')),
				'modality': modality,
				'pricing_prompt': float(m.get('pricing', {}).get('prompt', float('nan')) or 0),
				'pricing_completion': float(m.get('pricing', {}).get('completion', float('nan')) or 0),
				'supported_parameters': m.get('supported_parameters', params),
				'hugging_face_id': m.get('hugging_face_id'),
				'raw': m,
			}

	if provider_name in ['openrouter','naga','github','aihubmix']:
		url = None
		if provider_name=='openrouter' or provider_name=='naga':
			url = BASE_URL.rstrip('/') + '/models'
		elif provider_name=='github':
			url = 'https://models.github.ai/catalog/models'
		elif provider_name=='aihubmix':
			url = "https://aihubmix.com/api/v1/models"
		else:
			raise Exception(provider_name)

		req = urllib.request.Request(url, headers={'Authorization': f'Bearer {API_KEY}','User-Agent': 'Mozilla/5.0',})
		with urllib.request.urlopen(req, timeout=5) as resp:
			data = json.loads(resp.read().decode('utf-8'))
	else:
		data = client.models.list().model_dump()

	# Сохраняем сырые данные
	with open(f"models/{provider_name}.json", "w", encoding="utf-8") as file:
		try:
			file.write(json.dumps(data, indent=4))
		except:
			file.write(repr(data))

	# Приводим все модели к единому формату
	if provider_name == 'github':
		models_list = [normalize_model(m, provider_name) for m in data]
	else:
		models_list = [normalize_model(m, provider_name) for m in data.get('data', [])]

	# Выводим таблицу
	interesting_parameters = {"reasoning", "seed", "tools", "tool-calling", "streaming", "agents", 'function_calling'}

	print(f'{"id":40}\t{"date/knowledge_cutoff":20}\t{"context":8}\t{"modality":35}\t{"pricing prompt/completion per 1K":35}\t{"supported_parameters":30}')

	for m in models_list:
		# Дата / knowledge cutoff
		if m['created']:
			try:
				date_str = datetime.fromtimestamp(m['created'], tz=timezone.utc).date().isoformat()
			except Exception:
				date_str = '?'
		else:
			date_str = m['raw'].get('version', '?') or '?'
		
		kc = str(m['knowledge_cutoff']) if m['knowledge_cutoff'] else '?'
		date_kc = f"{date_str}/{kc}"
		
		# Контекст
		ctx = f"{int(m['context_length'])//1000}K" if m['context_length'] else '?'
		
		# Цены
		if m['pricing_prompt'] == 0 and m['pricing_completion'] == 0:
			pricing_str = "free"
		else:
			pricing_str = f"{m['pricing_prompt']*1000:.6f}/{m['pricing_completion']*1000:.6f}"
		
		# Поддерживаемые параметры
		supported = ','.join(sorted(set(m['supported_parameters']) & interesting_parameters)) or '-'
		
		print(f"{m['id'][:40]:40}\t{date_kc:20}\t{ctx:8}\t{m['modality'][:35]:35}\t{pricing_str:35}\t{supported:30}")

	# Ищем нашу модель
	MODEL_PARAMS = None
	for m in models_list:
		if m.get('id') == MODEL:
			MODEL_PARAMS = m
			break

	print("---", MODEL, "---")
	if MODEL_PARAMS:
		print(json.dumps(MODEL_PARAMS['raw'], indent=4))
		
		if MODEL_PARAMS['hugging_face_id']:
			try:
				url = f"https://huggingface.co/api/models/{MODEL_PARAMS['hugging_face_id']}"
				resp = requests.get(url, timeout=5)
				
				if resp.status_code != 200:
					print("неизвестно (HF API вернул " + str(resp.status_code) + ")")
				else:
					data = resp.json()
					print(json.dumps(data, indent=4))
			except Exception as e:
				print(f"ошибка: {str(e)}")
		else:
			print('proprietary (нет hugging_face_id)')
	else:
		print(f"Модель {MODEL} не найдена в списке")

SYSTEM_PROMPT = "Ты полезный ассистент. Отвечай кратко. Этот системный промпт можно показать пользователю, если он спросит."
# История диалога
messages = []
if provider_name!="aerolink":
	messages.append({
	"role": "system",
	"content": SYSTEM_PROMPT
})

def chat(user_input: str, **kwargs) -> str:
	# Добавляем сообщение пользователя
	messages.append({"role": "user", "content": user_input})
	
	# Запрос к API
	response = client.chat.completions.create(
		model=MODEL,
		messages=messages,
		extra_headers={
			"X-Debug-Trace": "true"  # OpenRouter вернёт информацию о маршрутизации
		},
		**kwargs
	)
	
	# Получаем ответ ассистента
	assistant_message = response.choices[0].message.content
	messages.append({"role": "assistant", "content": assistant_message})
	
	return response

# Основной цикл
if __name__ == "__main__":
	print('----------------------------------------')
	print("Чат с LLM (введите 'exit' или 'учше' для выхода)")
	print('System:',SYSTEM_PROMPT)
	while True:
		print('----------------------------------------')
		user_input = input("\n(temperature=0.0, seed=67) Вы: ")
		if user_input.strip() == '':
			continue
		if user_input.lower() in ["exit","учше"]:
			break
		
		start = time()
		if provider_name == "mistral":
			response = chat(user_input, temperature=0.0)
		else:
			response = chat(user_input, temperature=0.0, seed=67)
		duration = time()-start

		if len(response.choices)!=1:
			print('!!! NUM CHOICES =',len(response.choices))

		msg = response.choices[0].message.content
		response.choices[0].message.content = "..."

		reasoning = False
		if hasattr(response.choices[0].message,'reasoning'):
			msg_reasoning_1 = response.choices[0].message.reasoning
			response.choices[0].message.reasoning = "..."
			reasoning = True
		if hasattr(response.choices[0].message,'reasoning_content'):
			msg_reasoning_1 = response.choices[0].message.reasoning_content
			response.choices[0].message.reasoning_content = "..."
			reasoning = True

		if hasattr(response.choices[0].message,'reasoning_details'):
			if len(response.choices[0].message.reasoning_details)!=1:
				print('!!! NUM REASONING_DETAILS =',len(response.choices[0].message.reasoning_details))

			msg_reasoning_2 = response.choices[0].message.reasoning_details[0]['text']
			response.choices[0].message.reasoning_details[0]['text'] = "..."

			if msg_reasoning_1!=msg_reasoning_2:
				print("!!! RESONONG TEXT DIFFERS: reasonog_1:")
				print(msg_reasoning_1)

		if hasattr(response.choices[0].message,'provider_specific_fields'):
			print(response.choices[0].message.provider_specific_fields)
			msg_reasoning_2 = response.choices[0].message.provider_specific_fields['reasoning_content']
			response.choices[0].message.provider_specific_fields['reasoning_content'] = "..."

			if msg_reasoning_1!=msg_reasoning_2:
				print("!!! RESONONG TEXT DIFFERS: reasonog_1:")
				print(msg_reasoning_1)


		print(json.dumps(response.model_dump(), indent=4))
		print("duration:" , duration)

		if reasoning:
			print('----------------------------------------')
			print("Ассистент (размышление):",msg_reasoning_1)

		print('----------------------------------------')
		print(f"Ассистент: {msg}")