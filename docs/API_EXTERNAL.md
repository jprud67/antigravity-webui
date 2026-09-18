# 🛸 Guide Complet de l'API Externe Antigravity

Bienvenue dans la documentation de l'API externe d'**Antigravity WebUI**. Cette interface permet à **n'importe quelle application externe** (Cursor, VS Code Continue, LangChain, OpenWebUI, LibreChat, n8n, scripts Python/Node.js, microservices) de piloter le moteur d'agent autonome Antigravity CLI avec l'intégralité de ses capacités.

---

## 📑 Table des Matières

1. [Authentification & Clés d'API](#1-authentification--clés-dapi)
2. [Passerelle Compatible OpenAI (`/v1`)](#2-passerelle-compatible-openai-v1)
   - [Découverte des Modèles (`GET /v1/models`)](#découverte-des-modèles-get-v1models)
   - [Chat Completions (`POST /v1/chat/completions`)](#chat-completions-post-v1chatcompletions)
   - [Streaming & Raisonnement Thinking](#streaming--raisonnement-thinking)
   - [Tool Calling (Function Calling)](#tool-calling-function-calling)
3. [API Native Agent Antigravity (`/api/v1/agent`)](#3-api-native-agent-antigravity-apiv1agent)
   - [Exécution d'un Tour Agent (`POST /api/v1/agent/run`)](#exécution-dun-tour-agent-post-apiv1agentrun)
   - [Interruption & Guidage en Direct (`steer` / `interrupt`)](#interruption--guidage-en-direct)
   - [Statut, Quotas Google Cloud & Crédits (`GET /api/v1/agent/status`)](#statut-quotas-google-cloud--crédits)
4. [Intégrations Prêtes à l'Emploi](#4-intégrations-prêtes-à-lemploi)
   - [Configuration dans Cursor IDE](#configuration-dans-cursor-ide)
   - [Configuration dans VS Code Continue](#configuration-dans-vs-code-continue)
   - [Intégration Python avec le SDK officiel `openai`](#intégration-python-avec-le-sdk-officiel-openai)
   - [Intégration LangChain](#intégration-langchain)
   - [Requête cURL en Ligne de Commande](#requête-curl-en-ligne-de-commande)

---

## 1. Authentification & Clés d'API

Toutes les requêtes externes doivent être authentifiées par une clé d'API secrète générée depuis l'interface WebUI (**Paramètres > Clés d'API Externe**) ou définie via la variable d'environnement `ANTIGRAVITY_API_KEY`.

### En-têtes supportés

Vous pouvez passer votre clé de deux manières équivalentes :

```http
Authorization: Bearer agy_sk_votre_cle_secrete
```
ou
```http
X-API-Key: agy_sk_votre_cle_secrete
```

> [!TIP]
> Une clé maîtresse par défaut est automatiquement créée au premier démarrage. Vous pouvez générer autant de clés nommées que vous le souhaitez (ex: *Cursor*, *Microservice Prod*, *Tests Auto*) et révoquer une clé compromise à tout moment sans affecter les autres.

---

## 2. Passerelle Compatible OpenAI (`/v1`)

Cette passerelle implémente fidèlement les spécifications de l'API OpenAI, ce qui la rend compatible instantanément avec **100% des outils et bibliothèques de l'écosystème IA**.

### Découverte des Modèles (`GET /v1/models`)

Retourne tous les modèles configurés dans votre CLI Antigravity (familles Gemini 3.x, Claude Sonnet/Opus, etc.).

```bash
curl -s http://localhost:8000/v1/models \
  -H "Authorization: Bearer agy_sk_votre_cle"
```

**Réponse type :**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-3.8-flash",
      "object": "model",
      "created": 1789677000,
      "owned_by": "antigravity"
    },
    {
      "id": "gemini-3.1-pro",
      "object": "model",
      "created": 1789677000,
      "owned_by": "antigravity"
    },
    {
      "id": "claude-sonnet-4-6",
      "object": "model",
      "created": 1789677000,
      "owned_by": "antigravity"
    }
  ]
}
```

---

### Chat Completions (`POST /v1/chat/completions`)

Gère à la fois les requêtes synchrones standard et le streaming temps réel (SSE).

#### Paramètres supportés :

| Paramètre | Type | Requis | Description |
|---|---|:---:|---|
| `model` | string | Oui | Identifiant du modèle (`gemini-3.8-flash`, `claude-sonnet-4-6`, etc.) |
| `messages` | array | Oui | Tableau de messages `[{"role": "user"|"system"|"assistant", "content": "..."}]` |
| `stream` | boolean | Non | `true` pour activer le Server-Sent Events (défaut : `false`) |
| `temperature` | float | Non | Température de génération |
| `max_tokens` | integer | Non | Nombre maximal de tokens de sortie |
| `tools` | array | Non | Définitions d'outils OpenAI — active le **tool calling** (voir section dédiée ci-dessous) |
| `tool_choice` | string / object | Non | `auto` (défaut) · `required` · `none` · `{"type":"function","function":{"name":"..."}}` — nécessite `tools` |
| `workspace_path` | string | Non | *Extension Antigravity* : répertoire de travail racine pour l'agent (ignoré en mode tool calling) |
| `effort` | string | Non | *Extension Antigravity* : niveau de réflexion (`low`, `medium`, `high`) |
| `auto_approve` | boolean | Non | *Extension Antigravity* : exécution autonome sans confirmation d'outil (défaut : `true`) |
| `conversation_id` | string | Non | *Extension Antigravity* : ID pour continuer une session existante |

---

### Streaming & Raisonnement Thinking

Lorsque `stream: true` est activé, l'API renvoie des blocs SSE compatibles OpenAI.

Pour les modèles dotés de capacités de raisonnement (Gemini Thinking, Claude Thinking), le flux de réflexion interne est transmis dans le champ standard **`reasoning_content`** (norme DeepSeek R1 / OpenAI o1) :

```http
data: {"id":"chatcmpl-a1b2c3","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"reasoning_content":"Analyse de la structure du code..."},"finish_reason":null}]}

data: {"id":"chatcmpl-a1b2c3","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Voici la solution proposée :"},"finish_reason":null}]}

data: {"id":"chatcmpl-a1b2c3","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

---

### Tool Calling (Function Calling)

La passerelle `/v1` prend en charge le **protocole function calling d'OpenAI** : les clients agentiques (**Hermes Agent**, SDK OpenAI avec `tools=[...]`, agents autonomes) déclarent leurs propres outils, reçoivent des **`tool_calls`**, les exécutent de leur côté, puis renvoient les résultats pour poursuivre la boucle — jusqu'à la réponse finale en texte.

> [!IMPORTANT]
> **En mode tool calling, l'agent Antigravity n'exécute jamais ses propres outils.** Il « joue le rôle » d'un modèle sans état : il décide du prochain appel d'outil (ou de la réponse finale) et c'est **votre application** qui exécute réellement les outils. Côté serveur : sortie contrainte par schéma JSON, bac à sable (`--sandbox`), aucune permission d'exécution accordée. La **bascule automatique de compte Google** s'applique aussi en cas de quota.

#### Premier pas — obtenir un `tool_call`

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="agy_sk_votre_cle")

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"]
        }
    }
}]

response = client.chat.completions.create(
    model="gemini-3.8-flash",
    messages=[{"role": "user", "content": "Quel temps fait-il à Paris ?"}],
    tools=tools,
)

choice = response.choices[0]
# → finish_reason == "tool_calls"
# → choice.message.tool_calls[0].function.name == "get_weather"
# → choice.message.tool_calls[0].function.arguments == '{"city": "Paris"}'
```

#### Deuxième pas — renvoyer le résultat de l'outil

```python
tool_call = choice.message.tool_calls[0]
messages = [
    {"role": "user", "content": "Quel temps fait-il à Paris ?"},
    choice.message,   # message assistant contenant tool_calls
    {"role": "tool", "tool_call_id": tool_call.id, "content": '{"temperature_c": 18, "conditions": "sunny"}'},
]

final = client.chat.completions.create(model="gemini-3.8-flash", messages=messages, tools=tools)
print(final.choices[0].message.content)  # → « Il fait ensoleillé à Paris avec 18°C. »
```

#### Comportement & bonnes pratiques

| Aspect | Détail |
|---|---|
| Décision | **1 appel d'outil par tour** (séquentiel) ; bouclez jusqu'à `finish_reason: "stop"` |
| Sans état | Rejouez **tout l'historique** à chaque appel : messages `assistant` avec `tool_calls`, puis messages `role: "tool"` avec `tool_call_id` |
| `tool_choice` | `auto` (défaut) · `required` (force un appel d'outil) · `none` (désactive le tool calling → chat texte) · `{"type":"function","function":{"name":"..."}}` |
| Streaming | Supporté : `tool_calls` émis en chunks SSE (`delta.tool_calls`), `finish_reason: "tool_calls"` |
| Quota | Bascule automatique de compte Google intégrée (comme le chat classique) ; erreur 429 seulement si tous les comptes sont épuisés |
| Coût / latence | Chaque appel = un tour complet d'`agy` (~15–60 k tokens, quelques dizaines de secondes). `effort: "low"` accélère la décision — ajustable par client (ex. `extra_body` chez Hermes) |
| Garde-fou | Pour les très longs historiques, la partie médiane peut être tronquée côté serveur pour rester sous la limite système de ligne de commande |

> [!TIP]
> **Hermes Agent** — configuration en *custom provider* : `base_url: http://<hôte>:8000/v1`, `api_key: agy_sk_...`, `model: gemini-3.8-flash`. La boucle d'outils complète (terminal, fichiers, etc.) fonctionne de bout en bout — vérifié en conditions réelles.

---

## 3. API Native Agent Antigravity (`/api/v1/agent`)

Pour les applications qui souhaitent aller au-delà du texte et exploiter **l'intégralité du moteur d'agent** (outils en direct, résultats de commandes shell, arborescence de fichiers, bascule de compte Google automatique).

### Exécution d'un Tour Agent (`POST /api/v1/agent/run`)

```bash
curl -N -X POST http://localhost:8000/api/v1/agent/run \
  -H "Authorization: Bearer agy_sk_votre_cle" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Vérifie les tests du projet et corrige les erreurs de linting",
    "workspace_path": "/chemin/vers/mon/projet",
    "model": "gemini-3.8-flash",
    "effort": "high",
    "auto_approve": true,
    "stream": true
  }'
```

#### Événements SSE émis en direct (`stream: true`) :

- **`event: init`** : Identifiant unique de conversation généré ou rattaché.
- **`event: thought`** : Pensée et raisonnement interne de l'agent en direct.
- **`event: text_delta`** : Morceau de texte de la réponse finale en streaming.
- **`event: tool_call`** : Outil invoqué (`run_command`, `write_to_file`, `grep_search`...) avec ses arguments JSON.
- **`event: tool_result`** : Résultat complet de l'outil après son exécution.
- **`event: usage`** : Statistiques précises de consommation de tokens (`prompt_tokens`, `completion_tokens`).
- **`event: done`** : Clôture du tour avec récapitulatif complet de la session.

---

### Interruption & Guidage en Direct

- **Interrompre un agent en cours** :
  ```http
  POST /api/v1/agent/interrupt
  Content-Type: application/json

  {"conversation_id": "ab20ae2a-9cdf-4f72-b10e-ec3c4a02b9e1"}
  ```

- **Réorienter un agent sans couper le contexte (`steer`)** :
  ```http
  POST /api/v1/agent/steer
  Content-Type: application/json

  {
    "conversation_id": "ab20ae2a-9cdf-4f72-b10e-ec3c4a02b9e1",
    "instruction": "Arrête les tests d'intégration, concentre-toi uniquement sur le fichier auth.py"
  }
  ```

---

### Statut, Quotas Google Cloud & Crédits

`GET /api/v1/agent/status` retourne la santé du système, les quotas par bucket, les crédits restants et le compte Google actif :

```bash
curl -s http://localhost:8000/api/v1/agent/status \
  -H "Authorization: Bearer agy_sk_votre_cle"
```

---

## 4. Intégrations Prêtes à l'Emploi

### Configuration dans Cursor IDE

1. Ouvrez **Cursor Settings > Models**.
2. Activez **OpenAI Compatible**.
3. Renseignez :
   - **Base URL** : `http://localhost:8000/v1`
   - **API Key** : `agy_sk_votre_cle`
   - **Model Name** : `gemini-3.8-flash` ou `claude-sonnet-4-6`

---

### Configuration dans VS Code Continue

Dans votre fichier `~/.continue/config.json` :

```json
{
  "models": [
    {
      "title": "Antigravity Gemini 3.8 Flash",
      "provider": "openai",
      "model": "gemini-3.8-flash",
      "apiBase": "http://localhost:8000/v1",
      "apiKey": "agy_sk_votre_cle"
    },
    {
      "title": "Antigravity Claude Sonnet 4.6",
      "provider": "openai",
      "model": "claude-sonnet-4-6",
      "apiBase": "http://localhost:8000/v1",
      "apiKey": "agy_sk_votre_cle"
    }
  ]
}
```

---

### Intégration Python avec le SDK officiel `openai`

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="agy_sk_votre_cle"
)

# 1. Requête simple avec Streaming
response = client.chat.completions.create(
    model="gemini-3.8-flash",
    messages=[
        {"role": "system", "content": "Tu es un assistant de code expert."},
        {"role": "user", "content": "Écris une fonction de retry exponentiel en Python."}
    ],
    stream=True
)

for chunk in response:
    # Récupération du texte
    delta = chunk.choices[0].delta
    if delta.content:
        print(delta.content, end="", flush=True)
    # Récupération de la réflexion Thinking (optionnel)
    if hasattr(delta, "reasoning_content") and delta.reasoning_content:
        print(f"[Pensée]: {delta.reasoning_content}", flush=True)
```

---

### Intégration LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:8000/v1",
    api_key="agy_sk_votre_cle",
    model="gemini-3.8-flash"
)

response = llm.invoke("Quels sont les avantages d'une architecture agentique ?")
print(response.content)
```

---

### Requête cURL en Ligne de Commande

```bash
curl -N -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer agy_sk_votre_cle" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [
      {"role": "user", "content": "Explique l'algorithme Raft en 3 points clés."}
    ],
    "stream": true
  }'
```
