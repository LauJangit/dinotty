use std::fs;
use std::path::Path;
use std::process::Command;

fn rerun_if_dist_contents(dir: &Path) {
    if !dir.is_dir() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                println!("cargo:rerun-if-changed={}", p.display());
            } else if p.is_dir() {
                rerun_if_dist_contents(&p);
            }
        }
    }
}

fn main() {
    // Inject version from git tag at compile time
    let version = Command::new("git")
        .args(["describe", "--tags", "--always"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map_or_else(
            || env!("CARGO_PKG_VERSION").to_string(),
            |o| {
                let raw = String::from_utf8_lossy(&o.stdout);
                let trimmed = raw.trim();
                trimmed.strip_prefix('v').unwrap_or(trimmed).to_string()
            },
        );

    println!("cargo:rustc-env=DINOTTY_VERSION={version}");
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/refs");

    let dist = Path::new("frontend/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    rerun_if_dist_contents(dist);
}
