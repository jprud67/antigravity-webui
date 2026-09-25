import { useState, useEffect } from 'react';

export interface LanguageOption {
  code: string;
  label: string;
  speech: string;
  flag?: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'fr', label: 'Français', speech: 'fr-FR', flag: '🇫🇷' },
  { code: 'en', label: 'English', speech: 'en-US', flag: '🇺🇸' },
  { code: 'es', label: 'Español', speech: 'es-ES', flag: '🇪🇸' },
  { code: 'de', label: 'Deutsch', speech: 'de-DE', flag: '🇩🇪' },
  { code: 'it', label: 'Italiano', speech: 'it-IT', flag: '🇮🇹' },
  { code: 'pt', label: 'Português', speech: 'pt-BR', flag: '🇧🇷' },
  { code: 'zh', label: '简体中文', speech: 'zh-CN', flag: '🇨🇳' },
  { code: 'zh-Hant', label: '繁體中文', speech: 'zh-TW', flag: '🇹🇼' },
  { code: 'ja', label: '日本語', speech: 'ja-JP', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', speech: 'ko-KR', flag: '🇰🇷' },
  { code: 'ru', label: 'Русский', speech: 'ru-RU', flag: '🇷🇺' },
  { code: 'tr', label: 'Türkçe', speech: 'tr-TR', flag: '🇹🇷' },
  { code: 'pl', label: 'Polski', speech: 'pl-PL', flag: '🇵🇱' },
  { code: 'cs', label: 'Čeština', speech: 'cs-CZ', flag: '🇨🇿' },
  { code: 'vi', label: 'Tiếng Việt', speech: 'vi-VN', flag: '🇻🇳' },
];

let LOCALES: Record<string, Record<string, string>> = {};

// Asynchronously load the locales file to avoid blocking HMR and main bundle load
if (typeof window !== 'undefined') {
  fetch('/locales.json')
    .then(res => {
      if (!res.ok) return null;
      return res.json();
    })
    .then(data => {
      if (data && typeof data === 'object') {
        LOCALES = data;
        // Trigger re-render for active listeners once loaded
        setTimeout(() => {
          LISTENERS.forEach((fn) => fn(currentLanguage));
        }, 100);
      }
    })
    .catch(() => {
      // Fallback silently to embedded UI_TRANSLATIONS
    });
}


export const UI_TRANSLATIONS: Record<string, Record<string, string>> = {
  dictation_recording: {
    en: 'Live Voice Dictation Studio',
    fr: 'Studio Dictée Vocale en direct',
    es: 'Estudio de Dictado de Voz',
    de: 'Live-Sprachdiktat-Studio',
  },
  confirm_dictation: {
    en: 'Accept dictation and keep text',
    fr: 'Valider la dictée et garder le texte',
    es: 'Validar dictado y conservar texto',
    de: 'Diktat bestätigen und Text behalten',
  },
  cancel_dictation: {
    en: 'Cancel dictation and restore previous prompt',
    fr: 'Annuler la dictée et restaurer le prompt initial',
    es: 'Cancelar dictado y restaurar prompt original',
    de: 'Diktat abbrechen und vorherigen Prompt wiederherstellen',
  },
  transcript_detected: {
    en: 'Transcribing:',
    fr: 'En cours :',
    es: 'Detectado:',
    de: 'Erkannt:',
  },
  eco_mode_label: {
    en: 'Eco Mode',
    fr: 'Mode Éco',
    es: 'Modo Eco',
    de: 'Öko-Modus',
  },
  eco_mode_tooltip_on: {
    en: 'Eco Mode active (minimal effort & token-saving directives)',
    fr: 'Mode Éco actif (effort minimal et directives d\'économie de tokens)',
  },
  eco_mode_tooltip_off: {
    en: 'Eco Mode off (click to activate)',
    fr: 'Mode Éco désactivé (cliquer pour activer)',
  },
  eco_mode_activated: {
    en: '🍃 Eco Mode active: minimal thinking effort and token saving rules applied.',
    fr: '🍃 Mode Éco activé : effort minimal et consignes d\'économie de tokens appliquées.',
  },
  eco_mode_deactivated: {
    en: '⚡ Eco Mode disabled: normal performance restored.',
    fr: '⚡ Mode Éco désactivé : performances standard rétablies.',
  },
  eco_mode_setting_title: {
    en: 'Default Eco Mode for new sessions',
    fr: 'Mode Éco par défaut',
  },
  eco_mode_setting_desc: {
    en: 'Automatically apply token-saving directives and minimal thinking effort to conserve quotas.',
    fr: 'Applique automatiquement les consignes de sobriété de tokens et un effort minimal pour préserver vos quotas.',
  },
  heavy_file_warning: {
    en: '⚠️ Large file ({0} KB / ~{1} tokens). In Eco Mode, consider providing only relevant excerpts.',
    fr: '⚠️ Fichier lourd ({0} Ko / ~{1} tokens). En mode Éco, pensez à ne transmettre que l\'extrait pertinent.',
  },
  loop_warning_banner_title: {
    en: 'Error Loop Detected',
    fr: 'Boucle d\'erreurs détectée',
  },
  loop_warning_banner_desc: {
    en: 'The agent encountered {0} consecutive failures without progress. Stop or steer to prevent token inflation.',
    fr: 'L\'agent a rencontré {0} échecs consécutifs sans progresser. Interrompez ou réorientez pour stopper l\'inflation de tokens.',
  },
  btn_stop_loop: {
    en: 'Stop Agent',
    fr: 'Stopper',
  },
  btn_steer_loop: {
    en: 'Steer Agent',
    fr: 'Réorienter',
  },
  context_heavy_warning: {
    en: 'Heavy context: future turns will consume increasing tokens.',
    fr: 'Contexte lourd : les prochains tours réinjecteront un volume élevé de tokens.',
  },
  btn_new_chat_purge: {
    en: 'New chat (Purge context)',
    fr: 'Nouvelle conversation (Purger)',
  },
  aux_bar_files: {
    en: 'Explorer & Files',
    fr: 'Explorateur & Fichiers',
  },
  aux_bar_changes: {
    en: 'Changes & Diffs',
    fr: 'Modifications & Diffs',
  },
  aux_bar_artifacts: {
    en: 'Live Artifacts',
    fr: 'Artéfacts en direct',
  },
  aux_bar_terminal: {
    en: 'Integrated Terminal',
    fr: 'Terminal intégré',
  },
  aux_bar_kanban: {
    en: 'Task Kanban',
    fr: 'Kanban des tâches',
  },
  aux_bar_toggle_collapse: {
    en: 'Toggle auxiliary panel (Ctrl+B)',
    fr: 'Basculer le volet auxiliaire (Ctrl+B)',
  },
  code_lens_run_terminal: {
    en: 'Run in terminal',
    fr: 'Exécuter dans le terminal',
  },
  code_lens_open_editor: {
    en: 'Open in editor',
    fr: 'Ouvrir dans l\'éditeur',
  },
  code_lens_copy: {
    en: 'Copy code',
    fr: 'Copier',
  },
  code_lens_copied: {
    en: 'Copied!',
    fr: 'Copié !',
  },
  new_conversation: {
    en: 'New Conversation',
    fr: 'Nouvelle conversation',
    es: 'Nueva conversación',
    de: 'Neue Unterhaltung',
    it: 'Nuova conversazione',
    pt: 'Nova conversa',
    zh: '新对话',
    'zh-Hant': '新對話',
    ja: '新しい会話',
    ko: '새 대화',
    ru: 'Новый разговор',
    tr: 'Yeni Konuşma',
    pl: 'Nowa rozmowa',
    cs: 'Nová konverzace',
    vi: 'Cuộc trò chuyện mới',
  },
  new_session: {
    en: 'New session',
    fr: 'Nouvelle session',
    es: 'Nueva sesión',
    de: 'Neue Sitzung',
    it: 'Nuova sessione',
    pt: 'Nova sessão',
    zh: '新建会话',
    'zh-Hant': '新建會話',
    ja: '新しいセッション',
    ko: '새 세션',
    ru: 'Новая сессия',
    tr: 'Yeni oturum',
    pl: 'Nowa sesja',
    cs: 'Nová relace',
    vi: 'Phiên mới',
  },
  send: {
    en: 'Send',
    fr: 'Envoyer',
    es: 'Enviar',
    de: 'Senden',
    it: 'Invia',
    pt: 'Enviar',
    zh: '发送',
    'zh-Hant': '發送',
    ja: '送信',
    ko: '보내기',
    ru: 'Отправить',
    tr: 'Gönder',
    pl: 'Wyślij',
    cs: 'Odeslat',
    vi: 'Gửi',
  },
  stop: {
    en: 'Stop',
    fr: 'Arrêter',
    es: 'Detener',
    de: 'Stoppen',
    it: 'Interrompi',
    pt: 'Parar',
    zh: '停止',
    'zh-Hant': '停止',
    ja: '停止',
    ko: '중지',
    ru: 'Остановить',
    tr: 'Durdur',
    pl: 'Zatrzymaj',
    cs: 'Zastavit',
    vi: 'Dừng lại',
  },
  steer: {
    en: 'Steer',
    fr: 'Orienter',
    es: 'Orientar',
    de: 'Steuern',
    it: 'Guida',
    pt: 'Orientar',
    zh: '引导',
    'zh-Hant': '引導',
    ja: '指示',
    ko: '조정',
    ru: 'Направить',
    tr: 'Yönlendir',
    pl: 'Kieruj',
    cs: 'Řídit',
    vi: 'Điều hướng',
  },
  queue: {
    en: 'Queue',
    fr: 'En attente',
    es: 'En cola',
    de: 'Warteschlange',
    it: 'In coda',
    pt: 'Na fila',
    zh: '排队',
    'zh-Hant': '排隊',
    ja: 'キュー',
    ko: '대기열',
    ru: 'В очереди',
    tr: 'Kuyruğa al',
    pl: 'W kolejce',
    cs: 'Do fronty',
    vi: 'Hàng đợi',
  },
  thinking: {
    en: 'Thinking...',
    fr: 'Réflexion en cours...',
    es: 'Pensando...',
    de: 'Nachdenken...',
    it: 'Riflessione in corso...',
    pt: 'Pensando...',
    zh: '正在思考...',
    'zh-Hant': '正在思考...',
    ja: '思考中...',
    ko: '생각하는 중...',
    ru: 'Размышление...',
    tr: 'Düşünüyor...',
    pl: 'Myślenie...',
    cs: 'Přemýšlím...',
    vi: 'Đang suy nghĩ...',
  },
  internal_reasoning: {
    en: 'Internal Reasoning',
    fr: 'Raisonnement interne',
    es: 'Razonamiento interno',
    de: 'Interne Überlegung',
    it: 'Ragionamento interno',
    pt: 'Raciocínio interno',
    zh: '内部推理',
    'zh-Hant': '內部推理',
    ja: '内部推論',
    ko: '내부 추론',
    ru: 'Внутреннее рассуждение',
    tr: 'Dahili Akıl Yürütme',
    pl: 'Wewnętrzne rozumowanie',
    cs: 'Vnitřní uvažování',
    vi: 'Lập luận nội bộ',
  },
  active_workspace: {
    en: 'Active Workspace',
    fr: 'Workspace actif',
    es: 'Espacio de trabajo activo',
    de: 'Aktiver Arbeitsbereich',
    it: 'Spazio di lavoro attivo',
    pt: 'Espaço de trabalho ativo',
    zh: '当前工作区',
    'zh-Hant': '當前工作區',
    ja: 'アクティブなワークスペース',
    ko: '활성 워크스페이스',
    ru: 'Активная рабочая область',
    tr: 'Etkin Çalışma Alanı',
    pl: 'Aktywny obszar roboczy',
    cs: 'Aktivní pracovní prostor',
    vi: 'Không gian làm việc',
  },
  settings: {
    en: 'Settings',
    fr: 'Paramètres',
    es: 'Configuración',
    de: 'Einstellungen',
    it: 'Impostazioni',
    pt: 'Configurações',
    zh: '设置',
    'zh-Hant': '設定',
    ja: '設定',
    ko: '설정',
    ru: 'Настройки',
    tr: 'Ayarlar',
    pl: 'Ustawienia',
    cs: 'Nastavení',
    vi: 'Cài đặt',
  },
  language: {
    en: 'Language',
    fr: 'Langue',
    es: 'Idioma',
    de: 'Sprache',
    it: 'Lingua',
    pt: 'Idioma',
    zh: '语言',
    'zh-Hant': '語言',
    ja: '言語',
    ko: '언어',
    ru: 'Язык',
    tr: 'Dil',
    pl: 'Język',
    cs: 'Jazyk',
    vi: 'Ngôn ngữ',
  },
  copy: {
    en: 'Copy',
    fr: 'Copier',
    es: 'Copiar',
    de: 'Kopieren',
    it: 'Copia',
    pt: 'Copiar',
    zh: '复制',
    'zh-Hant': '複製',
    ja: 'コピー',
    ko: '복사',
    ru: 'Копировать',
    tr: 'Kopyala',
    pl: 'Kopiuj',
    cs: 'Kopírovat',
    vi: 'Sao chép',
  },
  copied: {
    en: 'Copied!',
    fr: 'Copié !',
    es: '¡Copiado!',
    de: 'Kopiert!',
    it: 'Copiato!',
    pt: 'Copiado!',
    zh: '已复制！',
    'zh-Hant': '已複製！',
    ja: 'コピー完了！',
    ko: '복사됨!',
    ru: 'Скопировано!',
    tr: 'Kopyalandı!',
    pl: 'Skopiowano!',
    cs: 'Zkopírováno!',
    vi: 'Đã sao chép!',
  },
  fork: {
    en: 'Branch',
    fr: 'Bifurquer',
    es: 'Ramificar',
    de: 'Verzweigen',
    it: 'Biforca',
    pt: 'Ramificar',
    zh: '分支',
    'zh-Hant': '分支',
    ja: '分岐',
    ko: '브랜치',
    ru: 'Ветвление',
    tr: 'Dallandır',
    pl: 'Rozgałęź',
    cs: 'Větvit',
    vi: 'Phân nhánh',
  },
  listen: {
    en: 'Listen',
    fr: 'Écouter',
    es: 'Escuchar',
    de: 'Anhören',
    it: 'Ascolta',
    pt: 'Ouvir',
    zh: '朗读',
    'zh-Hant': '朗讀',
    ja: '読み上げ',
    ko: '듣기',
    ru: 'Слушать',
    tr: 'Dinle',
    pl: 'Słuchaj',
    cs: 'Poslouchat',
    vi: 'Nghe',
  },
  search_placeholder: {
    en: 'Search sessions & content...',
    fr: 'Rechercher sessions & contenu...',
    es: 'Buscar sesiones y contenido...',
    de: 'Sitzungen & Inhalt durchsuchen...',
    it: 'Cerca sessioni e contenuti...',
    pt: 'Pesquisar sessões e conteúdo...',
    zh: '搜索会话与内容...',
    'zh-Hant': '搜尋對話與內容...',
    ja: 'セッションと内容を検索...',
    ko: '세션 및 내용 검색...',
    ru: 'Поиск сессий и контента...',
    tr: 'Oturumları ve içeriği ara...',
    pl: 'Szukaj sesji i zawartości...',
    cs: 'Hledat relace a obsah...',
    vi: 'Tìm kiếm phiên & nội dung...',
  },
  composer_placeholder: {
    en: 'Ask a question or type / for commands...',
    fr: 'Posez une question ou tapez / pour les commandes...',
    es: 'Haga una pregunta o escriba / para comandos...',
    de: 'Stellen Sie eine Frage oder tippen Sie / für Befehle...',
    it: 'Fai una domanda o digita / per i comandi...',
    pt: 'Faça uma pergunta ou digite / para comandos...',
    zh: '输入问题或键入 / 查看命令...',
    'zh-Hant': '輸入問題或鍵入 / 查看命令...',
    ja: '質問を入力するか、/ でコマンドを表示...',
    ko: '질문을 입력하거나 / 를 입력하여 명령어를 확인하세요...',
    ru: 'Задайте вопрос или введите / для команд...',
    tr: 'Bir soru sorun veya komutlar için / yazın...',
    pl: 'Zadaj pytanie lub wpisz / aby zobaczyć polecenia...',
    cs: 'Zeptejte se nebo napište / pro příkazy...',
    vi: 'Đặt câu hỏi hoặc nhập / để xem lệnh...',
  },
  effort_high: {
    en: 'Effort: High',
    fr: 'Effort : Haut',
    es: 'Esfuerzo: Alto',
    de: 'Aufwand: Hoch',
    it: 'Sforzo: Alto',
    pt: 'Esforço: Alto',
    zh: '思考力度：高',
    'zh-Hant': '思考力度：高',
    ja: '思考レベル: 高',
    ko: '추론 노력: 높음',
    ru: 'Усилие: Высокое',
    tr: 'Çaba: Yüksek',
    pl: 'Wysiłek: Wysoki',
    cs: 'Úsilí: Vysoké',
    vi: 'Nỗ lực: Cao',
  },
  effort_medium: {
    en: 'Effort: Medium',
    fr: 'Effort : Moyen',
    es: 'Esfuerzo: Medio',
    de: 'Aufwand: Mittel',
    it: 'Sforzo: Medio',
    pt: 'Esforço: Médio',
    zh: '思考力度：中',
    'zh-Hant': '思考力度：中',
    ja: '思考レベル: 中',
    ko: '추론 노력: 중간',
    ru: 'Усилие: Среднее',
    tr: 'Çaba: Orta',
    pl: 'Wysiłek: Średni',
    cs: 'Úsilí: Střední',
    vi: 'Nỗ lực: Trung bình',
  },
  effort_low: {
    en: 'Effort: Low',
    fr: 'Effort : Faible',
    es: 'Esfuerzo: Bajo',
    de: 'Aufwand: Niedrig',
    it: 'Sforzo: Basso',
    pt: 'Esforço: Baixo',
    zh: '思考力度：低',
    'zh-Hant': '思考力度：低',
    ja: '思考レベル: 低',
    ko: '추론 노력: 낮음',
    ru: 'Усилие: Низкое',
    tr: 'Çaba: Düşük',
    pl: 'Wysiłek: Niski',
    cs: 'Úsilí: Nízké',
    vi: 'Nỗ lực: Thấp',
  },
  today: {
    en: 'Today',
    fr: "Aujourd'hui",
    es: 'Hoy',
    de: 'Heute',
    it: 'Oggi',
    pt: 'Hoje',
    zh: '今天',
    'zh-Hant': '今天',
    ja: '今日',
    ko: '오늘',
    ru: 'Сегодня',
    tr: 'Bugün',
    pl: 'Dzisiaj',
    cs: 'Dnes',
    vi: 'Hôm nay',
  },
  yesterday: {
    en: 'Yesterday',
    fr: 'Hier',
    es: 'Ayer',
    de: 'Gestern',
    it: 'Ieri',
    pt: 'Ontem',
    zh: '昨天',
    'zh-Hant': '昨天',
    ja: '昨日',
    ko: '어제',
    ru: 'Вчера',
    tr: 'Dün',
    pl: 'Wczoraj',
    cs: 'Včera',
    vi: 'Hôm qua',
  },
  last_7_days: {
    en: 'Last 7 days',
    fr: '7 derniers jours',
    es: 'Últimos 7 días',
    de: 'Letzte 7 Tage',
    it: 'Ultimi 7 giorni',
    pt: 'Últimos 7 dias',
    zh: '最近 7 天',
    'zh-Hant': '最近 7 天',
    ja: '過去 7 日間',
    ko: '지난 7일',
    ru: 'Последние 7 дней',
    tr: 'Son 7 gün',
    pl: 'Ostatnie 7 dni',
    cs: 'Posledních 7 dní',
    vi: '7 ngày qua',
  },
  this_month: {
    en: 'This month',
    fr: 'Ce mois-ci',
    es: 'Este mes',
    de: 'Diesen Monat',
    it: 'Questo mese',
    pt: 'Este mês',
    zh: '本月',
    'zh-Hant': '本月',
    ja: '今月',
    ko: '이번 달',
    ru: 'В этом месяце',
    tr: 'Bu ay',
    pl: 'W tym miesiącu',
    cs: 'Tento měsíc',
    vi: 'Tháng này',
  },
  older: {
    en: 'Older',
    fr: 'Plus ancien',
    es: 'Más antiguo',
    de: 'Älter',
    it: 'Più vecchio',
    pt: 'Mais antigo',
    zh: '更早',
    'zh-Hant': '更早',
    ja: '以前',
    ko: '이전',
    ru: 'Более старые',
    tr: 'Daha eski',
    pl: 'Starsze',
    cs: 'Starší',
    vi: 'Cũ hơn',
  },
  archives: {
    en: 'Archives',
    fr: 'Archives',
    es: 'Archivos',
    de: 'Archiv',
    it: 'Archivi',
    pt: 'Arquivos',
    zh: '归档',
    'zh-Hant': '封存',
    ja: 'アーカイブ',
    ko: '보관함',
    ru: 'Архивы',
    tr: 'Arşivler',
    pl: 'Archiwum',
    cs: 'Archivy',
    vi: 'Lưu trữ',
  },
  pinned_section: {
    en: 'Pinned',
    fr: 'Épinglées',
    es: 'Fijadas',
    de: 'Angepinnt',
    it: 'Fissate',
    pt: 'Fixadas',
    zh: '置顶',
    'zh-Hant': '釘選',
    ja: '固定',
    ko: '고정됨',
    ru: 'Закрепленные',
    tr: 'Sabitlenenler',
    pl: 'Przypięte',
    cs: 'Připnuté',
    vi: 'Đã ghim',
  },
  tasks_and_subagents: {
    en: 'Tasks & Subagents',
    fr: 'Tâches & Sous-agents',
    es: 'Tareas y Subagentes',
    de: 'Aufgaben & Subagenten',
    it: 'Attività e Sottoagenti',
    pt: 'Tarefas e Subagentes',
    zh: '任务与子智能体',
    'zh-Hant': '任務與子智能體',
    ja: 'タスクとサブエージェント',
    ko: '작업 및 서브에이전트',
    ru: 'Задачи и субагенты',
    tr: 'Görevler ve Alt Ajanlar',
    pl: 'Zadania i podagenci',
    cs: 'Úkoly a podagenti',
    vi: 'Nhiệm vụ & Tác nhân phụ',
  },
  documents_and_artifacts: {
    en: 'Documents & Artifacts',
    fr: 'Documents & Artifacts',
    es: 'Documentos y Artefactos',
    de: 'Dokumente & Artefakte',
    it: 'Documenti e Artefatti',
    pt: 'Documentos e Artefatos',
    zh: '文档与成果物',
    'zh-Hant': '文檔與產出物',
    ja: 'ドキュメントとアーティファクト',
    ko: '문서 및 아티팩트',
    ru: 'Документы и артефакты',
    tr: 'Belgeler ve Eserler',
    pl: 'Dokumenty i artefakty',
    cs: 'Dokumenty a artefakty',
    vi: 'Tài liệu & Thành phần',
  },
  logout: {
    en: 'Logout',
    fr: 'Déconnexion',
    es: 'Cerrar sesión',
    de: 'Abmelden',
    it: 'Disconnetti',
    pt: 'Sair',
    zh: '退出登录',
    'zh-Hant': '登出',
    ja: 'ログアウト',
    ko: '로그아웃',
    ru: 'Выйти',
    tr: 'Çıkış yap',
    pl: 'Wyloguj',
    cs: 'Odhlásit',
    vi: 'Đăng xuất',
  },
  explore_files_tooltip: {
    en: 'Explore and insert files (/files)',
    fr: 'Explorer et insérer des fichiers (/files)',
    es: 'Explorar e insertar archivos (/files)',
    de: 'Dateien durchsuchen und einfügen (/files)',
    it: 'Esplora e inserisci file (/files)',
    pt: 'Explorar e inserir arquivos (/files)',
    zh: '浏览并插入文件 (/files)',
    'zh-Hant': '瀏覽並插入檔案 (/files)',
    ja: 'ファイルを探索して挿入 (/files)',
    ko: '파일 탐색 및 삽입 (/files)',
    ru: 'Обзор и вставка файлов (/files)',
    tr: 'Dosyaları incele ve ekle (/files)',
    pl: 'Przeglądaj i wstaw pliki (/files)',
    cs: 'Prozkoumat a vložit soubory (/files)',
    vi: 'Khám phá và chèn tệp (/files)',
  },
  workspace_switch_tooltip: {
    en: 'Active workspace. Click to switch (/workspace)',
    fr: 'Workspace actif. Cliquer pour changer (/workspace)',
    es: 'Espacio de trabajo activo. Haga clic para cambiar (/workspace)',
    de: 'Aktiver Arbeitsbereich. Klicken zum Wechseln (/workspace)',
    it: 'Spazio di lavoro attivo. Clicca per cambiare (/workspace)',
    pt: 'Espaço de trabalho ativo. Clique para alterar (/workspace)',
    zh: '当前工作区。点击切换 (/workspace)',
    'zh-Hant': '當前工作區。點擊切換 (/workspace)',
    ja: 'アクティブなワークスペース。クリックして変更 (/workspace)',
    ko: '활성 워크스페이스. 전환하려면 클릭 (/workspace)',
    ru: 'Активная рабочая область. Нажмите для смены (/workspace)',
    tr: 'Etkin çalışma alanı. Değiştirmek için tıklayın (/workspace)',
    pl: 'Aktywny obszar roboczy. Kliknij, aby zmienić (/workspace)',
    cs: 'Aktivní pracovní prostor. Klikněte pro změnu (/workspace)',
    vi: 'Không gian làm việc. Nhấp để chuyển đổi (/workspace)',
  },
  help: {
    en: 'Help & Shortcuts',
    fr: 'Aide & Raccourcis',
    es: 'Ayuda y Atajos',
    de: 'Hilfe & Tastenkürzel',
    it: 'Aiuto e Scorciatoie',
    pt: 'Ajuda e Atalhos',
    zh: '帮助与快捷键',
    'zh-Hant': '幫助與快捷鍵',
    ja: 'ヘルプとショートカット',
    ko: '도움말 및 단축키',
    ru: 'Помощь и горячие клавиши',
    tr: 'Yardım ve Kısayollar',
    pl: 'Pomoc i skróty',
    cs: 'Nápověda a zkratky',
    vi: 'Trợ giúp & Phím tắt',
  },
  live: {
    en: 'Live',
    fr: 'En direct',
    es: 'En vivo',
    de: 'Live',
    it: 'Dal vivo',
    pt: 'Ao vivo',
    zh: '实时',
    'zh-Hant': '即時',
    ja: 'ライブ',
    ko: '실시간',
    ru: 'В прямом эфире',
    tr: 'Canlı',
    pl: 'Na żywo',
    cs: 'Živě',
    vi: 'Trực tiếp',
  },
  running: {
    en: 'running...',
    fr: 'en cours...',
    es: 'en progreso...',
    de: 'läuft...',
    it: 'in corso...',
    pt: 'em andamento...',
    zh: '运行中...',
    'zh-Hant': '執行中...',
    ja: '実行中...',
    ko: '실행 중...',
    ru: 'выполняется...',
    tr: 'çalışıyor...',
    pl: 'w toku...',
    cs: 'běží...',
    vi: 'đang chạy...',
  },
  done: {
    en: 'done',
    fr: 'terminé',
    es: 'terminado',
    de: 'abgeschlossen',
    it: 'fatto',
    pt: 'concluído',
    zh: '已完成',
    'zh-Hant': '已完成',
    ja: '完了',
    ko: '완료',
    ru: 'готово',
    tr: 'tamamlandı',
    pl: 'ukończono',
    cs: 'hotovo',
    vi: 'hoàn thành',
  },
  error: {
    en: 'error',
    fr: 'erreur',
    es: 'error',
    de: 'Fehler',
    it: 'errore',
    pt: 'erro',
    zh: '错误',
    'zh-Hant': '錯誤',
    ja: 'エラー',
    ko: '오류',
    ru: 'ошибка',
    tr: 'hata',
    pl: 'błąd',
    cs: 'chyba',
    vi: 'lỗi',
  },
  step: {
    en: 'Step',
    fr: 'Étape',
    es: 'Paso',
    de: 'Schritt',
    it: 'Passaggio',
    pt: 'Etapa',
    zh: '步骤',
    'zh-Hant': '步驟',
    ja: 'ステップ',
    ko: '단계',
    ru: 'Шаг',
    tr: 'Adım',
    pl: 'Krok',
    cs: 'Krok',
    vi: 'Bước',
  },
  export: {
    en: 'Export',
    fr: 'Exporter',
    es: 'Exportar',
    de: 'Exportieren',
    it: 'Esporta',
    pt: 'Exportar',
    zh: '导出',
    'zh-Hant': '匯出',
    ja: 'エクスポート',
    ko: '내보내기',
    ru: 'Экспорт',
    tr: 'Dışa Aktar',
    pl: 'Eksportuj',
    cs: 'Exportovat',
    vi: 'Xuất',
  },
  how_can_i_help: {
    en: 'How can I help you today?',
    fr: 'Que puis-je faire pour vous ?',
    es: '¿Cómo puedo ayudarte hoy?',
    de: 'Wie kann ich Ihnen heute helfen?',
    it: 'Come posso aiutarti oggi?',
    pt: 'Como posso ajudar você hoje?',
    zh: '今天有什么我可以帮您的？',
    'zh-Hant': '今天有什麼我可以幫您的？',
    ja: 'どのようなお手伝いができますか？',
    ko: '무엇을 도와드릴까요?',
    ru: 'Чем я могу вам помочь?',
    tr: 'Bugün size nasıl yardımcı olabilirim?',
    pl: 'W czym mogę Ci dzisiaj pomóc?',
    cs: 'Jak vám mohu dnes pomoci?',
    vi: 'Tôi có thể giúp gì cho bạn hôm nay?',
  },
  welcome_subtitle: {
    en: 'Ask a question, run commands, explore files, or schedule autonomous tasks without opening a terminal.',
    fr: 'Posez une question, lancez des commandes, explorez vos fichiers ou planifiez des tâches autonomes sans ouvrir de terminal.',
    es: 'Haga una pregunta, ejecute comandos, explore archivos o programe tareas autónomas sin abrir una terminal.',
    de: 'Stellen Sie eine Frage, führen Sie Befehle aus, erkunden Sie Dateien oder planen Sie autonome Aufgaben ohne Terminal.',
    it: 'Fai una domanda, esegui comandi, esplora file o pianifica attività autonome senza aprire un terminale.',
    pt: 'Faça uma pergunta, execute comandos, explore arquivos ou agende tarefas autônomas sem abrir um terminal.',
    zh: '无需打开终端即可提问、运行命令、浏览文件或编排自主任务。',
    'zh-Hant': '無需打開終端機即可提問、執行命令、瀏覽檔案或排程自主任務。',
    ja: 'ターミナルを開かずに、質問、コマンド実行、ファイル探索、自律タスクのスケジュールが可能です。',
    ko: '터미널을 열지 않고도 질문하고, 명령을 실행하고, 파일을 탐색하거나 자율 작업을 예약하세요.',
    ru: 'Задавайте вопросы, выполняйте команды, исследуйте файлы или планируйте автономные задачи без терминала.',
    tr: 'Terminal açmadan soru sorun, komutlar çalıştırın, dosyaları keşfedin veya özerk görevler planlayın.',
    pl: 'Zadawaj pytania, wykonuj polecenia, przeglądaj pliki lub planuj autonomiczne zadania bez otwierania terminala.',
    cs: 'Ptejte se, spouštějte příkazy, procházejte soubory nebo plánujte autonomní úlohy bez otevření terminálu.',
    vi: 'Đặt câu hỏi, chạy lệnh, khám phá tệp hoặc lên lịch các tác vụ tự động mà không cần mở terminal.',
  },
  search_sessions: {
    en: 'Search sessions & content...',
    fr: 'Rechercher sessions & contenu...',
    es: 'Buscar sesiones y contenido...',
    de: 'Sitzungen & Inhalt durchsuchen...',
    it: 'Cerca sessioni e contenuti...',
    pt: 'Pesquisar sessões e conteúdo...',
    zh: '搜索会话与内容...',
    'zh-Hant': '搜尋對話與內容...',
    ja: 'セッションと内容を検索...',
    ko: '세션 및 내용 검색...',
    ru: 'Поиск сессий и контента...',
    tr: 'Oturumları ve içeriği ara...',
    pl: 'Szukaj sesji i zawartości...',
    cs: 'Hledat relace a obsah...',
    vi: 'Tìm kiếm phiên & nội dung...',
  },
  file_browser: {
    en: 'Attach files or explore workspace (/files)',
    fr: 'Attacher des fichiers ou explorer le workspace (/files)',
    es: 'Adjuntar archivos o explorar espacio de trabajo (/files)',
    de: 'Dateien anhängen oder Arbeitsbereich erkunden (/files)',
    it: 'Allega file o esplora lo spazio di lavoro (/files)',
    pt: 'Anexar arquivos ou explorar espaço de trabalho (/files)',
    zh: '附加文件或浏览工作区 (/files)',
    'zh-Hant': '附加檔案或瀏覽工作區 (/files)',
    ja: 'ファイルを添付またはワークスペースを探索 (/files)',
    ko: '파일 첨부 또는 워크스페이스 탐색 (/files)',
    ru: 'Прикрепить файлы или исследовать рабочую область (/files)',
    tr: 'Dosya ekle veya çalışma alanını keşfet (/files)',
    pl: 'Załącz pliki lub przeglądaj obszar roboczy (/files)',
    cs: 'Připojit soubory nebo prozkoumat pracovní prostor (/files)',
    vi: 'Đính kèm tệp hoặc khám phá không gian làm việc (/files)',
  },
  voice_dictation: {
    en: 'Enable voice dictation (Microphone)',
    fr: 'Activer la dictée vocale (Microphone)',
    es: 'Activar dictado por voz (Micrófono)',
    de: 'Sprachdiktat aktivieren (Mikrofon)',
    it: 'Attiva dettatura vocale (Microfono)',
    pt: 'Ativar ditado de voz (Microfone)',
    zh: '启用语音听写（麦克风）',
    'zh-Hant': '啟用語音聽寫（麥克風）',
    ja: '音声入力を有効にする（マイク）',
    ko: '음성 받아쓰기 활성화 (마이크)',
    ru: 'Включить голосовой ввод (Микрофон)',
    tr: 'Sesli dikteyi etkinleştir (Mikrofon)',
    pl: 'Włącz dyktowanie głosowe (Mikrofon)',
    cs: 'Aktivovat hlasové diktování (Mikrofon)',
    vi: 'Bật đọc chính tả bằng giọng nói (Micrô)',
  },
  stop_voice: {
    en: 'Stop voice dictation',
    fr: 'Arrêter la dictée vocale',
    es: 'Detener dictado por voz',
    de: 'Sprachdiktat beenden',
    it: 'Interrompi dettatura vocale',
    pt: 'Parar ditado de voz',
    zh: '停止语音听写',
    'zh-Hant': '停止語音聽寫',
    ja: '音声入力を停止',
    ko: '음성 받아쓰기 중지',
    ru: 'Остановить голосовой ввод',
    tr: 'Sesli dikteyi durdur',
    pl: 'Zatrzymaj dyktowanie głosowe',
    cs: 'Zastavit hlasové diktování',
    vi: 'Dừng đọc chính tả bằng giọng nói',
  },
  workspace_explorer: {
    en: 'Workspace Explorer',
    fr: 'Explorateur Workspace',
    es: 'Explorador de espacio de trabajo',
    de: 'Arbeitsbereich-Explorer',
    it: 'Esploratore dello spazio di lavoro',
    pt: 'Explorador do espaço de trabalho',
    zh: '工作区资源管理器',
    'zh-Hant': '工作區檔案總管',
    ja: 'ワークスペースエクスプローラー',
    ko: '워크스페이스 탐색기',
    ru: 'Проводник рабочей области',
    tr: 'Çalışma Alanı Gezgini',
    pl: 'Eksplorator obszaru roboczego',
    cs: 'Průzkumník pracovního prostoru',
    vi: 'Trình khám phá không gian làm việc',
  },
  plan_card_desc: {
    en: 'Establish a step-by-step architecture plan',
    fr: "Établir un plan d'architecture par étapes",
    es: 'Establecer un plan de arquitectura paso a paso',
    de: 'Einen schrittweisen Architekturplan erstellen',
    it: 'Stabilire un piano di architettura passo dopo passo',
    pt: 'Estabelecer um plano de arquitetura passo a passo',
    zh: '建立分步架构计划',
    'zh-Hant': '建立逐步架構計劃',
    ja: '段階的なアーキテクチャ計画を策定',
    ko: '단계별 아키텍처 계획 수립',
    ru: 'Составить пошаговый архитектурный план',
    tr: 'Adım adım mimari plan oluşturun',
    pl: 'Ustal krok po kroku plan architektury',
    cs: 'Sestavte postupný plán architektury',
    vi: 'Thiết lập kế hoạch kiến trúc từng bước',
  },
  goal_card_desc: {
    en: 'Assign a deep autonomous objective',
    fr: 'Assigner un objectif autonome approfondi',
    es: 'Asignar un objetivo autónomo profundo',
    de: 'Ein tiefgehendes autonomes Ziel zuweisen',
    it: 'Assegna un obiettivo autonomo approfondito',
    pt: 'Atribuir um objetivo autônomo profundo',
    zh: '分配深度自主目标',
    'zh-Hant': '分配深度自主任務',
    ja: '深層的な自律目標を割り当てる',
    ko: '심층 자율 목표 할당',
    ru: 'Назначить глубокую автономную цель',
    tr: 'Derinlemesine özerk bir hedef atayın',
    pl: 'Przypisz głęboki cel autonomiczny',
    cs: 'Přiřaďte hluboký autonomní cíl',
    vi: 'Giao mục tiêu tự trị chuyên sâu',
  },
  inspect_code_title: {
    en: 'Inspect Code',
    fr: 'Inspecter le Code',
    es: 'Inspeccionar código',
    de: 'Code untersuchen',
    it: 'Ispeziona codice',
    pt: 'Inspecionar código',
    zh: '检查代码',
    'zh-Hant': '檢查程式碼',
    ja: 'コードを検査',
    ko: '코드 검사',
    ru: 'Инспектировать код',
    tr: 'Kodu incele',
    pl: 'Zbadaj kod',
    cs: 'Zkontrolovat kód',
    vi: 'Kiểm tra mã nguồn',
  },
  inspect_code_desc: {
    en: 'Analyze structure and detect bugs',
    fr: 'Analyser la structure et détecter les bugs',
    es: 'Analizar la estructura y detectar errores',
    de: 'Struktur analysieren und Fehler erkennen',
    it: 'Analizza la struttura e rileva bug',
    pt: 'Analisar estrutura e detectar bugs',
    zh: '分析结构并检测错误',
    'zh-Hant': '分析結構並檢測錯誤',
    ja: '構造を分析しバグを検出',
    ko: '구조를 분석하고 버그를 감지합니다',
    ru: 'Анализ структуры и выявление ошибок',
    tr: 'Yapıyı analiz edin ve hataları tespit edin',
    pl: 'Analizuj strukturę i wykrywaj błędy',
    cs: 'Analyzovat strukturu a detekovat chyby',
    vi: 'Phân tích cấu trúc và phát hiện lỗi',
  },
  status_cancelled: {
    en: 'Cancelled',
    fr: 'Annulé',
    es: 'Cancelado',
    de: 'Abgebrochen',
    it: 'Annullato',
    pt: 'Cancelado',
    zh: '已取消',
    'zh-Hant': '已取消',
    ja: 'キャンセル',
    ko: '취소됨',
    ru: 'Отменено',
    tr: 'İptal edildi',
    pl: 'Anulowano',
    cs: 'Zrušeno',
    vi: 'Đã hủy',
  },
  status_card_desc: {
    en: 'Check services and system health',
    fr: 'Vérifier les services et la santé du système',
    es: 'Verificar servicios y salud del sistema',
    de: 'Dienste und Systemzustand prüfen',
    it: 'Verifica servizi e stato del sistema',
    pt: 'Verificar serviços e integridade do sistema',
    zh: '检查服务和系统运行状况',
    'zh-Hant': '檢查服務與系統運行狀況',
    ja: 'サービスとシステムの正常性を確認',
    ko: '서비스 및 시스템 상태 확인',
    ru: 'Проверить службы и состояние системы',
    tr: 'Hizmetleri ve sistem durumunu kontrol edin',
    pl: 'Sprawdź usługi i stan systemu',
    cs: 'Zkontrolovat služby a stav systému',
    vi: 'Kiểm tra dịch vụ và tình trạng hệ thống',
  },
  discussions: {
    en: 'Discussions',
    fr: 'Discussions',
    es: 'Conversaciones',
    de: 'Diskussionen',
    it: 'Discussioni',
    pt: 'Discussões',
    zh: '讨论',
    'zh-Hant': '討論',
    ja: 'ディスカッション',
    ko: '대화 목록',
    ru: 'Обсуждения',
    tr: 'Tartışmalar',
    pl: 'Dyskusje',
    cs: 'Diskuze',
    vi: 'Các cuộc trò chuyện',
  },
  tools_and_extensions: {
    en: 'Tools & Extensions',
    fr: 'Outils & Extensions',
    es: 'Herramientas y extensiones',
    de: 'Werkzeuge & Erweiterungen',
    it: 'Strumenti ed estensioni',
    pt: 'Ferramentas e Extensões',
    zh: '工具与扩展',
    'zh-Hant': '工具與擴充功能',
    ja: 'ツールと拡張機能',
    ko: '도구 및 확장 기능',
    ru: 'Инструменты и расширения',
    tr: 'Araçlar ve Uzantılar',
    pl: 'Narzędzia i rozszerzenia',
    cs: 'Nástroje a rozšíření',
    vi: 'Công cụ & Tiện ích mở rộng',
  },
  git_manager_title: {
    en: 'Git Manager (/git)',
    fr: 'Gestionnaire Git (/git)',
    es: 'Gestor Git (/git)',
    de: 'Git-Manager (/git)',
    it: 'Gestore Git (/git)',
    pt: 'Gerenciador Git (/git)',
    zh: 'Git 管理器 (/git)',
    'zh-Hant': 'Git 管理員 (/git)',
    ja: 'Git マネージャー (/git)',
    ko: 'Git 관리자 (/git)',
    ru: 'Git-менеджер (/git)',
    tr: 'Git Yöneticisi (/git)',
    pl: 'Menedżer Git (/git)',
    cs: 'Správce Git (/git)',
    vi: 'Quản lý Git (/git)',
  },
  prompt_history_tooltip: {
    en: 'Prompt history (Keys ↑ / ↓ in input)',
    fr: 'Historique des prompts (Touches ↑ / ↓ dans le terminal)',
    es: 'Historial de prompts (Teclas ↑ / ↓ en el campo)',
    de: 'Prompt-Verlauf (Tasten ↑ / ↓ im Eingabefeld)',
    it: 'Cronologia dei prompt (Tasti ↑ / ↓ nel campo)',
    pt: 'Histórico de prompts (Teclas ↑ / ↓ no campo)',
    zh: '提示历史 (输入框按 ↑ / ↓)',
    'zh-Hant': '提示歷史 (輸入框按 ↑ / ↓)',
    ja: 'プロンプト履歴 (入力欄で ↑ / ↓)',
    ko: '프롬프트 기록 (입력창에서 ↑ / ↓)',
    ru: 'История промптов (Клавиши ↑ / ↓ в поле)',
    tr: 'Komut istemi geçmişi (Giriş alanında ↑ / ↓ tuşları)',
    pl: 'Historia promptów (Klawisze ↑ / ↓ w polu)',
    cs: 'Historie promptů (Klávesy ↑ / ↓ v poli)',
    vi: 'Lịch sử lời nhắc (Phím ↑ / ↓ trong ô nhập)',
  },
  workspace_click_to_change: {
    en: 'Workspace: {0} (Click to change)',
    fr: 'Workspace : {0} (Cliquer pour changer)',
    es: 'Espacio de trabajo: {0} (Clic para cambiar)',
    de: 'Arbeitsbereich: {0} (Klicken zum Ändern)',
    it: 'Spazio di lavoro: {0} (Fai clic per modificare)',
    pt: 'Espaço de trabalho: {0} (Clique para mudar)',
    zh: '工作区: {0} (点击更改)',
    'zh-Hant': '工作區: {0} (點擊更改)',
    ja: 'ワークスペース: {0} (クリックして変更)',
    ko: '워크스페이스: {0} (클릭하여 변경)',
    ru: 'Рабочая область: {0} (Нажмите, чтобы изменить)',
    tr: 'Çalışma alanı: {0} (Değiştirmek için tıklayın)',
    pl: 'Obszar roboczy: {0} (Kliknij, aby zmienić)',
    cs: 'Pracovní prostor: {0} (Klikněte pro změnu)',
    vi: 'Không gian làm việc: {0} (Nhấp để thay đổi)',
  },
  forked_session_hint: {
    en: 'Session forked from a branch',
    fr: "Session issue d'une bifurcation (branche)",
    es: 'Sesión derivada de una rama',
    de: 'Sitzung von einem Zweig abgezweigt',
    it: 'Sessione diramata da un branch',
    pt: 'Sessão bifurcada de uma ramificação',
    zh: '来自分支的会话',
    'zh-Hant': '來自分支的會話',
    ja: 'ブランチから分岐したセッション',
    ko: '브랜치에서 파생된 세션',
    ru: 'Сессия, ответвленная от ветки',
    tr: 'Bir daldan çatallanan oturum',
    pl: 'Sesja rozwidlona z gałęzi',
    cs: 'Relace rozvětvená z větve',
    vi: 'Phiên phân nhánh từ một nhánh',
  },
  help_and_shortcuts: {
    en: 'Help & Shortcuts (/help)',
    fr: 'Aide & Raccourcis (/help)',
    es: 'Ayuda y atajos (/help)',
    de: 'Hilfe & Tastenkürzel (/help)',
    it: 'Guida e scorciatoie (/help)',
    pt: 'Ajuda e Atalhos (/help)',
    zh: '帮助与快捷键 (/help)',
    'zh-Hant': '說明與快速鍵 (/help)',
    ja: 'ヘルプとショートカット (/help)',
    ko: '도움말 및 단축키 (/help)',
    ru: 'Справка и горячие клавиши (/help)',
    tr: 'Yardım ve Kısayollar (/help)',
    pl: 'Pomoc i skróty (/help)',
    cs: 'Nápověda a zkratky (/help)',
    vi: 'Trợ giúp & Phím tắt (/help)',
  },
  bulk_tag_placeholder: {
    en: 'e.g. frontend, release-v2, bugfix',
    fr: 'ex : frontend, release-v2, bugfix',
    es: 'ej: frontend, release-v2, corrección',
    de: 'z.B. frontend, release-v2, bugfix',
    it: 'es: frontend, release-v2, bugfix',
    pt: 'ex: frontend, release-v2, bugfix',
    zh: '例如：frontend, release-v2, bugfix',
    'zh-Hant': '例如：frontend, release-v2, bugfix',
    ja: '例: frontend, release-v2, bugfix',
    ko: '예: frontend, release-v2, bugfix',
    ru: 'например: frontend, release-v2, bugfix',
    tr: 'ör: frontend, release-v2, bugfix',
    pl: 'np. frontend, release-v2, bugfix',
    cs: 'např. frontend, release-v2, bugfix',
    vi: 'vd: frontend, release-v2, bugfix',
  },
  bulk_project_placeholder: {
    en: 'e.g. LeadForge, E-Commerce, Refactor',
    fr: 'ex : LeadForge, E-Commerce, Refactor',
    es: 'ej: LeadForge, E-Commerce, Refactorización',
    de: 'z.B. LeadForge, E-Commerce, Refactor',
    it: 'es: LeadForge, E-Commerce, Refactoring',
    pt: 'ex: LeadForge, E-Commerce, Refatoração',
    zh: '例如：LeadForge, E-Commerce, Refactor',
    'zh-Hant': '例如：LeadForge, E-Commerce, Refactor',
    ja: '例: LeadForge, E-Commerce, Refactor',
    ko: '예: LeadForge, E-Commerce, Refactor',
    ru: 'например: LeadForge, E-Commerce, Refactor',
    tr: 'ör: LeadForge, E-Commerce, Refactor',
    pl: 'np. LeadForge, E-Commerce, Refactor',
    cs: 'např. LeadForge, E-Commerce, Refactor',
    vi: 'vd: LeadForge, E-Commerce, Refactor',
  },
  project_name: {
    en: 'Project name:',
    fr: 'Nom du projet :',
    es: 'Nombre del proyecto:',
    de: 'Projektname:',
    it: 'Nome del progetto:',
    pt: 'Nome do projeto:',
    zh: '项目名称：',
    'zh-Hant': '專案名稱：',
    ja: 'プロジェクト名：',
    ko: '프로젝트 이름:',
    ru: 'Название проекта:',
    tr: 'Proje adı:',
    pl: 'Nazwa projektu:',
    cs: 'Název projektu:',
    vi: 'Tên dự án:',
  },
  refresh: {
    en: 'Refresh',
    fr: 'Actualiser',
    es: 'Actualizar',
    de: 'Aktualisieren',
    it: 'Aggiorna',
    pt: 'Atualizar',
    zh: '刷新',
    'zh-Hant': '重新整理',
    ja: '更新',
    ko: '새로고침',
    ru: 'Обновить',
    tr: 'Yenile',
    pl: 'Odśwież',
    cs: 'Obnovit',
    vi: 'Làm mới',
  },
  close: {
    en: 'Close',
    fr: 'Fermer',
    es: 'Cerrar',
    de: 'Schließen',
    it: 'Chiudi',
    pt: 'Fechar',
    zh: '关闭',
    'zh-Hant': '關閉',
    ja: '閉じる',
    ko: '닫기',
    ru: 'Закрыть',
    tr: 'Kapat',
    pl: 'Zamknij',
    cs: 'Zavřít',
    vi: 'Đóng',
  },
  toast_reasoning_effort_current: {
    en: 'Current effort: {0}. Choices: low, medium, high',
    fr: 'Effort actuel : {0}. Choix: low, medium, high',
    es: 'Esfuerzo actual: {0}. Opciones: low, medium, high',
    de: 'Aktueller Aufwand: {0}. Auswahl: low, medium, high',
    it: 'Sforzo attuale: {0}. Scelte: low, medium, high',
    pt: 'Esforço atual: {0}. Escolhas: low, medium, high',
    zh: '当前思考程度：{0}。可选：low, medium, high',
    'zh-Hant': '目前思考程度：{0}。可選：low, medium, high',
    ja: '現在の推論深度: {0}。選択肢: low, medium, high',
    ko: '현재 추론 깊이: {0}. 선택: low, medium, high',
    ru: 'Текущий уровень рассуждений: {0}. Варианты: low, medium, high',
    tr: 'Mevcut akıl yürütme: {0}. Seçenekler: low, medium, high',
    pl: 'Bieżący wysiłek: {0}. Opcje: low, medium, high',
    cs: 'Aktuální úsilí: {0}. Možnosti: low, medium, high',
    vi: 'Nỗ lực hiện tại: {0}. Lựa chọn: low, medium, high',
  },
  toast_workspace_active: {
    en: 'Active workspace: {0}',
    fr: 'Workspace actif : {0}',
    es: 'Espacio de trabajo activo: {0}',
    de: 'Aktiver Arbeitsbereich: {0}',
    it: 'Area di lavoro attiva: {0}',
    pt: 'Espaço de trabalho ativo: {0}',
    zh: '当前工作区：{0}',
    'zh-Hant': '目前工作區：{0}',
    ja: 'アクティブなワークスペース: {0}',
    ko: '활성 워크스페이스: {0}',
    ru: 'Активная рабочая область: {0}',
    tr: 'Etkin çalışma alanı: {0}',
    pl: 'Aktywna przestrzeń robocza: {0}',
    cs: 'Aktivní pracovní prostor: {0}',
    vi: 'Không gian làm việc đang hoạt động: {0}',
  },

  approve: {
    en: 'Approve',
    fr: 'Approuver',
  },
  approved_devices_title: {
    en: 'Authorized Devices & Channels',
    fr: 'Appareils & Canaux Autorisés',
  },
  canvas_code_editor: {
    en: 'HTML / JS Source Code',
    fr: 'Code Source HTML / JS',
  },
  canvas_create_first: {
    en: 'Create your first widget',
    fr: 'Créer votre premier widget',
  },
  canvas_delete_confirm: {
    en: 'Permanently delete this Canvas?',
    fr: 'Supprimer définitivement ce Canvas ?',
  },
  canvas_doc_title_placeholder: {
    en: 'Widget title...',
    fr: 'Titre du widget...',
  },
  canvas_filter_placeholder: {
    en: 'Search canvas documents...',
    fr: 'Filtrer les documents canvas...',
  },
  canvas_live_preview: {
    en: 'Live Sandboxed Preview',
    fr: 'Aperçu Isolé en Direct',
  },
  canvas_no_docs: {
    en: 'No canvas documents yet.',
    fr: 'Aucun document canvas pour le moment.',
  },
  canvas_open_tab: {
    en: 'Open in new tab',
    fr: 'Ouvrir dans un nouvel onglet',
  },
  canvas_save_btn: {
    en: 'Save Canvas',
    fr: 'Enregistrer Canvas',
  },
  canvas_saved_success: {
    en: 'Canvas Saved!',
    fr: 'Canvas Enregistré !',
  },
  canvas_saving: {
    en: 'Saving...',
    fr: 'Enregistrement...',
  },
  canvas_studio_desc: {
    en: 'Sandboxed iframe web widgets with live theme bridge and auto-resize.',
    fr: 'Widgets React/HTML isolés dans iframe sandboxed avec bridge de thème et auto-resize.',
  },
  canvas_studio_title: {
    en: 'Living Canvas & Interactive Documents',
    fr: 'Canvas Vivant & Documents Interactifs',
  },
  canvas_tab_gallery: {
    en: 'Gallery ({0})',
    fr: 'Galerie ({0})',
  },
  canvas_tab_studio: {
    en: 'Interactive Studio',
    fr: 'Studio Interactif',
  },
  canvas_template_select: {
    en: 'Template...',
    fr: 'Modèle...',
  },
  collapse_studios: {
    en: 'Collapse Studios',
    fr: 'Réduire les studios',
  },
  continuous_memory_desc: {
    en: 'Persistent knowledge injected as an immutable snapshot without breaking LLM prompt caching.',
    fr: 'Connaissances persistantes injectées en snapshot immuable sans rompre le cache de prompt.',
  },
  continuous_memory_title: {
    en: 'Curated Continuous Memory',
    fr: 'Mémoire Continue Curatée',
  },
  copied_to_clipboard: {
    en: 'Copied to clipboard!',
    fr: 'Copié dans le presse-papier !',
  },
  default_chat_id_label: {
    en: 'Default Chat ID / Channel ID',
    fr: 'Chat ID / Channel ID par défaut',
  },
  delete_permanently: {
    en: 'Force Delete',
    fr: 'Supprimer',
  },
  device_revoked: {
    en: 'Paired device revoked',
    fr: 'Appareil appairé révoqué',
  },
  devices_registered: {
    en: 'registered device(s)',
    fr: 'appareil(s) enregistré(s)',
  },
  disable_serve: {
    en: 'Disable HTTPS Serve',
    fr: 'Désactiver Serve HTTPS',
  },
  disconnected: {
    en: 'Disconnected',
    fr: 'Déconnecté',
  },
  discord_bot_token_label: {
    en: 'Discord Bot Token (from Discord Dev Portal)',
    fr: 'Token Bot Discord (obtenu via Discord Dev Portal)',
  },
  discord_channel_id_label: {
    en: 'Default Discord Channel ID',
    fr: 'Channel ID Discord par défaut',
  },
  discord_config_saved: {
    en: 'Discord configuration saved',
    fr: 'Configuration Discord enregistrée',
  },
  discord_notify_approval_label: {
    en: 'Send approval requests with Yes/No buttons',
    fr: 'Envoyer les demandes d\'approbation avec boutons',
  },
  discord_notify_complete_label: {
    en: 'Send task completion summaries',
    fr: 'Envoyer les résumés de fin de tâche',
  },
  discord_token_required: {
    en: 'Discord bot token is required',
    fr: 'Le token du bot Discord est requis',
  },
  docker_action_remove: {
    en: 'Remove',
    fr: 'Supprimer',
  },
  docker_action_restart: {
    en: 'Restart',
    fr: 'Redémarrer',
  },
  docker_action_start: {
    en: 'Start',
    fr: 'Démarrer',
  },
  docker_action_stop: {
    en: 'Stop',
    fr: 'Arrêter',
  },
  docker_compose_active: {
    en: 'Compose Available',
    fr: 'Compose Disponible',
  },
  docker_compose_down_btn: {
    en: 'Compose Down',
    fr: 'Arrêter Compose Down',
  },
  docker_compose_up_btn: {
    en: 'Compose Up',
    fr: 'Lancer Compose Up',
  },
  docker_daemon_active: {
    en: 'Docker Daemon Operational',
    fr: 'Démon Docker Opérationnel',
  },
  docker_daemon_inactive: {
    en: 'Docker Daemon Offline / Not Installed',
    fr: 'Démon Docker Hors-Ligne / Non Installé',
  },
  docker_detected_files: {
    en: 'Detected Docker & Compose Configurations',
    fr: 'Fichiers Docker & Compose Détectés',
  },
  docker_exec_btn: {
    en: 'Run Command',
    fr: 'Exécuter',
  },
  docker_exec_command_placeholder: {
    en: 'Command to run (e.g. ls -la, python --version)...',
    fr: 'Commande à exécuter (ex: ls -la, python --version)...',
  },
  docker_logs_tail_label: {
    en: 'Tail lines:',
    fr: 'Lignes :',
  },
  docker_no_containers: {
    en: 'No Docker containers found.',
    fr: 'Aucun conteneur Docker détecté.',
  },
  docker_refresh: {
    en: 'Refresh',
    fr: 'Actualiser',
  },
  docker_studio_desc: {
    en: 'Inspect, manage containers, execute commands, view logs, and orchestrate Docker Compose services directly from Antigravity.',
    fr: 'Inspectez, gérez vos conteneurs, exécutez des commandes, consultez les logs et orchestrez Docker Compose directement depuis Antigravity.',
  },
  docker_studio_title: {
    en: 'Docker & Container Management Studio',
    fr: 'Studio de Gestion Docker & Conteneurs',
  },
  docker_tab_compose: {
    en: 'Compose & Workspace',
    fr: 'Compose & Projet',
  },
  docker_tab_containers: {
    en: 'Containers ({0})',
    fr: 'Conteneurs ({0})',
  },
  docker_tab_logs: {
    en: 'Logs & Console',
    fr: 'Logs & Console',
  },
  doctor_checks_title: {
    en: 'Diagnostic Checks ({0})',
    fr: 'Points de Contrôle ({0})',
  },
  doctor_cpu_usage: {
    en: 'CPU Utilization',
    fr: 'Utilisation CPU',
  },
  doctor_desc: {
    en: 'Hardware telemetry, SQLite database integrity, Git health, and real-time LLM API probes.',
    fr: 'Monitoring matériel, intégrité SQLite, statut Git et connectivité temps réel des API LLM.',
  },
  doctor_disk_free: {
    en: 'Free Disk Space',
    fr: 'Espace Disque Libre',
  },
  doctor_hardware_telemetry: {
    en: 'Hardware & OS Telemetry',
    fr: 'Télémétrie Matériel & OS',
  },
  doctor_memory_ram: {
    en: 'RAM Usage',
    fr: 'Mémoire Vive (RAM)',
  },
  doctor_no_issues: {
    en: 'All subsystem checks passed with zero warnings.',
    fr: 'Tous les points de contrôle sont validés sans avertissement.',
  },
  doctor_recheck_btn: {
    en: 'Recheck Diagnostics',
    fr: 'Réanalyser',
  },
  doctor_repair_success: {
    en: 'Auto-Doctor: repairs applied successfully!',
    fr: 'Auto-Doctor : réparations appliquées avec succès !',
  },
  doctor_repairing: {
    en: 'Repairing System...',
    fr: 'Réparation en cours...',
  },
  doctor_run_repair_btn: {
    en: 'Run Auto-Doctor Repair',
    fr: 'Lancer Auto-Doctor Réparation',
  },
  doctor_status_critical: {
    en: 'Critical Issue',
    fr: 'Anomalie Critique',
  },
  doctor_status_healthy: {
    en: 'Operational & Healthy',
    fr: 'Opérationnel & Sain',
  },
  doctor_status_warning: {
    en: 'Warning Detected',
    fr: 'Avertissement Détecté',
  },
  doctor_title: {
    en: 'System Diagnostics & Auto-Doctor',
    fr: 'Diagnostics Système & Auto-Doctor',
  },
  enable_on_device: {
    en: 'Enable Push on this Device',
    fr: 'Activer Push sur cet appareil',
  },
  enable_serve: {
    en: 'Enable HTTPS Serve',
    fr: 'Activer Serve HTTPS',
  },
  encryption_wireguard_hint: {
    en: 'Private WireGuard tunnel: traffic never transits through third-party servers.',
    fr: 'Tunnel WireGuard privé : le trafic ne transite jamais par des serveurs tiers.',
  },
  enter_pairing_code: {
    en: 'Enter 6-digit code...',
    fr: 'Saisir le code à 6 chiffres...',
  },
  expand_studios: {
    en: 'Show all tools and studios ({0})',
    fr: 'Afficher tous les outils et studios ({0})',
  },
  expires_after_1h: {
    en: 'Expires in 1 hour',
    fr: 'Expire après 1 heure',
  },
  expires_in_minutes: {
    en: 'Expires in {0}m',
    fr: 'Expire dans {0} min',
  },
  finalize: {
    en: 'Finalize / Prune',
    fr: 'Finaliser / Prune',
  },
  finalize_hint: {
    en: 'Safely removes worktree if no uncommitted or unmerged changes exist',
    fr: 'Supprime en toute sécurité si aucun commit non fusionné n\'est présent',
  },
  fts_filter_all: {
    en: 'All Messages',
    fr: 'Tous les messages',
  },
  fts_filter_assistant: {
    en: 'Assistant Only',
    fr: 'Assistant uniquement',
  },
  fts_filter_user: {
    en: 'User Only',
    fr: 'Utilisateur uniquement',
  },
  fts_jump_to_discussion: {
    en: 'Open discussion',
    fr: 'Ouvrir la discussion',
  },
  fts_no_results: {
    en: 'No messages match your query.',
    fr: 'Aucun message ne correspond à votre recherche.',
  },
  fts_reindex_btn: {
    en: 'Rebuild FTS Index',
    fr: 'Reconstruire l\'index FTS',
  },
  fts_reindexing: {
    en: 'Reindexing...',
    fr: 'Réindexation...',
  },
  fts_results_count: {
    en: '{0} match(es) in {1} ms',
    fr: '{0} résultat(s) en {1} ms',
  },
  fts_search_placeholder: {
    en: 'Search through all chat messages, code blocks, and tool results...',
    fr: 'Rechercher dans tous les messages, blocs de code et résultats d\'outils...',
  },
  fts_search_title: {
    en: 'Full-Text Search across Discussions (FTS5)',
    fr: 'Recherche Plein Texte dans les Discussions (FTS5)',
  },
  generate_isolated_worktree: {
    en: 'Generate New Worktree',
    fr: 'Générer Nouveau Worktree',
  },
  invalid_code: {
    en: 'Please enter a valid 6-digit PIN code',
    fr: 'Veuillez saisir un code PIN valide à 6 chiffres',
  },
  magicdns_hostname: {
    en: 'MagicDNS Hostname',
    fr: 'Nom d\'hôte MagicDNS',
  },
  mcp_all_categories: {
    en: 'All Categories',
    fr: 'Toutes les catégories',
  },
  mcp_cancel: {
    en: 'Cancel',
    fr: 'Annuler',
  },
  mcp_catalog_desc: {
    en: 'Install verified Model Context Protocol tools and servers in 1 click.',
    fr: 'Installez des serveurs et outils Model Context Protocol vérifiés en 1 clic.',
  },
  mcp_catalog_title: {
    en: 'MCP Extensions Store & Connectors',
    fr: 'Store d\'Extensions MCP & Connecteurs',
  },
  mcp_confirm_install: {
    en: 'Confirm Installation',
    fr: 'Confirmer l\'installation',
  },
  mcp_env_dialog_desc: {
    en: 'This MCP connector requires an API key or configuration token to operate.',
    fr: 'Ce connecteur MCP nécessite une clé API ou un token pour fonctionner.',
  },
  mcp_env_dialog_title: {
    en: 'Configure API Key / Environment',
    fr: 'Configurer Clé API / Environnement',
  },
  mcp_install_btn: {
    en: 'Install 1-Click',
    fr: 'Installer 1-Clic',
  },
  mcp_installed_badge: {
    en: 'Installed',
    fr: 'Installé',
  },
  mcp_official_badge: {
    en: 'Certified',
    fr: 'Certifié',
  },
  mcp_search_placeholder: {
    en: 'Search 50+ MCP servers, databases, tools...',
    fr: 'Rechercher parmi 50+ serveurs MCP, bases de données, outils...',
  },
  mcp_test_btn: {
    en: 'Test Ping',
    fr: 'Tester Ping',
  },
  mcp_uninstall_btn: {
    en: 'Uninstall',
    fr: 'Désinstaller',
  },
  memory_add_btn: {
    en: 'Add Memory',
    fr: 'Ajouter au profil',
  },
  memory_add_entry_placeholder: {
    en: 'Add a persistent memory (convention, preference, key architectural fact)...',
    fr: 'Ajouter un souvenir persistant (convention, préférence, fait d\'architecture)...',
  },
  memory_delete_confirm: {
    en: 'Delete this entry from persistent memory?',
    fr: 'Supprimer cette entrée de la mémoire persistante ?',
  },
  memory_entry_added: {
    en: 'Memory entry added successfully!',
    fr: 'Entrée ajoutée avec succès !',
  },
  memory_loading: {
    en: 'Loading persistent memory...',
    fr: 'Chargement de la mémoire persistante...',
  },
  memory_no_entries: {
    en: 'No memories recorded yet in this file.',
    fr: 'Aucun souvenir enregistré dans ce fichier.',
  },
  memory_quota_label: {
    en: 'Token Quota Used',
    fr: 'Quota de Tokens Utilisé',
  },
  memory_refresh_snapshot: {
    en: 'Refresh Snapshot',
    fr: 'Rafraîchir Snapshot',
  },
  memory_refreshing: {
    en: 'Refreshing...',
    fr: 'Actualisation...',
  },
  memory_save_raw: {
    en: 'Save Raw File',
    fr: 'Enregistrer le fichier',
  },
  memory_snapshot_updated: {
    en: 'Immutable snapshot updated in LLM system prompt',
    fr: 'Snapshot gelé mis à jour dans le prompt système',
  },
  memory_target_user: {
    en: 'Developer Profile (USER.md)',
    fr: 'Profil Développeur (USER.md)',
  },
  memory_target_workspace: {
    en: 'Workspace Memory (MEMORY.md)',
    fr: 'Mémoire Workspace (MEMORY.md)',
  },
  memory_view_cards: {
    en: 'Curated Cards',
    fr: 'Cartes Curatées',
  },
  memory_view_raw: {
    en: 'Raw Markdown',
    fr: 'Markdown Brut',
  },
  messaging_data_load_failed: {
    en: 'Unable to load messaging gateway status',
    fr: 'Impossible de charger le statut de la passerelle',
  },
  messaging_gateway_desc: {
    en: 'Control Antigravity from Telegram, Discord, or mobile with PIN verification (NIST SP 800-63B compliant).',
    fr: 'Pilotez Antigravity depuis Telegram, Discord ou mobile avec vérification PIN (conforme NIST SP 800-63B).',
  },
  messaging_gateway_title: {
    en: 'Unified Messaging Gateway & PIN Pairing',
    fr: 'Passerelle de Messagerie & Appairage PIN',
  },
  mobile_web_push_title: {
    en: 'Native Web Push & Mobile PWA',
    fr: 'Web Push Natif & Mobile PWA',
  },
  modified_dirty: {
    en: 'Dirty (Uncommitted Changes)',
    fr: 'Modifié (Changements non commités)',
  },
  no_active_worktrees: {
    en: 'No active isolated worktrees.',
    fr: 'Aucun worktree isolé actif.',
  },
  no_approved_devices: {
    en: 'No authorized devices yet.',
    fr: 'Aucun appareil autorisé pour le moment.',
  },
  no_pending_pairing_codes: {
    en: 'No pending pairing codes.',
    fr: 'Aucun code d\'appairage en attente.',
  },
  not_installed: {
    en: 'Not Installed',
    fr: 'Non Installé',
  },
  notification_permission_denied: {
    en: 'Notification permission denied by browser',
    fr: 'Permission de notification refusée par le navigateur',
  },
  pending_requests: {
    en: 'Pending Pairing Requests',
    fr: 'Demandes d\'appairage en attente',
  },
  pin_pairing_badge: {
    en: 'Secure PIN Pairing',
    fr: 'Appairage PIN Sécurisé',
  },
  push_activated: {
    en: 'Mobile Web Push activated!',
    fr: 'Web Push mobile activé !',
  },
  push_activation_error: {
    en: 'Push activation failed',
    fr: 'Échec de l\'activation push',
  },
  push_disabled_this_browser: {
    en: 'Push notifications inactive on this browser',
    fr: 'Notifications push inactives sur ce navigateur',
  },
  push_enabled_this_browser: {
    en: 'Push notifications active on this browser',
    fr: 'Notifications push actives sur ce navigateur',
  },
  push_subscribed: {
    en: 'Subscribed to Push',
    fr: 'Abonné aux Push',
  },
  push_test_body: {
    en: 'Antigravity WebUI remote notification is functional!',
    fr: 'Notification distante Antigravity WebUI opérationnelle !',
  },
  pwa_push_desc: {
    en: 'Receive instant background alerts when a long task, build, or test finishes on your phone.',
    fr: 'Recevez des alertes instantanées en arrière-plan lorsqu\'une tâche longue, un build ou un test se termine.',
  },
  remote_access_badge: {
    en: 'Tailscale & PWA',
    fr: 'Tailscale & PWA',
  },
  remote_access_desc: {
    en: 'Access your Antigravity WebUI from any smartphone or laptop via Tailscale MagicDNS and receive native Web Push alerts.',
    fr: 'Accédez à votre Antigravity WebUI depuis n\'importe quel smartphone ou poste distant via Tailscale MagicDNS et recevez des alertes Web Push natives.',
  },
  remote_access_title: {
    en: 'Secure Remote Access & Push Notifications',
    fr: 'Accès Distant Sécurisé & Notifications Push',
  },
  remote_status_load_failed: {
    en: 'Failed to load remote status',
    fr: 'Impossible de charger le statut distant',
  },
  revoke_device_title: {
    en: 'Revoke this device',
    fr: 'Révoquer cet appareil',
  },
  revoke_failed: {
    en: 'Failed to revoke device',
    fr: 'Échec de la révocation de l\'appareil',
  },
  save_discord: {
    en: 'Save Discord Settings',
    fr: 'Enregistrer Discord',
  },
  save_telegram: {
    en: 'Save Telegram Settings',
    fr: 'Enregistrer Telegram',
  },
  secure_https_url: {
    en: 'Secure HTTPS URL (Tailscale Serve)',
    fr: 'URL HTTPS Sécurisée (Tailscale Serve)',
  },
  security_nist_hint: {
    en: 'NIST SP 800-63B compliant: 6-digit rate-limited codes with cryptographic hash storage.',
    fr: 'Conformité NIST SP 800-63B : codes à 6 chiffres avec limitation de débit et hash sécurisé.',
  },
  serve_active_desc: {
    en: 'Traffic encrypted end-to-end via your private Tailnet.',
    fr: 'Trafic chiffré de bout en bout via votre Tailnet privé.',
  },
  serve_inactive_desc: {
    en: 'Activate Tailscale Serve to generate a public valid HTTPS certificate on your private network.',
    fr: 'Activez Tailscale Serve pour générer un certificat HTTPS valide sur votre réseau privé.',
  },
  studio_canvas: {
    en: 'Canvas',
    fr: 'Canvas',
  },
  studio_docker: {
    en: 'Docker Studio',
    fr: 'Docker Studio',
  },
  studio_doctor: {
    en: 'Doctor',
    fr: 'Doctor',
  },
  studio_documents: {
    en: 'Documents',
    fr: 'Documents',
  },
  studio_gateway: {
    en: 'Gateway',
    fr: 'Passerelle',
  },
  studio_mcp_store: {
    en: 'MCP Store',
    fr: 'Store MCP',
  },
  studio_quotas: {
    en: 'Quotas',
    fr: 'Quotas',
  },
  studio_remote_access: {
    en: 'Remote Access',
    fr: 'Accès Distant',
  },
  studio_studios: {
    en: 'Studios',
    fr: 'Studios',
  },
  studio_tasks: {
    en: 'Tasks & Sub',
    fr: 'Tâches & Subs',
  },
  studio_vector_memory: {
    en: 'Vector Memory',
    fr: 'Mémoire Vec',
  },
  studio_workspace: {
    en: 'Workspace',
    fr: 'Workspace',
  },
  studio_worktrees: {
    en: 'Worktrees',
    fr: 'Worktrees',
  },
  switcher_add_project: {
    en: 'Add Project Directory',
    fr: 'Ajouter un Répertoire',
  },
  switcher_all_projects: {
    en: 'All Projects',
    fr: 'Tous les projets',
  },
  switcher_search_placeholder: {
    en: 'Search workspace or project...',
    fr: 'Rechercher un workspace ou projet...',
  },
  switcher_switched_toast: {
    en: 'Active workspace switched to {0}',
    fr: 'Workspace actif basculé vers {0}',
  },
  switcher_title: {
    en: 'Workspace Switcher & Explorer',
    fr: 'Sélecteur & Explorateur de Workspaces',
  },
  tab_discord: {
    en: 'Discord Bot',
    fr: 'Bot Discord',
  },
  tab_pin_pairing: {
    en: 'PIN Pairing',
    fr: 'Appairage PIN',
  },
  tab_telegram: {
    en: 'Telegram Bot',
    fr: 'Bot Telegram',
  },
  tailnet_connected: {
    en: 'Tailnet Connected',
    fr: 'Tailnet Connecté',
  },
  tailscale_ip: {
    en: 'Tailscale IP (IPv4)',
    fr: 'IP Tailscale (IPv4)',
  },
  tailscale_network_title: {
    en: 'Zero-Config Mesh (Tailscale MagicDNS)',
    fr: 'Réseau Maillé Zéro-Config (Tailscale MagicDNS)',
  },
  tailscale_not_active_warning: {
    en: 'Tailscale daemon is not active on this host. Run tailscale up to enable zero-config remote access.',
    fr: 'Le démon Tailscale n\'est pas actif sur cette machine. Lancez tailscale up pour activer l\'accès distant.',
  },
  tailscale_serve_disabled: {
    en: 'Tailscale Serve disabled',
    fr: 'Tailscale Serve désactivé',
  },
  tailscale_serve_enabled: {
    en: 'Tailscale Serve activated successfully!',
    fr: 'Tailscale Serve activé avec succès !',
  },
  tailscale_serve_error: {
    en: 'Tailscale Serve error',
    fr: 'Erreur Tailscale Serve',
  },
  telegram_bot_token_label: {
    en: 'Telegram Bot Token (from @BotFather)',
    fr: 'Token Bot Telegram (obtenu via @BotFather)',
  },
  telegram_config_saved: {
    en: 'Telegram configuration saved',
    fr: 'Configuration Telegram enregistrée',
  },
  telegram_token_required: {
    en: 'Telegram bot token is required',
    fr: 'Le token du bot Telegram est requis',
  },
  test_push_btn: {
    en: 'Send Test Push',
    fr: 'Envoyer Test Push',
  },
  test_push_failed: {
    en: 'Push test error',
    fr: 'Erreur test push',
  },
  test_push_sent: {
    en: 'Test push sent to all registered devices',
    fr: 'Push test envoyé à tous les appareils enregistrés',
  },
  tg_notify_approval_label: {
    en: 'Send interactive approval notifications',
    fr: 'Envoyer les notifications d\'approbation interactives',
  },
  tg_notify_complete_label: {
    en: 'Send task completion notifications',
    fr: 'Envoyer les notifications de tâche terminée',
  },
  toggle_error: {
    en: 'Toggle error',
    fr: 'Erreur de bascule',
  },
  validate: {
    en: 'Validate',
    fr: 'Valider',
  },
  vector_add_btn: {
    en: 'Vectorize & Store',
    fr: 'Vectoriser & Mémoriser',
  },
  vector_all_categories: {
    en: 'All Categories',
    fr: 'Toutes les catégories',
  },
  vector_category_label: {
    en: 'Category',
    fr: 'Catégorie',
  },
  vector_delete_confirm: {
    en: 'Permanently remove this vector memory?',
    fr: 'Supprimer définitivement ce souvenir vectoriel ?',
  },
  vector_importance_label: {
    en: 'Importance Weight',
    fr: 'Poids d\'importance',
  },
  vector_memory_desc: {
    en: 'Embedded semantic search with automatic context recall before each model turn.',
    fr: 'Recherche sémantique embarquée et injection automatique des souvenirs pertinents par prompt.',
  },
  vector_memory_title: {
    en: 'Vector Memory & Auto-Recall Hook',
    fr: 'Mémoire Vectorielle & Auto-Recall Hook',
  },
  vector_new_memory_placeholder: {
    en: 'New semantic memory to vectorize (facts, rules, architecture notes)...',
    fr: 'Nouveau souvenir sémantique à vectoriser (faits, règles, notes d\'architecture)...',
  },
  vector_no_memories: {
    en: 'No vector memories stored yet.',
    fr: 'Aucun souvenir vectoriel mémorisé pour le moment.',
  },
  vector_save_config_btn: {
    en: 'Save Embeddings Settings',
    fr: 'Enregistrer la Configuration',
  },
  vector_search_placeholder: {
    en: 'Real-time semantic search test...',
    fr: 'Test de recherche sémantique en temps réel...',
  },
  vector_searching: {
    en: 'Embedding...',
    fr: 'Vectorisation...',
  },
  vector_sim_prompt_label: {
    en: 'User prompt to evaluate for recall:',
    fr: 'Prompt utilisateur à évaluer pour le rappel :',
  },
  vector_sim_test_btn: {
    en: 'Simulate Recall Hook',
    fr: 'Simuler le Hook de Rappel',
  },
  vector_sim_title: {
    en: 'Auto-Recall Simulator',
    fr: 'Simulateur d\'Auto-Recall',
  },
  vector_tab_memories: {
    en: 'Memories ({0})',
    fr: 'Souvenirs ({0})',
  },
  vector_tab_settings: {
    en: 'Hook & Embeddings',
    fr: 'Hook & Embeddings',
  },
  worktree_create_failed: {
    en: 'Failed to create worktree',
    fr: 'Échec de la création du worktree',
  },
  worktree_created: {
    en: 'Isolated worktree created successfully for sub-agent',
    fr: 'Worktree isolé créé avec succès pour le sous-agent',
  },
  worktree_deleted: {
    en: 'Worktree deleted',
    fr: 'Worktree supprimé',
  },
  worktree_finalize_failed: {
    en: 'Failed to finalize worktree',
    fr: 'Échec de la finalisation du worktree',
  },
  worktree_isolation_desc: {
    en: 'Zero interference: each sub-agent executes in an isolated Git worktree without modifying your open files in Monaco.',
    fr: 'Zéro interférence : chaque sous-agent s\'exécute dans un worktree Git isolé sans modifier vos fichiers ouverts dans Monaco.',
  },
  worktree_isolation_title: {
    en: 'Sub-agent Isolation & Worktrees',
    fr: 'Isolation des Sous-Agents & Worktrees',
  },
  worktree_kept: {
    en: 'Worktree has unmerged commits and was preserved',
    fr: 'Le worktree contient des commits non fusionnés et a été préservé',
  },
  worktree_load_failed: {
    en: 'Unable to load Git worktrees',
    fr: 'Impossible de charger les worktrees Git',
  },
  worktree_not_a_repo: {
    en: 'Current workspace is not a Git repository.',
    fr: 'Le workspace actuel n\'est pas un dépôt Git.',
  },
  worktree_protection_hint: {
    en: 'Safe auto-cleanup: worktrees with pending commits are never deleted without your approval.',
    fr: 'Protection auto-clean : les worktrees ayant des commits en attente ne sont jamais supprimés sans votre accord.',
  },
  worktree_pruned: {
    en: 'Clean worktrees pruned automatically',
    fr: 'Worktrees propres nettoyés automatiquement',
  },
  worktree_remove_failed: {
    en: 'Failed to remove worktree',
    fr: 'Échec de la suppression du worktree',
  },
  worktree_sandbox_badge: {
    en: 'Multi-Agent Sandbox',
    fr: 'Sandbox Multi-Agents',
  },
  worktree_task_placeholder: {
    en: 'Sub-agent ID or task name (e.g. task-oauth-fix)...',
    fr: 'ID du sous-agent ou nom de tâche (ex: task-oauth-fix)...',
  },
  worktree_title: {
    en: 'Git Worktree Manager',
    fr: 'Gestionnaire de Worktrees Git',
  },
  worktrees_detected: {
    en: 'Worktrees detected',
    fr: 'Worktrees détectés',
  },
  canvas_badge_sandbox: {
    en: 'Sandboxed Document',
    fr: 'Document Sandboxé',
  },
  canvas_template_chart: {
    en: 'Chart.js Visualizer',
    fr: 'Graphique Chart.js',
  },
  canvas_template_kpi: {
    en: 'KPI Dashboard',
    fr: 'Tableau de Bord KPI',
  },
  canvas_template_table: {
    en: 'Filterable Table',
    fr: 'Tableau Filtrable',
  },
  vector_clear_all: {
    en: 'Clear all memories',
    fr: 'Effacer tous les souvenirs',
  },
  vector_config_desc: {
    en: 'Controls filtering, similarity thresholds and embeddings model',
    fr: 'Contrôle le filtrage, les seuils de similarité et le modèle d\'embeddings',
  },
  vector_config_saved: {
    en: 'Configuration Saved!',
    fr: 'Configuration Enregistrée !',
  },
  vector_config_title: {
    en: 'Auto-Recall Hook Configuration',
    fr: 'Configuration du Hook Auto-Recall',
  },
  vector_embedding_model: {
    en: 'Embedding Model',
    fr: 'Modèle d\'embedding',
  },
  vector_embedding_provider: {
    en: 'Embeddings Engine',
    fr: 'Moteur d\'Embeddings',
  },
  vector_enable_auto_recall: {
    en: 'Enable Automatic Auto-Recall',
    fr: 'Activer l\'Auto-Recall automatique',
  },
  vector_enable_auto_recall_desc: {
    en: 'Injects relevant memories before each LLM prompt',
    fr: 'Injecte les souvenirs pertinents avant chaque prompt LLM',
  },
  vector_engine_badge: {
    en: 'Vector Engine',
    fr: 'Moteur Vectoriel',
  },
  vector_max_chars: {
    en: 'Max length of injected block',
    fr: 'Longueur max du bloc injecté',
  },
  vector_max_results: {
    en: 'Max memories injected (Top-K)',
    fr: 'Max souvenirs réinjectés (Top-K)',
  },
  vector_min_similarity: {
    en: 'Minimum similarity threshold',
    fr: 'Seuil de similarité minimale',
  },
  vector_sim_btn: {
    en: 'Test',
    fr: 'Tester',
  },
  vector_sim_desc: {
    en: 'Test how the hook analyzes a prompt and injects memories',
    fr: 'Testez comment le hook analyse un prompt et injecte les souvenirs',
  },
  vector_sim_no_injection: {
    en: 'The hook did not inject context (trivial prompt or below threshold).',
    fr: 'Le hook n\'a pas injecté de contexte (prompt trivial ou score inférieur au seuil).',
  },
  vector_sim_placeholder: {
    en: 'Enter a test prompt...',
    fr: 'Entrez un prompt de test...',
  },
  vector_sim_testing: {
    en: 'Calculating...',
    fr: 'Calcul...',
  },
  vector_xml_block: {
    en: 'XML BLOCK INJECTED INTO SYSTEM:',
    fr: 'BLOC XML INJECTÉ DANS LE SYSTÈME :',
  },
};

const STORAGE_KEY = 'antigravity-lang';
const LISTENERS = new Set<(lang: string) => void>();

function detectInitialLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) return saved;

    const nav = navigator.language || '';
    for (const opt of SUPPORTED_LANGUAGES) {
      if (nav.toLowerCase().startsWith(opt.code.toLowerCase())) {
        return opt.code;
      }
    }
  } catch {}
  return 'fr'; // Default to French
}

let currentLanguage: string = detectInitialLocale();
document.documentElement.lang = currentLanguage;

/**
 * Switch active locale, update document and notify subscribers.
 */
export function setLanguage(lang: string) {
  const resolved = SUPPORTED_LANGUAGES.some((l) => l.code === lang) ? lang : 'en';
  currentLanguage = resolved;
  try {
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch {}
  document.documentElement.lang = resolved;
  LISTENERS.forEach((fn) => fn(resolved));
}

/**
 * Get current active language code.
 */
export function getCurrentLanguage(): string {
  return currentLanguage;
}

/**
 * Translate a key.
 * 1. Checks UI_TRANSLATIONS dictionary.
 * 2. Checks LOCALES (Hermes 1700+ bundle).
 * 3. Falls back to default string (if provided) or English, then key itself.
 */
export function t(key: string, defaultValOrArg?: string | number, ...args: (string | number)[]): string {
  let fallbackTemplate: string | undefined = undefined;
  let substArgs: (string | number)[] = [];

  if (args.length > 0) {
    if (typeof defaultValOrArg === 'string') {
      fallbackTemplate = defaultValOrArg;
      substArgs = args;
    } else if (defaultValOrArg !== undefined) {
      substArgs = [defaultValOrArg, ...args];
    }
  } else if (defaultValOrArg !== undefined) {
    if (typeof defaultValOrArg === 'number') {
      substArgs = [defaultValOrArg];
    } else if (typeof defaultValOrArg === 'string') {
      fallbackTemplate = defaultValOrArg;
    }
  }

  // 1. Direct UI translation
  if (UI_TRANSLATIONS[key]) {
    const directVal = UI_TRANSLATIONS[key][currentLanguage] ?? UI_TRANSLATIONS[key]['en'];
    if (directVal !== undefined && directVal !== null) {
      const valStr = String(directVal);
      let activeArgs = substArgs;
      if (activeArgs.length === 0 && fallbackTemplate !== undefined && !/\{\d+\}/.test(fallbackTemplate) && /\{\d+\}/.test(valStr)) {
        activeArgs = [fallbackTemplate];
      }
      if (activeArgs.length > 0 && /\{\d+\}/.test(valStr)) {
        return valStr.replace(/\{(\d+)\}/g, (match, idx) => {
          const i = parseInt(idx, 10);
          return i < activeArgs.length ? String(activeArgs[i]) : match;
        });
      }
      return valStr;
    }
  }

  // 2. Hermes Locales Bundle
  const dict = LOCALES[currentLanguage] || LOCALES.en || {};
  const enDict = LOCALES.en || {};
  const val = dict[key] ?? enDict[key];

  if (val !== undefined && val !== null) {
    const valStr = String(val);
    let activeArgs = substArgs;
    if (activeArgs.length === 0 && fallbackTemplate !== undefined && !/\{\d+\}/.test(fallbackTemplate) && /\{\d+\}/.test(valStr)) {
      activeArgs = [fallbackTemplate];
    }
    if (activeArgs.length > 0 && /\{\d+\}/.test(valStr)) {
      return valStr.replace(/\{(\d+)\}/g, (match, idx) => {
        const i = parseInt(idx, 10);
        return i < activeArgs.length ? String(activeArgs[i]) : match;
      });
    }
    return valStr;
  }

  // 3. Fallback: if caller provided a fallback text string (e.g. t('some_key', 'Fallback text'))
  if (fallbackTemplate !== undefined && fallbackTemplate.trim().length > 0) {
    if (substArgs.length > 0 && /\{\d+\}/.test(fallbackTemplate)) {
      return fallbackTemplate.replace(/\{(\d+)\}/g, (match, idx) => {
        const i = parseInt(idx, 10);
        return i < substArgs.length ? String(substArgs[i]) : match;
      });
    }
    return fallbackTemplate;
  }

  return key;
}

/**
 * React hook to listen to language changes and re-render.
 */
export function useI18n() {
  const [lang, setLang] = useState<string>(currentLanguage);
  const [, setRevision] = useState(0);

  useEffect(() => {
    const handler = (newLang: string) => {
      setLang(newLang);
      setRevision((rev) => rev + 1);
    };
    LISTENERS.add(handler);
    return () => {
      LISTENERS.delete(handler);
    };
  }, []);

  return {
    lang,
    setLanguage,
    t,
    supportedLanguages: SUPPORTED_LANGUAGES,
  };
}
