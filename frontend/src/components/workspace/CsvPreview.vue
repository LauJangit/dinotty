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
        :class="{ active: filterPanelOpen || filterIsActive }"
        data-testid="csv-filter-toggle"
        :title="t('csvPreview.filter')"
        :aria-label="t('csvPreview.filter')"
        :aria-pressed="filterPanelOpen"
        aria-controls="csv-preview-filter-panel"
        @click="toggleFilterPanel"
      >
        <ListFilter :size="16" aria-hidden="true" />
        <span v-if="activeFilterCount > 0" class="csv-preview-filter-count">
          {{ activeFilterCount }}
        </span>
      </button>

      <button
        ref="columnsButtonElement"
        type="button"
        class="csv-preview-icon-button"
        :class="{ active: columnDialogOpen || hiddenColumnIndexes.length > 0 }"
        data-testid="csv-columns-toggle"
        :title="t('csvPreview.chooseColumns')"
        :aria-label="t('csvPreview.chooseColumns')"
        aria-haspopup="dialog"
        :aria-expanded="columnDialogOpen"
        aria-controls="csv-preview-columns-dialog"
        @click="openColumnDialog"
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
      v-if="filterPanelOpen"
      id="csv-preview-filter-panel"
      class="csv-preview-filter-panel"
      data-testid="csv-filter-panel"
    >
      <div class="csv-preview-filter-header">
        <div
          class="csv-preview-logic-switch"
          role="group"
          :aria-label="t('csvPreview.combineMode')"
        >
          <button
            type="button"
            :class="{ active: filterLogicMode === 'and' }"
            data-testid="csv-filter-logic-and"
            :aria-pressed="filterLogicMode === 'and'"
            @click="setFilterLogicMode('and')"
          >
            {{ t('csvPreview.matchAll') }}
          </button>
          <button
            type="button"
            :class="{ active: filterLogicMode === 'or' }"
            data-testid="csv-filter-logic-or"
            :aria-pressed="filterLogicMode === 'or'"
            @click="setFilterLogicMode('or')"
          >
            {{ t('csvPreview.matchAny') }}
          </button>
        </div>

        <button
          type="button"
          class="csv-preview-text-button"
          data-testid="csv-filter-add"
          @click="addFilterCondition"
        >
          <Plus :size="14" aria-hidden="true" />
          {{ t('csvPreview.addCondition') }}
        </button>

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

      <div class="csv-preview-filter-conditions">
        <div
          v-for="(condition, conditionIndex) in filterConditions"
          :key="condition.id"
          class="csv-preview-filter-condition"
          :data-testid="`csv-filter-condition-${conditionIndex}`"
        >
          <span class="csv-preview-condition-number">{{ conditionIndex + 1 }}</span>

          <label class="csv-preview-filter-negate">
            <input
              v-model="condition.negated"
              type="checkbox"
              :data-testid="`csv-filter-negate-${conditionIndex}`"
              @change="resetPage"
            />
            <span>{{ t('csvPreview.negate') }}</span>
          </label>

          <label>
            <span class="sr-only">{{ t('csvPreview.filterColumn') }}</span>
            <select
              v-model.number="condition.columnIndex"
              :data-testid="`csv-filter-column-${conditionIndex}`"
              :aria-label="t('csvPreview.filterColumn')"
              @change="resetPage"
            >
              <option :value="-1">{{ t('csvPreview.allColumns') }}</option>
              <option
                v-for="columnIndex in columnCount"
                :key="columnIndex"
                :value="columnIndex - 1"
              >
                {{ headerText(columnIndex - 1) }}
              </option>
            </select>
          </label>

          <label>
            <span class="sr-only">{{ t('csvPreview.filterOperator') }}</span>
            <select
              v-model="condition.operator"
              :data-testid="`csv-filter-operator-${conditionIndex}`"
              :aria-label="t('csvPreview.filterOperator')"
              @change="resetPage"
            >
              <option value="contains">{{ t('csvPreview.contains') }}</option>
              <option value="notContains">{{ t('csvPreview.notContains') }}</option>
              <option value="equals">{{ t('csvPreview.equals') }}</option>
              <option value="notEquals">{{ t('csvPreview.notEquals') }}</option>
              <option value="startsWith">{{ t('csvPreview.startsWith') }}</option>
              <option value="endsWith">{{ t('csvPreview.endsWith') }}</option>
              <option value="isEmpty">{{ t('csvPreview.isEmpty') }}</option>
              <option value="isNotEmpty">{{ t('csvPreview.isNotEmpty') }}</option>
              <optgroup :label="t('csvPreview.numberOperators')">
                <option value="numberEquals">{{ t('csvPreview.numberEquals') }}</option>
                <option value="numberGreaterThan">
                  {{ t('csvPreview.numberGreaterThan') }}
                </option>
                <option value="numberGreaterThanOrEqual">
                  {{ t('csvPreview.numberGreaterThanOrEqual') }}
                </option>
                <option value="numberLessThan">{{ t('csvPreview.numberLessThan') }}</option>
                <option value="numberLessThanOrEqual">
                  {{ t('csvPreview.numberLessThanOrEqual') }}
                </option>
              </optgroup>
              <optgroup :label="t('csvPreview.dateOperators')">
                <option value="dateEquals">{{ t('csvPreview.dateEquals') }}</option>
                <option value="dateBefore">{{ t('csvPreview.dateBefore') }}</option>
                <option value="dateBeforeOrEqual">
                  {{ t('csvPreview.dateBeforeOrEqual') }}
                </option>
                <option value="dateAfter">{{ t('csvPreview.dateAfter') }}</option>
                <option value="dateAfterOrEqual">
                  {{ t('csvPreview.dateAfterOrEqual') }}
                </option>
              </optgroup>
            </select>
          </label>

          <label v-if="conditionNeedsValue(condition)" class="csv-preview-filter-value">
            <span class="sr-only">{{ t('csvPreview.filterValue') }}</span>
            <input
              v-model="condition.value"
              :data-testid="`csv-filter-value-${conditionIndex}`"
              :type="conditionInputType(condition)"
              :step="conditionInputType(condition) === 'number' ? 'any' : undefined"
              :placeholder="t('csvPreview.filterValue')"
              @input="resetPage"
            />
          </label>
          <span v-else class="csv-preview-filter-value-placeholder"></span>

          <button
            type="button"
            class="csv-preview-icon-button"
            :disabled="filterConditions.length <= 1"
            :title="t('csvPreview.removeCondition')"
            :aria-label="t('csvPreview.removeCondition')"
            :data-testid="`csv-filter-remove-${conditionIndex}`"
            @click="removeFilterCondition(conditionIndex)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="columnDialogOpen"
      class="csv-preview-dialog-backdrop"
      @click.self="cancelColumnDialog"
    >
      <section
        id="csv-preview-columns-dialog"
        ref="columnDialogElement"
        class="csv-preview-columns-dialog"
        data-testid="csv-columns-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-preview-columns-title"
        tabindex="-1"
        @keydown.esc="cancelColumnDialog"
      >
        <header class="csv-preview-dialog-header">
          <div>
            <h2 id="csv-preview-columns-title">{{ t('csvPreview.chooseColumns') }}</h2>
            <span>
              {{ draftVisibleColumnIndexes.length }} / {{ columnCount }}
              {{ t('csvPreview.columns') }}
            </span>
          </div>
          <button
            type="button"
            class="csv-preview-icon-button"
            :title="t('cancel')"
            :aria-label="t('cancel')"
            @click="cancelColumnDialog"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </header>

        <div class="csv-preview-dialog-tools">
          <button
            type="button"
            class="csv-preview-text-button"
            data-testid="csv-columns-select-all"
            :disabled="draftVisibleColumnIndexes.length === columnCount"
            @click="selectAllDraftColumns"
          >
            {{ t('csvPreview.showAllColumns') }}
          </button>
          <button
            type="button"
            class="csv-preview-text-button"
            data-testid="csv-columns-select-none"
            :disabled="draftVisibleColumnIndexes.length === 0"
            @click="selectNoDraftColumns"
          >
            {{ t('csvPreview.hideAllColumns') }}
          </button>
        </div>

        <div class="csv-preview-dialog-column-list">
          <label v-for="columnIndex in columnCount" :key="columnIndex">
            <input
              type="checkbox"
              :checked="isDraftColumnVisible(columnIndex - 1)"
              :data-testid="`csv-column-option-${columnIndex - 1}`"
              @change="changeDraftColumnVisibility(columnIndex - 1, $event)"
            />
            <span :title="headerText(columnIndex - 1)">{{ headerText(columnIndex - 1) }}</span>
          </label>
        </div>

        <footer class="csv-preview-dialog-footer">
          <button
            type="button"
            class="csv-preview-text-button"
            data-testid="csv-columns-cancel"
            @click="cancelColumnDialog"
          >
            {{ t('cancel') }}
          </button>
          <button
            type="button"
            class="csv-preview-primary-button"
            data-testid="csv-columns-confirm"
            @click="confirmColumnDialog"
          >
            {{ t('csvPreview.confirm') }}
          </button>
        </footer>
      </section>
    </div>

    <div v-if="displayedContentIsTruncated" class="csv-preview-notice" role="status">
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns3,
  ListFilter,
  Plus,
  Search,
  TableProperties,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { detectCsvDelimiter, parseCsvText, type CsvRow } from '../../utils/csvPreview'

interface VisibleCsvRow {
  cells: CsvRow
  sourceIndex: number
}

interface CsvFilterCondition {
  id: number
  columnIndex: number
  operator: CsvFilterOperator
  value: string
  negated: boolean
}

type CsvFilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'numberEquals'
  | 'numberGreaterThan'
  | 'numberGreaterThanOrEqual'
  | 'numberLessThan'
  | 'numberLessThanOrEqual'
  | 'dateEquals'
  | 'dateBefore'
  | 'dateBeforeOrEqual'
  | 'dateAfter'
  | 'dateAfterOrEqual'

type CsvFilterLogicMode = 'and' | 'or'

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
const displayedContentIsTruncated = ref(props.truncated)
const rawBytes = ref<ArrayBuffer | null>(null)
const encodingLoading = ref(false)
const encodingError = ref('')
const filterPanelOpen = ref(false)
const filterLogicMode = ref<CsvFilterLogicMode>('and')
let nextFilterConditionId = 0
const filterConditions = ref<CsvFilterCondition[]>([createFilterCondition()])
const hiddenColumnIndexes = ref<number[]>([])
const columnDialogOpen = ref(false)
const draftVisibleColumnIndexes = ref<number[]>([])
const columnDialogElement = ref<HTMLElement | null>(null)
const columnsButtonElement = ref<HTMLButtonElement | null>(null)

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

const activeFilterCount = computed(function computeActiveFilterCount() {
  // 步骤1：统计已经填写完整的筛选条件。
  let activeConditionCount = 0
  for (
    let conditionIndex = 0;
    conditionIndex < filterConditions.value.length;
    conditionIndex += 1
  ) {
    if (conditionIsComplete(filterConditions.value[conditionIndex])) activeConditionCount += 1
  }
  return activeConditionCount
})

const filterIsActive = computed(function computeFilterIsActive() {
  // 步骤1：至少有一条完整条件时筛选生效。
  return activeFilterCount.value > 0
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

function createFilterCondition(): CsvFilterCondition {
  // 步骤1：创建一条可直接编辑的新条件。
  const condition: CsvFilterCondition = {
    id: nextFilterConditionId,
    columnIndex: -1,
    operator: 'contains',
    value: '',
    negated: false,
  }
  nextFilterConditionId += 1
  return condition
}

function conditionNeedsValue(condition: CsvFilterCondition): boolean {
  // 步骤1：为空和非空条件不需要额外输入值。
  return condition.operator !== 'isEmpty' && condition.operator !== 'isNotEmpty'
}

function conditionInputType(condition: CsvFilterCondition): 'text' | 'number' | 'date' {
  // 步骤1：数值运算符使用浏览器的数字输入控件。
  if (condition.operator.startsWith('number')) return 'number'

  // 步骤2：日期运算符使用浏览器的日期输入控件。
  if (condition.operator.startsWith('date')) return 'date'

  // 步骤3：其他运算符继续使用普通文本输入框。
  return 'text'
}

function conditionIsComplete(condition: CsvFilterCondition): boolean {
  // 步骤1：无需输入值的条件在选中后立即完整。
  if (!conditionNeedsValue(condition)) return true

  // 步骤2：其他条件必须填写匹配值。
  return condition.value.trim() !== ''
}

function parseNumber(value: string): number | null {
  // 步骤1：空文本不作为有效数值。
  const trimmedValue = value.trim()
  if (trimmedValue === '') return null

  // 步骤2：只接受 JavaScript 能完整转换的有限数值。
  const parsedValue = Number(trimmedValue)
  if (!Number.isFinite(parsedValue)) return null
  return parsedValue
}

function parseDate(value: string): number | null {
  // 步骤1：优先读取单元格开头的标准年月日。
  const trimmedValue = value.trim()
  const standardDateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmedValue)
  if (standardDateMatch) {
    const year = Number(standardDateMatch[1])
    const monthIndex = Number(standardDateMatch[2]) - 1
    const day = Number(standardDateMatch[3])
    const timestamp = Date.UTC(year, monthIndex, day)
    const parsedDate = new Date(timestamp)
    const dateIsValid =
      parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === monthIndex &&
      parsedDate.getUTCDate() === day
    if (!dateIsValid) return null
    return timestamp
  }

  // 步骤2：其他常见日期格式交给浏览器解析，再统一到 UTC 日历日。
  const parsedTimestamp = Date.parse(trimmedValue)
  if (!Number.isFinite(parsedTimestamp)) return null
  const parsedDate = new Date(parsedTimestamp)
  return Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), parsedDate.getUTCDate())
}

function numberMatchesCondition(cellValue: string, condition: CsvFilterCondition): boolean {
  // 步骤1：任一侧不是有效数值时不匹配。
  const cellNumber = parseNumber(cellValue)
  const filterNumber = parseNumber(condition.value)
  if (cellNumber === null || filterNumber === null) return false

  // 步骤2：按当前数值运算符比较。
  switch (condition.operator) {
    case 'numberGreaterThan':
      return cellNumber > filterNumber
    case 'numberGreaterThanOrEqual':
      return cellNumber >= filterNumber
    case 'numberLessThan':
      return cellNumber < filterNumber
    case 'numberLessThanOrEqual':
      return cellNumber <= filterNumber
    default:
      return cellNumber === filterNumber
  }
}

function dateMatchesCondition(cellValue: string, condition: CsvFilterCondition): boolean {
  // 步骤1：任一侧不是有效日期时不匹配。
  const cellDate = parseDate(cellValue)
  const filterDate = parseDate(condition.value)
  if (cellDate === null || filterDate === null) return false

  // 步骤2：按当前日期运算符比较日历日。
  switch (condition.operator) {
    case 'dateBefore':
      return cellDate < filterDate
    case 'dateBeforeOrEqual':
      return cellDate <= filterDate
    case 'dateAfter':
      return cellDate > filterDate
    case 'dateAfterOrEqual':
      return cellDate >= filterDate
    default:
      return cellDate === filterDate
  }
}

function cellMatchesCondition(cellValue: string, condition: CsvFilterCondition): boolean {
  // 步骤1：数值和日期条件分别使用对应类型进行比较。
  if (condition.operator.startsWith('number')) {
    return numberMatchesCondition(cellValue, condition)
  }
  if (condition.operator.startsWith('date')) {
    return dateMatchesCondition(cellValue, condition)
  }

  // 步骤2：文本条件统一使用不区分大小写的内容进行匹配。
  const normalizedCellValue = cellValue.toLocaleLowerCase()
  const normalizedFilterValue = condition.value.trim().toLocaleLowerCase()

  // 步骤3：按当前文本匹配方式判断单元格。
  switch (condition.operator) {
    case 'notContains':
      return !normalizedCellValue.includes(normalizedFilterValue)
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

function rowMatchesCondition(row: CsvRow, condition: CsvFilterCondition): boolean {
  // 步骤1：选择了具体列时只判断该列。
  let conditionMatches = false
  if (condition.columnIndex >= 0) {
    conditionMatches = cellMatchesCondition(cellText(row, condition.columnIndex), condition)
  } else if (condition.operator === 'notContains') {
    // 步骤2：“所有列不包含”要求每一列都不含筛选文本。
    conditionMatches = true
    for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
      if (!cellMatchesCondition(cellText(row, columnIndex), condition)) {
        conditionMatches = false
        break
      }
    }
  } else {
    // 步骤3：其他运算符选择全部列时，任意一列满足条件即匹配。
    for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
      if (cellMatchesCondition(cellText(row, columnIndex), condition)) {
        conditionMatches = true
        break
      }
    }
  }

  // 步骤4：启用“非”时对整条条件结果取反。
  if (condition.negated) return !conditionMatches
  return conditionMatches
}

function rowMatchesFilter(row: CsvRow): boolean {
  // 步骤1：没有完整条件时保留当前行。
  if (!filterIsActive.value) return true

  // 步骤2：逐条计算完整条件，忽略尚未填写的条件。
  for (
    let conditionIndex = 0;
    conditionIndex < filterConditions.value.length;
    conditionIndex += 1
  ) {
    const condition = filterConditions.value[conditionIndex]
    if (!conditionIsComplete(condition)) continue

    const conditionMatches = rowMatchesCondition(row, condition)
    if (filterLogicMode.value === 'and' && !conditionMatches) return false
    if (filterLogicMode.value === 'or' && conditionMatches) return true
  }

  // 步骤3：AND 全部通过时匹配，OR 全部未通过时不匹配。
  return filterLogicMode.value === 'and'
}

function toggleFilterPanel(): void {
  // 步骤1：切换多条件筛选面板显示状态。
  filterPanelOpen.value = !filterPanelOpen.value
}

function setFilterLogicMode(logicMode: CsvFilterLogicMode): void {
  // 步骤1：切换条件组合方式并回到第一页。
  filterLogicMode.value = logicMode
  resetPage()
}

function addFilterCondition(): void {
  // 步骤1：在条件列表末尾添加空条件。
  filterConditions.value.push(createFilterCondition())
}

function removeFilterCondition(conditionIndex: number): void {
  // 步骤1：至少保留一条可编辑条件。
  if (filterConditions.value.length <= 1) return

  // 步骤2：用普通循环移除目标条件。
  const updatedConditions: CsvFilterCondition[] = []
  for (let index = 0; index < filterConditions.value.length; index += 1) {
    if (index !== conditionIndex) updatedConditions.push(filterConditions.value[index])
  }
  filterConditions.value = updatedConditions
  resetPage()
}

function clearFilter(): void {
  // 步骤1：恢复一条空条件和默认 AND 模式。
  filterLogicMode.value = 'and'
  filterConditions.value = [createFilterCondition()]
  resetPage()
}

function openColumnDialog(): void {
  // 步骤1：复制当前可见列作为弹窗草稿。
  const draftColumnIndexes: number[] = []
  for (let index = 0; index < visibleColumnIndexes.value.length; index += 1) {
    draftColumnIndexes.push(visibleColumnIndexes.value[index])
  }
  draftVisibleColumnIndexes.value = draftColumnIndexes

  // 步骤2：打开弹窗并收起筛选面板。
  columnDialogOpen.value = true
  filterPanelOpen.value = false

  // 步骤3：弹窗渲染后把键盘焦点移入弹窗。
  void nextTick(function focusColumnDialog() {
    columnDialogElement.value?.focus()
  })
}

function isDraftColumnVisible(columnIndex: number): boolean {
  // 步骤1：检查列是否包含在当前弹窗草稿中。
  return draftVisibleColumnIndexes.value.includes(columnIndex)
}

function changeDraftColumnVisibility(columnIndex: number, event: Event): void {
  // 步骤1：读取复选框状态并按原始列顺序重建草稿。
  const checkbox = event.target as HTMLInputElement
  const updatedDraftIndexes: number[] = []
  for (let index = 0; index < columnCount.value; index += 1) {
    if (index === columnIndex) {
      if (checkbox.checked) updatedDraftIndexes.push(index)
      continue
    }
    if (draftVisibleColumnIndexes.value.includes(index)) updatedDraftIndexes.push(index)
  }
  draftVisibleColumnIndexes.value = updatedDraftIndexes
}

function selectAllDraftColumns(): void {
  // 步骤1：把全部列加入弹窗草稿。
  const allColumnIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
    allColumnIndexes.push(columnIndex)
  }
  draftVisibleColumnIndexes.value = allColumnIndexes
}

function selectNoDraftColumns(): void {
  // 步骤1：清空弹窗草稿中的全部可见列。
  draftVisibleColumnIndexes.value = []
}

function closeColumnDialog(): void {
  // 步骤1：关闭弹窗并把键盘焦点还给列按钮。
  columnDialogOpen.value = false
  void nextTick(function focusColumnsButton() {
    columnsButtonElement.value?.focus()
  })
}

function cancelColumnDialog(): void {
  // 步骤1：直接关闭弹窗，不应用草稿。
  closeColumnDialog()
}

function confirmColumnDialog(): void {
  // 步骤1：根据草稿生成新的隐藏列列表，空草稿表示隐藏全部数据列。
  const updatedHiddenIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
    if (!draftVisibleColumnIndexes.value.includes(columnIndex)) {
      updatedHiddenIndexes.push(columnIndex)
    }
  }
  hiddenColumnIndexes.value = updatedHiddenIndexes

  // 步骤2：应用后关闭弹窗。
  closeColumnDialog()
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

  // 步骤3：读取完整文件，保证表格行数、搜索和筛选覆盖全部记录。
  const response = await fetch(props.rawUrl)
  if (!response.ok) throw new Error(t('csvPreview.rawLoadFailed'))

  // 步骤4：缓存完整响应字节供后续编码切换使用。
  rawBytes.value = await response.arrayBuffer()
  return rawBytes.value
}

async function changeEncoding(): Promise<void> {
  // 步骤1：重置分页和错误状态。
  resetPage()
  encodingError.value = ''

  // 步骤2：UTF-8 优先复用已加载的完整原始字节。
  if (selectedEncoding.value === 'utf-8') {
    if (rawBytes.value) {
      const textDecoder = new TextDecoder('utf-8')
      displayedContent.value = textDecoder.decode(rawBytes.value)
      displayedContentIsTruncated.value = false
    } else {
      displayedContent.value = props.content
      displayedContentIsTruncated.value = props.truncated
    }
    return
  }

  // 步骤3：其他编码读取完整原始字节并在浏览器解码。
  encodingLoading.value = true
  try {
    const bytes = await loadRawBytes()
    const textDecoder = new TextDecoder(selectedEncoding.value)
    displayedContent.value = textDecoder.decode(bytes)
    displayedContentIsTruncated.value = false
  } catch (error) {
    encodingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    encodingLoading.value = false
  }
}

async function loadCompleteContent(): Promise<void> {
  // 步骤1：元数据内容完整或没有原始地址时无需额外读取。
  const contentIsComplete = props.content !== '' && !props.truncated
  if (contentIsComplete || !props.rawUrl) return

  // 步骤2：读取完整原始字节并先按 UTF-8 展示。
  encodingLoading.value = true
  encodingError.value = ''
  try {
    const bytes = await loadRawBytes()
    const textDecoder = new TextDecoder('utf-8')
    displayedContent.value = textDecoder.decode(bytes)
    displayedContentIsTruncated.value = false
  } catch (error) {
    encodingError.value = error instanceof Error ? error.message : String(error)
  } finally {
    encodingLoading.value = false
  }
}

onMounted(function initializeCompleteContent() {
  // 步骤1：元数据缺失或被截断时从原始文件初始化完整预览。
  void loadCompleteContent()
})

function currentContent(): string {
  // 步骤1：向 Vue 提供可监听的内容值。
  return props.content
}

function currentFilePath(): string {
  // 步骤1：向 Vue 提供可监听的文件路径。
  return props.filePath
}

function currentTruncatedState(): boolean {
  // 步骤1：向 Vue 提供可监听的截断状态。
  return props.truncated
}

watch(
  [currentContent, currentFilePath, currentTruncatedState],
  function synchronizeSelectedFile(values) {
    // 步骤1：读取新文件内容并清空旧文件缓存。
    const newContent = values[0]
    const newContentIsTruncated = values[2]
    displayedContent.value = newContent
    displayedContentIsTruncated.value = newContentIsTruncated
    rawBytes.value = null

    // 步骤2：恢复新文件的默认筛选、分页和编码状态。
    searchText.value = ''
    currentPage.value = 1
    selectedEncoding.value = 'utf-8'
    encodingError.value = ''
    filterPanelOpen.value = false
    filterLogicMode.value = 'and'
    filterConditions.value = [createFilterCondition()]
    hiddenColumnIndexes.value = []
    columnDialogOpen.value = false
    draftVisibleColumnIndexes.value = []

    // 步骤3：元数据缺失或被截断时重新读取当前文件完整原始字节。
    if (newContent === '' || newContentIsTruncated) void loadCompleteContent()
  }
)

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
  position: relative;
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
  position: relative;
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

.csv-preview-filter-count {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  min-width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  border: 1px solid var(--tab-bg, #252525);
  border-radius: 7px;
  background: var(--accent, #89b4fa);
  color: var(--bg, #1a1a1a);
  font-size: 9px;
  font-weight: 700;
  line-height: 12px;
}

.csv-preview-filter-panel {
  display: flex;
  min-width: 0;
  max-height: 220px;
  flex-shrink: 0;
  flex-direction: column;
  border-bottom: 1px solid var(--border, #333333);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.csv-preview-filter-header {
  display: flex;
  min-height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #333333) 70%, transparent);
}

.csv-preview-logic-switch {
  display: inline-flex;
  flex: 0 0 auto;
}

.csv-preview-logic-switch button {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border, #3c3c3c);
  background: var(--bg-surface, #141414);
  color: var(--fg-muted, #888888);
  font: inherit;
  cursor: pointer;
}

.csv-preview-logic-switch button:first-child {
  border-radius: 4px 0 0 4px;
}

.csv-preview-logic-switch button:last-child {
  margin-left: -1px;
  border-radius: 0 4px 4px 0;
}

.csv-preview-logic-switch button.active {
  z-index: 1;
  border-color: var(--accent, #89b4fa);
  color: var(--accent, #89b4fa);
}

.csv-preview-filter-conditions {
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}

.csv-preview-filter-condition {
  display: grid;
  min-width: 620px;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #333333) 55%, transparent);
  grid-template-columns:
    22px auto minmax(110px, 160px) minmax(100px, 140px) minmax(120px, 1fr)
    28px;
}

.csv-preview-filter-condition:last-child {
  border-bottom: 0;
}

.csv-preview-condition-number {
  color: var(--fg-muted, #888888);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.csv-preview-filter-negate {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-filter-negate input,
.csv-preview-dialog-column-list input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent, #89b4fa);
}

.csv-preview-filter-condition select,
.csv-preview-filter-value input {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  outline: 0;
  background: var(--bg-surface, #141414);
  color: var(--fg, #cccccc);
  font: inherit;
}

.csv-preview-filter-condition select {
  padding: 0 24px 0 8px;
}

.csv-preview-filter-value {
  min-width: 0;
}

.csv-preview-filter-value input {
  padding: 0 8px;
}

.csv-preview-filter-condition select:focus-visible,
.csv-preview-filter-value input:focus-visible,
.csv-preview-filter-negate input:focus-visible,
.csv-preview-logic-switch button:focus-visible,
.csv-preview-text-button:focus-visible,
.csv-preview-primary-button:focus-visible,
.csv-preview-dialog-column-list input:focus-visible,
.csv-preview-columns-dialog:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-text-button {
  display: inline-flex;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
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

.csv-preview-dialog-backdrop {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgb(0 0 0 / 55%);
  font-family: var(--font-sans, sans-serif);
}

.csv-preview-columns-dialog {
  display: flex;
  width: min(460px, 100%);
  max-height: min(560px, 100%);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 6px;
  outline: 0;
  background: var(--tab-bg, #252525);
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
  color: var(--fg, #cccccc);
}

.csv-preview-dialog-header {
  display: flex;
  min-height: 54px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #333333);
}

.csv-preview-dialog-header > div {
  min-width: 0;
}

.csv-preview-dialog-header h2 {
  margin: 0;
  color: var(--fg-bright, #eeeeee);
  font-size: 14px;
  font-weight: 600;
}

.csv-preview-dialog-header span {
  color: var(--fg-muted, #888888);
  font-size: 11px;
}

.csv-preview-dialog-tools {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 7px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border, #333333);
}

.csv-preview-dialog-column-list {
  display: grid;
  min-height: 0;
  padding: 8px 12px;
  overflow-y: auto;
  gap: 5px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  scrollbar-width: thin;
}

.csv-preview-dialog-column-list label {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-dialog-column-list label:has(input:checked) {
  border-color: color-mix(in srgb, var(--accent, #89b4fa) 45%, var(--border, #3c3c3c));
  color: var(--fg, #cccccc);
}

.csv-preview-dialog-column-list input {
  flex: 0 0 auto;
}

.csv-preview-dialog-column-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-preview-dialog-footer {
  display: flex;
  min-height: 46px;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding: 7px 12px;
  border-top: 1px solid var(--border, #333333);
}

.csv-preview-primary-button {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--accent, #89b4fa);
  border-radius: 4px;
  background: var(--accent, #89b4fa);
  color: var(--bg, #1a1a1a);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.csv-preview-primary-button:disabled {
  cursor: default;
  opacity: 0.4;
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

  .csv-preview-filter-header {
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .csv-preview-filter-header > * {
    flex-shrink: 0;
  }

  .csv-preview-dialog-backdrop {
    padding: 8px;
  }

  .csv-preview-dialog-column-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
