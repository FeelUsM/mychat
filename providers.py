import jsonc
import re
import os

def get_provider_by_name(name,model=None):
	name = name.replace("inferera","aihubmix")

	if name == "omniroute":
		BASE_URL = "http://localhost:20128/v1"
		MODEL = "fmd/gpt-5.5"
	if name == "openrouter":
		BASE_URL = "https://openrouter.ai/api/v1"
		MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
	if name == "github":
		BASE_URL = "https://models.github.ai/inference"
		MODEL = "deepseek/deepseek-r1"
	if name == "naga":
		BASE_URL = "https://api.naga.ac/v1"
		MODEL = "llama-3.3-70b-instruct:free"
	if name == "freemodel":
		BASE_URL = "https://api.freemodel.dev/v1"
		MODEL = "freemodel/gpt-5.6"
	if name == "mistral":
		BASE_URL = "https://api.mistral.ai/v1"
		MODEL = "mistral-large-latest"
	if name == "aihubmix": # не заработал
		BASE_URL = "https://api.inferera.com" # "https://aihubmix.com"
		MODEL = "gpt-4o-free"
	if name == "pateway":
		BASE_URL = "https://api.pateway.ai/v1"
		MODEL = "deepseek-v4-pro"
	if name == "groq":
		BASE_URL = "https://api.groq.com/openai/v1"
		MODEL = "groq/compound"
	if name == "cerebras":
		BASE_URL = "https://api.cerebras.ai/v1"
		MODEL = "gemma-4-31b"
	if 'BASE_URL' not in locals(): print("не выбрано ни одного провайдера"); exit()

	if model is not None: MODEL = model

	with open(os.path.dirname(os.path.abspath(__file__))+os.sep+'secret_keys.json', 'r') as jsonfile:
		# Load the content into a Python object
		api_keys = jsonc.load(jsonfile)['providers']
		API_KEY = api_keys[name]

	return BASE_URL, API_KEY, MODEL
