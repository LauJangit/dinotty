use std::collections::VecDeque;
use vte::{Params, Perform};

#[derive(Clone, Copy, Default)]
pub struct CellAttrs {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub inverse: bool,
    pub strikethrough: bool,
}

#[derive(Clone, Copy)]
pub enum Color {
    Indexed(u8),
    Rgb(u8, u8, u8),
}

#[derive(Clone, Copy)]
struct Cell {
    ch: char,
    attrs: CellAttrs,
}

impl Default for Cell {
    fn default() -> Self {
        Self { ch: ' ', attrs: CellAttrs::default() }
    }
}

#[derive(Clone)]
struct CursorState {
    row: usize,
    col: usize,
    attrs: CellAttrs,
}

impl Default for CursorState {
    fn default() -> Self {
        Self { row: 0, col: 0, attrs: CellAttrs::default() }
    }
}

#[derive(Clone)]
struct ScreenBuffer {
    cells: Vec<Vec<Cell>>,
    cursor: CursorState,
    scroll_top: usize,
    scroll_bottom: usize,
    cols: usize,
    rows: usize,
}

impl ScreenBuffer {
    fn new(cols: usize, rows: usize) -> Self {
        Self {
            cells: vec![vec![Cell::default(); cols]; rows],
            cursor: CursorState::default(),
            scroll_top: 0,
            scroll_bottom: rows - 1,
            cols,
            rows,
        }
    }

    fn resize(&mut self, cols: usize, rows: usize) {
        let old_rows = self.cells.len();
        let old_cols = if old_rows > 0 { self.cells[0].len() } else { 0 };

        if rows != old_rows {
            self.cells.resize(rows, vec![Cell::default(); cols]);
        }
        if cols != old_cols {
            for row in &mut self.cells {
                row.resize(cols, Cell::default());
            }
        }
        self.cols = cols;
        self.rows = rows;
        self.scroll_bottom = rows - 1;
        if self.cursor.row >= rows {
            self.cursor.row = rows - 1;
        }
        if self.cursor.col >= cols {
            self.cursor.col = cols - 1;
        }
    }

    fn scroll_up(&mut self, scrollback: &mut VecDeque<Vec<Cell>>) {
        let row = self.cells.remove(self.scroll_top);
        if self.scroll_top == 0 {
            scrollback.push_back(row);
            if scrollback.len() > 10000 {
                scrollback.pop_front();
            }
        }
        self.cells.insert(self.scroll_bottom, vec![Cell::default(); self.cols]);
    }

    fn scroll_down(&mut self) {
        self.cells.remove(self.scroll_bottom);
        self.cells.insert(self.scroll_top, vec![Cell::default(); self.cols]);
    }
}

pub struct VirtualScreen {
    primary: ScreenBuffer,
    alternate: ScreenBuffer,
    using_alternate: bool,
    scrollback: VecDeque<Vec<Cell>>,
    parser: vte::Parser,
    cols: usize,
    rows: usize,
    saved_cursor: Option<CursorState>,
    pending_switch: Option<bool>, // Some(true)=enter alt, Some(false)=leave alt
}

impl VirtualScreen {
    pub fn new(cols: usize, rows: usize) -> Self {
        Self {
            primary: ScreenBuffer::new(cols, rows),
            alternate: ScreenBuffer::new(cols, rows),
            using_alternate: false,
            scrollback: VecDeque::new(),
            parser: vte::Parser::new(),
            cols,
            rows,
            saved_cursor: None,
            pending_switch: None,
        }
    }

    pub fn feed(&mut self, data: &[u8]) {
        for &byte in data {
            let mut performer = ScreenPerformer {
                screen: if self.using_alternate { &mut self.alternate } else { &mut self.primary },
                scrollback: &mut self.scrollback,
                saved_cursor: &mut self.saved_cursor,
                pending_switch: &mut self.pending_switch,
            };
            self.parser.advance(&mut performer, byte);

            // Handle alternate screen switch after processing
            if let Some(enter) = self.pending_switch.take() {
                if enter && !self.using_alternate {
                    self.saved_cursor = Some(self.primary.cursor.clone());
                    self.using_alternate = true;
                    // Clear alternate screen on enter
                    self.alternate = ScreenBuffer::new(self.cols, self.rows);
                } else if !enter && self.using_alternate {
                    self.using_alternate = false;
                    if let Some(ref saved) = self.saved_cursor {
                        self.primary.cursor = saved.clone();
                    }
                }
            }
        }
    }

    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows = rows;
        self.primary.resize(cols, rows);
        self.alternate.resize(cols, rows);
    }

    pub fn snapshot_scrollback_chunks(&self, chunk_lines: usize) -> Vec<String> {
        if self.using_alternate || self.scrollback.is_empty() {
            return Vec::new();
        }
        let mut chunks = Vec::new();
        let mut current = String::new();
        let mut lines_in_chunk = 0;

        for row in &self.scrollback {
            let mut prev_attrs = CellAttrs::default();
            let last_content = row.iter().rposition(|c| c.ch != ' ' || has_attrs(&c.attrs))
                .map(|i| i + 1).unwrap_or(0);
            for cell in &row[..last_content] {
                if !attrs_eq(&cell.attrs, &prev_attrs) {
                    current.push_str(&encode_sgr(&cell.attrs));
                    prev_attrs = cell.attrs;
                }
                current.push(cell.ch);
            }
            if has_attrs(&prev_attrs) {
                current.push_str("\x1b[0m");
            }
            current.push_str("\r\n");
            lines_in_chunk += 1;

            if lines_in_chunk >= chunk_lines {
                chunks.push(std::mem::take(&mut current));
                lines_in_chunk = 0;
            }
        }
        if !current.is_empty() {
            chunks.push(current);
        }
        chunks
    }

    pub fn snapshot(&self) -> String {
        let buf = if self.using_alternate { &self.alternate } else { &self.primary };
        let mut out = String::with_capacity(self.cols * self.rows * 4);

        // Reset terminal state
        out.push_str("\x1b[!p"); // soft reset
        out.push_str("\x1b[?25l"); // hide cursor during draw

        if self.using_alternate {
            out.push_str("\x1b[?1049h"); // enter alternate screen
        }

        // Render each row
        for (row_idx, row) in buf.cells.iter().enumerate() {
            out.push_str(&format!("\x1b[{};1H\x1b[2K", row_idx + 1)); // move to row start + erase line
            let mut prev_attrs = CellAttrs::default();

            // Find last non-space column to avoid trailing spaces
            let last_content = row.iter().rposition(|c| c.ch != ' ' || has_attrs(&c.attrs))
                .map(|i| i + 1).unwrap_or(0);

            for cell in &row[..last_content] {
                if !attrs_eq(&cell.attrs, &prev_attrs) {
                    out.push_str(&encode_sgr(&cell.attrs));
                    prev_attrs = cell.attrs;
                }
                out.push(cell.ch);
            }

            // Reset attrs at end of row
            if has_attrs(&prev_attrs) {
                out.push_str("\x1b[0m");
            }
        }

        // Restore cursor position
        out.push_str(&format!("\x1b[{};{}H", buf.cursor.row + 1, buf.cursor.col + 1));
        // Restore cursor attrs
        out.push_str(&encode_sgr(&buf.cursor.attrs));
        out.push_str("\x1b[?25h"); // show cursor

        out
    }
}

fn has_attrs(a: &CellAttrs) -> bool {
    a.fg.is_some() || a.bg.is_some() || a.bold || a.dim || a.italic || a.underline || a.inverse || a.strikethrough
}

fn attrs_eq(a: &CellAttrs, b: &CellAttrs) -> bool {
    color_eq(&a.fg, &b.fg) && color_eq(&a.bg, &b.bg)
        && a.bold == b.bold && a.dim == b.dim && a.italic == b.italic
        && a.underline == b.underline && a.inverse == b.inverse && a.strikethrough == b.strikethrough
}

fn color_eq(a: &Option<Color>, b: &Option<Color>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Color::Indexed(x)), Some(Color::Indexed(y))) => x == y,
        (Some(Color::Rgb(r1, g1, b1)), Some(Color::Rgb(r2, g2, b2))) => r1 == r2 && g1 == g2 && b1 == b2,
        _ => false,
    }
}

fn encode_sgr(attrs: &CellAttrs) -> String {
    let mut params: Vec<String> = vec!["0".to_string()]; // reset first
    if attrs.bold { params.push("1".to_string()); }
    if attrs.dim { params.push("2".to_string()); }
    if attrs.italic { params.push("3".to_string()); }
    if attrs.underline { params.push("4".to_string()); }
    if attrs.inverse { params.push("7".to_string()); }
    if attrs.strikethrough { params.push("9".to_string()); }
    match attrs.fg {
        Some(Color::Indexed(c)) if c < 8 => params.push(format!("{}", 30 + c)),
        Some(Color::Indexed(c)) if c < 16 => params.push(format!("{}", 90 + c - 8)),
        Some(Color::Indexed(c)) => params.push(format!("38;5;{}", c)),
        Some(Color::Rgb(r, g, b)) => params.push(format!("38;2;{};{};{}", r, g, b)),
        None => {}
    }
    match attrs.bg {
        Some(Color::Indexed(c)) if c < 8 => params.push(format!("{}", 40 + c)),
        Some(Color::Indexed(c)) if c < 16 => params.push(format!("{}", 100 + c - 8)),
        Some(Color::Indexed(c)) => params.push(format!("48;5;{}", c)),
        Some(Color::Rgb(r, g, b)) => params.push(format!("48;2;{};{};{}", r, g, b)),
        None => {}
    }
    format!("\x1b[{}m", params.join(";"))
}

// Internal performer that applies VT sequences to the screen buffer
struct ScreenPerformer<'a> {
    screen: &'a mut ScreenBuffer,
    scrollback: &'a mut VecDeque<Vec<Cell>>,
    saved_cursor: &'a mut Option<CursorState>,
    pending_switch: &'a mut Option<bool>,
}

impl<'a> Perform for ScreenPerformer<'a> {
    fn print(&mut self, c: char) {
        if self.screen.cursor.col >= self.screen.cols {
            self.screen.cursor.col = 0;
            self.screen.cursor.row += 1;
            if self.screen.cursor.row > self.screen.scroll_bottom {
                self.screen.cursor.row = self.screen.scroll_bottom;
                self.screen.scroll_up(self.scrollback);
            }
        }
        let row = self.screen.cursor.row;
        let col = self.screen.cursor.col;
        if row < self.screen.rows && col < self.screen.cols {
            self.screen.cells[row][col] = Cell { ch: c, attrs: self.screen.cursor.attrs };
        }
        self.screen.cursor.col += 1;
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            0x08 => { // BS
                if self.screen.cursor.col > 0 {
                    self.screen.cursor.col -= 1;
                }
            }
            0x09 => { // HT (tab)
                self.screen.cursor.col = ((self.screen.cursor.col / 8) + 1) * 8;
                if self.screen.cursor.col >= self.screen.cols {
                    self.screen.cursor.col = self.screen.cols - 1;
                }
            }
            0x0A | 0x0B | 0x0C => { // LF, VT, FF
                self.screen.cursor.row += 1;
                if self.screen.cursor.row > self.screen.scroll_bottom {
                    self.screen.cursor.row = self.screen.scroll_bottom;
                    self.screen.scroll_up(self.scrollback);
                }
            }
            0x0D => { // CR
                self.screen.cursor.col = 0;
            }
            _ => {}
        }
    }

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {}

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, action: char) {
        let ps: Vec<u16> = params.iter().flat_map(|s| s.iter().copied()).collect();
        let p0 = ps.first().copied().unwrap_or(0) as usize;
        let p1 = ps.get(1).copied().unwrap_or(0) as usize;

        // Handle DECSET/DECRST (CSI ? Ps h/l)
        if intermediates == b"?" {
            match action {
                'h' => {
                    for &p in &ps {
                        if p == 1049 || p == 47 || p == 1047 {
                            *self.pending_switch = Some(true);
                        }
                    }
                    return;
                }
                'l' => {
                    for &p in &ps {
                        if p == 1049 || p == 47 || p == 1047 {
                            *self.pending_switch = Some(false);
                        }
                    }
                    return;
                }
                _ => return,
            }
        }

        match action {
            'A' => { // CUU - cursor up
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.row = self.screen.cursor.row.saturating_sub(n);
            }
            'B' => { // CUD - cursor down
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.row = (self.screen.cursor.row + n).min(self.screen.rows - 1);
            }
            'C' => { // CUF - cursor forward
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.col = (self.screen.cursor.col + n).min(self.screen.cols - 1);
            }
            'D' => { // CUB - cursor back
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.col = self.screen.cursor.col.saturating_sub(n);
            }
            'H' | 'f' => { // CUP - cursor position
                let row = if p0 == 0 { 1 } else { p0 };
                let col = if p1 == 0 { 1 } else { p1 };
                self.screen.cursor.row = (row - 1).min(self.screen.rows - 1);
                self.screen.cursor.col = (col - 1).min(self.screen.cols - 1);
            }
            'J' => { // ED - erase display
                match p0 {
                    0 => { // from cursor to end
                        let row = self.screen.cursor.row;
                        let col = self.screen.cursor.col;
                        for c in &mut self.screen.cells[row][col..] { *c = Cell::default(); }
                        for r in (row + 1)..self.screen.rows {
                            for c in &mut self.screen.cells[r] { *c = Cell::default(); }
                        }
                    }
                    1 => { // from start to cursor
                        let row = self.screen.cursor.row;
                        let col = self.screen.cursor.col;
                        for r in 0..row {
                            for c in &mut self.screen.cells[r] { *c = Cell::default(); }
                        }
                        for c in &mut self.screen.cells[row][..=col.min(self.screen.cols - 1)] { *c = Cell::default(); }
                    }
                    2 | 3 => { // entire screen
                        for r in &mut self.screen.cells {
                            for c in r { *c = Cell::default(); }
                        }
                    }
                    _ => {}
                }
            }
            'K' => { // EL - erase line
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                match p0 {
                    0 => { for c in &mut self.screen.cells[row][col..] { *c = Cell::default(); } }
                    1 => { for c in &mut self.screen.cells[row][..=col.min(self.screen.cols - 1)] { *c = Cell::default(); } }
                    2 => { for c in &mut self.screen.cells[row] { *c = Cell::default(); } }
                    _ => {}
                }
            }
            'L' => { // IL - insert lines
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                for _ in 0..n {
                    if self.screen.scroll_bottom < self.screen.cells.len() {
                        self.screen.cells.remove(self.screen.scroll_bottom);
                    }
                    self.screen.cells.insert(row, vec![Cell::default(); self.screen.cols]);
                }
            }
            'M' => { // DL - delete lines
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                for _ in 0..n {
                    if row < self.screen.cells.len() {
                        self.screen.cells.remove(row);
                    }
                    self.screen.cells.insert(self.screen.scroll_bottom, vec![Cell::default(); self.screen.cols]);
                }
            }
            'P' => { // DCH - delete characters
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                for _ in 0..n {
                    if col < self.screen.cells[row].len() {
                        self.screen.cells[row].remove(col);
                        self.screen.cells[row].push(Cell::default());
                    }
                }
            }
            '@' => { // ICH - insert characters
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                for _ in 0..n {
                    self.screen.cells[row].insert(col, Cell::default());
                    self.screen.cells[row].truncate(self.screen.cols);
                }
            }
            'S' => { // SU - scroll up
                let n = if p0 == 0 { 1 } else { p0 };
                for _ in 0..n { self.screen.scroll_up(self.scrollback); }
            }
            'T' => { // SD - scroll down
                let n = if p0 == 0 { 1 } else { p0 };
                for _ in 0..n { self.screen.scroll_down(); }
            }
            'r' => { // DECSTBM - set scroll region
                let top = if p0 == 0 { 1 } else { p0 };
                let bottom = if p1 == 0 { self.screen.rows } else { p1 };
                self.screen.scroll_top = (top - 1).min(self.screen.rows - 1);
                self.screen.scroll_bottom = (bottom - 1).min(self.screen.rows - 1);
                self.screen.cursor.row = 0;
                self.screen.cursor.col = 0;
            }
            'd' => { // VPA - line position absolute
                let row = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.row = (row - 1).min(self.screen.rows - 1);
            }
            'G' | '`' => { // CHA - cursor character absolute
                let col = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.col = (col - 1).min(self.screen.cols - 1);
            }
            'X' => { // ECH - erase characters
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                for i in 0..n {
                    if col + i < self.screen.cols {
                        self.screen.cells[row][col + i] = Cell::default();
                    }
                }
            }
            'm' => { // SGR - select graphic rendition
                self.apply_sgr(&ps);
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, intermediates: &[u8], _ignore: bool, byte: u8) {
        match (intermediates, byte) {
            (b"7", _) | ([], b'7') => { // DECSC - save cursor
                *self.saved_cursor = Some(self.screen.cursor.clone());
            }
            (b"8", _) | ([], b'8') => { // DECRC - restore cursor
                if let Some(ref saved) = self.saved_cursor {
                    self.screen.cursor = saved.clone();
                }
            }
            ([], b'M') => { // RI - reverse index (scroll down)
                if self.screen.cursor.row == self.screen.scroll_top {
                    self.screen.scroll_down();
                } else if self.screen.cursor.row > 0 {
                    self.screen.cursor.row -= 1;
                }
            }
            _ => {}
        }
    }
}

impl<'a> ScreenPerformer<'a> {
    fn apply_sgr(&mut self, params: &[u16]) {
        if params.is_empty() {
            self.screen.cursor.attrs = CellAttrs::default();
            return;
        }
        let mut i = 0;
        while i < params.len() {
            match params[i] {
                0 => self.screen.cursor.attrs = CellAttrs::default(),
                1 => self.screen.cursor.attrs.bold = true,
                2 => self.screen.cursor.attrs.dim = true,
                3 => self.screen.cursor.attrs.italic = true,
                4 => self.screen.cursor.attrs.underline = true,
                7 => self.screen.cursor.attrs.inverse = true,
                9 => self.screen.cursor.attrs.strikethrough = true,
                21 | 22 => { self.screen.cursor.attrs.bold = false; self.screen.cursor.attrs.dim = false; }
                23 => self.screen.cursor.attrs.italic = false,
                24 => self.screen.cursor.attrs.underline = false,
                27 => self.screen.cursor.attrs.inverse = false,
                29 => self.screen.cursor.attrs.strikethrough = false,
                30..=37 => self.screen.cursor.attrs.fg = Some(Color::Indexed((params[i] - 30) as u8)),
                38 => {
                    i += 1;
                    if i < params.len() {
                        match params[i] {
                            5 => { i += 1; if i < params.len() { self.screen.cursor.attrs.fg = Some(Color::Indexed(params[i] as u8)); } }
                            2 => {
                                if i + 3 < params.len() {
                                    self.screen.cursor.attrs.fg = Some(Color::Rgb(params[i+1] as u8, params[i+2] as u8, params[i+3] as u8));
                                    i += 3;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                39 => self.screen.cursor.attrs.fg = None,
                40..=47 => self.screen.cursor.attrs.bg = Some(Color::Indexed((params[i] - 40) as u8)),
                48 => {
                    i += 1;
                    if i < params.len() {
                        match params[i] {
                            5 => { i += 1; if i < params.len() { self.screen.cursor.attrs.bg = Some(Color::Indexed(params[i] as u8)); } }
                            2 => {
                                if i + 3 < params.len() {
                                    self.screen.cursor.attrs.bg = Some(Color::Rgb(params[i+1] as u8, params[i+2] as u8, params[i+3] as u8));
                                    i += 3;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                49 => self.screen.cursor.attrs.bg = None,
                90..=97 => self.screen.cursor.attrs.fg = Some(Color::Indexed((params[i] - 90 + 8) as u8)),
                100..=107 => self.screen.cursor.attrs.bg = Some(Color::Indexed((params[i] - 100 + 8) as u8)),
                _ => {}
            }
            i += 1;
        }
    }
}
