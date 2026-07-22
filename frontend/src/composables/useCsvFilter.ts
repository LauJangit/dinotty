import { computed, ref, type Ref } from 'vue'
import type { CsvRow } from '../utils/csvPreview'

export type CsvFilterOperator =
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

export type CsvFilterLogicMode = 'and' | 'or'

export interface CsvFilterCondition {
  id: number
  columnIndex: number
  operator: CsvFilterOperator
  value: string
  negated: boolean
}

export interface VisibleCsvRow {
  cells: CsvRow
  sourceIndex: number
}

export interface CsvFilterOptions {
  parsedRows: Ref<CsvRow[]>
  columnCount: Ref<number>
  firstRowIsHeader: Ref<boolean>
  onFilterChanged: () => void
}

export interface CsvFilter {
  searchText: Ref<string>
  filterPanelOpen: Ref<boolean>
  filterLogicMode: Ref<CsvFilterLogicMode>
  filterConditions: Ref<CsvFilterCondition[]>
  activeFilterCount: Ref<number>
  filterIsActive: Ref<boolean>
  filteredRows: Ref<VisibleCsvRow[]>
  cellText: (row: CsvRow, columnIndex: number) => string
  conditionNeedsValue: (condition: CsvFilterCondition) => boolean
  conditionInputType: (condition: CsvFilterCondition) => 'text' | 'number' | 'date'
  toggleFilterPanel: () => void
  setFilterLogicMode: (mode: CsvFilterLogicMode) => void
  addFilterCondition: () => void
  removeFilterCondition: (index: number) => void
  clearFilter: () => void
  reset: () => void
}

export function useCsvFilter(opts: CsvFilterOptions): CsvFilter {
  const { parsedRows, columnCount, firstRowIsHeader, onFilterChanged } = opts

  const searchText = ref('')
  const filterPanelOpen = ref(false)
  const filterLogicMode = ref<CsvFilterLogicMode>('and')
  let nextFilterConditionId = 0
  const filterConditions = ref<CsvFilterCondition[]>([createFilterCondition()])

  function createFilterCondition(): CsvFilterCondition {
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

  function cellText(row: CsvRow, columnIndex: number): string {
    return row[columnIndex] ?? ''
  }

  function conditionNeedsValue(condition: CsvFilterCondition): boolean {
    return condition.operator !== 'isEmpty' && condition.operator !== 'isNotEmpty'
  }

  function conditionInputType(condition: CsvFilterCondition): 'text' | 'number' | 'date' {
    if (condition.operator.startsWith('number')) return 'number'
    if (condition.operator.startsWith('date')) return 'date'
    return 'text'
  }

  function conditionIsComplete(condition: CsvFilterCondition): boolean {
    if (!conditionNeedsValue(condition)) return true
    return condition.value.trim() !== ''
  }

  function parseNumber(value: string): number | null {
    const trimmedValue = value.trim()
    if (trimmedValue === '') return null
    const parsedValue = Number(trimmedValue)
    if (!Number.isFinite(parsedValue)) return null
    return parsedValue
  }

  function parseDate(value: string): number | null {
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
    const parsedTimestamp = Date.parse(trimmedValue)
    if (!Number.isFinite(parsedTimestamp)) return null
    const parsedDate = new Date(parsedTimestamp)
    return Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), parsedDate.getUTCDate())
  }

  function numberMatchesCondition(cellValue: string, condition: CsvFilterCondition): boolean {
    const cellNumber = parseNumber(cellValue)
    const filterNumber = parseNumber(condition.value)
    if (cellNumber === null || filterNumber === null) return false
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
    const cellDate = parseDate(cellValue)
    const filterDate = parseDate(condition.value)
    if (cellDate === null || filterDate === null) return false
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
    if (condition.operator.startsWith('number')) {
      return numberMatchesCondition(cellValue, condition)
    }
    if (condition.operator.startsWith('date')) {
      return dateMatchesCondition(cellValue, condition)
    }
    const normalizedCellValue = cellValue.toLocaleLowerCase()
    const normalizedFilterValue = condition.value.trim().toLocaleLowerCase()
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
    let conditionMatches = false
    if (condition.columnIndex >= 0) {
      conditionMatches = cellMatchesCondition(cellText(row, condition.columnIndex), condition)
    } else if (condition.operator === 'notContains') {
      conditionMatches = true
      for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
        if (!cellMatchesCondition(cellText(row, columnIndex), condition)) {
          conditionMatches = false
          break
        }
      }
    } else {
      for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
        if (cellMatchesCondition(cellText(row, columnIndex), condition)) {
          conditionMatches = true
          break
        }
      }
    }
    if (condition.negated) return !conditionMatches
    return conditionMatches
  }

  const activeFilterCount = computed(function computeActiveFilterCount() {
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

  const filterIsActive = computed(() => activeFilterCount.value > 0)

  function rowMatchesFilter(row: CsvRow): boolean {
    if (!filterIsActive.value) return true
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
    return filterLogicMode.value === 'and'
  }

  const filteredRows = computed(function computeFilteredRows() {
    const firstDataRowIndex = firstRowIsHeader.value ? 1 : 0
    const normalizedSearchText = searchText.value.trim().toLocaleLowerCase()
    const matchingRows: VisibleCsvRow[] = []
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

  function toggleFilterPanel(): void {
    filterPanelOpen.value = !filterPanelOpen.value
  }

  function setFilterLogicMode(logicMode: CsvFilterLogicMode): void {
    filterLogicMode.value = logicMode
    onFilterChanged()
  }

  function addFilterCondition(): void {
    filterConditions.value.push(createFilterCondition())
  }

  function removeFilterCondition(conditionIndex: number): void {
    if (filterConditions.value.length <= 1) return
    const updatedConditions: CsvFilterCondition[] = []
    for (let index = 0; index < filterConditions.value.length; index += 1) {
      if (index !== conditionIndex) updatedConditions.push(filterConditions.value[index])
    }
    filterConditions.value = updatedConditions
    onFilterChanged()
  }

  function clearFilter(): void {
    filterLogicMode.value = 'and'
    filterConditions.value = [createFilterCondition()]
    onFilterChanged()
  }

  function reset(): void {
    searchText.value = ''
    filterPanelOpen.value = false
    filterLogicMode.value = 'and'
    filterConditions.value = [createFilterCondition()]
  }

  return {
    searchText,
    filterPanelOpen,
    filterLogicMode,
    filterConditions,
    activeFilterCount,
    filterIsActive,
    filteredRows,
    cellText,
    conditionNeedsValue,
    conditionInputType,
    toggleFilterPanel,
    setFilterLogicMode,
    addFilterCondition,
    removeFilterCondition,
    clearFilter,
    reset,
  }
}
