import litellm
import os
import sys
import jsonc
import re

if len(sys.argv)==4:
	src, baseurl, model, api = sys.argv
elif len(sys.argv)==3:
	src, baseurl, model = sys.argv
	api = 'openai'
else:
	print("python pingopenaiapi <baseurl> <model> [<api>]")
	exit(1)

providername = re.search(r'^(?:https?:\/\/)?(?:[^\s\/\n]+@)?(?:.*?\.)?([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}(?:[:\/\.].*)?$', baseurl).group(1)

with open(os.path.dirname(os.path.abspath(__file__))+os.sep+'secret_keys.json', 'r') as secret_keys:
	acc_name = '1'
	accs = ['1']
	API_KEY = jsonc.load(secret_keys)['providers'][providername]
	if type(API_KEY) is not str:
		with open(os.path.dirname(os.path.abspath(__file__))+os.sep+'last_used.json', 'r') as last_used:
			acc_name = jsonc.load(last_used)['providers'][providername]
			accs = list(API_KEY.keys())
			API_KEY = API_KEY[acc_name]


model_list = []
for acc in accs:
	model_list.append({
		"model_name": "chat",
		"litellm_params": {
			"model": model,
			"api_key": API_KEY,
			"api_base": baseurl,
			"custom_llm_provider": api,
		},
		"model_info": {
			"acc":acc
		}
	})

def on_success(kwargs, completion_response, start_time, end_time):
	print('acc:',kwargs["litellm_params"].get("metadata",{}).get('model_info',{}).get('acc'))
	print('time:',kwargs['end_time'] - kwargs['start_time'])

litellm.success_callback = [on_success]

router = litellm.Router(model_list=model_list,num_retries=0)

response = router.completion(
	model="chat",
	messages=[
		{
			"role": "user",
			"content": "Привет. Что ты за модель?",
		}
	],
)

print('-------')
print(response)
