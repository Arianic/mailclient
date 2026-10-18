use rusqlite::{params, Connection};
use serde::Serialize;
use std::{collections::HashMap, path::Path, sync::Mutex};

pub struct WorkspaceStore(pub Mutex<Database>);
pub struct Database {
    connection: Connection,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub key: String,
    pub value: Option<String>,
    pub revision: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub values: HashMap<String, String>,
    pub revision: u64,
}

fn allowed_key(key: &str) -> bool {
    matches!(
        key,
        "mail-theme" | "mail-density" | "mail-messages-v1" | "mail-events"
    ) || key
        .strip_prefix("mail-draft:")
        .is_some_and(crate::valid_draft_id)
}

fn validate_value(key: &str, value: &str) -> Result<(), String> {
    if !allowed_key(key) {
        return Err("Unsupported workspace key".into());
    }
    if value.len() > 2_000_000 {
        return Err("Workspace item is too large".into());
    }
    let parsed: serde_json::Value =
        serde_json::from_str(value).map_err(|_| "Invalid workspace JSON")?;
    if let Some(id) = key.strip_prefix("mail-draft:") {
        if parsed.get("id").and_then(|id| id.as_str()) != Some(id) {
            return Err("Draft identifier does not match its storage key".into());
        }
    }
    if key == "mail-theme" && !matches!(parsed.as_str(), Some("light" | "dark" | "system")) {
        return Err("Invalid appearance preference".into());
    }
    if key == "mail-density"
        && !matches!(
            parsed.as_str(),
            Some("compact" | "comfortable" | "spacious")
        )
    {
        return Err("Invalid density preference".into());
    }
    Ok(())
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        Self::initialize(connection)
    }
    fn initialize(connection: Connection) -> Result<Self, String> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err("This workspace needs a newer version of Mail".into());
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN; CREATE TABLE IF NOT EXISTS workspace_values (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version=1; COMMIT;").map_err(|e| e.to_string())?;
        Ok(Self {
            connection,
            revision: 0,
        })
    }
    pub fn load(&self) -> Result<Snapshot, String> {
        let mut statement = self
            .connection
            .prepare("SELECT key, value FROM workspace_values")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut values = HashMap::new();
        for row in rows {
            let (key, value) = row.map_err(|e| e.to_string())?;
            validate_value(&key, &value)?;
            values.insert(key, value);
        }
        Ok(Snapshot {
            values,
            revision: self.revision,
        })
    }
    pub fn set(&mut self, key: String, value: String) -> Result<Update, String> {
        validate_value(&key, &value)?;
        self.connection.execute("INSERT INTO workspace_values (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value]).map_err(|e| e.to_string())?;
        self.revision += 1;
        Ok(Update {
            key,
            value: Some(value),
            revision: self.revision,
        })
    }
    pub fn remove(&mut self, key: String) -> Result<Update, String> {
        if !key.starts_with("mail-draft:") || !allowed_key(&key) {
            return Err("Only draft records may be removed".into());
        }
        self.connection
            .execute("DELETE FROM workspace_values WHERE key=?1", [&key])
            .map_err(|e| e.to_string())?;
        self.revision += 1;
        Ok(Update {
            key,
            value: None,
            revision: self.revision,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_and_drafts_survive_reopening() {
        let path = std::env::temp_dir().join(format!(
            "mail-test-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let mut db = Database::open(&path).unwrap();
            db.set("mail-theme".into(), "\"dark\"".into()).unwrap();
            db.set(
                "mail-draft:test-1".into(),
                r#"{"id":"test-1","body":"Saved draft"}"#.into(),
            )
            .unwrap();
        }
        {
            let db = Database::open(&path).unwrap();
            let saved = db.load().unwrap();
            assert_eq!(saved.values.get("mail-theme").unwrap(), "\"dark\"");
            assert!(saved
                .values
                .get("mail-draft:test-1")
                .unwrap()
                .contains("Saved draft"));
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn independently_saved_drafts_do_not_overwrite_each_other() {
        let mut db = Database::initialize(Connection::open_in_memory().unwrap()).unwrap();
        db.set("mail-draft:a".into(), r#"{"id":"a"}"#.into())
            .unwrap();
        db.set("mail-draft:b".into(), r#"{"id":"b"}"#.into())
            .unwrap();
        db.remove("mail-draft:a".into()).unwrap();
        assert!(db.load().unwrap().values.contains_key("mail-draft:b"));
    }
    #[test]
    fn rejects_credentials_invalid_json_and_mismatched_ids() {
        let mut db = Database::initialize(Connection::open_in_memory().unwrap()).unwrap();
        assert!(db.set("access-token".into(), "\"secret\"".into()).is_err());
        assert!(db.set("mail-events".into(), "broken".into()).is_err());
        assert!(db
            .set("mail-draft:a".into(), r#"{"id":"b"}"#.into())
            .is_err());
        assert!(db.remove("mail-theme".into()).is_err());
    }
    #[test]
    fn refuses_a_newer_database_instead_of_resetting_it() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA user_version=99;").unwrap();
        assert!(Database::initialize(connection).is_err());
    }
}
