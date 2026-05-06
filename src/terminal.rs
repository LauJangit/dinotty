use dashmap::DashMap;
use std::{io::Write, sync::{Arc, Mutex}};

pub struct TerminalManager {
    pub sessions: DashMap<String, Arc<Mutex<Box<dyn Write + Send>>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self { sessions: DashMap::new() }
    }
}
