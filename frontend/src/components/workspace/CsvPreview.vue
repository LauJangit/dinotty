<template>
  <div class="csv-preview">
    <div class="csv-preview-toolbar">
      <div class="csv-preview-summary">
        <TableProperties :size="15" aria-hidden="true" />
        <span>{{ filteredRows.length }} {{ t('csvPreview.rows') }}</span>
        <span class="csv-preview-separator">·</span>
        <span>
          {{ visibleColumnIndexes.length
          }}<template v-if="hiddenColumnIndexes.length > 0"> / {{ columnCount }}</template>
          {{ t('csvPreview.columns') }}
        </span>
      </div>

      <label class="csv-preview-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">{{ t('csvPreview.search') }}</span>
        <input
          v-model="searchText"
          type="search"
          :placeholder="t('csvPreview.search')"
          @input="resetPage"
        />
      </label>

      <button
        type="button"
        class="csv-preview-icon-button"
        :class="{ active: activeControlPanel === 'filter' || filterIsActive }"
        data-testid="csv-filter-toggle"
        :title="t('csvPreview.filter')"
        :aria-label="t('csvPreview.filter')"
        :aria-pressed="activeControlPanel === 'filter'"
        aria-controls="csv-preview-filter-panel"
        @click="toggleControlPanel('filter')"
      >
        <ListFilter :size="16" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="csv-preview-icon-button"
        :class="{ active: activeControlPanel === 'columns' || hiddenColumnIndexes.length > 0 }"
        data-testid="csv-columns-toggle"
        :title="t('csvPreview.chooseColumns')"
        :aria-label="t('csvPreview.chooseColumns')"
        :aria-pressed="activeControlPanel === 'columns'"
        aria-controls="csv-preview-columns-panel"
        @click="toggleControlPanel('columns')"
      >
        <Columns3 :size="16" aria-hidden="true" />
      </button>

      <label class="csv-preview-header-toggle">
        <input v-model="firstRowIsHeader" type="checkbox" @change="resetPage" />
        <span>{{ t('csvPreview.firstRowHeader') }}</span>
      </label>

      <label class="csv-preview-encoding">
        <span class="sr-only">{{ t('csvPreview.encoding') }}</span>
        <select
          v-model="selectedEncoding"
          data-testid="csv-encoding-select"
          :title="t('csvPreview.encoding')"
          :aria-label="t('csvPreview.encoding')"
          @change="changeEncoding"
        >
          <option value="utf-8">UTF-8</option>
          <option value="gbk">GBK</option>
        </select>
      </label>

      <button
        v-if="sourceAvailable"
        type="button"
        class="csv-preview-icon-button"
        data-testid="csv-source-button"
        :title="t('filePreview.source')"
        :aria-label="t('filePreview.source')"
        @click="emitShowSource"
      >
        <Code2 :size="16" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="activeControlPanel === 'filter'"
      id="csv-preview-filter-panel"
      class="csv-preview-control-panel csv-preview-filter-panel"
      data-testid="csv-filter-panel"
    >
      <ListFilter :size="14" aria-hidden="true" />
      <label>
        <span class="sr-only">{{ t('csvPreview.filterColumn') }}</span>
        <select
          v-model.number="filterColumnIndex"
          data-testid="csv-filter-column"
          :aria-label="t('csvPreview.filterColumn')"
          @change="resetPage"
        >
          <option :value="-1">{{ t('csvPreview.allColumns') }}</option>
          <option v-for="columnIndex in columnCount" :key="columnIndex" :value="columnIndex - 1">
            {{ headerText(columnIndex - 1) }}
          </option>
        </select>
      </label>

      <label>
        <span class="sr-only">{{ t('csvPreview.filterOperator') }}</span>
        <select
          v-model="filterOperator"
          data-testid="csv-filter-operator"
          :aria-label="t('csvPreview.filterOperator')"
          @change="resetPage"
        >
          <option value="contains">{{ t('csvPreview.contains') }}</option>
          <option value="equals">{{ t('csvPreview.equals') }}</option>
          <option value="notEquals">{{ t('csvPreview.notEquals') }}</option>
          <option value="startsWith">{{ t('csvPreview.startsWith') }}</option>
          <option value="endsWith">{{ t('csvPreview.endsWith') }}</option>
          <option value="isEmpty">{{ t('csvPreview.isEmpty') }}</option>
          <option value="isNotEmpty">{{ t('csvPreview.isNotEmpty') }}</option>
        </select>
      </label>

      <label v-if="filterOperatorNeedsValue" class="csv-preview-filter-value">
        <span class="sr-only">{{ t('csvPreview.filterValue') }}</span>
        <input
          v-model="filterValue"
          data-testid="csv-filter-value"
          type="text"
          :placeholder="t('csvPreview.filterValue')"
          @input="resetPage"
        />
      </label>

      <button
        type="button"
        class="csv-preview-icon-button"
        data-testid="csv-filter-clear"
        :disabled="!filterIsActive"
        :title="t('csvPreview.clearFilter')"
        :aria-label="t('csvPreview.clearFilter')"
        @click="clearFilter"
      >
        <X :size="15" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="activeControlPanel === 'columns'"
      id="csv-preview-columns-panel"
      class="csv-preview-control-panel csv-preview-columns-panel"
      data-testid="csv-columns-panel"
    >
      <Columns3 :size="14" aria-hidden="true" />
      <button
        type="button"
        class="csv-preview-text-button"
        data-testid="csv-columns-show-all"
        :disabled="hiddenColumnIndexes.length === 0"
        @click="showAllColumns"
      >
        {{ t('csvPreview.showAllColumns') }}
      </button>
      <div class="csv-preview-column-options">
        <label v-for="columnIndex in columnCount" :key="columnIndex">
          <input
            type="checkbox"
            :checked="isColumnVisible(columnIndex - 1)"
            :disabled="visibleColumnIndexes.length === 1 && isColumnVisible(columnIndex - 1)"
            :data-testid="`csv-column-option-${columnIndex - 1}`"
            @change="changeColumnVisibility(columnIndex - 1, $event)"
          />
          <span :title="headerText(columnIndex - 1)">{{ headerText(columnIndex - 1) }}</span>
        </label>
      </div>
    </div>

    <div v-if="truncated" class="csv-preview-notice" role="status">
      {{ t('csvPreview.truncated') }}
    </div>

    <div v-if="encodingLoading" class="csv-preview-notice" role="status">
      {{ t('csvPreview.encodingLoading') }}
    </div>

    <div v-if="encodingError" class="csv-preview-notice error" role="alert">
      {{ encodingError }}
    </div>

    <div v-if="parsedRows.length === 0" class="csv-preview-empty">
      {{ t('csvPreview.empty') }}
    </div>

    <div v-else-if="filteredRows.length === 0" class="csv-preview-empty">
      {{ t('csvPreview.noMatches') }}
    </div>

    <div v-else class="csv-preview-table-scroll">
      <table>
        <thead>
          <tr>
            <th class="csv-preview-row-number" scope="col">#</th>
            <th v-for="columnIndex in visibleColumnIndexes" :key="columnIndex" scope="col">
              {{ headerText(columnIndex) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="visibleRow in visibleRows" :key="visibleRow.sourceIndex">
            <th class="csv-preview-row-number" scope="row">
              {{ visibleRow.sourceIndex + 1 }}
            </th>
            <td
              v-for="columnIndex in visibleColumnIndexes"
              :key="columnIndex"
              :title="cellText(visibleRow.cells, columnIndex)"
            >
              {{ cellText(visibleRow.cells, columnIndex) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="filteredRows.length > 0" class="csv-preview-footer">
      <span>{{ pageStart + 1 }}–{{ pageEnd }} / {{ filteredRows.length }}</span>
      <div class="csv-preview-pagination">
        <button
          type="button"
          class="csv-preview-icon-button"
          :disabled="currentPage <= 1"
          :title="t('csvPreview.previousPage')"
          :aria-label="t('csvPreview.previousPage')"
          @click="goToPreviousPage"
        >
          <ChevronLeft :size="16" aria-hidden="true" />
        </button>
        <span>{{ currentPage }} / {{ pageCount }}</span>
        <button
          type="button"
          class="csv-preview-icon-button"
          :disabled="currentPage >= pageCount"
          :title="t('csvPreview.nextPage')"
          :aria-label="t('csvPreview.nextPage')"
          @click="goToNextPage"
        >
          <ChevronRight :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns3,
  ListFilter,
  Search,
  TableProperties,
  X,
} from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { detectCsvDelimiter, parseCsvText, type CsvRow } from '../../utils/csvPreview'

interface VisibleCsvRow {
  cells: CsvRow
  sourceIndex: number
}

type CsvControlPanel = '' | 'filter' | 'columns'
type CsvFilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'

const props = withDefaults(
  defineProps<{
    content: string
    filePath: string
    rawUrl?: string
    sourceAvailable?: boolean
    truncated: boolean
    pageSize?: number
  }>(),
  {
    pageSize: 200,
    rawUrl: '',
    sourceAvailable: true,
  }
)

const emit = defineEmits<{
  showSource: []
}>()

const { t } = useI18n()
const searchText = ref('')
const firstRowIsHeader = ref(true)
const currentPage = ref(1)
const selectedEncoding = ref('utf-8')
const displayedContent = ref(props.content)
const rawBytes = ref<ArrayBuffer | null>(null)
const encodingLoading = ref(false)
const encodingError = ref('')
const activeControlPanel = ref<CsvControlPanel>('')
const filterColumnIndex = ref(-1)
const filterOperator = ref<CsvFilterOperator>('contains')
const filterValue = ref('')
const hiddenColumnIndexes = ref<number[]>([])

const parsedRows = computed(function computeParsedRows() {
  // 步骤1：检测当前文件的分隔符。
  const delimiter = detectCsvDelimiter(displayedContent.value, props.filePath)

  // 步骤2：解析全部预览文本。
  return parseCsvText(displayedContent.value, delimiter)
})

const columnCount = computed(function computeColumnCount() {
  // 步骤1：以最长记录作为表格列数。
  let longestRowLength = 0
  for (let rowIndex = 0; rowIndex < parsedRows.value.length; rowIndex += 1) {
    const currentLength = parsedRows.value[rowIndex].length
    if (currentLength > longestRowLength) longestRowLength = currentLength
  }
  return longestRowLength
})

const visibleColumnIndexes = computed(function computeVisibleColumnIndexes() {
  // 步骤1：按文件中的原始顺序收集未隐藏的列。
  const columnIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
    if (!hiddenColumnIndexes.value.includes(columnIndex)) columnIndexes.push(columnIndex)
  }
  return columnIndexes
})

const filterOperatorNeedsValue = computed(function computeFilterOperatorNeedsValue() {
  // 步骤1：为空和非空条件不需要额外输入值。
  return filterOperator.value !== 'isEmpty' && filterOperator.value !== 'isNotEmpty'
})

const filterIsActive = computed(function computeFilterIsActive() {
  // 步骤1：为空和非空条件在选中后立即生效。
  if (!filterOperatorNeedsValue.value) return true

  // 步骤2：其他匹配方式只在输入了条件值后生效。
  return filterValue.value.trim() !== ''
})

const filteredRows = computed(function computeFilteredRows() {
  // 步骤1：确定数据起始行和搜索文本。
  const firstDataRowIndex = firstRowIsHeader.value ? 1 : 0
  const normalizedSearchText = searchText.value.trim().toLocaleLowerCase()
  const matchingRows: VisibleCsvRow[] = []

  // 步骤2：逐行、逐单元格匹配搜索内容。
  for (let rowIndex = firstDataRowIndex; rowIndex < parsedRows.value.length; rowIndex += 1) {
    const currentRow = parsedRows.value[rowIndex]
    let rowMatches = normalizedSearchText === ''

    if (!rowMatches) {
      for (let columnIndex = 0; columnIndex < currentRow.length; columnIndex += 1) {
        const normalizedCell = currentRow[columnIndex].toLocaleLowerCase()
        if (normalizedCell.includes(normalizedSearchText)) {
          rowMatches = true
          break
        }
      }
    }

    if (rowMatches && rowMatchesFilter(currentRow)) {
      matchingRows.push({ cells: currentRow, sourceIndex: rowIndex })
    }
  }

  return matchingRows
})

const pageCount = computed(function computePageCount() {
  // 步骤1：至少保留一页，避免显示零页。
  return Math.max(1, Math.ceil(filteredRows.value.length / props.pageSize))
})

const pageStart = computed(function computePageStart() {
  // 步骤1：计算当前页在过滤结果中的起始位置。
  return (currentPage.value - 1) * props.pageSize
})

const pageEnd = computed(function computePageEnd() {
  // 步骤1：确保结束位置不会超过过滤结果长度。
  return Math.min(pageStart.value + props.pageSize, filteredRows.value.length)
})

const visibleRows = computed(function computeVisibleRows() {
  // 步骤1：用普通循环收集当前页数据。
  const currentRows: VisibleCsvRow[] = []
  for (let rowIndex = pageStart.value; rowIndex < pageEnd.value; rowIndex += 1) {
    currentRows.push(filteredRows.value[rowIndex])
  }
  return currentRows
})

function headerText(columnIndex: number): string {
  // 步骤1：启用表头时优先使用文件首行内容。
  if (firstRowIsHeader.value && parsedRows.value[0]?.[columnIndex] !== undefined) {
    return parsedRows.value[0][columnIndex]
  }

  // 步骤2：没有表头时生成稳定的列名。
  return `${t('csvPreview.column')} ${columnIndex + 1}`
}

function cellText(row: CsvRow, columnIndex: number): string {
  // 步骤1：缺失字段显示为空字符串。
  return row[columnIndex] ?? ''
}

function cellMatchesFilter(cellValue: string): boolean {
  // 步骤1：统一使用不区分大小写的文本进行匹配。
  const normalizedCellValue = cellValue.toLocaleLowerCase()
  const normalizedFilterValue = filterValue.value.trim().toLocaleLowerCase()

  // 步骤2：按当前匹配方式判断单元格。
  switch (filterOperator.value) {
    case 'equals':
      return normalizedCellValue === normalizedFilterValue
    case 'notEquals':
      return normalizedCellValue !== normalizedFilterValue
    case 'startsWith':
      return normalizedCellValue.startsWith(normalizedFilterValue)
    case 'endsWith':
      return normalizedCellValue.endsWith(normalizedFilterValue)
    case 'isEmpty':
      return cellValue.trim() === ''
    case 'isNotEmpty':
      return cellValue.trim() !== ''
    default:
      return normalizedCellValue.includes(normalizedFilterValue)
  }
}

function rowMatchesFilter(row: CsvRow): boolean {
  // 步骤1：没有完整条件时保留当前行。
  if (!filterIsActive.value) return true

  // 步骤2：选择了具体列时只判断该列。
  if (filterColumnIndex.value >= 0) {
    return cellMatchesFilter(cellText(row, filterColumnIndex.value))
  }

  // 步骤3：选择全部列时，任意一列满足条件即可保留该行。
  for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
    if (cellMatchesFilter(cellText(row, columnIndex))) return true
  }
  return false
}

function toggleControlPanel(panel: CsvControlPanel): void {
  // 步骤1：再次点击当前按钮时收起面板，否则切换到目标面板。
  if (activeControlPanel.value === panel) {
    activeControlPanel.value = ''
    return
  }
  activeControlPanel.value = panel
}

function clearFilter(): void {
  // 步骤1：恢复默认条件并回到第一页。
  filterColumnIndex.value = -1
  filterOperator.value = 'contains'
  filterValue.value = ''
  resetPage()
}

function isColumnVisible(columnIndex: number): boolean {
  // 步骤1：未记录在隐藏列表中的列即为可见列。
  return !hiddenColumnIndexes.value.includes(columnIndex)
}

function changeColumnVisibility(columnIndex: number, event: Event): void {
  // 步骤1：读取复选框的新状态。
  const checkbox = event.target as HTMLInputElement
  const updatedHiddenIndexes: number[] = []

  // 步骤2：显示列时从隐藏列表中移除该列。
  if (checkbox.checked) {
    for (let index = 0; index < hiddenColumnIndexes.value.length; index += 1) {
      const hiddenColumnIndex = hiddenColumnIndexes.value[index]
      if (hiddenColumnIndex !== columnIndex) updatedHiddenIndexes.push(hiddenColumnIndex)
    }
    hiddenColumnIndexes.value = updatedHiddenIndexes
    return
  }

  // 步骤3：隐藏列时至少保留一列可见。
  if (visibleColumnIndexes.value.length <= 1) return
  for (let index = 0; index < hiddenColumnIndexes.value.length; index += 1) {
    updatedHiddenIndexes.push(hiddenColumnIndexes.value[index])
  }
  updatedHiddenIndexes.push(columnIndex)
  hiddenColumnIndexes.value = updatedHiddenIndexes
}

function showAllColumns(): void {
  // 步骤1：清空隐藏列表以恢复全部列。
  hiddenColumnIndexes.value = []
}

function resetPage(): void {
  // 步骤1：筛选条件变化后回到第一页。
  currentPage.value = 1
}

async function loadRawBytes(): Promise<ArrayBuffer> {
  // 步骤1：优先复用已经加载的原始字节。
  if (rawBytes.value) return rawBytes.value

  // 步骤2：没有原始文件地址时给出明确错误。
  if (!props.rawUrl) throw new Error(t('csvPreview.rawUnavailable'))

  // 步骤3：只请求前 512 KB，避免大文件占满浏览器内存。
  const response = await fetch(props.rawUrl, {
    headers: { Range: 'bytes=0-524287' },
  })
  if (!response.ok) throw new Error(t('csvPreview.rawLoadFailed'))

  // 步骤4：缓存响应字节供后续编码切换使用。
  rawBytes.value = await response.arrayBuffer()
  return rawBytes.value
}

async function changeEncoding(): Promise<void> {
  // 步骤1：重置分页和错误状态。
  resetPage()
  encodingError.value = ''

  // 步骤2：UTF-8 直接使用后端已经解码的文本。
  if (selectedEncoding.value === 'utf-8') {
    displayedContent.value = props.content
    return
  }

  // 步骤3：其他编码读取受限原始字节并在浏览器解码。
  encodingLoading.value = true
  try {
    const bytes = await loadRawBytes()
    const textDecoder = new TextDecoder(selectedEncoding.value)
    displayedContent.value = textDecoder.decode(bytes)
  } catch (error) {
    encodingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    encodingLoading.value = false
  }
}

async function loadMissingContent(): Promise<void> {
  // 步骤1：已有后端文本或没有原始地址时无需额外读取。
  if (props.content !== '' || !props.rawUrl) return

  // 步骤2：读取受限原始字节并先按 UTF-8 展示。
  encodingLoading.value = true
  encodingError.value = ''
  try {
    const bytes = await loadRawBytes()
    const textDecoder = new TextDecoder('utf-8')
    displayedContent.value = textDecoder.decode(bytes)
  } catch (error) {
    encodingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    encodingLoading.value = false
  }
}

onMounted(function initializeMissingContent() {
  // 步骤1：后端无法解码时从原始文件初始化预览。
  void loadMissingContent()
})

function currentContent(): string {
  // 步骤1：向 Vue 提供可监听的内容值。
  return props.content
}

function currentFilePath(): string {
  // 步骤1：向 Vue 提供可监听的文件路径。
  return props.filePath
}

watch([currentContent, currentFilePath], function synchronizeSelectedFile(values) {
  // 步骤1：读取新文件内容并清空旧文件缓存。
  const newContent = values[0]
  displayedContent.value = newContent
  rawBytes.value = null

  // 步骤2：恢复新文件的默认筛选、分页和编码状态。
  searchText.value = ''
  currentPage.value = 1
  selectedEncoding.value = 'utf-8'
  encodingError.value = ''
  activeControlPanel.value = ''
  filterColumnIndex.value = -1
  filterOperator.value = 'contains'
  filterValue.value = ''
  hiddenColumnIndexes.value = []

  // 步骤3：后端没有文本时重新读取当前文件原始字节。
  if (newContent === '') void loadMissingContent()
})

function goToPreviousPage(): void {
  // 步骤1：尚有上一页时减少页码。
  if (currentPage.value > 1) currentPage.value -= 1
}

function goToNextPage(): void {
  // 步骤1：尚有下一页时增加页码。
  if (currentPage.value < pageCount.value) currentPage.value += 1
}

function emitShowSource(): void {
  // 步骤1：通知文件预览器切换到源码视图。
  emit('showSource')
}
</script>

<style scoped>
.csv-preview {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg, #cccccc);
  background: var(--bg-surface, #141414);
  font-family: var(--font-mono, monospace);
  container-type: inline-size;
}

.csv-preview-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #333333);
  background: var(--tab-bg, #252525);
}

.csv-preview-summary,
.csv-preview-header-toggle,
.csv-preview-encoding,
.csv-preview-search,
.csv-preview-pagination {
  display: flex;
  align-items: center;
}

.csv-preview-summary {
  gap: 5px;
  color: var(--fg-muted, #888888);
  font-size: 12px;
  white-space: nowrap;
}

.csv-preview-summary svg {
  color: var(--accent, #89b4fa);
}

.csv-preview-separator {
  opacity: 0.55;
}

.csv-preview-search {
  flex: 1 1 180px;
  min-width: 140px;
  max-width: 320px;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
}

.csv-preview-search:focus-within {
  border-color: var(--accent, #89b4fa);
}

.csv-preview-search input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--fg, #cccccc);
  font: inherit;
  font-size: 12px;
}

.csv-preview-header-toggle {
  gap: 5px;
  color: var(--fg-muted, #888888);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.csv-preview-header-toggle input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent, #89b4fa);
}

.csv-preview-encoding select {
  box-sizing: border-box;
  height: 28px;
  padding: 0 22px 0 7px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  outline: 0;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  font: inherit;
  font-size: 11px;
}

.csv-preview-encoding select:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-icon-button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-icon-button:hover:not(:disabled) {
  border-color: var(--accent, #89b4fa);
  color: var(--fg-bright, #eeeeee);
}

.csv-preview-icon-button.active {
  border-color: var(--accent, #89b4fa);
  background: color-mix(in srgb, var(--accent, #89b4fa) 12%, var(--bg, #1a1a1a));
  color: var(--accent, #89b4fa);
}

.csv-preview-icon-button:focus-visible,
.csv-preview-header-toggle input:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-icon-button:disabled {
  cursor: default;
  opacity: 0.35;
}

.csv-preview-control-panel {
  display: flex;
  min-width: 0;
  min-height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border, #333333);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.csv-preview-control-panel > svg {
  flex: 0 0 auto;
  color: var(--accent, #89b4fa);
}

.csv-preview-control-panel select,
.csv-preview-filter-value input {
  box-sizing: border-box;
  height: 28px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  outline: 0;
  background: var(--bg-surface, #141414);
  color: var(--fg, #cccccc);
  font: inherit;
}

.csv-preview-control-panel select {
  max-width: 180px;
  padding: 0 24px 0 8px;
}

.csv-preview-filter-value {
  min-width: 120px;
  max-width: 280px;
  flex: 1 1 180px;
}

.csv-preview-filter-value input {
  width: 100%;
  padding: 0 8px;
}

.csv-preview-control-panel select:focus-visible,
.csv-preview-filter-value input:focus-visible,
.csv-preview-text-button:focus-visible,
.csv-preview-column-options input:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-text-button {
  height: 28px;
  flex: 0 0 auto;
  padding: 0 8px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg-surface, #141414);
  color: var(--fg, #cccccc);
  font: inherit;
  cursor: pointer;
}

.csv-preview-text-button:hover:not(:disabled) {
  border-color: var(--accent, #89b4fa);
}

.csv-preview-text-button:disabled {
  cursor: default;
  opacity: 0.4;
}

.csv-preview-column-options {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.csv-preview-column-options label {
  display: flex;
  max-width: 180px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-column-options label:has(input:checked) {
  color: var(--fg, #cccccc);
}

.csv-preview-column-options input {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin: 0;
  accent-color: var(--accent, #89b4fa);
}

.csv-preview-column-options span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-preview-notice {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.csv-preview-notice.error {
  border-bottom-color: color-mix(in srgb, var(--color-red, #f44747) 35%, transparent);
  background: color-mix(in srgb, var(--color-red, #f44747) 8%, transparent);
  color: var(--color-red, #f44747);
}

.csv-preview-empty {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 16px;
  color: var(--fg-muted, #888888);
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  text-align: center;
}

.csv-preview-table-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.csv-preview table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  line-height: 18px;
}

.csv-preview th,
.csv-preview td {
  box-sizing: border-box;
  max-width: 420px;
  padding: 6px 9px;
  overflow: hidden;
  border-right: 1px solid var(--border, #333333);
  border-bottom: 1px solid var(--border, #333333);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-preview th:last-child,
.csv-preview td:last-child {
  border-right: 0;
}

.csv-preview thead th {
  position: sticky;
  z-index: 2;
  top: 0;
  background: var(--tab-bg, #252525);
  color: var(--fg-bright, #eeeeee);
  font-weight: 600;
}

.csv-preview tbody tr:hover th,
.csv-preview tbody tr:hover td {
  background: var(--bg-hover, #2a2a2a);
}

.csv-preview .csv-preview-row-number {
  position: sticky;
  z-index: 1;
  left: 0;
  width: 52px;
  min-width: 52px;
  max-width: 52px;
  background: var(--tab-bg, #252525);
  color: var(--fg-muted, #888888);
  text-align: right;
  user-select: none;
}

.csv-preview thead .csv-preview-row-number {
  z-index: 3;
}

.csv-preview-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 3px 10px;
  border-top: 1px solid var(--border, #333333);
  background: var(--tab-bg, #252525);
  color: var(--fg-muted, #888888);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.csv-preview-pagination {
  gap: 7px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@container (max-width: 560px) {
  .csv-preview-toolbar {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .csv-preview-search {
    flex: 0 0 150px;
    max-width: 150px;
  }

  .csv-preview-summary,
  .csv-preview-header-toggle,
  .csv-preview-encoding,
  .csv-preview-icon-button {
    flex-shrink: 0;
  }

  .csv-preview-control-panel {
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .csv-preview-filter-panel label,
  .csv-preview-filter-value {
    flex: 0 0 auto;
  }

  .csv-preview-filter-value {
    width: 160px;
  }

  .csv-preview-column-options {
    overflow: visible;
  }
}
</style>
