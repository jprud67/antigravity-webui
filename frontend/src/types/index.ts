export interface BookmarkItem {
  id: string;
  step_index: number;
  label: string;
  preview?: string;
  created_at: string;
  conversation_id?: string;
  conversation_title?: string;
}

export interface Conversation {
  conversation_id: string;
  title: string;
  raw_title?: string;
  preview: string;
  step_count: number;
  last_modified_time: string;
  workspace_uris?: string;
  status: string;
  agent_name?: string;
  parent_conversation_id?: string | null;
  project_id?: string;
  group_id?: string;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  project?: string;
  projectColor?: string;
  customTitle?: string;
  match_type?: 'metadata' | 'transcript';
  match_snippet?: string;
  is_running?: boolean;
  bookmarks?: BookmarkItem[];
}

export interface ToolCallItem {
  id?: string;
  name: string;
  args?: any;
  result?: any;
  status?: 'running' | 'done' | 'error' | 'cancelled';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  toolCalls?: ToolCallItem[];
  timestamp?: string;
  stepIndex?: number;
  isLive?: boolean;
  error?: string;
  subtype?: 'checkpoint' | 'task' | 'error' | 'system' | 'context_summary';
  taskId?: string;
}

export interface ArtifactItem {
  conversation_id: string;
  filename: string;
  relative_path: string;
  full_path: string;
  size: number;
  last_modified: string;
}

export interface ModelOption {
  id: string;
  name: string;
  default_effort?: string | null;
  supported_efforts: string[];
  variants: Record<string, string>;
}

export interface AppSettings {
  agentMode?: string;
  colorScheme?: string;
  model?: string;
  effort?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  trustedWorkspaces?: string[];
  defaultWorkspace?: string;
  ecoMode?: boolean;
}

export interface WorkspaceFolder {
  current_path: string;
  parent_path?: string | null;
  entries: {
    name: string;
    path: string;
    is_dir: boolean;
    size?: number | null;
  }[];
}

export interface GitFileVersionsResponse {
  workspace: string;
  path: string;
  filename: string;
  original: string;
  modified: string;
  is_new: boolean;
  is_deleted: boolean;
  staged: boolean;
  commit?: string;
}

export interface MonacoStudioConfig {
  mode: 'editor' | 'diff';
  title?: string;
  filePath?: string;
  workspace?: string;
  language?: string;
  content?: string;
  initialValue?: string;
  originalContent?: string;
  modifiedContent?: string;
  diffText?: string;
  readOnly?: boolean;
}

