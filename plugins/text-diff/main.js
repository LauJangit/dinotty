function activate(context) {
  const { h, ref, computed } = context;

  context.commands.register('text-diff.open', () => {});

  const component = {
    setup() {
      const left = ref('');
      const right = ref('');
      const showResult = ref(false);
      const sideBySide = ref(true);

      const diff = computed(() => {
        if (!showResult.value) return null;
        return computeDiff(left.value, right.value);
      });

      const stats = computed(() => {
        if (!diff.value) return null;
        let added = 0, removed = 0;
        for (const line of diff.value) {
          if (line.type === 'add') added++;
          else if (line.type === 'del') removed++;
        }
        return { added, removed };
      });

      function compare() {
        showResult.value = true;
      }

      function swap() {
        const tmp = left.value;
        left.value = right.value;
        right.value = tmp;
        if (showResult.value) showResult.value = true;
      }

      function clear() {
        left.value = '';
        right.value = '';
        showResult.value = false;
      }

      return () => {
        const children = [];

        // Input area
        children.push(
          h('div', { class: 'text-diff-inputs' }, [
            h('div', { class: 'input-group' }, [
              h('label', null, '原始文本'),
              h('textarea', {
                value: left.value,
                onInput: (e) => { left.value = e.target.value; },
                placeholder: '粘贴原始文本...'
              })
            ]),
            h('div', { class: 'input-group' }, [
              h('label', null, '修改文本'),
              h('textarea', {
                value: right.value,
                onInput: (e) => { right.value = e.target.value; },
                placeholder: '粘贴修改后的文本...'
              })
            ])
          ])
        );

        // Toolbar
        const toolbarItems = [
          h('button', { onClick: compare }, '对比'),
          h('button', { onClick: swap, class: 'mode-toggle' }, '交换'),
          h('button', { onClick: clear, class: 'mode-toggle' }, '清空'),
          h('button', {
            class: 'mode-toggle' + (sideBySide.value ? ' active' : ''),
            onClick: () => { sideBySide.value = !sideBySide.value; }
          }, sideBySide.value ? '并排' : '上下'),
        ];

        if (stats.value) {
          toolbarItems.push(
            h('span', { class: 'stats' },
              `+${stats.value.added} -${stats.value.removed}`)
          );
        }

        children.push(h('div', { class: 'text-diff-toolbar' }, toolbarItems));

        // Result
        if (diff.value) {
          if (sideBySide.value) {
            children.push(renderSideBySide(h, diff.value));
          } else {
            children.push(renderUnified(h, diff.value));
          }
        }

        return h('div', { class: 'text-diff' }, children);
      };
    }
  };

  return { component };
}

function computeDiff(a, b) {
  const aLines = splitLines(a);
  const bLines = splitLines(b);
  const n = aLines.length;
  const m = bLines.length;

  if (n === 0 && m === 0) {
    return [];
  }

  if (n + m > 50000 || n * m > 2_000_000) {
    return [{ type: 'ctx', left: 1, right: 1, text: '(文本过长，仅显示简单对比)' }];
  }

  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result = [];
  let i = 0, j = 0;
  let leftNum = 0, rightNum = 0;

  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      leftNum++;
      rightNum++;
      result.push({ type: 'ctx', left: leftNum, right: rightNum, text: aLines[i] });
      i++;
      j++;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      leftNum++;
      result.push({ type: 'del', left: leftNum, text: aLines[i] });
      i++;
    } else {
      rightNum++;
      result.push({ type: 'add', right: rightNum, text: bLines[j] });
      j++;
    }
  }

  while (i < n) {
    leftNum++;
    result.push({ type: 'del', left: leftNum, text: aLines[i] });
    i++;
  }

  while (j < m) {
    rightNum++;
    result.push({ type: 'add', right: rightNum, text: bLines[j] });
    j++;
  }

  // Inline char highlighting for adjacent add/del pairs
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].type === 'del' && result[i + 1].type === 'add') {
      const [delH, addH] = charDiff(result[i].text, result[i + 1].text);
      result[i].highlights = delH;
      result[i + 1].highlights = addH;
    }
  }

  return result;
}

function splitLines(text) {
  return text === '' ? [] : text.split('\n');
}

function charDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const aKeep = new Set();
  const bKeep = new Set();
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      aKeep.add(i - 1);
      bKeep.add(j - 1);
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const aH = [], bH = [];
  for (let k = 0; k < n; k++) if (!aKeep.has(k)) aH.push(k);
  for (let k = 0; k < m; k++) if (!bKeep.has(k)) bH.push(k);
  return [aH, bH];
}

function renderUnified(h, diff) {
  const lines = diff.map((line) => {
    const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
    const num = line.type === 'add' ? line.right : line.left;
    const content = line.highlights
      ? renderHighlighted(h, line.text, line.highlights, line.type === 'add' ? 'char-add' : 'char-del')
      : line.text;

    return h('div', { class: 'diff-line ' + (line.type === 'ctx' ? 'context' : line.type === 'add' ? 'added' : 'removed') }, [
      h('span', { class: 'line-num' }, String(num)),
      h('span', { class: 'line-content' }, [prefix + ' ', content])
    ]);
  });
  return h('div', { class: 'text-diff-result' }, lines);
}

function renderSideBySide(h, diff) {
  const leftLines = [];
  const rightLines = [];

  for (const line of diff) {
    if (line.type === 'ctx') {
      leftLines.push({ num: line.left, text: line.text, cls: 'context' });
      rightLines.push({ num: line.right, text: line.text, cls: 'context' });
    } else if (line.type === 'del') {
      const content = line.highlights
        ? renderHighlighted(h, line.text, line.highlights, 'char-del')
        : line.text;
      leftLines.push({ num: line.left, content, cls: 'removed' });
      rightLines.push({ num: '', text: '', cls: 'context' });
    } else {
      const content = line.highlights
        ? renderHighlighted(h, line.text, line.highlights, 'char-add')
        : line.text;
      leftLines.push({ num: '', text: '', cls: 'context' });
      rightLines.push({ num: line.right, content, cls: 'added' });
    }
  }

  function renderPanel(lines) {
    return h('div', { class: 'side-panel' }, lines.map((l) =>
      h('div', { class: 'diff-line ' + l.cls }, [
        h('span', { class: 'line-num' }, String(l.num)),
        h('span', { class: 'line-content' }, l.content || l.text || '')
      ])
    ));
  }

  return h('div', { class: 'text-diff-result side-by-side' }, [
    renderPanel(leftLines),
    renderPanel(rightLines)
  ]);
}

function renderHighlighted(h, text, indices, cls) {
  if (!indices.length) return text;
  const set = new Set(indices);
  const parts = [];
  let buf = '', inHL = false;
  for (let i = 0; i < text.length; i++) {
    const hl = set.has(i);
    if (hl !== inHL) {
      if (buf) parts.push(inHL ? h('span', { class: cls }, buf) : buf);
      buf = '';
      inHL = hl;
    }
    buf += text[i];
  }
  if (buf) parts.push(inHL ? h('span', { class: cls }, buf) : buf);
  return parts;
}

export { activate };
