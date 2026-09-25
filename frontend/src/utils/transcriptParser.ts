import type { ChatMessage } from '../types';

const REQUEST_REGEX = /<USER_REQUEST(?:\s+[^>]*)?>([\s\S]*?)<\/USER_REQUEST>/gi;
const CONTEXT_SUMMARY_REGEX = /<CONTEXT_SUMMARY(?:\s+[^>]*)?>[\s\S]*?<\/CONTEXT_SUMMARY>/gi;
const XML_BLOCKS_REGEX = /<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONTEXT_SUMMARY|SKILLS|USER_INFORMATION|SYSTEM_MESSAGE|ENVIRONMENT_DETAILS|IDENTITY|SUBAGENTS|MESSAGING|CONVERSATION_TRANSCRIPT|ARTIFACTS|SLASH_COMMANDS|GUIDELINES|COMMUNICATION_STYLE|SKILL_CALL|EXTENSIONS|SYSTEM_PROMPT|PLANNER_RESPONSE|TOOL_CALL|AGENT_MODE)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/gi;
const XML_TAGS_REGEX = /<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|USER_SETTINGS_CHANGE|SKILLS|USER_INFORMATION|SYSTEM_MESSAGE|ENVIRONMENT_DETAILS|IDENTITY|SUBAGENTS|MESSAGING|CONVERSATION_TRANSCRIPT|ARTIFACTS|SLASH_COMMANDS|GUIDELINES|COMMUNICATION_STYLE|SKILL_CALL|EXTENSIONS|SYSTEM_PROMPT|PLANNER_RESPONSE|TOOL_CALL|AGENT_MODE)(?:\s+[^>]*)?>/gi;
const STEERING_PREFIX_REGEX = /^(?:⚡\s*\[(?:Guidage|Steering)\]\s*|📥\s*\[(?:En attente|Queued)\]\s*|\[(?:Instruction Prioritaire de Guidage|Priority Steering Instruction)\]\s*:?\s*)+/i;
const TASK_NOTIFY_REGEX = /Task id "([^"]+)" finished with result:\s*([\s\S]*)/i;
const SYSTEM_MESSAGE_TAG_REGEX = /<SYSTEM_MESSAGE>([\s\S]*?)<\/SYSTEM_MESSAGE>/i;
const USER_METADATA_CHECK_REGEX = /<(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|USER_SETTINGS_CHANGE|SKILLS|USER_INFORMATION|SYSTEM_MESSAGE|ENVIRONMENT_DETAILS|IDENTITY)(?:\s+[^>]*)?>/i;

const TOOL_STEP_TYPES = new Set([
  'GENERIC',
  'SYSTEM',
  'TOOL_RESULT',
  'TOOL_OUTPUT',
  'VIEW_FILE',
  'RUN_COMMAND',
  'BASH',
  'EXECUTE',
  'EXECUTE_COMMAND',
  'TERMINAL',
  'SHELL',
  'READ_FILE',
  'CODE_ACTION',
  'GREP_SEARCH',
  'LIST_DIRECTORY',
  'LIST_DIR',
  'WRITE_TO_FILE',
  'WRITE_FILE',
  'REPLACE_FILE_CONTENT',
  'EDIT_FILE',
  'SEARCH_WEB',
  'READ_URL_CONTENT',
  'FETCH_WEB_PAGE',
  'FIND_BY_NAME',
  'MANAGE_TASK',
  'SCHEDULE',
  'ASK_QUESTION',
  'INVOKE_SUBAGENT',
  'MANAGE_SUBAGENTS',
  'DEFINE_SUBAGENT',
  'GENERATE_IMAGE',
]);

const TOOL_ALIASES: Record<string, string> = {
  BASH: 'RUNCOMMAND',
  EXECUTE: 'RUNCOMMAND',
  EXECUTECOMMAND: 'RUNCOMMAND',
  SHELL: 'RUNCOMMAND',
  TERMINAL: 'RUNCOMMAND',
  READFILE: 'VIEWFILE',
  VIEW: 'VIEWFILE',
  WRITEFILE: 'WRITETOFILE',
  CREATEFILE: 'WRITETOFILE',
  EDITFILE: 'REPLACEFILECONTENT',
  EDIT: 'REPLACEFILECONTENT',
  WEBSEARCH: 'SEARCHWEB',
  FETCHWEBPAGE: 'READURLCONTENT',
};

function extractRawTextParts(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.map(extractRawTextParts).filter(Boolean).join('\n');
  }
  if (typeof val === 'object') {
    if (typeof val.text === 'string') return val.text;
    if (typeof val.content === 'string') return val.content;
    if (Array.isArray(val.content)) {
      return val.content.map(extractRawTextParts).filter(Boolean).join('\n');
    }
  }
  return '';
}

/**
 * Nettoie le texte utilisateur pour extraire la requête réelle en retirant
 * les balises XML internes injectées par agy (<USER_REQUEST>, <ADDITIONAL_METADATA>, etc.)
 */
export function cleanUserPrompt(raw: any): string {
  if (!raw) return '';

  let str = '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const extracted = extractRawTextParts(parsed);
        str = extracted || raw;
      } catch {
        str = raw;
      }
    } else {
      str = raw;
    }
  } else if (typeof raw === 'object') {
    const extracted = extractRawTextParts(raw);
    str = extracted || JSON.stringify(raw);
  } else {
    str = String(raw);
  }

  const trimmedStart = str.trimStart();
  // Optimisation de performance : court-circuiter si aucun délimiteur XML ou préfixe de guidage
  if (!trimmedStart.includes('<') && !trimmedStart.startsWith('⚡') && !trimmedStart.startsWith('📥') && !trimmedStart.startsWith('[')) {
    return trimmedStart.trimEnd();
  }

  // 1. Retirer d'abord les résumés de contexte passés pour ne pas extraire d'anciennes requêtes archivées
  const textWithoutContext = str.replace(CONTEXT_SUMMARY_REGEX, '');

  // 2. Si une balise explicite <USER_REQUEST> existe, extraire son contenu en préservant le code interne
  REQUEST_REGEX.lastIndex = 0;
  const requestMatches = [...textWithoutContext.matchAll(REQUEST_REGEX)];
  let cleaned = '';
  if (requestMatches.length > 0) {
    cleaned = requestMatches[requestMatches.length - 1][1];
  } else {
    // Repli pour les invites brutes sans balise <USER_REQUEST>
    cleaned = textWithoutContext.replace(XML_BLOCKS_REGEX, '');
    cleaned = cleaned.replace(XML_TAGS_REGEX, '');
  }

  // 3. Retirer les préfixes de guidage/file d'attente
  cleaned = cleaned.replace(STEERING_PREFIX_REGEX, '');

  return cleaned.trim();
}

/**
 * Détecte si une chaîne de contenu correspond à une sortie brute d'outil
 * pour éviter qu'elle ne fuite en tant que texte de dialogue de l'assistant.
 */
export function isToolOutputContent(content: any): boolean {
  if (!content) return false;
  let c = '';
  if (typeof content === 'string') {
    const trimmedStart = content.trimStart();
    c = trimmedStart.length > 250 ? trimmedStart.slice(0, 250) : trimmedStart;
  } else if (typeof content === 'object') {
    c = JSON.stringify(content);
  } else {
    c = String(content).trim();
  }

  return (
    c.startsWith('Created At:') ||
    c.startsWith('Completed At:') ||
    c.startsWith('File Path:') ||
    c.startsWith('The command exited with code') ||
    c.startsWith('The command exited') ||
    c.startsWith('Tool is running as a background task') ||
    c.startsWith('Encountered error in tool execution:') ||
    c.startsWith('Exit code:') ||
    c.startsWith('process terminated') ||
    c.startsWith('Process terminated') ||
    c.startsWith('Command exited with code') ||
    c.startsWith('{"File":') ||
    c.startsWith('{"status":') ||
    c.startsWith('{"event":') ||
    c.startsWith('{"step_index":') ||
    c.startsWith('{"type":') ||
    c.startsWith('[{"File":') ||
    c.startsWith('[{"status":') ||
    c.startsWith('[{"name":') ||
    c.startsWith('[{"step_index":') ||
    c.startsWith('Task id "') ||
    c.startsWith('[Active skills:') ||
    c.startsWith('Starting background task')
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
            tc.status = tc.result !== undefined ? 'done' : (currentAssistantMsg.error ? 'error' : 'cancelled');
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

    // 1b. Synthèse de continuité / Contexte transféré
    if (stype === 'CONTEXT_SUMMARY') {
      flushAssistant();
      let summaryContent = content.trim();
      if (summaryContent.startsWith('<CONTEXT_SUMMARY>') && summaryContent.endsWith('</CONTEXT_SUMMARY>')) {
        summaryContent = summaryContent.slice(17, -18).trim();
      }
      messages.push({
        id: `context-summary-${idx}`,
        role: 'system',
        subtype: 'context_summary',
        content: summaryContent || 'Synthèse du contexte de la session précédente',
        stepIndex,
        timestamp: createdAt
      });
      continue;
    }

    // 2. Message Utilisateur
    if (src === 'USER_EXPLICIT' || stype === 'USER_INPUT') {
      flushAssistant();
      const cleanContent = cleanUserPrompt(content);
      const displayContent = cleanContent || (USER_METADATA_CHECK_REGEX.test(content) ? '' : content.trim());
      if (displayContent) {
        messages.push({
          id: `step-user-${idx}`,
          role: 'user',
          content: displayContent,
          stepIndex,
          timestamp: createdAt
        });
      }
      continue;
    }

    // 3. Message d'erreur API ou d'exécution (hors erreurs d'outils traitées dans les toolCalls)
    const isToolStep = TOOL_STEP_TYPES.has(stype.toUpperCase()) || isToolOutputContent(content);
    if (stype === 'ERROR_MESSAGE' || (error && !isToolStep && toolCallsRaw.length === 0)) {
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
        currentAssistantMsg.error = currentAssistantMsg.error
          ? `${currentAssistantMsg.error}\n${errText}`
          : errText;
      }
      continue;
    }

    // 4. Notifications système / Fin de tâche en arrière-plan
    if (stype === 'SYSTEM_MESSAGE') {
      if (content.includes('finished with result:')) {
        const matchTask = TASK_NOTIFY_REGEX.exec(content);
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
        const msgMatch = SYSTEM_MESSAGE_TAG_REGEX.exec(content);
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
      const isStepError = s.status === 'ERROR' || Boolean(s.error);
      for (const tc of toolCallsRaw) {
        if (!tc || typeof tc !== 'object') continue;
        let rawArgs = tc.args || tc.parameters || tc.function?.arguments || {};
        if (typeof rawArgs === 'string') {
          try {
            rawArgs = JSON.parse(rawArgs);
          } catch {}
        }
        currentAssistantMsg.toolCalls = currentAssistantMsg.toolCalls || [];
        currentAssistantMsg.toolCalls.push({
          id: tc.id || tc.tool_call_id || tc.call_id || undefined,
          name: tc.name || tc.tool_name || tc.toolAction || tc.function?.name || 'tool',
          args: rawArgs,
          result: undefined,
          status: isStepError ? 'error' : (s.status === 'DONE' ? 'done' : 'running')
        });
      }
    }

    // Appairage de la sortie d'exécution d'un outil
    const isModelResponse = (
      stype === 'PLANNER_RESPONSE' ||
      stype === 'MODEL' ||
      stype === 'AGENT_RESPONSE' ||
      stype === 'MESSAGE' ||
      stype === 'TEXT' ||
      src === 'MODEL' ||
      src === 'ASSISTANT'
    );

    const isToolOutput = !isModelResponse && (
      TOOL_STEP_TYPES.has(stype.toUpperCase()) ||
      (!toolCallsRaw.length && !thinking && isToolOutputContent(content))
    );

    if (isToolOutput) {
      const isCommandFailure = typeof content === 'string' && (
        /The command exited with code (?!0\b)\d+/i.test(content) ||
        /Command exited with code (?!0\b)\d+/i.test(content) ||
        /Exit code: (?!0\b)\d+/i.test(content) ||
        content.startsWith('Encountered error in tool execution:') ||
        content.startsWith('Tool execution failed:') ||
        content.startsWith('process terminated with exit code')
      );
      const isErr = s.status === 'ERROR' || Boolean(s.error) || isCommandFailure;
      const outputText = content || (s.error ? String(s.error) : '');
      const tools = currentAssistantMsg.toolCalls || [];
      const toolCallId = s.tool_call_id || s.call_id;
      const cleanType = (stype || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      const isMatchingToolName = (toolName?: string) => {
        if (!toolName || !cleanType) return false;
        let normName = toolName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        let normType = cleanType;
        normName = TOOL_ALIASES[normName] || normName;
        normType = TOOL_ALIASES[normType] || normType;
        return normName.includes(normType) || normType.includes(normName);
      };

      const isGenericStepType = ['GENERIC', 'TOOLOUTPUT', 'TOOLRESULT', 'SYSTEM', ''].includes(cleanType);

      // Appairer prioritairement par ID, puis par concordance de nom, puis avec un outil anonyme en attente
      let targetTool = toolCallId
        ? tools.find((t) => t.id === toolCallId && t.result === undefined)
        : undefined;

      if (!targetTool && !isGenericStepType) {
        targetTool = tools.find((t) => t.result === undefined && isMatchingToolName(t.name));
      }

      if (!targetTool) {
        targetTool = toolCallId
          ? tools.find((t) => !t.id && t.result === undefined)
          : tools.find((t) => t.result === undefined);
      }

      if (targetTool) {
        if (!targetTool.id && toolCallId) {
          targetTool.id = toolCallId;
        }
        targetTool.result = outputText;
        targetTool.status = isErr ? 'error' : 'done';
      } else {
        // Sortie d'action implicite sans appel préalable (ex: amorce subagent)
        currentAssistantMsg.toolCalls = currentAssistantMsg.toolCalls || [];
        currentAssistantMsg.toolCalls.push({
          id: toolCallId || undefined,
          name: !['GENERIC', 'TOOL_OUTPUT', 'TOOL_RESULT', 'SYSTEM'].includes(stype.toUpperCase()) ? stype.toLowerCase() : 'action',
          args: {},
          result: outputText,
          status: isErr ? 'error' : 'done'
        });
      }
    } else if (isModelResponse || (!isToolOutput && content && !isToolOutputContent(content))) {
      // Accumuler le contenu de dialogue de l'assistant
      if (content) {
        let text = content;
        // Extraire d'éventuelles balises de raisonnement (<thinking>...</thinking>, <thought>...</thought>, <think>...</think> ou <reasoning>...</reasoning>)
        const thoughtRegex = /<(?:thinking|thought|think|reasoning)>([\s\S]*?)<\/(?:thinking|thought|think|reasoning)>/gi;
        const matches = [...text.matchAll(thoughtRegex)];
        if (matches.length > 0) {
          const thoughts = matches.map((m) => m[1].trim()).filter(Boolean).join('\n\n');
          if (thoughts) {
            currentAssistantMsg.thought = currentAssistantMsg.thought
              ? `${currentAssistantMsg.thought}\n\n${thoughts}`.trim()
              : thoughts.trim();
          }
          text = text.replace(thoughtRegex, '').trim();
        }

        if (text) {
          currentAssistantMsg.content = currentAssistantMsg.content
            ? `${currentAssistantMsg.content}\n\n${text}`.trim()
            : text.trim();
        }
      }
    }
  }

  flushAssistant();

  return messages;
}
