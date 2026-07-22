use super::data::{CellAttrs, Color, ScreenBuffer};
use std::fmt::Write;

/// Render every row of `buf` with absolute addressing (`CSI row;1 H` +
/// erase-line), skipping trailing blanks, and leave attributes reset.
pub(crate) fn render_buffer(buf: &ScreenBuffer, out: &mut String) {
    let mut prev_attrs = CellAttrs::default();
    for (row_idx, row) in buf.cells.iter().enumerate() {
        let _ = write!(out, "\x1b[{};1H\x1b[2K", row_idx + 1); // move to row start + erase line

        // Find last non-space column to avoid trailing spaces
        let last_content = row
            .iter()
            .rposition(|c| (c.ch != ' ' && c.ch != '\0') || has_attrs(&c.attrs))
            .map_or(0, |i| i + 1);

        for cell in &row[..last_content] {
            if cell.ch == '\0' {
                continue;
            }
            if !attrs_eq(&cell.attrs, &prev_attrs) {
                out.push_str(&encode_sgr(&cell.attrs));
                prev_attrs = cell.attrs;
            }
            cell.write_to(out);
        }

        // Reset attrs at end of row
        if has_attrs(&prev_attrs) {
            out.push_str("\x1b[0m");
            prev_attrs = CellAttrs::default();
        }
    }
    out.push_str("\x1b[0m");
}

/// Restore `buf`'s scroll region (if non-default) and cursor position.
pub(crate) fn restore_cursor_state(buf: &ScreenBuffer, out: &mut String) {
    if buf.scroll_top != 0 || buf.scroll_bottom != buf.rows - 1 {
        let _ = write!(out, "\x1b[{};{}r", buf.scroll_top + 1, buf.scroll_bottom + 1);
    }
    let _ = write!(out, "\x1b[{};{}H", buf.cursor.row + 1, buf.cursor.col + 1);
}

pub(crate) fn has_attrs(a: &CellAttrs) -> bool {
    a.fg.is_some()
        || a.bg.is_some()
        || a.bold
        || a.dim
        || a.italic
        || a.underline
        || a.inverse
        || a.strikethrough
}

pub(crate) fn attrs_eq(a: &CellAttrs, b: &CellAttrs) -> bool {
    color_eq(a.fg, b.fg)
        && color_eq(a.bg, b.bg)
        && a.bold == b.bold
        && a.dim == b.dim
        && a.italic == b.italic
        && a.underline == b.underline
        && a.inverse == b.inverse
        && a.strikethrough == b.strikethrough
}

pub(crate) fn color_eq(a: Option<Color>, b: Option<Color>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Color::Indexed(x)), Some(Color::Indexed(y))) => x == y,
        (Some(Color::Rgb(r1, g1, b1)), Some(Color::Rgb(r2, g2, b2))) => {
            r1 == r2 && g1 == g2 && b1 == b2
        }
        _ => false,
    }
}

pub(crate) fn encode_sgr(attrs: &CellAttrs) -> String {
    let mut params: Vec<String> = vec!["0".to_string()]; // reset first
    if attrs.bold {
        params.push("1".to_string());
    }
    if attrs.dim {
        params.push("2".to_string());
    }
    if attrs.italic {
        params.push("3".to_string());
    }
    if attrs.underline {
        params.push("4".to_string());
    }
    if attrs.inverse {
        params.push("7".to_string());
    }
    if attrs.strikethrough {
        params.push("9".to_string());
    }
    match attrs.fg {
        Some(Color::Indexed(c)) if c < 8 => params.push(format!("{}", 30 + c)),
        Some(Color::Indexed(c)) if c < 16 => params.push(format!("{}", 90 + c - 8)),
        Some(Color::Indexed(c)) => params.push(format!("38;5;{c}")),
        Some(Color::Rgb(r, g, b)) => params.push(format!("38;2;{r};{g};{b}")),
        None => {}
    }
    match attrs.bg {
        Some(Color::Indexed(c)) if c < 8 => params.push(format!("{}", 40 + c)),
        Some(Color::Indexed(c)) if c < 16 => params.push(format!("{}", 100 + c - 8)),
        Some(Color::Indexed(c)) => params.push(format!("48;5;{c}")),
        Some(Color::Rgb(r, g, b)) => params.push(format!("48;2;{r};{g};{b}")),
        None => {}
    }
    format!("\x1b[{}m", params.join(";"))
}
