## Summary

-

## Changes

-

## Test Plan

- [ ] Tested locally
- [ ] Frontend type-check passes (`npx vue-tsc --noEmit`)
- [ ] No regressions on desktop browser
- [ ] No regressions on mobile browser (if applicable)

## Visual Checklist

参考 `CLAUDE.md` 的 Visual Style 一节：

- [ ] 新增颜色用 `var(--color-*)` / design tokens，未在组件里硬编码 hex
- [ ] 未引入与主调色板冲突的高饱和糖果色
- [ ] 图标使用 `lucide-vue-next`（无 emoji / 自制 SVG 字符图标）
- [ ] workspace 调色板改动同步了前端 `WORKSPACE_COLORS` 和后端 `WORKSPACE_PALETTE`
- [ ] 暗色主题下视觉一致
