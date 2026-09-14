import type { ChatMessage } from '../types';

/**
 * Nettoie le texte utilisateur pour extraire la requête réelle en retirant
 * les balises XML internes injectées par agy (<USER_REQUEST>, <ADDITIONAL_METADATA>, etc.)
 */
export function cleanUserPrompt(raw: string): string {
  if (!raw) return '';

  // 1. Extraire le contenu spécifique de <USER_REQUEST>
  const requestMatch = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(raw);
  if (requestMatch) {
    return requestMatch[1].trim();
  }

  // 2. Retirer <ADDITIONAL_METADATA>...</ADDITIONAL_METADATA>
  let cleaned = raw.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');

  // 3. Retirer les autres conteneurs internes (<USER_SETTINGS_CHANGE>, <CONTEXT_SUMMARY>)
  cleaned = cleaned.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '');
  cleaned = cleaned.replace(/<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY)>/gi, '');

  return cleaned.trim();
}

/**
 * Agrège la liste brute des étapes issues du transcript.jsonl en tours de discussion (Turns)
 * cohérents, lisibles et structurés.
 *
 * Résout le problème critique de fragmentation où chaque outil et chaque sortie brute
 * devenait une bulle d'assistant isolée.
 */
export function parseStepsToMessages(steps: any[]): ChatMessage[] {
  if (!steps || !Array.isArray(steps)) return [];

  const messages: ChatMessage[] = [];
  let currentAssistantMsg: ChatMessage | null = null;

  for (let idx = 0; idx < steps.length; idx++) {
    const s = steps[idx];
    if (!s) continue;

    const src = s.source || '';
    const stype = s.type || '';
    const content = s.content || '';
    const thinking = s.thinking || '';
    const toolCallsRaw = s.tool_calls || [];
    const stepIndex = s.step_index !== undefined ? s.step_index : idx;
    const createdAt = s.created_at || s.timestamp;

    // Ignorer les historiques internes redondants
    if (stype === 'CONVERSATION_HISTORY') {
      continue;
    }

    // Checkpoint / Résumé de contexte système
    if (stype === 'CHECKPOINT') {
      if (currentAssistantMsg) {
        messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      messages.push({
        id: `checkpoint-${idx}`,
        role: 'system',
        content: content || 'Point de sauvegarde (Checkpoint)',
        stepIndex,
        timestamp: createdAt
      });
      continue;
    }

    // Message Utilisateur
    if (src === 'USER_EXPLICIT' || stype === 'USER_INPUT') {
      if (currentAssistantMsg) {
        messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }

      const cleanContent = cleanUserPrompt(content);
      messages.push({
        id: `step-user-${idx}`,
        role: 'user',
        content: cleanContent || content,
        stepIndex,
        timestamp: createdAt
      });
      continue;
    }

    // Étape Assistant / Modèle / Outil
    if (!currentAssistantMsg) {
      currentAssistantMsg = {
        id: `step-assistant-${idx}`,
        role: 'assistant',
        content: '',
        thought: '',
        toolCalls: [],
        stepIndex,
        timestamp: createdAt
      };
    }

    // Accumulation du raisonnement interne (thinking)
    if (thinking) {
      currentAssistantMsg.thought = currentAssistantMsg.thought
        ? `${currentAssistantMsg.thought}\n\n${thinking}`
        : thinking;
    }

    // Accumulation des appels d'outils
    if (toolCallsRaw.length > 0) {
      for (const tc of toolCallsRaw) {
        currentAssistantMsg.toolCalls = currentAssistantMsg.toolCalls || [];
        currentAssistantMsg.toolCalls.push({
          name: tc.name || tc.tool_name || 'tool',
          args: tc.args || tc.parameters,
          result: undefined,
          status: 'done'
        });
      }
    }

    // Traitement du résultat d'outil (type: GENERIC ou TOOL_OUTPUT)
    if (stype === 'GENERIC' || stype === 'TOOL_OUTPUT') {
      const tools = currentAssistantMsg.toolCalls || [];
      // Appairer avec le dernier outil qui n'a pas encore de résultat
      const targetTool = tools.slice().reverse().find((t) => t.result === undefined);
      if (targetTool) {
        targetTool.result = content;
      } else {
        // En l'absence d'outil en attente, n'ajouter que si c'est du vrai contenu texte assistant
        if (!tools.length && content && !currentAssistantMsg.content.includes(content)) {
          currentAssistantMsg.content = currentAssistantMsg.content
            ? `${currentAssistantMsg.content}\n\n${content}`
            : content;
        }
      }
    } else if (stype === 'PLANNER_RESPONSE') {
      if (content) {
        currentAssistantMsg.content = currentAssistantMsg.content
          ? `${currentAssistantMsg.content}\n\n${content}`
          : content;
      }
    }
  }

  if (currentAssistantMsg) {
    messages.push(currentAssistantMsg);
  }

  return messages;
}
