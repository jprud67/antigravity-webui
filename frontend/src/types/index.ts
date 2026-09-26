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

// Visual Branch Manager & Interactive Rebase Types
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
// Git Remotes & Tags Studio Types
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

// Continuous Memory, FTS5 Search & Skill Curator
export interface MemoryTargetStatus {
  path: string;
  exists: boolean;
  entries: string[];
  entry_count: number;
  char_count: number;
  char_limit: number;
  percentage: number;
  raw: string;
  workspace?: string;
}

export interface ContinuousMemoryStatus {
  user: MemoryTargetStatus;
  memory: MemoryTargetStatus;
  snapshot_available: boolean;
}

export interface MemoryOperationPayload {
  target: 'user' | 'memory';
  action: 'add' | 'replace' | 'remove' | 'save_raw';
  content?: string;
  old_text?: string;
  new_content?: string;
  raw_markdown?: string;
}

export interface FtsSearchResultItem {
  session_id: string;
  session_title: string;
  message_id: string;
  role: string;
  project: string;
  timestamp: string;
  snippet: string;
  rank: number;
}

export interface FtsSearchResponse {
  query: string;
  matches: FtsSearchResultItem[];
  total_matches: number;
  took_ms: number;
  error?: string;
}

export interface SkillTelemetry {
  skill_name: string;
  use_count: number;
  last_used_at: string | null;
  created_at: string | null;
  pinned: boolean;
  status: 'active' | 'stale' | 'archived';
  is_protected: boolean;
}

export interface SkillCuratorSweepResult {
  success: boolean;
  timestamp: string;
  total_skills: number;
  transitions_count: number;
  transitions: Array<{ skill_name: string; before: string; after: string }>;
  archived_count?: number;
  swept_count?: number;
}

export interface SkillCuratorLedgerRecord {
  id: string;
  timestamp: string;
  action: string;
  skill_name: string;
  actor: string;
  before?: any;
  after?: any;
  details: string;
}

export interface ToolRepairPreviewResponse {
  cleaned_text: string;
  tool_calls: Array<{ id: string; name: string; arguments: Record<string, any> }>;
  was_repaired: boolean;
  repaired_count: number;
}

// Types: MCP Catalog, Progress Card, Doctor, Link Understanding
export interface McpCatalogItem {
  slug: string;
  name: string;
  description: string;
  category: string;
  transport: {
    type: 'http' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
  };
  auth?: {
    type?: string;
    env_var?: string;
    provider?: string;
  };
  source?: string;
  keywords?: string[];
  is_official?: boolean;
  is_installed: boolean;
}

export interface McpTestResult {
  success: boolean;
  status_code: number;
  latency_ms: number;
  transport: string;
  error?: string | null;
  binary?: string;
}

export interface ProgressCardStep {
  label: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ProgressCardData {
  title: string;
  markdown?: string | null;
  steps: ProgressCardStep[];
  percent: number;
  updated_at: number;
}

export interface LlmProbeResult {
  name: string;
  provider: string;
  url: string;
  status: 'online' | 'degraded' | 'offline';
  status_code: number;
  latency_ms: number;
  error?: string | null;
}

export interface SystemDiagnosticsReport {
  health_status: 'healthy' | 'warning' | 'critical';
  timestamp: number;
  system: {
    platform: string;
    cpu_cores: number;
    cpu_percent: number;
    ram: {
      total_gb: number;
      available_gb: number;
      used_gb: number;
      percent: number;
    };
    disk: {
      total_gb: number;
      free_gb: number;
      used_percent: number;
    };
  };
  runtimes: {
    python: {
      version: string;
      executable: string;
      is_venv: boolean;
    };
    git: {
      installed: boolean;
      path?: string;
      branch?: string;
      dirty_files: number;
    };
  };
  database: {
    status: string;
    size_mb: number;
    integrity: string;
    fts5: {
      total_indexed_rows: number;
      indexed_sessions: number;
      engine: string;
    };
  };
  llm_connectivity: LlmProbeResult[];
  anomalies: Array<{ level: 'warning' | 'error'; message: string }>;
}

export interface LinkExtractionResult {
  url: string;
  title: string;
  description: string;
  content: string;
  cached: boolean;
  cached_at: number;
}

export interface GitWorktreeItem {
  worktree: string;
  branch?: string;
  head?: string;
  dirty?: boolean;
  commits?: number;
}

export interface KernelExecutionResult {
  session_id: string;
  execution_count: number;
  status: 'ok' | 'error' | 'timeout' | 'exit';
  stdout: string;
  stderr: string;
  stdout_clipped: boolean;
  stderr_clipped: boolean;
  traceback: string;
  duration_ms: number;
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  magicdns?: string | null;
  tailscale_ip?: string | null;
  all_ips?: string[];
  serve_active: boolean;
  serve_url?: string | null;
  funnel_active: boolean;
  message: string;
}

export interface WebPushSubscriptionItem {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
  created_at: number;
}

export interface MessagingGatewayBotConfig {
  platform: string;
  has_token: boolean;
  masked_token: string;
  chat_id?: string;
  is_active: boolean;
  notify_on_approval: boolean;
  notify_on_complete: boolean;
  updated_at: number;
}

export interface PairingCodeItem {
  code: string;
  platform: string;
  user_id: string;
  user_name?: string;
  created_at: number;
  expires_at: number;
}

export interface ApprovedDeviceItem {
  id?: number;
  platform: string;
  user_id: string;
  user_name?: string;
  approved_at: number;
}

export interface MessagingGatewayStatus {
  configs: Record<string, MessagingGatewayBotConfig>;
  pending_count: number;
  approved_count: number;
}

// --- Canvas Documents ---
export type CanvasDocumentKind = 'html_bundle' | 'url_embed' | 'document' | 'image' | 'video_asset';
export type CanvasSurface = 'assistant_message' | 'tool_card' | 'sidebar';

export interface CanvasDocumentAsset {
  logicalPath: string;
  sourcePath: string;
  contentType?: string;
}

export interface CanvasDocumentEntrypoint {
  type: 'html' | 'path' | 'url';
  value: string;
}

export interface CanvasDocumentCreateInput {
  id?: string;
  kind?: CanvasDocumentKind;
  title?: string;
  preferredHeight?: number;
  entrypoint: CanvasDocumentEntrypoint;
  assets?: CanvasDocumentAsset[];
  surface?: CanvasSurface;
  retentionScope?: string;
  cspSandbox?: 'scripts';
  wrapWithTheme?: boolean;
}

export interface CanvasDocumentManifest {
  id: string;
  kind: CanvasDocumentKind;
  title?: string;
  preferredHeight?: number;
  createdAt: string;
  entryUrl: string;
  localEntrypoint?: string;
  externalUrl?: string;
  surface?: CanvasSurface;
  retentionScope?: string;
  cspSandbox?: 'scripts';
  assets: Array<{
    logicalPath: string;
    contentType?: string;
  }>;
}

// --- Vector Memory & Auto-Recall Hook ---
export type MemoryCategory = 'core' | 'daily' | 'preference' | 'fact' | 'convention' | 'general';
export type EmbeddingProvider = 'local' | 'openai' | 'ollama' | 'gemini';

export interface MemoryEntry {
  id: string;
  text: string;
  category: MemoryCategory;
  importance: number;
  agentId: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
  vector?: number[];
}

export interface MemoryStoreInput {
  text: string;
  category?: MemoryCategory;
  importance?: number;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  similarity: number;
}

export interface AutoRecallConfig {
  enabled: boolean;
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string;
  apiBase?: string;
  maxResults: number;
  minSimilarity: number;
  maxChars: number;
}

export interface RecallHookResult {
  shouldInject: boolean;
  recalledCount: number;
  contextBlock: string;
  memories: MemorySearchResult[];
}

// --- Docker & Container Management Studio ---
export type ContainerEngineType = 'docker' | 'podman' | 'none';
export type ContainerState = 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'unknown';

export interface ContainerSummary {
  id: string;
  names: string[];
  image: string;
  state: ContainerState;
  status: string;
  createdAt: string;
  ports: string[];
  command?: string;
}

export interface ComposeServiceSummary {
  name: string;
  image?: string;
  build?: string;
  ports: string[];
  environment: string[];
  volumes: string[];
}

export interface WorkspaceDockerItem {
  path: string;
  filename: string;
  kind: 'dockerfile' | 'compose' | 'dockerignore';
  services?: ComposeServiceSummary[];
}

export interface DockerEngineStatus {
  isAvailable: boolean;
  engine: ContainerEngineType;
  binaryPath?: string;
  version?: string;
  containersCount: number;
  runningCount: number;
  serverInfo: Record<string, any>;
  error?: string;
}

export interface ContainerExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

// Database Explorer & Visual SQL Query Studio
export interface DatabaseConnectionInfo {
  id: string;
  name: string;
  dialect: 'sqlite' | 'postgresql' | 'mysql';
  path: string;
  size_bytes?: number | null;
  is_workspace_local: boolean;
  table_count: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  primary_key: boolean;
  nullable: boolean;
  default_value?: string | null;
}

export interface TableInfo {
  name: string;
  is_view: boolean;
  columns: ColumnInfo[];
  row_count_estimate?: number | null;
}

export interface DatabaseSchema {
  database_name: string;
  dialect: string;
  tables: TableInfo[];
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  total_rows: number;
  truncated: boolean;
  execution_time_ms: number;
  error?: string | null;
}

export interface QueryRequest {
  db_path: string;
  query: string;
  limit?: number;
}

export interface ExportRequest {
  db_path: string;
  query: string;
  format: 'csv' | 'json';
}



