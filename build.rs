use std::fs;
use std::path::Path;

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
    // Use DINOTTY_VERSION env var if set, otherwise fall back to latest git tag
    if let Ok(ver) = std::env::var("DINOTTY_VERSION") {
        println!("cargo:rustc-env=DINOTTY_VERSION={}", ver);
    } else if let Ok(output) = std::process::Command::new("git")
        .args(["describe", "--tags", "--abbrev=0"])
        .output()
    {
        if output.status.success() {
            let tag = String::from_utf8_lossy(&output.stdout).trim().to_string();
            println!("cargo:rustc-env=DINOTTY_VERSION={}", tag);
        }
    }
    println!("cargo:rerun-if-changed=.git/refs/tags");

    let dist = Path::new("frontend/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    rerun_if_dist_contents(dist);
}
