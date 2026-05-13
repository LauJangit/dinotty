import { defineComponent, ref, h, onMounted, nextTick } from 'vue'
import type { VNode } from 'vue'
import { isTauri } from '../../composables/useTransport'

export interface DirEntry {
  name: string
  is_dir: boolean
  size: number
}

export function treeFolderIcon(expanded: boolean): VNode {
  const d = expanded
    ? 'M2 5h5l1 1h7v7H2V5zm1 1v6h10V7H8L7 6H3z'
    : 'M2 4h4.5l1 1H14v9H2V4zm1 1v8h10V7H8l-1-1H3z'
  return h('span', { class: ['tree-kind-icon', 'tree-kind-icon-folder', { open: expanded }] }, [
    h(
      'svg',
      { viewBox: '0 0 16 16', class: 'tree-svg', fill: 'currentColor', 'aria-hidden': 'true' },
      [h('path', { d })],
    ),
  ])
}

export function treeFileIcon(): VNode {
  return h('span', { class: 'tree-kind-icon tree-kind-icon-file' }, [
    h(
      'svg',
      { viewBox: '0 0 16 16', class: 'tree-svg', fill: 'currentColor', 'aria-hidden': 'true' },
      [
        h('path', {
          d: 'M4 2h5.2L13 5.8V14H4V2zm1 1v10h7V6.5H8.5L9 6 8 5H5zm5.2 0L12 5.8h-2V3h-.8z',
        }),
      ],
    ),
  ])
}

export function absJoinWorkspaceRoot(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, '')
  if (!rel) return r
  const parts = rel.split('/').filter(Boolean)
  if (/^[A-Za-z]:[\\/]/.test(r)) {
    return r + '\\' + parts.join('\\')
  }
  return r + '/' + parts.join('/')
}

function dispatchDropToTerminal(ev: DragEvent, path: string) {
  if (!isTauri()) return
  if (ev.dataTransfer?.dropEffect === 'none' && ev.clientX === 0 && ev.clientY === 0) return
  const el = document.elementFromPoint(ev.clientX, ev.clientY)
  const termPane = el?.closest('.terminal-pane')
  if (termPane) {
    termPane.dispatchEvent(new CustomEvent('terminal-drop-path', {
      detail: { path },
      bubbles: false,
    }))
  }
}

export const TreeInlineInput = defineComponent({
  name: 'TreeInlineInput',
  props: {
    placeholder: { type: String, default: '' },
  },
  emits: ['commit', 'cancel'],
  setup(props, { emit }) {
    const model = ref('')
    const inputRef = ref<HTMLInputElement | null>(null)
    onMounted(() => nextTick(() => inputRef.value?.focus()))
    return () =>
      h('input', {
        ref: inputRef,
        class: 'tree-inline-input',
        type: 'text',
        autocomplete: 'off',
        spellcheck: false,
        placeholder: props.placeholder,
        value: model.value,
        onInput: (e: Event) => {
          model.value = (e.target as HTMLInputElement).value
        },
        onKeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            emit('commit', model.value.trim())
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            emit('cancel')
          }
        },
      })
  },
})

export const TreeRows = defineComponent({
  name: 'TreeRows',
  props: {
    paneId: { type: String, required: true },
    depth: { type: Number, required: true },
    relPath: { type: String, required: true },
    workspaceRoot: { type: String, default: '' },
    cache: { type: Object, required: true },
    expanded: { type: Object, required: true },
    selectedRel: { type: String, default: undefined },
    inlineCreate: { type: Object, default: null },
    inlinePlaceholder: { type: String, default: '' },
    inlineRename: { type: Object, default: undefined },
  },
  emits: ['toggle', 'select-file', 'select-dir', 'inline-create-commit', 'inline-create-cancel', 'inline-rename-commit', 'inline-rename-cancel', 'context-menu', 'long-press', 'move-entry'],
  setup(p, { emit }) {
    function makeLongPressHandlers(rel: string, isDir: boolean) {
      let timer: ReturnType<typeof setTimeout> | null = null
      let startX = 0
      let startY = 0
      let fired = false
      return {
        onTouchstart: (e: TouchEvent) => {
          if (e.touches.length !== 1) return
          const touch = e.touches[0]
          startX = touch.clientX
          startY = touch.clientY
          fired = false
          timer = setTimeout(() => {
            fired = true
            emit('long-press', { clientX: startX, clientY: startY }, rel, isDir)
          }, 500)
        },
        onTouchmove: (e: TouchEvent) => {
          if (!timer) return
          const touch = e.touches[0]
          if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
            if (timer) clearTimeout(timer)
            timer = null
          }
        },
        onTouchend: (e: TouchEvent) => {
          if (timer) clearTimeout(timer)
          timer = null
          if (fired) e.preventDefault()
        },
        onTouchcancel: () => {
          if (timer) clearTimeout(timer)
          timer = null
        },
      }
    }

    return () => {
      const entries = (p.cache as Record<string, DirEntry[]>)[p.relPath]
      if (entries === undefined) return null
      const rows: ReturnType<typeof h>[] = []
      const rowPad = {
        paddingLeft: `calc(var(--tree-base-hpad) + var(--tree-indent-step) * ${p.depth})`,
      }
      const ic = p.inlineCreate as { parentRel: string; kind: 'file' | 'dir' } | null
      if (ic && ic.parentRel === p.relPath) {
        rows.push(
          h(
            'div',
            { class: 'tree-row tree-inline-create', key: '__ic__', style: rowPad },
            [
              h('span', { class: 'tree-twistie-placeholder' }),
              h(TreeInlineInput, {
                placeholder: p.inlinePlaceholder as string,
                onCommit: (name: string) => emit('inline-create-commit', name),
                onCancel: () => emit('inline-create-cancel'),
              }),
            ],
          ),
        )
      }
      const ir = p.inlineRename as { rel: string; isDir: boolean } | undefined
      for (const e of entries) {
        const rel = p.relPath ? `${p.relPath}/${e.name}` : e.name
        const isExp = (p.expanded as Set<string>).has(rel)
        const isRenaming = !!(ir && ir.rel === rel)
        if (e.is_dir) {
          const labelContent = isRenaming
            ? h(TreeInlineInput, {
                placeholder: e.name,
                onCommit: (name: string) => emit('inline-rename-commit', name),
                onCancel: () => emit('inline-rename-cancel'),
              })
            : h(
                'span',
                { class: ['tree-label', { sel: p.selectedRel === rel }] },
                e.name,
              )
          rows.push(
            h(
              'div',
              {
                class: 'tree-row dir',
                key: rel,
                style: rowPad,
                draggable: true,
                onContextmenu: (ev: MouseEvent) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  emit('context-menu', { ev, rel, isDir: true })
                },
                onDragstart: (ev: DragEvent) => {
                  ev.dataTransfer?.setData('application/x-tree-move', rel)
                  const root = p.workspaceRoot as string
                  if (root) {
                    ev.dataTransfer?.setData('text/plain', absJoinWorkspaceRoot(root, rel))
                  }
                  ev.dataTransfer!.effectAllowed = 'copyMove'
                },
                onDragend: (ev: DragEvent) => {
                  const root = p.workspaceRoot as string
                  if (root) dispatchDropToTerminal(ev, absJoinWorkspaceRoot(root, rel))
                },
                onDragover: (ev: DragEvent) => {
                  if (ev.dataTransfer?.types.includes('application/x-tree-move')) {
                    ev.preventDefault()
                    ev.dataTransfer!.dropEffect = 'move'
                    ;(ev.currentTarget as HTMLElement).classList.add('drop-target')
                  }
                },
                onDragleave: (ev: DragEvent) => {
                  ;(ev.currentTarget as HTMLElement).classList.remove('drop-target')
                },
                onDrop: (ev: DragEvent) => {
                  ev.preventDefault()
                  ;(ev.currentTarget as HTMLElement).classList.remove('drop-target')
                  const srcRel = ev.dataTransfer?.getData('application/x-tree-move')
                  if (srcRel !== undefined && srcRel !== rel && !rel.startsWith(srcRel + '/')) {
                    emit('move-entry', { src: srcRel, destDir: rel })
                  }
                },
                ...makeLongPressHandlers(rel, true),
              },
              [
                h(
                  'button',
                  {
                    type: 'button',
                    class: ['tree-twistie', { open: isExp }],
                    onClick: () => emit('toggle', rel),
                  },
                  isExp ? '▼' : '▶',
                ),
                h(
                  'span',
                  {
                    class: 'tree-folder-hit',
                    onClick: () => {
                      emit('toggle', rel)
                      emit('select-dir', rel)
                    },
                  },
                  [
                    treeFolderIcon(isExp),
                    labelContent,
                  ],
                ),
              ],
            ),
          )
          if (isExp) {
            rows.push(
              h(TreeRows, {
                paneId: p.paneId,
                depth: p.depth + 1,
                relPath: rel,
                workspaceRoot: p.workspaceRoot,
                cache: p.cache,
                expanded: p.expanded,
                selectedRel: p.selectedRel,
                inlineCreate: p.inlineCreate,
                inlinePlaceholder: p.inlinePlaceholder,
                inlineRename: p.inlineRename,
                onToggle: (x: string) => emit('toggle', x),
                onSelectFile: (x: string) => emit('select-file', x),
                onSelectDir: (x: string) => emit('select-dir', x),
                onInlineCreateCommit: (x: string) => emit('inline-create-commit', x),
                onInlineCreateCancel: () => emit('inline-create-cancel'),
                onInlineRenameCommit: (x: string) => emit('inline-rename-commit', x),
                onInlineRenameCancel: () => emit('inline-rename-cancel'),
                onContextMenu: (payload: { ev: MouseEvent; rel: string; isDir: boolean }) =>
                  emit('context-menu', payload),
                onLongPress: (pos: { clientX: number; clientY: number }, rel: string, isDir: boolean) =>
                  emit('long-press', pos, rel, isDir),
                onMoveEntry: (payload: { src: string; destDir: string }) =>
                  emit('move-entry', payload),
              }),
            )
          }
        } else {
          const fileLabelContent = isRenaming
            ? h(TreeInlineInput, {
                placeholder: e.name,
                onCommit: (name: string) => emit('inline-rename-commit', name),
                onCancel: () => emit('inline-rename-cancel'),
              })
            : h(
                'span',
                {
                  class: ['tree-label', { sel: p.selectedRel === rel }],
                  onClick: () => emit('select-file', rel),
                },
                e.name,
              )
          rows.push(
            h(
              'div',
              {
                class: 'tree-row file',
                key: rel,
                style: rowPad,
                draggable: true,
                onContextmenu: (ev: MouseEvent) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  emit('context-menu', { ev, rel, isDir: false })
                },
                onDragstart: (ev: DragEvent) => {
                  ev.dataTransfer?.setData('application/x-tree-move', rel)
                  const root = p.workspaceRoot as string
                  if (root) {
                    ev.dataTransfer?.setData('text/plain', absJoinWorkspaceRoot(root, rel))
                  }
                  ev.dataTransfer!.effectAllowed = 'copyMove'
                },
                onDragend: (ev: DragEvent) => {
                  const root = p.workspaceRoot as string
                  if (root) dispatchDropToTerminal(ev, absJoinWorkspaceRoot(root, rel))
                },
                ...makeLongPressHandlers(rel, false),
              },
              [
                h('span', {
                  class: 'tree-twistie-placeholder',
                }),
                treeFileIcon(),
                fileLabelContent,
              ],
            ),
          )
        }
      }
      let bgLongPressTimer: ReturnType<typeof setTimeout> | null = null
      let bgLongPressFired = false
      let bgStartX = 0
      let bgStartY = 0

      return h('div', {
        class: 'tree-rows',
        onDragover: (ev: DragEvent) => {
          if (ev.dataTransfer?.types.includes('application/x-tree-move')) {
            ev.preventDefault()
            ev.dataTransfer!.dropEffect = 'move'
          }
        },
        onDrop: (ev: DragEvent) => {
          ev.preventDefault()
          const srcRel = ev.dataTransfer?.getData('application/x-tree-move')
          if (srcRel !== undefined && srcRel.includes('/')) {
            emit('move-entry', { src: srcRel, destDir: '' })
          }
        },
        onContextmenu: (ev: MouseEvent) => {
          if (ev.target === ev.currentTarget) {
            ev.preventDefault()
            ev.stopPropagation()
            emit('context-menu', { ev, rel: '', isDir: true })
          }
        },
        onTouchstart: (e: TouchEvent) => {
          if (e.target !== e.currentTarget || e.touches.length !== 1) return
          const touch = e.touches[0]
          bgStartX = touch.clientX
          bgStartY = touch.clientY
          bgLongPressFired = false
          bgLongPressTimer = setTimeout(() => {
            bgLongPressFired = true
            emit('long-press', { clientX: bgStartX, clientY: bgStartY }, '', true)
          }, 500)
        },
        onTouchmove: (e: TouchEvent) => {
          if (!bgLongPressTimer) return
          const touch = e.touches[0]
          if (Math.abs(touch.clientX - bgStartX) > 10 || Math.abs(touch.clientY - bgStartY) > 10) {
            clearTimeout(bgLongPressTimer)
            bgLongPressTimer = null
          }
        },
        onTouchend: (e: TouchEvent) => {
          if (bgLongPressTimer) clearTimeout(bgLongPressTimer)
          bgLongPressTimer = null
          if (bgLongPressFired) e.preventDefault()
        },
        onTouchcancel: () => {
          if (bgLongPressTimer) clearTimeout(bgLongPressTimer)
          bgLongPressTimer = null
        },
      }, rows)
    }
  },
})
