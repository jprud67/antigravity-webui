import logging
import math
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.auth import require_auth

logger = logging.getLogger("antigravity.prompt")
router = APIRouter(prefix="/api/prompt", tags=["prompt"])

# Regex patterns for heuristic detection
_FILE_RE = re.compile(
    r"(?:`([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_]+)`|\b([a-zA-Z0-9_\-\.\/]+\.(?:py|tsx?|jsx?|json|html|css|scss|md|yaml|yml|sh|rs|go|cpp|c|h|java|sql|toml))\b)",
    re.IGNORECASE
)
_ERROR_LOG_RE = re.compile(
    r"\b(?:error|exception|traceback|fail|failed|failure|erreur|crash|status of (?:500|400|404|403)|stack trace|typeerror|syntaxerror|referenceerror|attributeerror)\b",
    re.IGNORECASE
)
_CONSTRAINTS_RE = re.compile(
    r"\b(?:sans|ne pas|n'ajoute pas|n'oublie pas|do not|without|conserver|preserve|strictement|strict|doit|must|only|uniquement|sans casser|non-breaking)\b",
    re.IGNORECASE
)
_ACTION_VERBS_RE = re.compile(
    r"\b(?:corrige|corriger|créer|creer|implémente|implementer|ajoute|ajouter|optimise|optimiser|refactorise|refactorer|revoir|analyse|analyser|fix|create|implement|add|optimize|refactor|review|build|setup|inspect)\b",
    re.IGNORECASE
)
_FORMAT_RE = re.compile(
    r"\b(?:diff|patch|markdown|json|étapes|etapes|steps|liste|code complet|unifié|unifie|syntaxe)\b",
    re.IGNORECASE
)


class PromptAnalysisRequest(BaseModel):
    prompt: str


class DetectedElements(BaseModel):
    files: list[str]
    has_error_logs: bool
    has_code_block: bool
    has_constraints: bool


class BreakdownScore(BaseModel):
    context: int
    objective: int
    constraints: int
    output_format: int


class PromptAnalysisResponse(BaseModel):
    prompt: str
    word_count: int
    char_count: int
    estimated_tokens: int
    clarity_score: int
    breakdown: BreakdownScore
    suggestions: list[str]
    detected_elements: DetectedElements


class PromptOptimizationRequest(BaseModel):
    prompt: str
    preset: str | None = "general"
    model: str | None = None


class PromptOptimizationResponse(BaseModel):
    original: str
    optimized: str
    preset: str
    tokens_original: int
    tokens_optimized: int
    improvement_factor: float


def _extract_detected_files(text: str) -> list[str]:
    files = set()
    for match in _FILE_RE.finditer(text):
        f = match.group(1) or match.group(2)
        if f and not f.startswith("http://") and not f.startswith("https://"):
            files.add(f.strip("`"))
    return sorted(files)


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    words = len(text.split())
    chars = len(text)
    # Average ~3.8 chars/token in mixed code & text
    return max(words, math.ceil(chars / 3.8))


@router.post("/analyze", response_model=PromptAnalysisResponse)
async def analyze_prompt(payload: PromptAnalysisRequest, _auth=Depends(require_auth)):
    raw_prompt = (payload.prompt or "").strip()
    words = raw_prompt.split()
    word_count = len(words)
    char_count = len(raw_prompt)
    estimated_tokens = _estimate_tokens(raw_prompt)

    if not raw_prompt:
        return PromptAnalysisResponse(
            prompt="",
            word_count=0,
            char_count=0,
            estimated_tokens=0,
            clarity_score=0,
            breakdown=BreakdownScore(context=0, objective=0, constraints=0, output_format=0),
            suggestions=[
                "Saisissez une description claire de l'action souhaitée.",
                "Mentionnez les fichiers ou modules concernés.",
                "Précisez les contraintes et le résultat attendu."
            ],
            detected_elements=DetectedElements(
                files=[],
                has_error_logs=False,
                has_code_block=False,
                has_constraints=False
            )
        )

    # Detect elements
    files = _extract_detected_files(raw_prompt)
    has_error_logs = bool(_ERROR_LOG_RE.search(raw_prompt))
    has_code_block = "```" in raw_prompt or ("`" in raw_prompt and len(files) == 0)
    has_constraints = bool(_CONSTRAINTS_RE.search(raw_prompt))
    has_action = bool(_ACTION_VERBS_RE.search(raw_prompt))
    has_format = bool(_FORMAT_RE.search(raw_prompt))

    # Calculate breakdown scores (each 0 - 25)
    # 1. Context (25 pts)
    ctx_score = 0
    if len(files) > 0:
        ctx_score += 15
    if has_error_logs or has_code_block:
        ctx_score += 5
    if word_count >= 15:
        ctx_score += 5
    ctx_score = min(25, ctx_score)

    # 2. Objective (25 pts)
    obj_score = 0
    if has_action:
        obj_score += 15
    if word_count >= 5:
        obj_score += 5
    if any(q in raw_prompt.lower() for q in ["pour", "afin de", "dans le but", "to", "in order to"]):
        obj_score += 5
    obj_score = min(25, max(5 if word_count > 0 else 0, obj_score))

    # 3. Constraints (25 pts)
    cst_score = 0
    if has_constraints:
        cst_score += 20
    if "sans" in raw_prompt.lower() or "strict" in raw_prompt.lower():
        cst_score += 5
    cst_score = min(25, cst_score)

    # 4. Output format (25 pts)
    fmt_score = 0
    if has_format:
        fmt_score += 20
    if "?" in raw_prompt or ":" in raw_prompt:
        fmt_score += 5
    fmt_score = min(25, fmt_score)

    clarity_score = ctx_score + obj_score + cst_score + fmt_score

    # Suggestions based on missing criteria
    suggestions = []
    if ctx_score < 15:
        suggestions.append("Précisez les chemins de fichiers ou le code source concerné (ex: `backend/app/main.py`).")
    if obj_score < 15:
        suggestions.append("Définissez un objectif précis avec un verbe d'action clair (ex: corriger, implémenter, refactoriser).")
    if cst_score < 10:
        suggestions.append("Indiquez vos contraintes techniques (ex: sans casser les tests existants, compatibilité).")
    if fmt_score < 10:
        suggestions.append("Spécifiez le format attendu pour la réponse (ex: diff unifié, fichier complet, explication étape par étape).")

    if not suggestions:
        suggestions.append("Prompt complet et bien structuré, prêt pour une exécution optimale par l'assistant.")

    return PromptAnalysisResponse(
        prompt=raw_prompt,
        word_count=word_count,
        char_count=char_count,
        estimated_tokens=estimated_tokens,
        clarity_score=clarity_score,
        breakdown=BreakdownScore(
            context=ctx_score,
            objective=obj_score,
            constraints=cst_score,
            output_format=fmt_score
        ),
        suggestions=suggestions,
        detected_elements=DetectedElements(
            files=files,
            has_error_logs=has_error_logs,
            has_code_block=has_code_block,
            has_constraints=has_constraints
        )
    )


@router.post("/optimize", response_model=PromptOptimizationResponse)
async def optimize_prompt(payload: PromptOptimizationRequest, _auth=Depends(require_auth)):
    raw = (payload.prompt or "").strip()
    preset = (payload.preset or "general").lower().strip()
    files = _extract_detected_files(raw)

    files_mention = f" sur `{', '.join(files)}`" if files else ""
    first_file = f"`{files[0]}`" if files else "le code source"

    if preset == "debug":
        optimized = (
            f"### Contexte & Symptôme\n"
            f"Un dysfonctionnement a été identifié concernant : {raw}.\n"
            f"Périmètre : {first_file}.\n\n"
            f"### Objectif de Résolution\n"
            f"Identifier précisément la cause racine du bogue et y apporter un correctif chirurgical.\n\n"
            f"### Instructions par étapes\n"
            f"1. Analyser la trace d'erreur ou le comportement inattendu lié à ce problème.\n"
            f"2. Inspecter les fonctions et flux de données associés dans {first_file}.\n"
            f"3. Appliquer le correctif minimal sans modifier le comportement des composants adjacents.\n"
            f"4. Proposer une commande de test ou de vérification pour confirmer la résolution.\n\n"
            f"### Format de sortie attendu\n"
            f"Fournir un diff unifié des modifications accompagné d'une brève synthèse de la cause identifiée."
        )
    elif preset == "plan":
        optimized = (
            f"### Architecture Cible & Objectif\n"
            f"Concevoir et implémenter la fonctionnalité suivante : {raw}.\n\n"
            f"### Instructions par étapes & Phasage TDD\n"
            f"1. **Analyse & Spécification** : Clarifier les interfaces de données, types et dépendances requis.\n"
            f"2. **Découpage en Tâches Bite-Sized** : Structurer chaque phase (tests unitaires d'abord, implémentation minimale ensuite).\n"
            f"3. **Validation & Non-Régression** : Vérifier que l'ensemble des suites de tests existantes reste vert.\n\n"
            f"### Format de sortie attendu\n"
            f"Présenter un plan d'implémentation détaillé par phases numérotées avec les fichiers exacts à créer ou modifier."
        )
    elif preset == "refactor":
        optimized = (
            f"### Périmètre du Refactoring\n"
            f"Refactoriser et nettoyer l'implémentation existante : {raw}{files_mention}.\n\n"
            f"### Objectifs de Qualité & Dette Technique\n"
            f"- Améliorer la lisibilité, la modularité et la maintenabilité du code.\n"
            f"- Éliminer les redondances (DRY) et simplifier les flux de contrôle.\n"
            f"- Garantir un typage strict et zéro avertissement de linter.\n\n"
            f"### Règles de Préservation\n"
            f"- Conserver strictement les signatures publiques et le comportement fonctionnel actuel.\n"
            f"- Ne pas introduire de régression sur les fonctionnalités connectées.\n\n"
            f"### Format de sortie attendu\n"
            f"Fournir les modifications sous forme de diffs précis avec une justification des choix architecturaux."
        )
    elif preset == "review":
        optimized = (
            f"### Objet de la Revue Critique\n"
            f"Effectuer un audit approfondi et critique sur : {raw}{files_mention}.\n\n"
            f"### Axes d'Analyse Privilégiés\n"
            f"1. **Sécurité** : Validation des entrées, protection contre les injections, fuites d'informations.\n"
            f"2. **Performance & Efficacité** : Gestion de la mémoire, complexité algorithmique, allocations superflues.\n"
            f"3. **Architecture & Typage** : Respect des conventions du projet, typage strict, gestion des erreurs aux limites.\n\n"
            f"### Format de sortie attendu\n"
            f"Classer les retours par niveau de sévérité (Critique, Important, Suggestion) avec des propositions de code concrètes."
        )
    else:  # general
        optimized = (
            f"### Contexte\n"
            f"Demande d'intervention : {raw}{files_mention}.\n\n"
            f"### Objectif\n"
            f"Réaliser cette action de manière rigoureuse et structurée, conformément aux standards du projet.\n\n"
            f"### Instructions par étapes\n"
            f"1. Analyser le code et le contexte existant avant toute modification.\n"
            f"2. Implémenter la solution avec un code propre, modulaire et typé.\n"
            f"3. Vérifier l'absence d'erreurs de syntaxe, de linter ou de régression fonctionnelle.\n\n"
            f"### Format de sortie attendu\n"
            f"Fournir les changements appliqués de manière claire et concise."
        )

    tokens_orig = _estimate_tokens(raw)
    tokens_opt = _estimate_tokens(optimized)
    improvement_factor = round(tokens_opt / max(1, tokens_orig), 2)

    return PromptOptimizationResponse(
        original=raw,
        optimized=optimized,
        preset=preset,
        tokens_original=tokens_orig,
        tokens_optimized=tokens_opt,
        improvement_factor=improvement_factor
    )
