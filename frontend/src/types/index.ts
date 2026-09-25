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
  contextBudgetTokens?: number;
  autoCompactContext?: boolean;
  preserveLastNTurns?: number;
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

export interface InlineSuggestRequest {
  prefix: string;
  suffix?: string;
  language: string;
  file_path?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface InlineSuggestResponse {
  suggestion: string;
  cached: boolean;
  latency_ms: number;
  model: string;
}

export interface CopilotActionRequest {
  action: 'refactor' | 'types' | 'docstring' | 'tests';
  code: string;
  language: string;
  file_path?: string;
  user_instruction?: string;
}

export interface CopilotActionResponse {
  action: string;
  result_code: string;
  explanation: string;
  diff?: string | null;
}

export interface CopilotStatusResponse {
  available: boolean;
  default_model: string;
  cached_items: number;
}

// Sprint 16: Visual Branch Manager & Interactive Rebase Types
export interface GitBranchDetail {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  last_commit_sha: string | null;
  last_commit_date: string | null;
  last_commit_subject: string | null;
}

export interface GitBranchesResponse {
  current: string;
  branches: GitBranchDetail[];
}

export interface BranchCheckoutRequest {
  workspace?: string;
  branch: string;
  create?: boolean;
  start_point?: string | null;
}

export interface BranchCreateRequest {
  workspace?: string;
  name: string;
  start_point?: string | null;
  checkout?: boolean;
}

export interface BranchDeleteRequest {
  workspace?: string;
  branch: string;
  force?: boolean;
  remote?: boolean;
  remote_name?: string;
}

export interface BranchMergeRequest {
  workspace?: string;
  branch: string;
  no_ff?: boolean;
  message?: string | null;
}

export interface BranchRenameRequest {
  workspace?: string;
  old_name: string;
  new_name: string;
}

export interface BranchActionResponse {
  success: boolean;
  branch?: string;
  name?: string;
  old_name?: string;
  new_name?: string;
  has_conflicts?: boolean;
  conflicts?: string[];
  output?: string;
  message?: string;
}

export interface RebaseCommitItem {
  sha: string;
  full_sha?: string;
  author?: string;
  date?: string;
  subject: string;
  action: 'pick' | 'reword' | 'squash' | 'drop';
  new_message?: string | null;
}

export interface RebaseTodoResponse {
  base: string;
  commits: RebaseCommitItem[];
}

export interface RebaseExecuteRequest {
  workspace?: string;
  base: string;
  commits: Array<{
    sha: string;
    action: string;
    new_message?: string | null;
  }>;
}

export interface RebaseExecuteResponse {
  success: boolean;
  status: 'completed' | 'conflict' | 'error';
  conflicts?: string[];
  output?: string;
  message?: string;
}

export interface RebaseStatusResponse {
  is_rebasing: boolean;
  current_step: number;
  total_steps: number;
  current_commit: string | null;
  conflicted_files: string[];
}

export interface ProjectRuntimeInfo {
  type: 'node' | 'python' | 'php' | 'rust' | 'go' | 'docker' | 'generic';
  version?: string | null;
  frameworks: string[];
  package_manager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'pipenv' | 'composer' | 'cargo' | 'go' | null;
}

export interface ProjectGitStatus {
  is_repo: boolean;
  branch?: string | null;
  is_dirty: boolean;
  uncommitted_count: number;
  remote_url?: string | null;
  ahead?: number;
  behind?: number;
  last_commit?: {
    sha: string;
    date: string;
    subject: string;
  } | null;
}

export interface ProjectHealthDiagnostic {
  status: 'healthy' | 'warning' | 'error';
  dependencies_installed: boolean;
  venv_present?: boolean | null;
  node_modules_present?: boolean | null;
  vendor_present?: boolean | null;
  warnings: string[];
  suggested_action?: {
    label: string;
    command: string;
  } | null;
}

export interface WorkspaceProjectDetail {
  path: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  last_modified?: string | null;
  stats?: {
    file_count?: number;
    disk_size_mb?: number;
    last_modified?: string | null;
  };
  runtimes: ProjectRuntimeInfo[];
  git: ProjectGitStatus;
  health: ProjectHealthDiagnostic;
}

export type GitDiffRangeType = 'added' | 'modified' | 'deleted';

export interface GitDiffRange {
  type: GitDiffRangeType;
  start_line: number;
  end_line: number;
}

export interface GitDiffSummary {
  added_lines: number;
  modified_lines: number;
  deleted_lines: number;
  total_changes: number;
}

export interface GitDiffRangesResponse {
  file_path: string;
  is_tracked: boolean;
  ranges: GitDiffRange[];
  summary: GitDiffSummary;
}

// ==========================================
// Sprint 19: Git Remotes & Tags Studio Types
// ==========================================

export interface GitRemoteDetail {
  name: string;
  fetch_url: string;
  push_url: string;
  is_default: boolean;
}

export interface CreateRemotePayload {
  name: string;
  url: string;
  push_url?: string;
  workspace?: string;
}

export interface UpdateRemotePayload {
  new_name?: string;
  url?: string;
  push_url?: string;
  workspace?: string;
}

export interface RemoteActionPayload {
  remote: string;
  branch?: string;
  set_upstream?: boolean;
  force?: boolean;
  workspace?: string;
}

export interface GitTagDetail {
  name: string;
  commit_sha: string;
  commit_short_sha: string;
  commit_date: string;
  commit_message: string;
  is_annotated: boolean;
  tagger_name?: string | null;
  tagger_date?: string | null;
  tag_message?: string | null;
}

export interface CreateTagPayload {
  name: string;
  target_commit?: string;
  message?: string;
  push?: boolean;
  remote?: string;
  workspace?: string;
}

export interface DeleteTagPayload {
  delete_remote?: boolean;
  remote_name?: string;
  workspace?: string;
}

export interface ReleaseNotesResponse {
  tag: string;
  previous_tag?: string | null;
  commit_count: number;
  suggested_title: string;
  changelog_markdown: string;
  github_release_url?: string | null;
  has_gh_cli: boolean;
}

export interface PublishReleasePayload {
  tag: string;
  title: string;
  notes: string;
  draft?: boolean;
  prerelease?: boolean;
  workspace?: string;
}

export interface PublishReleaseResponse {
  success: boolean;
  mode: 'cli' | 'web';
  url?: string | null;
  message: string;
}


