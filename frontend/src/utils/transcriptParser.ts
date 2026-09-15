import type { ChatMessage } from '../types';

/**
 * Nettoie le texte utilisateur pour extraire la requête réelle en retirant
 * les balises XML internes injectées par agy (<USER_REQUEST>, <ADDITIONAL_METADATA>, etc.)
 */
export function cleanUserPrompt(raw: any): string {
  if (!raw) return '';
  const str = typeof raw === 'string' ? raw : (typeof raw === 'object' ? JSON.stringify(raw) : String(raw));

  // 1. Extraire le contenu spécifique de <USER_REQUEST> s'il est présent
  const requestMatch = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(str);
  if (requestMatch) {
    return requestMatch[1].trim();
  }

  // 2. Retirer les blocs de métadonnées et paramètres système
  let cleaned = str.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');
  cleaned = cleaned.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '');
  cleaned = cleaned.replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, '');
  cleaned = cleaned.replace(/<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|USER_SETTINGS_CHANGE)>/gi, '');

  return cleaned.trim();
}

/**
 * Détecte si une chaîne de contenu correspond à une sortie brute d'outil
 * pour éviter qu'elle ne fuite en tant que texte de dialogue de l'assistant.
 */
export function isToolOutputContent(content: any): boolean {
  if (!content) return false;
  const c = typeof content === 'string' ? content.trim() : (typeof content === 'object' ? JSON.stringify(content) : String(content).trim());
  return (
    c.startsWith('Created At:') ||
    c.startsWith('Completed At:') ||
    c.startsWith('File Path:') ||
    c.startsWith('The command exited with code') ||
    c.startsWith('Tool is running as a background task') ||
    c.startsWith('Encountered error in tool execution:') ||
    c.startsWith('{"File":') ||
    c.startsWith('{"status":') ||
    c.startsWith('{"event":') ||
    c.startsWith('Task id "')
  );
}

/**
 * Agrège la liste brute des étapes issues de transcript.jsonl en tours de discussion (Turns)
 * ultra-propres, cohérents et agrémentés de métadonnées d'état.
 */
export function parseStepsToMessages(steps: any[]): ChatMessage[] {
  if (!steps || !Array.isArray(steps)) return [];

  const messages: ChatMessage[] = [];
  let currentAssistantMsg: ChatMessage | null = null;

  const flushAssistant = () => {
    if (currentAssistantMsg) {
      if (currentAssistantMsg.toolCalls) {
        for (const tc of currentAssistantMsg.toolCalls) {
          if (tc.status === 'running') {
            tc.status = 'done';
          }
        }
      }
      const hasTools = (currentAssistantMsg.toolCalls?.length || 0) > 0;
      const hasThought = Boolean(currentAssistantMsg.thought?.trim());
      const hasContent = Boolean(currentAssistantMsg.content?.trim());
      const hasError = Boolean(currentAssistantMsg.error?.trim());

      if (hasContent || hasTools || hasThought || hasError) {
        messages.push(currentAssistantMsg);
      }
      currentAssistantMsg = null;
    }
  };

  for (let idx = 0; idx < steps.length; idx++) {
    const s = steps[idx];
    if (!s) continue;

    const src = s.source || '';
    const stype = s.type || '';
    const rawContent = s.content;
    const content = typeof rawContent === 'string' ? rawContent : (rawContent != null ? (typeof rawContent === 'object' ? JSON.stringify(rawContent, null, 2) : String(rawContent)) : '');
    const rawThinking = s.thinking;
    const thinking = typeof rawThinking === 'string' ? rawThinking : (rawThinking != null ? (typeof rawThinking === 'object' ? JSON.stringify(rawThinking, null, 2) : String(rawThinking)) : '');
    const toolCallsRaw = s.tool_calls || [];
    const stepIndex = s.step_index !== undefined ? s.step_index : idx;
    const createdAt = s.created_at || s.timestamp;
    const rawError = s.error;
    const error = typeof rawError === 'string' ? rawError : (rawError != null ? String(rawError) : '');

    // Ignorer les historiques internes redondants
    if (stype === 'CONVERSATION_HISTORY' || stype === 'DIRECTORY_RULES') {
      continue;
    }

    // 1. Point de restauration (Checkpoint)
    if (stype === 'CHECKPOINT') {
      flushAssistant();
      messages.push({
        id: `checkpoint-${idx}`,
        role: 'system',
        subtype: 'checkpoint',
        content: content || 'Point de sauvegarde (Checkpoint)',
        stepIndex,
        timestamp: createdAt
      });
      continue;
    }

    // 2. Message Utilisateur
    if (src === 'USER_EXPLICIT' || stype === 'USER_INPUT') {
      flushAssistant();
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

    // 3. Message d'erreur API ou d'exécution
    if (stype === 'ERROR_MESSAGE' || error) {
      const errText = error || content || 'Une erreur est survenue lors du traitement de la requête.';
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          id: `step-assistant-${idx}`,
          role: 'assistant',
          content: '',
          thought: '',
          toolCalls: [],
          error: errText,
          stepIndex,
          timestamp: createdAt
        };
      } else {
        currentAssistantMsg.error = errText;
      }
      continue;
    }

    // 4. Notifications système / Fin de tâche en arrière-plan
    if (stype === 'SYSTEM_MESSAGE') {
      if (content.includes('finished with result:')) {
        const matchTask = /Task id "([^"]+)" finished with result:\s*([\s\S]*)/i.exec(content);
        const taskId = matchTask ? matchTask[1] : 'Tâche';
        const taskResult = matchTask ? matchTask[2].trim() : content;
        flushAssistant();
        messages.push({
          id: `task-notify-${idx}`,
          role: 'system',
          subtype: 'task',
          taskId,
          content: taskResult,
          stepIndex,
          timestamp: createdAt
        });
        continue;
      } else {
        // Extraire le message système réel en retirant le préambule d'antigravity
        let sysText = content;
        const msgMatch = /<SYSTEM_MESSAGE>([\s\S]*?)<\/SYSTEM_MESSAGE>/i.exec(content);
        if (msgMatch) {
          sysText = msgMatch[1].trim();
        }
        if (sysText.trim()) {
          flushAssistant();
          messages.push({
            id: `system-notify-${idx}`,
            role: 'system',
            subtype: 'system',
            content: sysText.trim(),
            stepIndex,
            timestamp: createdAt
          });
          continue;
        }
      }
    }

    // 5. Initialisation du tour assistant si absent
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
        ? `${currentAssistantMsg.thought}\n\n${thinking}`.trim()
        : thinking.trim();
    }

    // Accumulation des appels d'outils
    if (toolCallsRaw.length > 0) {
      for (const tc of toolCallsRaw) {
        if (!tc || typeof tc !== 'object') continue;
        currentAssistantMsg.toolCalls = currentAssistantMsg.toolCalls || [];
        currentAssistantMsg.toolCalls.push({
          name: tc.name || tc.tool_name || 'tool',
          args: tc.args || tc.parameters || {},
          result: undefined,
          status: s.status === 'DONE' ? 'done' : 'running'
        });
      }
    }

    // Appairage de la sortie d'exécution d'un outil
    const isToolOutput = (
      ['GENERIC', 'TOOL_OUTPUT', 'VIEW_FILE', 'RUN_COMMAND', 'CODE_ACTION', 'GREP_SEARCH', 'LIST_DIRECTORY'].includes(stype) ||
      (!toolCallsRaw.length && !thinking && isToolOutputContent(content))
    );

    if (isToolOutput) {
      const tools = currentAssistantMsg.toolCalls || [];
      // Appairer avec le premier outil en attente de résultat (FIFO)
      const targetTool = tools.find((t) => t.result === undefined);
      if (targetTool) {
        targetTool.result = content;
        targetTool.status = 'done';
      } else {
        // Sortie d'action implicite sans appel préalable (ex: amorce subagent)
        currentAssistantMsg.toolCalls = currentAssistantMsg.toolCalls || [];
        currentAssistantMsg.toolCalls.push({
          name: stype !== 'GENERIC' && stype !== 'TOOL_OUTPUT' ? stype.toLowerCase() : 'action',
          args: {},
          result: content,
          status: 'done'
        });
      }
    } else if (
      stype === 'PLANNER_RESPONSE' ||
      stype === 'MODEL' ||
      stype === 'AGENT_RESPONSE' ||
      stype === 'MESSAGE' ||
      stype === 'TEXT' ||
      src === 'MODEL' ||
      src === 'ASSISTANT'
    ) {
      // N'accumuler que du vrai contenu de dialogue
      if (content && !isToolOutputContent(content)) {
        currentAssistantMsg.content = currentAssistantMsg.content
          ? `${currentAssistantMsg.content}\n\n${content}`.trim()
          : content.trim();
      }
    }
  }

  flushAssistant();

  return messages;
}
