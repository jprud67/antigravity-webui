import { useState, useEffect } from 'react';
import localesData from './locales.json';

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

const LOCALES: Record<string, Record<string, string>> = localesData as any;

export const UI_TRANSLATIONS: Record<string, Record<string, string>> = {
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
  }
};

const STORAGE_KEY = 'antigravity-lang';
const LISTENERS = new Set<(lang: string) => void>();

function detectInitialLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('hermes-lang');
    if (saved && (LOCALES[saved] || UI_TRANSLATIONS.new_conversation[saved])) return saved;

    const nav = navigator.language || '';
    for (const opt of SUPPORTED_LANGUAGES) {
      if (nav.toLowerCase().startsWith(opt.code.toLowerCase())) {
        return opt.code;
      }
    }
  } catch (_) {}
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
    localStorage.setItem('hermes-lang', resolved);
  } catch (_) {}
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
 * 3. Falls back to English, then defaultVal or key itself.
 */
export function t(key: string, ...args: (string | number)[]): string {
  // 1. Direct UI translation
  if (UI_TRANSLATIONS[key]) {
    const directVal = UI_TRANSLATIONS[key][currentLanguage] ?? UI_TRANSLATIONS[key]['en'];
    if (directVal) {
      if (args.length > 0) {
        return String(directVal).replace(/\{(\d+)\}/g, (match, idx) => {
          const i = parseInt(idx, 10);
          return i < args.length ? String(args[i]) : match;
        });
      }
      return directVal;
    }
  }

  // 2. Hermes Locales Bundle
  const dict = LOCALES[currentLanguage] || LOCALES.en || {};
  const enDict = LOCALES.en || {};
  const val = dict[key] ?? enDict[key];

  if (val !== undefined && val !== null) {
    if (args.length > 0) {
      return String(val).replace(/\{(\d+)\}/g, (match, idx) => {
        const i = parseInt(idx, 10);
        return i < args.length ? String(args[i]) : match;
      });
    }
    return String(val);
  }

  return key;
}

/**
 * React hook to listen to language changes and re-render.
 */
export function useI18n() {
  const [lang, setLang] = useState<string>(currentLanguage);

  useEffect(() => {
    const handler = (newLang: string) => setLang(newLang);
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
