import axios from 'axios'

// ── 类型定义（与后端 models.py 对齐）────────────────────────────────────────

const http = axios.create({ baseURL: '/api' })
export type TaskStatus =
  | 'pending' | 'detecting' | 'ocr' | 'translating'
  | 'polishing' | 'inpainting' | 'rendering' | 'awaiting_edit'
  | 'done' | 'failed' | 'cancelled'

export type PageStatus =
  | 'pending' | 'processing' | 'awaiting_edit'
  | 'done' | 'failed'
export interface TaskConfig {
  target_lang: string
  translator: string
  polish: boolean
  glossary_id: string | null
  detector: string
  ocr: string
  inpainter: string
  render_translated_text: boolean
  detection_size: number
  context_size: number
  font_size_offset: number
  font_size_minimum: number
  line_spacing: number | null
  disable_font_border: boolean
  mask_dilation_offset: number
  mask_kernel_size: number
  inpainting_size: number
  font_path: string
  interactive_edit: boolean
}

export interface TextBlockResult {
  xyxy: [number, number, number, number]
  original_text: string
  translated_text: string
  polished_text: string
}

export interface Page {
  filename: string
  upload_path: string
  result_path: string
  inpainted_path: string
  text_blocks: TextBlockResult[]
  status: PageStatus
  error: string | null
}

export interface Task {
  id: string
  name: string
  status: TaskStatus
  created_at: string
  config: TaskConfig
  pages: Page[]
  error: string | null
}

export interface ProgressEvent {
  state: TaskStatus
  progress_pct: number
  message_cn: string
  done: boolean
}

export interface GlossaryEntry {
  source: string
  target: string
  note: string
}

export interface GlossaryMeta {
  id: string
  name: string
  created_at: string
  entry_count: number
}

export interface Glossary extends GlossaryMeta {
  entries: GlossaryEntry[]
}

export interface OptionItem {
  id: string
  name: string
}

export interface TranslatorOption extends OptionItem {
  requires_key: boolean
  configured: boolean
  supported_langs: string[] | null
}

export interface OptionsResponse {
  languages: OptionItem[]
  translators: TranslatorOption[]
  detectors: OptionItem[]
  ocr: OptionItem[]
  inpainters: OptionItem[]
}

export interface CreateTaskResponse {
  task_id: string
  page_count: number
}
export interface ConfigField {
  env_var: string
  label: string
  field_type: string  // text, password
  required: boolean
  value: string
}

export interface TranslatorConfigItem {
  translator: string
  display_name: string
  category: string  // "translator" | "llm" | "polish"
  fields: ConfigField[]
  configured: boolean
}

export async function getTranslatorConfigs(): Promise<TranslatorConfigItem[]> {
  const { data } = await http.get('/config/translator')
  return data
}


export interface CustomTranslatorPreset {
  id: string
  name: string
  engine: 'openai' | 'custom_openai'
  api_key: string
  api_base: string
  model: string
}

export async function listCustomTranslators(): Promise<{ items: CustomTranslatorPreset[] }> {
  const { data } = await http.get('/config/custom-translators')
  return data
}

export async function saveCustomTranslator(preset: Partial<CustomTranslatorPreset>): Promise<CustomTranslatorPreset> {
  const { data } = await http.post('/config/custom-translators', preset)
  return data
}

export async function deleteCustomTranslator(id: string): Promise<void> {
  await http.delete(`/config/custom-translators/${id}`)
}
export async function saveTranslatorConfig(payload: {
  translator: string
  values: Record<string, string>
}): Promise<{ status: string }> {
  const { data } = await http.post('/config/translator', payload)
  return data
}

export interface ModelStatus {
  category: string
  id: string
  downloaded: boolean
  error?: string
}

export async function getModelStatus(): Promise<{ models: ModelStatus[] }> {
  const { data } = await http.get('/models/status')
  return data
}

export interface HealthResponse {
  status: string
  gpu: boolean
  version: string
}

// ── 默认 TaskConfig ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: Partial<TaskConfig> = {
  target_lang: 'CHS',
  translator: 'google',
  polish: false,
  glossary_id: null,
  detector: 'default',
  ocr: 'ocr48px',
  inpainter: 'lama_large',
  render_translated_text: true,
  detection_size: 2048,
  context_size: 2,
  font_size_offset: 0,
  font_size_minimum: 10,
  line_spacing: null,
  disable_font_border: false,
  font_path: '',
  interactive_edit: false,
}

// ── 任务 API ─────────────────────────────────────────────────────────────────

export async function createTask(
  images: File[],
  config: Partial<TaskConfig>,
): Promise<CreateTaskResponse> {
  const form = new FormData()
  images.forEach((img) => form.append('images', img))
  form.append('config', JSON.stringify(config))
  const { data } = await http.post('/tasks', form)
  return data
}

export async function listTasks(page = 1, limit = 20): Promise<{ total: number; items: Task[] }> {
  const { data } = await http.get('/tasks', { params: { page, limit } })
  return data
}

export async function getTask(taskId: string): Promise<Task> {
  const { data } = await http.get(`/tasks/${taskId}`)
  return data
}

export async function deleteTask(taskId: string): Promise<void> {
  await http.delete(`/tasks/${taskId}`)
}

export async function cancelTask(taskId: string): Promise<{ status: string }> {
  const { data } = await http.post(`/tasks/${taskId}/cancel`)
  return data
}

export function getResultUrl(taskId: string, page = 1): string {
  return `/api/tasks/${taskId}/result?page=${page}`
}

export function getInpaintedUrl(taskId: string, page = 1): string {
  return `/api/tasks/${taskId}/inpainted?page=${page}`
}

export function getDownloadAllUrl(taskId: string, format: "zip" | "cbz" = "zip"): string {
  return `/api/tasks/${taskId}/download?format=${format}`
}

export interface EditableTextBlock {
  index: number
  original_text: string
  translated_text: string
  polished_text: string
  center: number[]
  size: number[]
  xyxy: number[]
  font_size: number
  fg_color: number[]
  bg_color: number[]
  horizontal: boolean
}

export interface EditablePage {
  page_index: number
  filename: string
  status: PageStatus
  text_blocks: EditableTextBlock[]
}

export interface EditableBlocksResponse {
  task_id: string
  pages: EditablePage[]
}

export async function getEditableBlocks(taskId: string): Promise<EditableBlocksResponse> {
  const { data } = await http.get(`/tasks/${taskId}/edit`)
  return data
}

export async function submitEdits(
  taskId: string,
  pages: Record<string, string[]>,
  offsets?: Record<string, number[][]>,
): Promise<{ task_id: string; status: string }> {
  const { data } = await http.post(`/tasks/${taskId}/edit`, { pages, offsets })
  return data
}

export async function updateTaskConfig(
  taskId: string,
  config: Partial<TaskConfig>,
): Promise<{ task_id: string; updated: string[] }> {
  const { data } = await http.patch(`/tasks/${taskId}/config`, config)
  return data
}

export async function renderPreview(
  taskId: string,
  pageIndex: number,
  texts: string[],
  offsets: number[][],
): Promise<string> {
  const { data } = await http.post(`/tasks/${taskId}/preview`, {
    page_index: pageIndex,
    texts,
    offsets,
  }, { responseType: 'blob', timeout: 30000 })
  return URL.createObjectURL(data)
}

// ── 术语库 API ────────────────────────────────────────────────────────────────

export async function listGlossaries(): Promise<GlossaryMeta[]> {
  const { data } = await http.get('/glossaries')
  return data
}

export async function getGlossary(id: string): Promise<Glossary> {
  const { data } = await http.get(`/glossaries/${id}`)
  return data
}

export async function createGlossary(name: string): Promise<GlossaryMeta> {
  const { data } = await http.post('/glossaries', { name })
  return data
}

export async function deleteGlossary(id: string): Promise<void> {
  await http.delete(`/glossaries/${id}`)
}

export async function updateEntries(id: string, entries: GlossaryEntry[]): Promise<Glossary> {
  const { data } = await http.put(`/glossaries/${id}`, { entries })
  return data
}

export async function deleteEntry(id: string, source: string): Promise<void> {
  await http.delete(`/glossaries/${id}/entries/${encodeURIComponent(source)}`)
}

export async function addGlossaryEntry(
  glossaryId: string,
  source: string,
  target: string,
  note?: string,
): Promise<{ status: string; entry_count: number }> {
  const { data } = await http.post(`/glossaries/${glossaryId}/entries`, { source, target, note })
  return data
}
// ── 配置 API ──────────────────────────────────────────────────────────────────

export async function getOptions(): Promise<OptionsResponse> {
  const { data } = await http.get('/options')
  return data
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await http.get('/health')
  return data
}


// ── SSE 进度订阅 ──────────────────────────────────────────────────────────────

export function subscribeProgress(
  taskId: string,
  onEvent: (e: ProgressEvent) => void,
  onError?: () => void,
): () => void {
  const es = new EventSource(`/api/tasks/${taskId}/progress`)
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data))
    } catch { /* ignore */ }
  }
  es.onerror = () => {
    es.close()
    onError?.()
  }
  return () => es.close()
}


export interface LogFile {
  name: string
  size: number
  size_human: string
  modified: string
}

export async function listLogs(): Promise<{ files: LogFile[] }> {
  const { data } = await http.get('/logs')
  return data
}

export async function readLog(filename: string, tail = 500): Promise<{ filename: string; content: string; tail: number }> {
  const { data } = await http.get(`/logs/${filename}`, { params: { tail } })
  return data
}

export async function deleteLog(filename: string): Promise<void> {
  await http.delete(`/logs/${filename}`)
}


export interface FontInfo {
  name: string
  path: string
  builtin: boolean
  cjk: boolean
  note: string
}

export async function listFonts(): Promise<{ fonts: FontInfo[] }> {
  const { data } = await http.get('/fonts')
  return data
}

export async function uploadFont(file: File): Promise<FontInfo> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post('/fonts/upload', form)
  return data
}

export async function deleteFont(filename: string): Promise<void> {
  await http.delete(`/fonts/${encodeURIComponent(filename)}`)
}

export async function updateFontNote(filename: string, note: string): Promise<void> {
  await http.patch(`/fonts/${encodeURIComponent(filename)}/note`, { note })
}
