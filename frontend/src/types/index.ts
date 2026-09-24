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
  openFiles?: Array<{ path: string; name?: string; content?: string }>;
}

export interface FileSearchResult {
  name: string;
  path: string;
  is_dir: boolean;
  match_type: 'name' | 'content';
  line_number?: number;
  snippet?: string;
}

export interface OpenEditorFile {
  path: string;
  filename: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
}

export type PromptPreset = 'general' | 'debug' | 'plan' | 'refactor' | 'review';

export interface PromptBreakdownScore {
  context: number;
  objective: number;
  constraints: number;
  output_format: number;
}

export interface PromptDetectedElements {
  files: string[];
  has_error_logs: boolean;
  has_code_block: boolean;
  has_constraints: boolean;
}

export interface PromptAnalysisResponse {
  prompt: string;
  word_count: number;
  char_count: number;
  estimated_tokens: number;
  clarity_score: number;
  breakdown: PromptBreakdownScore;
  suggestions: string[];
  detected_elements: PromptDetectedElements;
}

export interface PromptOptimizationResponse {
  original: string;
  optimized: string;
  preset: string;
  tokens_original: number;
  tokens_optimized: number;
  improvement_factor: number;
}

export interface WorkspaceSearchMatchItem {
  line_number: number;
  column: number;
  match_length: number;
  line_text: string;
  match_text: string;
}

export interface WorkspaceFileSearchResult {
  file_path: string;
  relative_path: string;
  matches: WorkspaceSearchMatchItem[];
}

export interface WorkspaceSearchRequest {
  query: string;
  workspace?: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  is_regex?: boolean;
  include_pattern?: string;
  exclude_pattern?: string;
  max_results?: number;
  max_file_size_kb?: number;
}

export interface WorkspaceSearchResponse {
  query: string;
  total_matches: number;
  total_files: number;
  files: WorkspaceFileSearchResult[];
  duration_ms: number;
  truncated: boolean;
}

export interface FileReplacePreview {
  file_path: string;
  relative_path: string;
  replacements_count: number;
  original_content: string;
  modified_content: string;
}

export interface WorkspaceReplaceRequest {
  query: string;
  replace_text: string;
  workspace?: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  is_regex?: boolean;
  include_pattern?: string;
  exclude_pattern?: string;
  file_paths?: string[];
  dry_run?: boolean;
}

export interface WorkspaceReplaceResponse {
  query: string;
  replace_text: string;
  total_replacements: number;
  files_modified: number;
  previews: FileReplacePreview[];
  dry_run: boolean;
  duration_ms: number;
}

export interface SingleReplaceRequest {
  file_path: string;
  workspace?: string;
  line_number: number;
  column: number;
  match_length: number;
  replace_text: string;
  expected_match?: string;
}

export interface SingleReplaceResponse {
  success: boolean;
  file_path: string;
  modified_content: string;
}

export interface GitStashItem {
  index: number;
  id: string;
  hash: string;
  relative_time: string;
  message: string;
}

export interface StashSaveRequest {
  workspace?: string;
  message?: string;
  include_untracked?: boolean;
  keep_index?: boolean;
}

export interface StashActionRequest {
  workspace?: string;
  index: number;
}

export interface ConflictFileInfo {
  file_path: string;
  relative_path: string;
  base_content: string;
  ours_content: string;
  theirs_content: string;
  current_content: string;
}

export interface ResolveConflictRequest {
  workspace?: string;
  path: string;
  resolution: 'ours' | 'theirs' | 'custom';
  custom_content?: string;
}

export interface CherryPickRequest {
  workspace?: string;
  commit_hash: string;
}

export interface CherryPickResponse {
  status: 'applied' | 'conflict';
  message: string;
  conflicts: string[];
}



