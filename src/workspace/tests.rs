use super::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn normalize_join_rejects_parent_dir() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "../etc/passwd");
    assert!(result.is_err());
}

#[test]
fn normalize_join_rejects_nested_parent_dir() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "foo/../../etc");
    assert!(result.is_err());
}

#[test]
fn normalize_join_accepts_normal_subdir() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "subdir/file.txt").unwrap();
    assert_eq!(result, tmp.path().join("subdir").join("file.txt"));
}

#[test]
fn normalize_join_handles_dot_and_empty() {
    let tmp = TempDir::new().unwrap();
    assert_eq!(normalize_join(tmp.path(), ".").unwrap(), tmp.path().to_path_buf());
    assert_eq!(normalize_join(tmp.path(), "").unwrap(), tmp.path().to_path_buf());
}

#[test]
fn normalize_join_strips_leading_slash() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "/foo/bar").unwrap();
    assert_eq!(result, tmp.path().join("foo").join("bar"));
}

#[test]
fn path_must_be_under_accepts_child() {
    let tmp = TempDir::new().unwrap();
    let child = tmp.path().join("sub");
    fs::create_dir(&child).unwrap();
    assert!(path_must_be_under(tmp.path(), &child).is_ok());
}

#[test]
fn path_must_be_under_rejects_outside() {
    let tmp1 = TempDir::new().unwrap();
    let tmp2 = TempDir::new().unwrap();
    assert!(path_must_be_under(tmp1.path(), tmp2.path()).is_err());
}
