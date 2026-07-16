import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CsvPreview from '../components/workspace/CsvPreview.vue'
import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'
import { detectCsvDelimiter, isCsvPreviewFile, parseCsvText } from '../utils/csvPreview'

describe('CSV preview utilities', function csvPreviewUtilitiesSuite() {
  it('recognizes CSV and TSV paths without matching spreadsheet files', function recognizesPaths() {
    // 步骤1：验证支持的文件后缀和大小写。
    expect(isCsvPreviewFile('reports/users.csv')).toBe(true)
    expect(isCsvPreviewFile('reports/users.TSV')).toBe(true)

    // 步骤2：验证其他表格和普通文本不会进入 CSV 预览。
    expect(isCsvPreviewFile('reports/users.xlsx')).toBe(false)
    expect(isCsvPreviewFile('reports/users.csv.md')).toBe(false)
  })

  it('detects delimiters outside quoted fields', function detectsDelimiter() {
    // 步骤1：引号内的逗号不参与分隔符统计。
    const semicolonText = 'name;note\nAlice;"Shanghai, China"'
    expect(detectCsvDelimiter(semicolonText, 'people.csv')).toBe(';')

    // 步骤2：TSV 文件优先使用制表符。
    expect(detectCsvDelimiter('name\tage\nAlice\t30', 'people.tsv')).toBe('\t')
  })

  it('parses quoted delimiters, escaped quotes, and line breaks', function parsesQuotedFields() {
    // 步骤1：解析包含特殊字符的两行 CSV。
    const csvText = 'name,note\r\n"Doe, Jane","said ""hello""\nagain"\r\n'
    const parsedRows = parseCsvText(csvText, ',')

    // 步骤2：确认字段内容和尾部空行处理正确。
    expect(parsedRows).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hello"\nagain'],
    ])
  })
})

describe('CsvPreview', function csvPreviewComponentSuite() {
  afterEach(function restoreBrowserMocks() {
    // 步骤1：清理当前用例替换的浏览器 API。
    vi.unstubAllGlobals()
  })

  it('uses the first row as headers and filters matching records', async function rendersAndFilters() {
    // 步骤1：挂载一个包含三条记录的 CSV 表格。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,city\nAlice,Shanghai\nBob,Beijing\nCarol,Shenzhen',
        filePath: 'people.csv',
        truncated: false,
      },
    })

    // 步骤2：确认首行成为表头，数据行正常显示。
    const headerCells = wrapper.findAll('thead th')
    expect(headerCells[1].text()).toBe('name')
    expect(headerCells[2].text()).toBe('city')
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)

    // 步骤3：搜索后只保留匹配记录。
    await wrapper.get('input[type="search"]').setValue('beijing')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
  })

  it('filters rows with a condition on the selected column', async function filtersSelectedColumn() {
    // 步骤1：挂载包含城市和状态字段的 CSV 表格。
    const wrapper = mount(CsvPreview, {
      props: {
        content:
          'name,city,status\nAlice,Shanghai,active\nBob,Shanghai,inactive\nCarol,Beijing,active',
        filePath: 'people.csv',
        truncated: false,
      },
    })

    // 步骤2：打开条件筛选并指定城市列等于 Shanghai。
    await wrapper.get('[data-testid="csv-filter-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-filter-column"]').setValue('1')
    await wrapper.get('[data-testid="csv-filter-operator"]').setValue('equals')
    await wrapper.get('[data-testid="csv-filter-value"]').setValue('Shanghai')

    // 步骤3：确认仅保留城市完全匹配的两行。
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('tbody').text()).toContain('Alice')
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Carol')
  })

  it('shows selected columns and can restore all columns', async function selectsVisibleColumns() {
    // 步骤1：挂载包含三列的 CSV 表格并打开列显示设置。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,city,status\nAlice,Shanghai,active',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-columns-toggle"]').trigger('click')

    // 步骤2：隐藏城市和状态列，只保留姓名列。
    await wrapper.get('[data-testid="csv-column-option-1"]').setValue(false)
    await wrapper.get('[data-testid="csv-column-option-2"]').setValue(false)
    expect(wrapper.findAll('thead th')).toHaveLength(2)
    expect(wrapper.find('thead').text()).toContain('name')
    expect(wrapper.find('thead').text()).not.toContain('city')
    expect(wrapper.findAll('tbody td')).toHaveLength(1)

    // 步骤3：一键恢复后重新显示全部三列。
    await wrapper.get('[data-testid="csv-columns-show-all"]').trigger('click')
    expect(wrapper.findAll('thead th')).toHaveLength(4)
    expect(wrapper.find('thead').text()).toContain('city')
    expect(wrapper.find('thead').text()).toContain('status')
  })

  it('emits a source request from the toolbar', async function emitsSourceRequest() {
    // 步骤1：挂载最小 CSV 内容。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        truncated: false,
      },
    })

    // 步骤2：点击源码按钮并检查事件。
    await wrapper.get('[data-testid="csv-source-button"]').trigger('click')
    expect(wrapper.emitted('showSource')).toHaveLength(1)
  })

  it('loads a bounded raw range and decodes GBK', async function decodesGbk() {
    // 步骤1：准备包含“中文”的 GBK 原始字节。
    const gbkBytes = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xd6, 0xd0, 0xce, 0xc4])
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return gbkBytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    // 步骤2：切换编码并等待原始内容加载。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        rawUrl: '/api/workspace/raw?path=people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-encoding-select"]').setValue('gbk')
    await flushPromises()

    // 步骤3：确认请求范围受限并显示 GBK 文本。
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/raw?path=people.csv', {
      headers: { Range: 'bytes=0-524287' },
    })
    expect(wrapper.find('tbody').text()).toContain('中文')
  })

  it('loads raw UTF-8 when metadata has no decoded content', async function loadsMissingContent() {
    // 步骤1：准备后端未提供文本时可读取的 UTF-8 原始内容。
    const utf8Bytes = new TextEncoder().encode('name\nAlice')
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return utf8Bytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    // 步骤2：挂载没有已解码内容的 CSV 并等待自动加载。
    const wrapper = mount(CsvPreview, {
      props: {
        content: '',
        filePath: 'people.csv',
        rawUrl: '/api/workspace/raw?path=people.csv',
        truncated: false,
      },
    })
    await flushPromises()

    // 步骤3：确认表格显示原始 UTF-8 内容。
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(wrapper.find('tbody').text()).toContain('Alice')
  })

  it('replaces table data when the selected file changes', async function replacesFileContent() {
    // 步骤1：先显示第一个文件的数据。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'first.csv',
        truncated: false,
      },
    })
    expect(wrapper.find('tbody').text()).toContain('Alice')

    // 步骤2：复用组件并传入另一个文件。
    await wrapper.setProps({
      content: 'name\nBob',
      filePath: 'second.csv',
    })

    // 步骤3：确认旧文件数据被完全替换。
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
  })

  it('paginates rows without rendering the whole file', async function paginatesRows() {
    // 步骤1：把每页大小缩小到两行以验证分页。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice\nBob\nCarol',
        filePath: 'people.csv',
        truncated: false,
        pageSize: 2,
      },
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('tbody').text()).toContain('Alice')

    // 步骤2：进入下一页后只显示最后一条记录。
    const paginationButtons = wrapper.findAll('.csv-preview-pagination button')
    expect(paginationButtons).toHaveLength(2)
    await paginationButtons[1].trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Carol')

    // 步骤3：返回上一页后恢复前两条记录。
    await paginationButtons[0].trigger('click')
    expect(wrapper.find('tbody').text()).toContain('Alice')
  })

  it('can treat the first record as table data', async function togglesHeaderRow() {
    // 步骤1：确认默认模式把首行作为表头。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)

    // 步骤2：关闭表头模式后首行进入数据区。
    await wrapper.get('.csv-preview-header-toggle input').setValue(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('thead').text()).toContain('列 1')
  })
})

describe('FilePreviewContent CSV integration', function csvPreviewIntegrationSuite() {
  afterEach(function restoreBrowserMocks() {
    // 步骤1：清理当前用例替换的浏览器 API。
    vi.unstubAllGlobals()
  })

  it('opens CSV as a table and can switch between table and source', async function switchesViews() {
    // 步骤1：用文件导航器实际传入的文本元数据挂载预览组件。
    const csvContent = 'name,city\nAlice,Shanghai'
    const wrapper = mount(FilePreviewContent, {
      props: {
        previewLoading: false,
        previewErr: '',
        selectedRel: 'people.csv',
        selectedIsDir: false,
        meta: { kind: 'text', content: csvContent, language: 'plaintext', truncated: false },
        rawUrl: '/api/workspace/raw?path=people.csv',
        showSave: true,
        audioTitle: '',
        audioSub: '',
        audioTimeNow: '0:00',
        audioTimeTotal: '0:00',
        audioSeekValue: 0,
        audioVolValue: 100,
        audioPlaying: false,
        editorDirty: false,
        editorText: csvContent,
        canSaveEditor: true,
        mdShowPreview: false,
        htmlShowPreview: false,
        markdownEditorHtml: '',
        officeLoading: false,
        officeErr: '',
        officeHtml: '',
        paneId: 'pane-1',
        filePath: 'people.csv',
      },
      global: {
        stubs: {
          MonacoEditor: true,
        },
      },
    })

    // 步骤2：CSV 默认显示表格预览。
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)

    // 步骤3：从表格切换到源码视图。
    await wrapper.get('[data-testid="csv-source-button"]').trigger('click')
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(false)
    expect(wrapper.find('.file-editor-root').exists()).toBe(true)

    // 步骤4：选择另一个 CSV 时默认恢复表格视图。
    await wrapper.setProps({
      selectedRel: 'next.csv',
      filePath: 'next.csv',
      meta: { kind: 'text', content: 'name\nBob', language: 'plaintext', truncated: false },
      editorText: 'name\nBob',
    })
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)

    // 步骤5：仍可从源码工具栏手动切回表格视图。
    await wrapper.get('[data-testid="csv-source-button"]').trigger('click')
    await wrapper.get('[data-testid="csv-table-button"]').trigger('click')
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)
  })

  it('opens backend-unsupported CSV files in the table preview', async function opensUnsupportedCsv() {
    // 步骤1：模拟后端无法按 UTF-8 解码文件的元数据和原始内容。
    const emptyBytes = new Uint8Array(0)
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return emptyBytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(FilePreviewContent, {
      props: {
        previewLoading: false,
        previewErr: '',
        selectedRel: 'legacy.csv',
        selectedIsDir: false,
        meta: { kind: 'unsupported', message: 'binary file', truncated: false },
        rawUrl: '/api/workspace/raw?path=legacy.csv',
        showSave: true,
        audioTitle: '',
        audioSub: '',
        audioTimeNow: '0:00',
        audioTimeTotal: '0:00',
        audioSeekValue: 0,
        audioVolValue: 100,
        audioPlaying: false,
        editorDirty: false,
        editorText: '',
        canSaveEditor: false,
        mdShowPreview: false,
        htmlShowPreview: false,
        markdownEditorHtml: '',
        officeLoading: false,
        officeErr: '',
        officeHtml: '',
        paneId: 'pane-1',
        filePath: 'legacy.csv',
      },
    })
    await flushPromises()

    // 步骤2：仍然显示 CSV 表格入口，且不提供无效的源码按钮。
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)
    expect(wrapper.find('[data-testid="csv-source-button"]').exists()).toBe(false)
  })
})
