/// Recursively check if a JSON layout tree contains a leaf with the given `pane_id`.
pub(crate) fn layout_has_pane(layout: &serde_json::Value, pane_id: &str) -> bool {
    if let Some(pid) = layout.get("paneId").and_then(|v| v.as_str()) {
        if pid == pane_id {
            return true;
        }
    }
    if let Some(children) = layout.get("children").and_then(|v| v.as_array()) {
        for child in children {
            if layout_has_pane(child, pane_id) {
                return true;
            }
        }
    }
    false
}

#[must_use]
pub fn collect_leaf_pane_ids(layout: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    collect_leaf_ids_recursive(layout, &mut ids);
    ids
}

/// # Panics
/// May panic if the JSON tree structure is unexpectedly malformed.
#[must_use]
pub fn remove_pane_from_layout(
    node: &serde_json::Value,
    pane_id: &str,
) -> Option<serde_json::Value> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            if node.get("paneId")?.as_str()? == pane_id {
                None
            } else {
                Some(node.clone())
            }
        }
        "split" => {
            let children = node.get("children")?.as_array()?;
            let new_children: Vec<serde_json::Value> =
                children.iter().filter_map(|c| remove_pane_from_layout(c, pane_id)).collect();
            match new_children.len() {
                0 => None,
                _ if new_children.len() == children.len() => {
                    // Children count unchanged - but a child may have changed internally
                    // (e.g. a nested split collapsed). Always use the updated children.
                    let mut result = node.clone();
                    result["children"] = serde_json::Value::Array(new_children);
                    Some(result)
                }
                1 => {
                    // Single-child split is degenerate - collapse by returning the child directly
                    Some(
                        new_children
                            .into_iter()
                            .next()
                            .unwrap_or_else(|| unreachable!("checked len == 1")),
                    )
                }
                _ => {
                    let mut result = node.clone();
                    result["children"] = serde_json::Value::Array(new_children);
                    // Rebalance ratios evenly
                    let n = result["children"]
                        .as_array()
                        .unwrap_or_else(|| unreachable!("just assigned as array"))
                        .len();
                    #[allow(clippy::cast_precision_loss)]
                    let ratio = 1.0 / f64::from(u32::try_from(n).unwrap_or(1));
                    result["ratios"] = serde_json::Value::Array(
                        (0..n).map(|_| serde_json::Value::from(ratio)).collect(),
                    );
                    Some(result)
                }
            }
        }
        _ => Some(node.clone()),
    }
}

/// Find and return a clone of the leaf node matching `pane_id`, preserving
/// all its original fields (kind, pluginId, path, url, title, etc.).
/// Used by move/extract handlers to relocate an existing leaf verbatim.
#[must_use]
pub fn extract_leaf_from_layout(
    node: &serde_json::Value,
    pane_id: &str,
) -> Option<serde_json::Value> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            if node.get("paneId")?.as_str()? == pane_id {
                Some(node.clone())
            } else {
                None
            }
        }
        "split" => {
            let children = node.get("children")?.as_array()?;
            children.iter().find_map(|c| extract_leaf_from_layout(c, pane_id))
        }
        _ => None,
    }
}

fn collect_leaf_ids_recursive(node: &serde_json::Value, ids: &mut Vec<String>) {
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        if node_type == "leaf" {
            if let Some(pane_id) = node.get("paneId").and_then(|v| v.as_str()) {
                ids.push(pane_id.to_string());
            }
        } else if node_type == "split" {
            if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
                for child in children {
                    collect_leaf_ids_recursive(child, ids);
                }
            }
        }
    }
}

/// Returns the kind of a leaf node, defaulting to `"terminal"` when absent
/// (for backward compatibility with layouts created before `kind` was introduced).
fn leaf_kind(node: &serde_json::Value) -> &str {
    node.get("kind").and_then(|v| v.as_str()).unwrap_or("terminal")
}

/// Collect `pane_ids` of leaves that require a PTY session (`kind=terminal` or absent).
/// Leaves with `kind=plugin|files|web` have no PTY and are excluded.
#[must_use]
pub fn collect_terminal_leaf_pane_ids(layout: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    collect_terminal_leaf_ids_recursive(layout, &mut ids);
    ids
}

fn collect_terminal_leaf_ids_recursive(node: &serde_json::Value, ids: &mut Vec<String>) {
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        if node_type == "leaf" {
            if leaf_kind(node) == "terminal" {
                if let Some(pane_id) = node.get("paneId").and_then(|v| v.as_str()) {
                    ids.push(pane_id.to_string());
                }
            }
        } else if node_type == "split" {
            if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
                for child in children {
                    collect_terminal_leaf_ids_recursive(child, ids);
                }
            }
        }
    }
}

/// Recursively ensure every leaf node carries a `kind` field. Leaves without
/// `kind` are tagged `"terminal"` (backward compatibility). Returns a new tree.
#[must_use]
pub fn ensure_leaf_kind(layout: serde_json::Value) -> serde_json::Value {
    match layout.get("type").and_then(|v| v.as_str()) {
        Some("leaf") => {
            if layout.get("kind").is_none() {
                let mut result = layout;
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("kind".to_string(), serde_json::json!("terminal"));
                }
                result
            } else {
                layout
            }
        }
        Some("split") => {
            let mut result = layout;
            if let Some(children) = result.get_mut("children").and_then(|c| c.as_array_mut()) {
                let new_children: Vec<serde_json::Value> =
                    children.drain(..).map(ensure_leaf_kind).collect();
                *children = new_children;
            }
            result
        }
        _ => layout,
    }
}

/// Normalize a split `direction` field to `"horizontal"` / `"vertical"`.
///
/// Frontend's `SplitContainer` and `SplitDivider` only handle these two values.
/// Legacy callers (cross-tab merge, non-terminal pane insertion) pass
/// `"left"` / `"right"` / `"top"` / `"bottom"` to express position; that
/// position is used to decide child ordering, but the stored `direction`
/// field must be the axis. This helper also tolerates `"horizontal"` /
/// `"vertical"` inputs so callers can pass either form.
fn normalize_split_direction(direction: &str) -> &'static str {
    match direction {
        "top" | "bottom" | "vertical" => "vertical",
        _ => "horizontal",
    }
}

/// Insert a new pane into the layout tree by splitting the target pane.
/// Returns the updated layout, or None if the target pane was not found.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn insert_pane_into_layout(
    layout: &serde_json::Value,
    target_pane_id: &str,
    direction: &str,
    new_pane_id: &str,
) -> Option<serde_json::Value> {
    insert_pane_into_layout_inner(layout, target_pane_id, direction, new_pane_id, None, None)
}

/// Insert a subtree (split or leaf) into the layout by splitting the target
/// pane. The target leaf is wrapped in a new split node containing
/// `[subtree, target]` when `direction=left|top` (subtree first), or
/// `[target, subtree]` otherwise. The subtree's internal structure is
/// preserved as-is. Used for "drag whole tab as subtree" (mode A).
///
/// When the parent split has the same `direction` as the new split, the new
/// split's children are flattened into the parent (mirrors
/// `insert_pane_into_layout_inner` behavior).
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn insert_subtree_into_layout(
    layout: &serde_json::Value,
    target_pane_id: &str,
    direction: &str,
    subtree: serde_json::Value,
) -> Option<serde_json::Value> {
    let node_type = layout.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            let pane_id = layout.get("paneId")?.as_str()?;
            if pane_id == target_pane_id {
                let existing_leaf = layout.clone();
                let split_id = uuid::Uuid::new_v4().to_string();
                let (first, second) = match direction {
                    "left" | "top" => (subtree, existing_leaf),
                    _ => (existing_leaf, subtree),
                };
                Some(serde_json::json!({
                    "type": "split",
                    "id": split_id,
                    "direction": normalize_split_direction(direction),
                    "children": [first, second],
                    "ratios": [0.5, 0.5],
                }))
            } else {
                Some(layout.clone())
            }
        }
        "split" => {
            let parent_dir = layout.get("direction")?.as_str()?;
            let parent_dir_axis = normalize_split_direction(parent_dir);
            let children = layout.get("children")?.as_array()?;
            let mut new_children: Vec<serde_json::Value> = Vec::new();
            let mut found = false;
            for child in children {
                if let Some(updated) =
                    insert_subtree_into_layout(child, target_pane_id, direction, subtree.clone())
                {
                    let changed = found || updated != *child;
                    if changed {
                        found = true;
                    }
                    // Flatten: if the updated child became a split with the same
                    // direction as the parent, splice its children into the parent.
                    if changed
                        && updated.get("type").and_then(|t| t.as_str()) == Some("split")
                        && updated
                            .get("direction")
                            .and_then(|d| d.as_str())
                            .map(normalize_split_direction)
                            == Some(parent_dir_axis)
                    {
                        if let Some(inner_children) =
                            updated.get("children").and_then(|c| c.as_array())
                        {
                            new_children.extend(inner_children.iter().cloned());
                            continue;
                        }
                    }
                    new_children.push(updated);
                }
            }
            if !found {
                return Some(layout.clone());
            }
            let mut result = layout.clone();
            let n = new_children.len();
            let ratio = 1.0 / f64::from(u32::try_from(n).unwrap_or(1));
            for child in &mut new_children {
                if let Some(obj) = child.as_object_mut() {
                    obj.insert("ratio".to_string(), serde_json::json!(ratio));
                }
            }
            result["children"] = serde_json::Value::Array(new_children);
            let ratios: Vec<serde_json::Value> = (0..n).map(|_| serde_json::json!(ratio)).collect();
            result["ratios"] = serde_json::json!(ratios);
            Some(result)
        }
        _ => Some(layout.clone()),
    }
}

/// Like `insert_pane_into_layout` but allows specifying `title` and `shell_type` for the new leaf.
#[must_use]
pub fn insert_pane_into_layout_with_info(
    layout: &serde_json::Value,
    target_pane_id: &str,
    direction: &str,
    new_pane_id: &str,
    title: &str,
    shell_type: &str,
) -> Option<serde_json::Value> {
    insert_pane_into_layout_inner(
        layout,
        target_pane_id,
        direction,
        new_pane_id,
        Some(title),
        Some(shell_type),
    )
}

fn insert_pane_into_layout_inner(
    layout: &serde_json::Value,
    target_pane_id: &str,
    direction: &str,
    new_pane_id: &str,
    title: Option<&str>,
    shell_type: Option<&str>,
) -> Option<serde_json::Value> {
    let node_type = layout.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            let pane_id = layout.get("paneId")?.as_str()?;
            if pane_id == target_pane_id {
                // Found the target - wrap in a new split node
                let mut new_leaf = serde_json::json!({
                    "type": "leaf",
                    "paneId": new_pane_id,
                    "title": title.unwrap_or("Terminal"),
                    "ratio": 1,
                    "zoomed": false,
                });
                if let Some(st) = shell_type {
                    new_leaf["shell_type"] = serde_json::json!(st);
                }
                let existing_leaf = layout.clone();
                let split_id = uuid::Uuid::new_v4().to_string();
                Some(serde_json::json!({
                    "type": "split",
                    "id": split_id,
                    "direction": direction,
                    "children": [existing_leaf, new_leaf],
                    "ratios": [0.5, 0.5],
                }))
            } else {
                Some(layout.clone())
            }
        }
        "split" => {
            let parent_dir = layout.get("direction")?.as_str()?;
            let parent_dir_axis = normalize_split_direction(parent_dir);
            let children = layout.get("children")?.as_array()?;
            let mut new_children: Vec<serde_json::Value> = Vec::new();
            let mut found = false;
            for child in children {
                if let Some(updated) = insert_pane_into_layout_inner(
                    child,
                    target_pane_id,
                    direction,
                    new_pane_id,
                    title,
                    shell_type,
                ) {
                    let changed = found || updated != *child;
                    if changed {
                        found = true;
                    }
                    // If the child became a split with the same direction, flatten it
                    // (insert its children as siblings instead of nesting)
                    if changed
                        && updated.get("type").and_then(|t| t.as_str()) == Some("split")
                        && updated
                            .get("direction")
                            .and_then(|d| d.as_str())
                            .map(normalize_split_direction)
                            == Some(parent_dir_axis)
                    {
                        if let Some(inner_children) =
                            updated.get("children").and_then(|c| c.as_array())
                        {
                            new_children.extend(inner_children.iter().cloned());
                            continue;
                        }
                    }
                    new_children.push(updated);
                }
            }
            if !found {
                return Some(layout.clone());
            }
            let mut result = layout.clone();
            // Redistribute ratios equally among all children after insertion
            let n = new_children.len();
            let ratio = 1.0 / f64::from(u32::try_from(n).unwrap_or(1));
            for child in &mut new_children {
                if let Some(obj) = child.as_object_mut() {
                    obj.insert("ratio".to_string(), serde_json::json!(ratio));
                }
            }
            result["children"] = serde_json::Value::Array(new_children);
            let ratios: Vec<serde_json::Value> = (0..n).map(|_| serde_json::json!(ratio)).collect();
            result["ratios"] = serde_json::json!(ratios);
            Some(result)
        }
        _ => Some(layout.clone()),
    }
}

pub fn first_leaf_id(node: &serde_json::Value) -> Option<String> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "leaf" => node.get("paneId")?.as_str().map(String::from),
        "split" => {
            let children = node.get("children")?.as_array()?;
            for child in children {
                if let Some(id) = first_leaf_id(child) {
                    return Some(id);
                }
            }
            None
        }
        _ => None,
    }
}
