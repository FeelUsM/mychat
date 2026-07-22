---
a_sendReasoning: false
a_userHeading: Пользователь
a_assistantHeadings:
  - Ассистент
  - Assistant
a_reasoningHeadings:
  - Размышления ассистента
ap_temperature: 0.2
---
ты полезный ассистент
# omnirioute
как настроить omnirioute так чтобы я задавал модель, а он сам находил и направлял запрос провайдеру с этой моделью.
Или как хотя бы посмотреть список провайдеров, предоставляющих данную модель?
## Размышления ассистента
The user wants to know how to configure OmniRouter (likely referring to a specific LLM router/gateway like `omnigate`, `portkey`, `litellm`, or a specific project named "OmniRouter") to:
1. Specify a model name and have the router automatically find a provider that serves it and route the request.
2. Alternatively, list providers offering a specific model.

I need to clarify *which* "OmniRouter" they mean, as there isn't a single dominant standard tool with that exact name.
Candidates:
- **Portkey.ai** (often called an AI Gateway/Router)
- **LiteLLM** (very popular proxy/router)
- **OpenRouter** (API aggregator, acts like a router)
- **OmniGate** / **OmniRouter** (specific smaller GitHub projects)
- **Kong AI Gateway** / **Cloudflare AI Gateway**

Most likely, they mean **LiteLLM** (often used as a self-hosted router) or **OpenRouter** (managed service) or **Portkey**.
I should provide a general answer covering the most popular tools (LiteLLM, Portkey, OpenRouter) and ask for clarification if they mean a specific niche project.
## Ассистент
Проблема в том, что **единого стандарта «OmniRouter» не существует**. Под этим названием могут скрываться разные проекты (LiteLLM, Portkey, OpenRouter, самописные обертки или малоизвестные GitHub-репозитории).

Ниже инструкции для **трех самых популярных инструментов**, которые обычно имеют в виду под «роутером для LLM». Найдите свой случай:

---

#### 1. LiteLLM (Самый популярный self-hosted прокси/роутер)
Это стандарт де-факто для «универсального прокси» под OpenAI API.

##### Как задать модель, а он сам найдет провайдера (Fallbacks / Router)
В `config.yaml` настраивается **`model_list`** с приоритетами (fallbacks). Вы обращаетесь к **одному виртуальному имени модели** (например, `my-gpt-4o`), а LiteLLM сам пробует провайдеров по очереди.

```yaml
# config.yaml
model_list:
  - model_name: "my-gpt-4o"          # <--- ВАШЕ ИМЯ МОДЕЛИ (любое)
    litellm_params:
      model: "openai/gpt-4o"         # Провайдер 1: Официальный OpenAI
      api_key: "os.environ/OPENAI_KEY"
    # Если упадет/кончится лимит — пойдет сюда:
    fallback: 
      - model_name: "azure-gpt-4o"
      - model_name: "aws-bedrock-gpt-4o"

  - model_name: "azure-gpt-4o"       # Внутреннее имя для фоллбека
    litellm_params:
      model: "azure/gpt-4o"
      api_key: "os.environ/AZURE_KEY"
      api_base: "https://your-resource.openai.azure.com"
      api_version: "2024-02-01"

  - model_name: "aws-bedrock-gpt-4o" # Еще один фоллбек
    litellm_params:
      model: "bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0" # Или другая модель
      aws_region_name: "us-east-1"
```

**Как пользоваться:**
Вы шлете запрос на `http://localhost:4000/v1/chat/completions` с `"model": "my-gpt-4o"`. LiteLLM сам решит, куда его отправить.

##### Как посмотреть список провайдеров для модели (CLI / UI)
1. **CLI:** `litellm get_providers --model="gpt-4o"` (покажет все поддерживаемые интеграции: openai, azure, vertex_ai, bedrock и т.д.).
2. **Admin UI:** Запустите `litellm --ui` -> вкладка **Models** -> поиск по названию. Покажет всех настроенных в конфиге провайдеров для этой модели.
3. **Программно (Python):**
   ```python
   import litellm
   # Все провайдеры, которые *умеют* эту модель (даже если не в конфиге)
   print(litellm.get_llm_provider("gpt-4o")) 
   # Вывод: ('openai', 'gpt-4o', None, None) — значит нативный OpenAI
   ```

---

#### 2. Portkey.ai (Managed Gateway / Self-hosted)
Более «энтерпрайзный» вариант с визуальным конфигом.

##### Автоматический выбор провайдера (Virtual Keys / Configs)
1. В дашборде (или `config.yaml`) создаете **Virtual Key** (виртуальный ключ).
2. Привязываете к нему **Config** с стратегией `fallback` или `loadbalance`.
3. В конфиге указываете список провайдеров для **одного виртуального имени модели**.

**Пример `config.yaml` (Portkey):**
```yaml
virtual_keys:
  - virtual_key: "vk-my-app-key"
    config:
      strategy:
        mode: "fallback" # или loadbalance
      models:
        - name: "gpt-4o" # Ваше имя модели
          provider: "openai"
          api_key: "sk-..."
          weight: 1
        - name: "gpt-4o" # Тоже имя, другой провайдер
          provider: "azure"
          api_key: "azure-key..."
          azure_endpoint: "https://..."
          weight: 2
```
**Запрос:** Вызываете `portkey.chat.completions.create(model="gpt-4o", ...)` с заголовком `x-portkey-virtual-key: vk-my-app-key`. Portkey сам маршрутизирует.

##### Список провайдеров для модели
*   **Dashboard:** Settings -> Providers. Там видно, какие провайдеры (OpenAI, Anthropic, Gemini, Mistral, Bedrock, Vertex, Groq, Together и др.) поддерживают выбранную модель.
*   **Документация:** [Portkey Supported Models](https://portkey.ai/docs/provider-integrations/supported-models) — таблица: Модель -> Список провайдеров.

---

#### 3. OpenRouter (Самый простой вариант: «API ключ один — модели все»)
Это **не self-hosted**, а SaaS. Но именно он делает то, что вы просите «из коробки» без конфигов.

##### Как это работает
1. Регистрируетесь -> получаете **один API Key** (`sk-or-v1-...`).
2. В запросе указываете **любую модель** из их каталога (сотни моделей: `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.1-405b`, `google/gemini-flash-1.5` и т.д.).
3. OpenRouter **сам находит провайдера** (у них пул собственных GPU + партнеры вроде Together, Fireworks, Groq, Azure и т.д.), балансирует нагрузку, делает фоллбэки.

**Пример запроса:**
```bash
curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
  -H "Authorization: Bearer $OPENROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-3.5-sonnet", # Просто пишете модель
    "messages": [{"role": "user", "content": "Привет"}]
  }'
```

##### Как посмотреть провайдеров для модели
1. **Веб-интерфейс:** Зайдите на [openrouter.ai/models](https://openrouter.ai/models) -> выберите модель -> вкладка **"Providers" / "Endpoints"**. Увидите список: `Together AI`, `Fireworks`, `Groq`, `OpenRouter (own)`, цены и лимиты.
2. **API:** `GET https://openrouter.ai/api/v1/models` -> в поле `endpoints` для каждой модели будет массив провайдеров с ценами и контекстом.

---

#### 4. Если у вас свой кастомный проект / другой репозиторий
Если вы клонировали репозиторий именно с названием **`OmniRouter`** (например, `github.com/someuser/OmniRouter`):

1.  Посмотрите **`README.md`** — там обычно есть раздел *Configuration* или *Model Routing*.
2.  Ищите файл конфигурации: `config.yaml`, `config.json`, `.env`, `settings.py`.
3.  Ищите ключевые слова: `router`, `fallback`, `model_mapping`, `providers`, `endpoints`.
4.  Запустите с флагом `--help` или посмотрите CLI-команды: `python -m omnirouter --help` или `omnirouter list-models`.

---

#### Резюме: что выбрать?

| Задача | Лучший инструмент |
| :--- | :--- |
| **Self-hosted, полный контроль, сложные фоллбэки, бюджетинг, логирование** | **LiteLLM** (Docker: `docker run -p 4000:4000 ghcr.io/berriai/litellm:main-latest`) |
| **Нужен UI, команды для команд, кэширование, guardrails, не хочется копать YAML** | **Portkey** (Self-hosted или Cloud) |
| **Хочу «просто работает», не хочу держать инфраструктуру, нужен доступ ко ВСЕМ моделям сразу** | **OpenRouter** (Один ключ, платишь за токены) |

**Если вы уточните, какой именно репозиторий/продукт используете (ссылка на GitHub или название SaaS), я напишу точный конфиг для него.**

# Пользователь
