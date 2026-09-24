# Design Specification: AI Prompt Optimizer & Meta-Prompt Studio (v0.2.14)

**Status:** Proposed  
**Author:** Antigravity Team  
**Date:** 2026-09-24  
**Version Target:** v0.2.14  
**Scope:** Frontend (`ChatInput`, `PromptOptimizerModal`, `promptAnalyzer`) & Backend (`/api/prompt/analyze`, `/api/prompt/optimize`)

---

## 1. Problem Statement & Motivation
Users frequently interact with the Antigravity assistant with short, underspecified, or ambiguous prompts (e.g., *"fix this"*, *"optimize my code"*, *"make a login form"*). Such queries often lead to suboptimal responses, excessive back-and-forth roundtrips, or hallucinated assumptions regarding context, file paths, and technical constraints.

While `PromptTemplatesModal` provides pre-made static templates, users need an **active prompt doctor** that:
1. Analyzes what they are **currently typing in real time** without leaving the chat interface.
2. Quantifies the prompt's agentic clarity via a **0-100% score** broken down into 4 key axes: **Context**, **Objective**, **Constraints**, and **Output Format**.
3. Reconstructs rough drafts into **high-precision meta-prompts** with 1 click using proven agentic prompting formulas (Role, Context, Step-by-step Execution, Verification).
4. Provides specialized meta-prompt recipes (Debugging, Architecture Plan, Clean Refactoring, Critical Code Review, Explaining).

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────┐
│                      ChatInput                         │
│  [User draft text area...]                             │
│  [Clarity Badge: 85% 🟢] [Wand2 Button: "Optimiser"]   │
└───────────────────────────┬────────────────────────────┘
                            │ (Click or Ctrl+Shift+O or /optimize)
                            ▼
┌────────────────────────────────────────────────────────┐
│             PromptOptimizerModal (Studio)              │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Header: Clarity Score (0-100%) & 4 Quality Gauges   │ │
│ │ [Contexte 25/25] [Objectif 20/25] [Contraintes]     │ │
│ ├──────────────────────────┬─────────────────────────┤ │
│ │ Original Draft           │ Optimized Meta-Prompt   │ │
│ │ (Raw user input)         │ (Structured with roles) │ │
│ ├──────────────────────────┴─────────────────────────┤ │
│ │ Presets: [✨ Général] [🛠️ Debug] [📋 Plan] [⚡ Refactor]│ │
│ ├────────────────────────────────────────────────────┤ │
│ │ Actions: [⚡ Appliquer au chat] [📋 Copier] [Fermer] │ │
│ └────────────────────────────────────────────────────┘ │
└───────────────────────────┬────────────────────────────┘
                            │
              POST /api/prompt/analyze
              POST /api/prompt/optimize
                            ▼
┌────────────────────────────────────────────────────────┐
│               FastAPI Backend Endpoints                │
│  `backend/app/api/prompt.py`                           │
│  - Heuristic analysis & token estimation               │
│  - Meta-prompt transformation engine                   │
└────────────────────────────────────────────────────────┘
```

---

## 3. Data Models & API Contracts

### 3.1 Backend Endpoints (`backend/app/api/prompt.py`)

#### `POST /api/prompt/analyze`
**Request Body:**
```json
{
  "prompt": "corrige le bug dans main.py quand on clique sur enregistrer"
}
```
**Response Body (`PromptAnalysisResponse`):**
```json
{
  "prompt": "corrige le bug dans main.py quand on clique sur enregistrer",
  "word_count": 10,
  "char_count": 60,
  "estimated_tokens": 15,
  "clarity_score": 55,
  "breakdown": {
    "context": 15,
    "objective": 20,
    "constraints": 10,
    "output_format": 10
  },
  "suggestions": [
    "Précisez le message d'erreur ou le comportement inattendu observé.",
    "Indiquez les contraintes techniques ou le format de solution attendu (ex: diff, patch)."
  ],
  "detected_elements": {
    "files": ["main.py"],
    "has_error_logs": false,
    "has_code_block": false,
    "has_constraints": false
  }
}
```

#### `POST /api/prompt/optimize`
**Request Body:**
```json
{
  "prompt": "corrige le bug dans main.py quand on clique sur enregistrer",
  "preset": "debug",
  "model": "gemini-3.8-flash"
}
```
**Response Body (`PromptOptimizationResponse`):**
```json
{
  "original": "corrige le bug dans main.py quand on clique sur enregistrer",
  "optimized": "### Contexte\nUn dysfonctionnement survient dans `main.py` lors du déclenchement de l'action d'enregistrement.\n\n### Objectif\nIdentifier la cause racine et corriger le bug lié à la sauvegarde dans `main.py`.\n\n### Instructions par étapes\n1. Analyser le gestionnaire d'événement associé à l'action d'enregistrement.\n2. Vérifier la validation des données et les erreurs potentielles remontées.\n3. Appliquer le correctif minimal sans modifier le comportement attendu des autres modules.\n\n### Format de sortie attendu\nFournir un diff unifié clair ou le bloc de code corrigé accompagné d'une brève explication.",
  "preset": "debug",
  "tokens_original": 15,
  "tokens_optimized": 82,
  "improvement_factor": 1.45
}
```

---

## 4. Frontend Architecture

### 4.1 Client-Side Instant Analyzer (`frontend/src/utils/promptAnalyzer.ts`)
- Fast, zero-dependency heuristic function `calculatePromptClarity(prompt: string)` running directly inside the `ChatInput` render cycle with memoization (`useMemo`).
- Provides instantaneous visual feedback on the Wand button without inducing network latency:
  - Empty or <10 chars: neutral.
  - 10-40% score: Amber badge ("Améliorable").
  - 40-75% score: Blue badge ("Bon").
  - >75% score: Emerald badge ("Optimal").

### 4.2 Modal Studio (`frontend/src/components/PromptOptimizerModal.tsx`)
- Lazy-loaded via `React.lazy()` in `App.tsx` and `ChatInput.tsx`.
- Displays real-time breakdown bars:
  - 🎯 **Objectif** : Verbes d'action explicites (analyser, créer, corriger, implémenter).
  - 📂 **Contexte** : Chemins de fichiers, code entre backticks, logs d'erreur.
  - 🛡️ **Contraintes** : Instructions négatives ("sans casser", "strictement", "conserver").
  - 📋 **Format** : Formats de réponse souhaités (diff, markdown, étapes).
- Presets:
  - `general`: Optimisation générale et structuration AIDA/Agentic.
  - `debug`: Débogage chirurgical (reproduction, logs, correctif minimal).
  - `plan`: Planification par étapes et architecture TDD.
  - `refactor`: Refactoring propre (conservation des signatures, typage strict).
  - `review`: Revue de code critique (sécurité, performance, conventions).
- Action **"Appliquer au chat"** : insère le prompt amélioré directement dans l'état de `ChatInput` et ferme la modale.

### 4.3 Trigger Points
- `Wand2` button in `ChatInput` footer toolbar (with tooltip and optional clarity pill).
- Slash commands `/optimize` and `/metaprompt`.
- Keyboard shortcut `Ctrl+Shift+O` inside `ChatInput` textarea.

---

## 5. Security & Isolation
- No arbitrary remote calls: heuristic and template engine executes locally on the user's backend instance.
- No user tokens or private workspace paths leaked beyond standard local logging.
- Strict HTML sanitization on any previewed markdown.

---

## 6. Testing & Quality Gates
- **Pytest**: `backend/tests/test_prompt_optimizer.py` testing analysis scoring, token estimation, and optimization presets.
- **Frontend Linter**: `npx oxlint --deny-warnings src` (0 warnings, 0 errors).
- **TypeScript**: `npx tsc -b` (0 compilation errors).
- **Vite Build**: Production bundle check.
- **Chrome DevTools MCP**: Live browser validation on `http://localhost:8000/`.
