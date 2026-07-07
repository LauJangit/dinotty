import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaces } from '../useWorkspaces'
import type { Workspace } from '../../types/workspace'
import type { TerminalTab } from '../../types/pane'
import type { TabInfo } from '../../components/terminal/TabBar.vue'

// Helper to create a minimal TerminalTab with cwd
function makeTab(paneId: string, cwd?: string): TerminalTab {
  return {
    type: 'terminal',
    paneId,
    layout: { type: 'leaf', paneId, title: 'Terminal', ratio: 1, zoomed: false },
    activePaneId: paneId,
    paneMru: [paneId],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
    cwd,
  }
}

describe('useWorkspaces', () => {
  const { workspaces, matchWorkspace, filterTabs } = useWorkspaces()

  beforeEach(() => {
    workspaces.value = [
      { id: 'ws1', name: 'dinotty', path: '/Users/talentc/rust/dinotty', order: 0 },
      { id: 'ws2', name: 'my-app', path: '/Users/talentc/projects/my-app', order: 1 },
      { id: 'ws3', name: 'rust', path: '/Users/talentc/rust', order: 2 },
    ]
  })

  describe('matchWorkspace', () => {
    it('exact match', () => {
      const result = matchWorkspace('/Users/talentc/rust/dinotty')
      expect(result?.id).toBe('ws1')
    })

    it('subdir match', () => {
      const result = matchWorkspace('/Users/talentc/rust/dinotty/src/main.rs')
      expect(result?.id).toBe('ws1')
    })

    it('boundary check - does not match similar prefix', () => {
      const result = matchWorkspace('/Users/talentc/rust-dinotty')
      expect(result).toBeNull()
    })

    it('boundary check - matches parent workspace for sibling directory', () => {
      // /Users/talentc/rust/dinotty-extended is under /Users/talentc/rust but NOT under /Users/talentc/rust/dinotty
      const result = matchWorkspace('/Users/talentc/rust/dinotty-extended')
      expect(result?.id).toBe('ws3') // matches parent rust workspace, not dinotty
    })

    it('longest prefix wins', () => {
      // Both ws3 (/Users/talentc/rust) and ws1 (/Users/talentc/rust/dinotty) match
      const result = matchWorkspace('/Users/talentc/rust/dinotty/src')
      expect(result?.id).toBe('ws1') // longer prefix wins
    })

    it('matches parent when only parent exists', () => {
      const result = matchWorkspace('/Users/talentc/rust/other-project')
      expect(result?.id).toBe('ws3')
    })

    it('no match returns null', () => {
      const result = matchWorkspace('/home/other/path')
      expect(result).toBeNull()
    })

    it('empty cwd returns null', () => {
      const result = matchWorkspace('')
      expect(result).toBeNull()
    })

    it('matches workspace with path exactly equal to cwd', () => {
      const result = matchWorkspace('/Users/talentc/projects/my-app')
      expect(result?.id).toBe('ws2')
    })
  })

  describe('filterTabs', () => {
    it('filters tabs belonging to a workspace', () => {
      const tabs = [
        makeTab('t1', '/Users/talentc/rust/dinotty/src'),
        makeTab('t2', '/Users/talentc/projects/my-app/lib'),
        makeTab('t3', '/Users/talentc/rust/other'),
      ]
      const result = filterTabs(tabs, 'ws1')
      expect(result).toHaveLength(1)
      expect(result[0].paneId).toBe('t1')
    })

    it('returns empty when no tabs match', () => {
      const tabs = [makeTab('t1', '/home/other/path')]
      const result = filterTabs(tabs, 'ws1')
      expect(result).toHaveLength(0)
    })

    it('excludes tabs without cwd', () => {
      const tabs = [makeTab('t1')] // no cwd
      const result = filterTabs(tabs, 'ws1')
      expect(result).toHaveLength(0)
    })

    it('matches deeper workspace over parent', () => {
      const tabs = [
        makeTab('t1', '/Users/talentc/rust/dinotty/src'),
        makeTab('t2', '/Users/talentc/rust/other-project'),
      ]
      // ws1 = /Users/talentc/rust/dinotty, ws3 = /Users/talentc/rust
      const resultWs1 = filterTabs(tabs, 'ws1')
      expect(resultWs1).toHaveLength(1)
      expect(resultWs1[0].paneId).toBe('t1')

      const resultWs3 = filterTabs(tabs, 'ws3')
      expect(resultWs3).toHaveLength(1)
      expect(resultWs3[0].paneId).toBe('t2')
    })
  })

  describe('visibleTabList pattern (TabInfo filtering)', () => {
    // Simulates the visibleTabList computed in App.vue:
    // filters TabInfo[] by matching raw tab cwd against active workspace

    function makeTabInfo(paneId: string): TabInfo {
      return { paneId, title: 'Terminal', index: 1, type: 'terminal' }
    }

    function filterByWorkspace(
      tabInfos: TabInfo[],
      rawTabs: TerminalTab[],
      workspaceId: string | null
    ): TabInfo[] {
      if (!workspaceId) return tabInfos
      return tabInfos.filter((info) => {
        const rawTab = rawTabs.find((t) => t.paneId === info.paneId)
        if (!rawTab || rawTab.type !== 'terminal' || !rawTab.cwd) return false
        const ws = matchWorkspace(rawTab.cwd)
        return ws?.id === workspaceId
      })
    }

    it('no active workspace returns all tabs', () => {
      const infos = [makeTabInfo('t1'), makeTabInfo('t2')]
      const raws = [makeTab('t1', '/Users/talentc/rust/dinotty'), makeTab('t2', '/other')]
      const result = filterByWorkspace(infos, raws, null)
      expect(result).toHaveLength(2)
    })

    it('filters tabs by active workspace', () => {
      const infos = [makeTabInfo('t1'), makeTabInfo('t2'), makeTabInfo('t3')]
      const raws = [
        makeTab('t1', '/Users/talentc/rust/dinotty/src'),
        makeTab('t2', '/Users/talentc/projects/my-app'),
        makeTab('t3', '/Users/talentc/rust/other'),
      ]
      const result = filterByWorkspace(infos, raws, 'ws1')
      expect(result).toHaveLength(1)
      expect(result[0].paneId).toBe('t1')
    })

    it('returns empty when no tabs match active workspace', () => {
      const infos = [makeTabInfo('t1')]
      const raws = [makeTab('t1', '/home/other')]
      const result = filterByWorkspace(infos, raws, 'ws1')
      expect(result).toHaveLength(0)
    })

    it('excludes tabs without cwd when workspace active', () => {
      const infos = [makeTabInfo('t1'), makeTabInfo('t2')]
      const raws = [makeTab('t1', '/Users/talentc/rust/dinotty'), makeTab('t2')]
      const result = filterByWorkspace(infos, raws, 'ws1')
      expect(result).toHaveLength(1)
      expect(result[0].paneId).toBe('t1')
    })
  })
})
