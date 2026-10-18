use super::*;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use std::{path::Path, sync::Mutex as DbMutex};
#[path = "query.rs"]
mod query;
pub const HEADER_FIELDS:&str="id,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,isRead,hasAttachments,inferenceClassification,parentFolderId,conversationId";
pub struct MailIndex(
    pub DbMutex<Connection>,
    pub Mutex<()>,
    pub tokio::sync::Notify,
);
#[derive(Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub paused: bool,
    pub messages: usize,
    pub folders: usize,
    pub pending: usize,
    pub missing_files: usize,
    pub reported_items: Option<usize>,
    pub coverage_gaps: usize,
    pub last_sync: i64,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub messages: Vec<MessageSummary>,
    pub snippets: HashMap<String, String>,
    pub total: usize,
    pub has_more: bool,
    pub suggestions: Vec<String>,
    pub status: IndexStatus,
}
#[derive(Serialize)]
pub struct SearchAlternative {
    pub query: String,
    pub count: usize,
}
#[derive(Serialize, Default)]
pub struct SearchDiagnostics {
    pub alternatives: Vec<SearchAlternative>,
    pub corrections: Vec<SearchAlternative>,
}
pub fn text(html: &str) -> String {
    let doc = scraper::Html::parse_fragment(html);
    doc.tree
        .root()
        .descendants()
        .filter(|node| {
            !node.ancestors().any(|p| {
                p.value()
                    .as_element()
                    .is_some_and(|e| matches!(e.name(), "script" | "style"))
            })
        })
        .filter_map(|n| n.value().as_text().map(|s| s.to_string()))
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn body_text(raw: &serde_json::Value) -> String {
    let content = raw["body"]["content"].as_str().unwrap_or("");
    if raw["body"]["contentType"]
        .as_str()
        .is_some_and(|v| v.eq_ignore_ascii_case("html"))
    {
        text(content)
    } else {
        content.into()
    }
}
fn addresses(value: &serde_json::Value, key: &str) -> String {
    value[key]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|v| {
                    format!(
                        "{} {}",
                        v["emailAddress"]["name"].as_str().unwrap_or(""),
                        v["emailAddress"]["address"].as_str().unwrap_or("")
                    )
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}
impl MailIndex {
    fn start_round(&self, account: &str, folder: &str) -> Result<(String, i64), String> {
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let run = CsrfToken::new_random().secret().clone();
        c.execute("INSERT OR IGNORE INTO folder_rounds(account,id,run,started) VALUES(?1,?2,?3,unixepoch())",params![account,folder,run]).map_err(|_|"Could not start folder reconciliation")?;
        c.query_row(
            "SELECT run,started FROM folder_rounds WHERE account=?1 AND id=?2",
            params![account, folder],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Could not read folder reconciliation".into())
    }
    fn finish_round(
        &self,
        account: &str,
        folder: &str,
        run: &str,
        started: i64,
        delta: Option<&str>,
    ) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "Mail index busy")?;
        let tx = c
            .transaction()
            .map_err(|_| "Could not reconcile cached messages")?;
        let predicate="account=?1 AND folder=?2 AND COALESCE(json_extract(json,'$._indexRun'),'')!=?3 AND COALESCE(json_extract(json,'$._cachedAt'),0)<?4";
        tx.execute(&format!("DELETE FROM mail_fts WHERE rowid IN (SELECT rowid FROM messages WHERE {predicate})"),params![account,folder,run,started]).map_err(|_|"Could not reconcile search entries")?;
        tx.execute(
            &format!("DELETE FROM messages WHERE {predicate}"),
            params![account, folder, run, started],
        )
        .map_err(|_| "Could not reconcile message cache")?;
        tx.execute(
            "DELETE FROM folder_rounds WHERE account=?1 AND id=?2",
            params![account, folder],
        )
        .map_err(|_| "Could not finish folder reconciliation")?;
        tx.execute("UPDATE folders SET cursor=NULL,delta=?1,scan=0,done=?2,synced=CASE WHEN ?2=1 THEN unixepoch() ELSE 0 END WHERE account=?3 AND id=?4",params![delta,delta.is_some(),account,folder]).map_err(|_|"Could not save reconciled checkpoint")?;
        tx.commit().map_err(|_| "Could not finish reconciliation")?;
        Ok(())
    }
    fn apply_sync_page(
        &self,
        account: &str,
        folder: &str,
        scanning: bool,
        mut page: Delta,
    ) -> Result<(), String> {
        let next = page
            .next
            .map(|u| {
                if scanning {
                    valid_next_page(&u)
                } else {
                    delta_url(&u)
                }
            })
            .transpose()?;
        let delta = page.delta.map(|u| delta_url(&u)).transpose()?;
        if !scanning && next.is_none() && delta.is_none() {
            return Err("Outlook omitted its sync checkpoint. Indexing will retry.".into());
        }
        let round = if scanning {
            Some(self.start_round(account, folder)?)
        } else {
            None
        };
        if let Some((run, _)) = &round {
            for change in &mut page.value {
                if change.get("@removed").is_none() {
                    change["_indexRun"] = run.clone().into();
                }
            }
        }
        self.upsert(account, folder, &page.value)?;
        if next.is_none() {
            if let Some((run, started)) = round {
                // A full ordinary listing establishes history. Delta then establishes change tracking
                // without purging older messages if its initial response contains only recent changes.
                return self.finish_round(account, folder, &run, started, None);
            }
        }
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        c.execute("UPDATE folders SET cursor=?1,delta=COALESCE(?2,delta),done=CASE WHEN ?3=1 THEN 1 ELSE done END,synced=CASE WHEN ?3=1 THEN unixepoch() ELSE synced END WHERE account=?4 AND id=?5",params![next,delta,!scanning && next.is_none(),account,folder]).map_err(|_|"Could not save sync checkpoint")?;
        Ok(())
    }
    pub fn request_sync(&self, account: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Mail index busy")?
            .execute("UPDATE folders SET synced=0 WHERE account=?1", [account])
            .map_err(|_| "Could not refresh mail")?;
        self.2.notify_one();
        Ok(())
    }
    pub fn folder_ready(&self, account: &str, folder: &str) -> Result<bool, String> {
        self.0
            .lock()
            .map_err(|_| "Mail index busy")?
            .query_row(
                "SELECT done FROM folders WHERE account=?1 AND id=?2",
                params![account, folder],
                |r| r.get(0),
            )
            .optional()
            .map(|v| v.unwrap_or(false))
            .map_err(|_| "Could not check folder cache".into())
    }
    pub fn control(&self, account: &str, action: &str) -> Result<(), String> {
        if !matches!(action, "pause" | "resume" | "clear" | "rebuild") {
            return Err("Unknown search index action".into());
        }
        let mut c = self.0.lock().map_err(|_| "Mail index busy")?;
        let tx = c
            .transaction()
            .map_err(|_| "Could not update indexing settings")?;
        tx.execute("INSERT INTO index_settings(account,paused) VALUES(?1,?2) ON CONFLICT(account) DO UPDATE SET paused=excluded.paused",params![account,matches!(action,"pause"|"clear")]).map_err(|_|"Could not update indexing settings")?;
        if action == "rebuild" {
            tx.execute(
                "UPDATE folders SET scan=1,done=0,cursor=NULL,delta=NULL,synced=0 WHERE account=?1",
                [account],
            )
            .map_err(|_| "Could not restart mailbox scan")?;
            tx.execute("UPDATE discovery SET done=0 WHERE account=?1", [account])
                .map_err(|_| "Could not refresh folders")?;
            for table in ["folder_rounds", "folder_checks", "sync_errors"] {
                tx.execute(&format!("DELETE FROM {table} WHERE account=?1"), [account])
                    .map_err(|_| "Could not restart indexing")?;
            }
        }
        if action == "clear" {
            tx.execute(
                "DELETE FROM mail_fts WHERE rowid IN (SELECT rowid FROM messages WHERE account=?1)",
                [account],
            )
            .map_err(|_| "Could not clear search entries")?;
            for table in [
                "messages",
                "folders",
                "discovery",
                "sync_errors",
                "folder_checks",
                "folder_rounds",
                "contacts",
            ] {
                tx.execute(&format!("DELETE FROM {table} WHERE account=?1"), [account])
                    .map_err(|_| "Could not clear cached mail")?;
            }
        }
        tx.commit().map_err(|_| "Could not save index settings")?;
        self.2.notify_one();
        Ok(())
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        Self::init(Connection::open(path).map_err(|_| "Could not open the local mail index")?)
    }
    fn init(c: Connection) -> Result<Self, String> {
        c.busy_timeout(Duration::from_secs(5))
            .map_err(|_| "Mail index unavailable")?;
        let version: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|_| "Could not read mail index version")?;
        if version > 2 {
            return Err("The mail index needs a newer app version".into());
        }
        c.execute_batch("PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;BEGIN;
 CREATE TABLE IF NOT EXISTS messages(rowid INTEGER PRIMARY KEY,account TEXT NOT NULL,id TEXT NOT NULL,folder TEXT NOT NULL,received TEXT NOT NULL,read INTEGER NOT NULL,attached INTEGER NOT NULL,conversation TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(account,id));
 CREATE INDEX IF NOT EXISTS message_folder ON messages(account,folder,received);CREATE INDEX IF NOT EXISTS message_thread ON messages(account,conversation);
 CREATE VIRTUAL TABLE IF NOT EXISTS mail_fts USING fts5(subject,sender,to_line,cc_line,bcc_line,body,filenames,tokenize='unicode61 remove_diacritics 2',prefix='2 3 4');
 CREATE VIRTUAL TABLE IF NOT EXISTS mail_vocab USING fts5vocab(mail_fts,'row');
 CREATE TABLE IF NOT EXISTS folders(account TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,parent TEXT NOT NULL,cursor TEXT,delta TEXT,done INTEGER NOT NULL DEFAULT 0,synced INTEGER NOT NULL DEFAULT 0,json TEXT NOT NULL,PRIMARY KEY(account,id));
 CREATE TABLE IF NOT EXISTS discovery(account TEXT NOT NULL,parent TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,parent));
 CREATE TABLE IF NOT EXISTS contacts(account TEXT NOT NULL,email TEXT NOT NULL,name TEXT,updated INTEGER NOT NULL DEFAULT(unixepoch()),PRIMARY KEY(account,email));
 CREATE TABLE IF NOT EXISTS index_settings(account TEXT PRIMARY KEY,paused INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS folder_checks(account TEXT NOT NULL,parent TEXT NOT NULL,checked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,parent));
 CREATE TABLE IF NOT EXISTS folder_rounds(account TEXT NOT NULL,id TEXT NOT NULL,run TEXT NOT NULL,started INTEGER NOT NULL,PRIMARY KEY(account,id));
 CREATE TABLE IF NOT EXISTS sync_errors(account TEXT PRIMARY KEY,error TEXT);COMMIT;").map_err(|_|"Could not initialize local mail search")?;
        if version < 2 {
            // Repair previous completion claims without deleting cached mail or user pause settings.
            c.execute_batch(
                "BEGIN; ALTER TABLE folders ADD COLUMN scan INTEGER NOT NULL DEFAULT 1;
                UPDATE folders SET scan=1,done=0,cursor=NULL,delta=NULL,synced=0;
                DELETE FROM folder_rounds; UPDATE discovery SET done=0; DELETE FROM folder_checks;
                PRAGMA user_version=2; COMMIT;",
            )
            .map_err(|_| "Could not upgrade mailbox indexing")?;
        } else {
            c.pragma_update(None, "user_version", 2)
                .map_err(|_| "Could not retain mailbox index version")?;
        }
        Ok(Self(
            DbMutex::new(c),
            Mutex::new(()),
            tokio::sync::Notify::new(),
        ))
    }
    pub fn status(&self, account: &str) -> Result<IndexStatus, String> {
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        Ok(IndexStatus{
 paused:c.query_row("SELECT paused FROM index_settings WHERE account=?1",[account],|r|r.get(0)).optional().map_err(|_|"Could not read index setting")?.unwrap_or(false),
  messages:c.query_row("SELECT count(*) FROM messages WHERE account=?1",[account],|r|r.get::<_,i64>(0)).unwrap_or(0) as usize,
  folders:c.query_row("SELECT count(*) FROM folders WHERE account=?1",[account],|r|r.get::<_,i64>(0)).unwrap_or(0) as usize,
  pending:c.query_row("SELECT (SELECT count(*) FROM folders WHERE account=?1 AND (done=0 OR cursor IS NOT NULL))+(SELECT count(*) FROM discovery WHERE account=?1 AND done=0)",[account],|r|r.get::<_,i64>(0)).unwrap_or(0) as usize,
  missing_files:c.query_row("SELECT count(*) FROM messages WHERE account=?1 AND attached=1 AND COALESCE(json_extract(json,'$._attachmentsIndexed'),0)=0",[account],|r|r.get::<_,i64>(0)).unwrap_or(0) as usize,
  reported_items:c.query_row("SELECT sum(json_extract(json,'$.totalItemCount')) FROM folders WHERE account=?1",[account],|r|r.get::<_,Option<i64>>(0)).unwrap_or(None).map(|n|n.max(0) as usize),
  coverage_gaps:c.query_row("SELECT count(*) FROM folders f WHERE f.account=?1 AND f.scan=0 AND f.done=1 AND COALESCE(json_extract(f.json,'$.totalItemCount'),0)>(SELECT count(*) FROM messages m WHERE m.account=f.account AND m.folder=f.id)",[account],|r|r.get::<_,i64>(0)).unwrap_or(0) as usize,
  last_sync:c.query_row("SELECT COALESCE(max(synced),0) FROM folders WHERE account=?1",[account],|r|r.get(0)).unwrap_or(0),
  error:c.query_row("SELECT error FROM sync_errors WHERE account=?1",[account],|r|r.get(0)).optional().map_err(|_|"Could not read search status")?.flatten(),
 })
    }
    pub fn error(&self, account: &str, error: Option<&str>) {
        if let Ok(c) = self.0.lock() {
            let _=c.execute("INSERT INTO sync_errors(account,error) VALUES(?1,?2) ON CONFLICT(account) DO UPDATE SET error=excluded.error",params![account,error]);
        }
    }
    pub fn upsert(
        &self,
        account: &str,
        folder: &str,
        changes: &[serde_json::Value],
    ) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "Mail index busy")?;
        let tx = c
            .transaction()
            .map_err(|_| "Could not update search index")?;
        for change in changes {
            let id = change["id"]
                .as_str()
                .ok_or("Outlook returned a message without an ID")?;
            let prior: Option<(i64, String, String)> = tx
                .query_row(
                    "SELECT rowid,json,folder FROM messages WHERE account=?1 AND id=?2",
                    params![account, id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(|_| "Could not read cached mail")?;
            if change.get("@removed").is_some() {
                if let Some((row, _, old_folder)) = prior {
                    if old_folder == folder {
                        tx.execute("DELETE FROM mail_fts WHERE rowid=?1", [row])
                            .map_err(|_| "Could not remove search entry")?;
                        tx.execute("DELETE FROM messages WHERE rowid=?1", [row])
                            .map_err(|_| "Could not remove cached mail")?;
                    }
                }
                continue;
            }
            let mut merged = prior
                .as_ref()
                .and_then(|(_, s, _)| serde_json::from_str::<serde_json::Value>(s).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            for (key, value) in change.as_object().ok_or("Invalid message update")? {
                merged[key] = value.clone();
            }
            if merged["parentFolderId"].as_str().unwrap_or("").is_empty() {
                merged["parentFolderId"] = folder.into();
            }
            let summary: MessageSummary = serde_json::from_value(merged.clone())
                .map_err(|_| "Outlook returned incomplete message metadata; search will retry.")?;
            let target = summary.parent_folder_id.as_str();
            tx.execute("INSERT INTO messages(account,id,folder,received,read,attached,conversation,json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(account,id) DO UPDATE SET folder=excluded.folder,received=excluded.received,read=excluded.read,attached=excluded.attached,conversation=excluded.conversation,json=excluded.json",params![account,id,target,summary.received_date_time,summary.is_read,summary.has_attachments,summary.conversation_id,merged.to_string()]).map_err(|_|"Could not save cached mail")?;
            let row: i64 = tx
                .query_row(
                    "SELECT rowid FROM messages WHERE account=?1 AND id=?2",
                    params![account, id],
                    |r| r.get(0),
                )
                .map_err(|_| "Could not locate cached mail")?;
            tx.execute("DELETE FROM mail_fts WHERE rowid=?1", [row])
                .map_err(|_| "Could not replace search entry")?;
            let mut people = vec![merged["from"]["emailAddress"].clone()];
            for key in ["toRecipients", "ccRecipients"] {
                if let Some(list) = merged[key].as_array() {
                    people.extend(list.iter().map(|p| p["emailAddress"].clone()));
                }
            }
            for person in people {
                if let Some(email) = person["address"].as_str() {
                    if email_address::EmailAddress::is_valid(email) {
                        tx.execute("INSERT INTO contacts(account,email,name) VALUES(?1,?2,?3) ON CONFLICT(account,email) DO UPDATE SET name=COALESCE(excluded.name,contacts.name),updated=unixepoch()",params![account,email.to_lowercase(),person["name"].as_str()]).map_err(|_|"Could not index recipients")?;
                    }
                }
            }
            let sender = merged["from"]["emailAddress"].clone();
            let body = merged["body"]["content"].as_str().unwrap_or("");
            let body = if merged["body"]["contentType"]
                .as_str()
                .is_some_and(|s| s.eq_ignore_ascii_case("html"))
            {
                text(body)
            } else {
                body.into()
            };
            tx.execute("INSERT INTO mail_fts(rowid,subject,sender,to_line,cc_line,bcc_line,body,filenames) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![row,summary.subject.unwrap_or_default(),format!("{} {}",sender["name"].as_str().unwrap_or(""),sender["address"].as_str().unwrap_or("")),addresses(&merged,"toRecipients"),addresses(&merged,"ccRecipients"),addresses(&merged,"bccRecipients"),body,merged["_attachmentNames"].as_str().unwrap_or("")]).map_err(|_|"Could not index message text")?;
        }
        tx.commit().map_err(|_| "Could not finish index update")?;
        Ok(())
    }
    pub fn raw(&self, account: &str, id: &str) -> Result<Option<serde_json::Value>, String> {
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let raw: Option<String> = c
            .query_row(
                "SELECT json FROM messages WHERE account=?1 AND id=?2",
                params![account, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Could not open cached mail")?;
        raw.map(|s| serde_json::from_str(&s).map_err(|_| "Could not decode cached mail".into()))
            .transpose()
    }
    pub fn folders(&self, account: &str) -> Result<Vec<super::folders::Folder>, String> {
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let mut stmt = c
            .prepare("SELECT json FROM folders WHERE account=?1 ORDER BY name COLLATE NOCASE")
            .map_err(|_| "Could not list cached folders")?;
        let rows = stmt
            .query_map([account], |r| r.get::<_, String>(0))
            .map_err(|_| "Could not list cached folders")?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|_| "Could not read folder")?)
                .map_err(|_| "Could not decode folder".into())
        })
        .collect()
    }
    pub fn search(
        &self,
        account: &str,
        query: &str,
        offset: u32,
        sort: &str,
    ) -> Result<SearchPage, String> {
        let q = query::parse(query, account)?;
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let mut values = vec![rusqlite::types::Value::Text(account.into())];
        values.extend(q.values.clone());
        let where_sql = format!("m.account=? AND ({})", q.sql);
        let total: i64 = c
            .query_row(
                &format!("SELECT count(*) FROM messages m WHERE {where_sql}"),
                params_from_iter(values.iter()),
                |r| r.get(0),
            )
            .map_err(|_| "Could not run search. Check the query syntax.")?;
        let order = match sort {
            "oldest" => "m.received ASC",
            "relevance" if !q.terms.is_empty() => "m.received DESC",
            "newest" | "relevance" => "m.received DESC",
            _ => return Err("Choose newest, oldest or relevance sorting".into()),
        };
        // Rank the full filtered candidate set before paginating; no provider result cap.
        let mut sql = format!("SELECT m.json FROM messages m WHERE {where_sql} ORDER BY {order}");
        if sort == "relevance" && !q.terms.is_empty() {
            let rank = q
                .terms
                .iter()
                .map(|t| format!("\"{}\"*", t.trim_end_matches('*').replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" OR ");
            values.push(rank.into());
            sql=format!("SELECT m.json FROM messages m LEFT JOIN (SELECT rowid,bm25(mail_fts,8,4,2,2,2,1,3) rank FROM mail_fts WHERE mail_fts MATCH ?) ranked ON ranked.rowid=m.rowid WHERE {where_sql} ORDER BY COALESCE(ranked.rank,0),m.received DESC");
            let last = values.pop().unwrap();
            values.insert(0, last);
        }
        sql.push_str(" LIMIT 50 OFFSET ?");
        values.push((offset as i64).into());
        let mut stmt = c.prepare(&sql).map_err(|_| "Could not prepare search")?;
        let rows = stmt
            .query_map(params_from_iter(values.iter()), |r| r.get::<_, String>(0))
            .map_err(|_| "Could not search this mailbox")?;
        let mut messages = Vec::new();
        let mut snippets = HashMap::new();
        for row in rows {
            let raw: serde_json::Value =
                serde_json::from_str(&row.map_err(|_| "Could not read search result")?)
                    .map_err(|_| "Invalid cached message")?;
            let summary: MessageSummary =
                serde_json::from_value(raw.clone()).map_err(|_| "Invalid cached message")?;
            let body = body_text(&raw);
            let lower = body.to_lowercase();
            let at = q
                .terms
                .iter()
                .filter_map(|t| lower.find(&t.to_lowercase()))
                .min()
                .unwrap_or(0);
            let start = lower[..at].chars().count().saturating_sub(65);
            let snippet = body.chars().skip(start).take(220).collect::<String>();
            snippets.insert(summary.id.clone(), snippet);
            messages.push(summary);
        }
        let mut suggestions = Vec::new();
        if total == 0 && !query.contains([' ', ':', '"', '(', ')']) && query.len() > 3 {
            let mut stmt=c.prepare("SELECT term FROM mail_vocab WHERE length(term) BETWEEN ?1 AND ?2 ORDER BY doc DESC LIMIT 4000").map_err(|_|"Could not load spelling suggestions")?;
            let terms = stmt
                .query_map(
                    params![
                        (query.chars().count() as i64 - 2).max(1),
                        query.chars().count() as i64 + 2
                    ],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|_| "Could not load spelling suggestions")?;
            for term in terms.flatten() {
                if distance(&term, &query.to_lowercase()) <= if query.len() > 7 { 2 } else { 1 } {
                    let needle = format!("\"{}\"", term.replace('"', "\"\""));
                    let own:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM mail_fts JOIN messages m ON m.rowid=mail_fts.rowid WHERE m.account=?1 AND mail_fts MATCH ?2)",params![account,needle],|r|r.get(0)).unwrap_or(false);
                    if !own {
                        continue;
                    }
                    suggestions.push(term);
                    if suggestions.len() == 5 {
                        break;
                    }
                }
            }
        }
        drop(stmt);
        drop(c);
        Ok(SearchPage {
            has_more: offset as usize + messages.len() < total as usize,
            messages,
            snippets,
            total: total as usize,
            suggestions,
            status: self.status(account)?,
        })
    }
    pub fn diagnostics(
        &self,
        account: &str,
        original: &str,
        alternatives: &[String],
    ) -> Result<SearchDiagnostics, String> {
        if alternatives.len() > 8 {
            return Err("Use up to eight search alternatives".into());
        }
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let count = |text: &str| -> Result<usize, String> {
            let q = query::parse(text, account)?;
            let mut values = vec![rusqlite::types::Value::Text(account.into())];
            values.extend(q.values);
            c.query_row(
                &format!(
                    "SELECT count(*) FROM messages m WHERE m.account=? AND ({})",
                    q.sql
                ),
                params_from_iter(values.iter()),
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as usize)
            .map_err(|_| "Could not check search alternatives".into())
        };
        let mut result = SearchDiagnostics::default();
        // The mailbox may have changed while the empty-search UI was loading.
        if count(original)? > 0 {
            return Ok(result);
        }
        for query in alternatives {
            result.alternatives.push(SearchAlternative {
                query: query.clone(),
                count: count(query)?,
            });
        }
        for word in query::spelling_words(original)? {
            let length = word.chars().count() as i64;
            let mut statement = c.prepare("SELECT term FROM mail_vocab WHERE length(term) BETWEEN ?1 AND ?2 ORDER BY doc DESC LIMIT 2000").map_err(|_| "Could not check spelling")?;
            let candidates = statement
                .query_map(params![(length - 2).max(1), length + 2], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|_| "Could not check spelling")?;
            let mut checked = 0;
            for term in candidates.flatten() {
                if term == word.to_lowercase()
                    || distance(&term, &word.to_lowercase()) > if length > 7 { 2 } else { 1 }
                {
                    continue;
                }
                let own:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM mail_fts JOIN messages m ON m.rowid=mail_fts.rowid WHERE m.account=?1 AND mail_fts MATCH ?2)",params![account,format!("\"{}\"",term.replace('"',"\"\""))], |r|r.get(0)).unwrap_or(false);
                if !own {
                    continue;
                }
                checked += 1;
                let changed = query::replace_keyword(original, &word, &term)?;
                let matches = count(&changed)?;
                if matches > 0 && !result.corrections.iter().any(|a| a.query == changed) {
                    result.corrections.push(SearchAlternative {
                        query: changed,
                        count: matches,
                    });
                }
                if result.corrections.len() >= 3 || checked >= 8 {
                    break;
                }
            }
            if result.corrections.len() >= 3 {
                break;
            }
        }
        Ok(result)
    }
    pub fn conversation(&self, account: &str, id: &str) -> Result<Vec<serde_json::Value>, String> {
        let Some(raw) = self.raw(account, id)? else {
            return Ok(vec![]);
        };
        let conversation = raw["conversationId"].as_str().unwrap_or("");
        if conversation.is_empty() {
            return Ok(vec![raw]);
        }
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let mut stmt = c
            .prepare(
                "SELECT json FROM messages WHERE account=?1 AND conversation=?2 ORDER BY received",
            )
            .map_err(|_| "Could not load conversation")?;
        let rows = stmt
            .query_map(params![account, conversation], |r| r.get::<_, String>(0))
            .map_err(|_| "Could not load conversation")?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|_| "Could not read conversation")?)
                .map_err(|_| "Could not decode conversation".into())
        })
        .collect()
    }
    pub fn contacts(&self, account: &str, query: &str) -> Result<Vec<Address>, String> {
        if query.len() > 500 {
            return Err("Contact search is too long".into());
        }
        let c = self.0.lock().map_err(|_| "Mail index busy")?;
        let mut stmt=c.prepare("SELECT name,email FROM contacts WHERE account=?1 AND (instr(lower(COALESCE(name,'')),lower(?2))>0 OR instr(lower(email),lower(?2))>0) ORDER BY updated DESC,email LIMIT 8").map_err(|_|"Could not search contacts")?;
        let rows = stmt
            .query_map(params![account, query], |r| {
                Ok(Address {
                    name: r.get(0)?,
                    address: Some(r.get(1)?),
                })
            })
            .map_err(|_| "Could not search contacts")?;
        rows.map(|r| r.map_err(|_| "Could not read contact".into()))
            .collect()
    }
}
fn distance(a: &str, b: &str) -> usize {
    let b = b.chars().collect::<Vec<_>>();
    let mut row = (0..=b.len()).collect::<Vec<_>>();
    for (i, x) in a.chars().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            let old = row[j + 1];
            row[j + 1] = (row[j] + 1).min(old + 1).min(prev + usize::from(x != *y));
            prev = old;
        }
    }
    row[b.len()]
}
#[derive(Deserialize)]
struct Delta {
    value: Vec<serde_json::Value>,
    #[serde(rename = "@odata.nextLink")]
    next: Option<String>,
    #[serde(rename = "@odata.deltaLink")]
    delta: Option<String>,
}
fn delta_url(url: &str) -> Result<String, String> {
    let u = reqwest::Url::parse(url).map_err(|_| "Invalid Outlook sync address")?;
    if u.scheme() != "https"
        || u.host_str() != Some("graph.microsoft.com")
        || u.port_or_known_default() != Some(443)
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
        || !u.path().starts_with("/v1.0/")
        || !u.path().ends_with("/messages/delta")
    {
        return Err("Outlook returned an unsupported sync address".into());
    }
    Ok(u.to_string())
}
impl OutlookService {
    pub async fn sync_step(&self, index: &MailIndex) -> Result<bool, String> {
        let _guard = index.1.lock().await;
        let account = self.draft_account().await?.to_lowercase();
        if index.status(&account)?.paused {
            return Ok(false);
        }
        let (discovery, ids): (Option<String>, Vec<String>) = {
            let c = index.0.lock().map_err(|_| "Mail index busy")?;
            c.execute(
                "INSERT OR IGNORE INTO discovery(account,parent) VALUES(?1,'')",
                [&account],
            )
            .map_err(|_| "Could not start indexing")?;
            c.execute("UPDATE discovery SET done=0 WHERE account=?1 AND COALESCE((SELECT checked FROM folder_checks f WHERE f.account=discovery.account AND f.parent=discovery.parent),0)<unixepoch()-900",[&account]).map_err(|_|"Could not refresh folder discovery")?;
            let ids = {
                let mut stmt = c
                    .prepare("SELECT id FROM folders WHERE account=?1")
                    .map_err(|_| "Could not load folders")?;
                let values = stmt
                    .query_map([&account], |r| r.get::<_, String>(0))
                    .map_err(|_| "Could not load folders")?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| "Could not load folders")?;
                values
            };
            let discovery = c
                .query_row(
                    "SELECT parent FROM discovery WHERE account=?1 AND done=0 LIMIT 1",
                    [&account],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| "Could not read folder discovery")?;
            (discovery, ids)
        };
        self.session.lock().await.known_folders.extend(ids);
        if let Some(parent) = discovery {
            let folders = self
                .folders(if parent.is_empty() {
                    None
                } else {
                    Some(parent.clone())
                })
                .await?;
            let mut c = index.0.lock().map_err(|_| "Mail index busy")?;
            let tx = c.transaction().map_err(|_| "Could not save folders")?;
            let retained = folders
                .iter()
                .map(|f| f.id.clone())
                .collect::<std::collections::HashSet<_>>();
            if parent.is_empty() && retained.is_empty() {
                return Err(
                    "Outlook returned an empty root-folder list; the existing cache was preserved."
                        .into(),
                );
            }
            let old = {
                let mut stmt = tx
                    .prepare("SELECT id FROM folders WHERE account=?1 AND parent=?2")
                    .map_err(|_| "Could not check removed folders")?;
                let rows = stmt
                    .query_map(params![account, parent], |r| r.get::<_, String>(0))
                    .map_err(|_| "Could not check removed folders")?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|_| "Could not check removed folders")?
            };
            for removed in old.into_iter().filter(|id| !retained.contains(id)) {
                let descendants = {
                    let mut stmt=tx.prepare("WITH RECURSIVE tree(id) AS (SELECT ?2 UNION SELECT f.id FROM folders f JOIN tree t ON f.parent=t.id WHERE f.account=?1) SELECT id FROM tree").map_err(|_|"Could not reconcile folders")?;
                    let rows = stmt
                        .query_map(params![account, removed], |r| r.get::<_, String>(0))
                        .map_err(|_| "Could not reconcile folders")?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(|_| "Could not reconcile folders")?
                };
                for id in descendants {
                    tx.execute("DELETE FROM mail_fts WHERE rowid IN (SELECT rowid FROM messages WHERE account=?1 AND folder=?2)",params![account,id]).map_err(|_|"Could not remove old folder search entries")?;
                    tx.execute(
                        "DELETE FROM messages WHERE account=?1 AND folder=?2",
                        params![account, id],
                    )
                    .map_err(|_| "Could not remove old folder cache")?;
                    tx.execute(
                        "DELETE FROM folders WHERE account=?1 AND id=?2",
                        params![account, id],
                    )
                    .map_err(|_| "Could not remove old folder")?;
                    tx.execute(
                        "DELETE FROM discovery WHERE account=?1 AND parent=?2",
                        params![account, id],
                    )
                    .map_err(|_| "Could not remove old folder discovery")?;
                }
            }
            for folder in folders {
                tx.execute("INSERT INTO folders(account,id,name,parent,json) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(account,id) DO UPDATE SET name=excluded.name,parent=excluded.parent,json=excluded.json",params![account,folder.id,folder.display_name,parent,serde_json::to_string(&folder).map_err(|_|"Could not save folder")?]).map_err(|_|"Could not save folder")?;
                if folder.child_folder_count > 0 {
                    tx.execute(
                        "INSERT OR IGNORE INTO discovery(account,parent) VALUES(?1,?2)",
                        params![account, folder.id],
                    )
                    .map_err(|_| "Could not discover subfolders")?;
                }
            }
            tx.execute(
                "UPDATE discovery SET done=1 WHERE account=?1 AND parent=?2",
                params![account, parent],
            )
            .map_err(|_| "Could not save folder discovery")?;
            tx.execute("INSERT INTO folder_checks(account,parent,checked) VALUES(?1,?2,unixepoch()) ON CONFLICT(account,parent) DO UPDATE SET checked=excluded.checked",params![account,parent]).map_err(|_|"Could not save folder refresh time")?;
            tx.commit().map_err(|_| "Could not finish discovery")?;
            return Ok(true);
        }
        let pending: Option<(String, Option<String>, bool)> = {
            let c = index.0.lock().map_err(|_| "Mail index busy")?;
            c.query_row("SELECT id,COALESCE(cursor,delta),scan FROM folders WHERE account=?1 AND (done=0 OR cursor IS NOT NULL OR synced<unixepoch()-60) ORDER BY done,synced LIMIT 1",[&account],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|"Could not read indexing position")?
        };
        if let Some((folder, cursor, scanning)) = pending {
            let (token, url) = {
                let mut s = self.session.lock().await;
                let token = self.access(&mut s).await?;
                let url = if let Some(cursor) = cursor {
                    if scanning {
                        valid_next_page(&cursor)?
                    } else {
                        delta_url(&cursor)?
                    }
                } else {
                    let mut u = reqwest::Url::parse(&format!("{GRAPH}/me/mailFolders/")).unwrap();
                    u.path_segments_mut()
                        .unwrap()
                        .pop_if_empty()
                        .push(&folder)
                        .push("messages");
                    if !scanning {
                        u.path_segments_mut().unwrap().push("delta");
                    }
                    u.query_pairs_mut()
                        .append_pair("$select", &format!("{HEADER_FIELDS},body"));
                    u.to_string()
                };
                (token, url)
            };
            let result: Result<Delta, String> = self.get_paged(&url, &token, true).await;
            let page = match result {
                Ok(p) => p,
                Err(e) => {
                    if e == SESSION_EXPIRED {
                        self.session.lock().await.access = None;
                    }
                    if e.contains("(410)") {
                        let c = index.0.lock().map_err(|_| "Mail index busy")?;
                        c.execute("UPDATE folders SET scan=1,cursor=NULL,delta=NULL,done=0,synced=0 WHERE account=?1 AND id=?2",params![account,folder]).map_err(|_|"Could not restart folder sync")?;
                        c.execute(
                            "DELETE FROM folder_rounds WHERE account=?1 AND id=?2",
                            params![account, folder],
                        )
                        .map_err(|_| "Could not restart folder reconciliation")?;
                        return Ok(true);
                    }
                    return Err(e);
                }
            };
            if page.next.as_deref() == Some(url.as_str()) {
                return Err(
                    "Outlook repeated a mailbox page. Your existing cache was preserved.".into(),
                );
            }
            index.apply_sync_page(&account, &folder, scanning, page)?;
            return Ok(true);
        }
        let pending_file: Option<(String, String)> = {
            let c = index.0.lock().map_err(|_| "Mail index busy")?;
            c.query_row("SELECT id,folder FROM messages WHERE account=?1 AND attached=1 AND COALESCE(json_extract(json,'$._attachmentsIndexed'),0)=0 LIMIT 1",[&account],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|"Could not index filenames")?
        };
        if let Some((id, folder)) = pending_file {
            let token = {
                let mut s = self.session.lock().await;
                self.access(&mut s).await?
            };
            let files = self.attachment_list(&id, &token).await?;
            index.upsert(&account,&folder,&[serde_json::json!({"id":id,"_attachmentNames":files.into_iter().filter(|f|!f.is_inline).map(|f|f.name).collect::<Vec<_>>().join(" "),"_attachmentsIndexed":true})])?;
            return Ok(true);
        }
        index.error(&account, None);
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_folder(index: &MailIndex, count: usize) {
        let json = serde_json::json!({"id":"inbox","displayName":"Inbox","isInbox":true,"unreadItemCount":0,"childFolderCount":0,"totalItemCount":count});
        index.0.lock().unwrap().execute("INSERT INTO folders(account,id,name,parent,json) VALUES('a','inbox','Inbox','',?1)",[json.to_string()]).unwrap();
    }
    #[test]
    fn full_scan_pages_through_thousands_resumes_and_does_not_stop_at_300() {
        let mut index = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        test_folder(&index, 2025);
        for page in 0..81 {
            let mails = (page * 25..(page + 1) * 25)
                .map(|n| mail(&n.to_string(), "Invoice", "Searchable history"))
                .collect();
            let next = if page < 80 {
                Some(format!(
                    "{GRAPH}/me/mailFolders/inbox/messages?$skiptoken=opaque-{}",
                    page + 1
                ))
            } else {
                None
            };
            index
                .apply_sync_page(
                    "a",
                    "inbox",
                    true,
                    Delta {
                        value: mails,
                        next,
                        delta: None,
                    },
                )
                .unwrap();
            if page == 11 {
                assert_eq!(index.status("a").unwrap().messages, 300);
                assert_eq!(index.status("a").unwrap().pending, 1);
                assert!(!index.folder_ready("a", "inbox").unwrap());
                let connection = index.0.into_inner().unwrap();
                index = MailIndex::init(connection).unwrap();
                let cursor: String = index
                    .0
                    .lock()
                    .unwrap()
                    .query_row(
                        "SELECT cursor FROM folders WHERE account='a' AND id='inbox'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                assert!(cursor.contains("opaque-12"));
                // Empty intermediate pages still have to advance to their next link.
                index
                    .apply_sync_page(
                        "a",
                        "inbox",
                        true,
                        Delta {
                            value: vec![],
                            next: Some(format!(
                                "{GRAPH}/me/mailFolders/inbox/messages?$skiptoken=empty-page"
                            )),
                            delta: None,
                        },
                    )
                    .unwrap();
                assert_eq!(index.status("a").unwrap().pending, 1);
            }
        }
        assert_eq!(
            index
                .search("a", "history", 2000, "newest")
                .unwrap()
                .messages
                .len(),
            25
        );
        assert_eq!(index.status("a").unwrap().pending, 1); // change-tracking baseline still pending
        index
            .apply_sync_page(
                "a",
                "inbox",
                false,
                Delta {
                    value: vec![mail("0", "Invoice", "Searchable history")],
                    next: None,
                    delta: Some(format!(
                        "{GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=baseline"
                    )),
                },
            )
            .unwrap();
        let status = index.status("a").unwrap();
        assert_eq!(status.messages, 2025);
        assert_eq!(status.pending, 0);
        assert_eq!(status.coverage_gaps, 0);
        assert_eq!(status.reported_items, Some(2025));
        assert!(index.folder_ready("a", "inbox").unwrap());
        index
            .apply_sync_page(
                "a",
                "inbox",
                false,
                Delta {
                    value: vec![],
                    next: Some(format!(
                        "{GRAPH}/me/mailFolders/inbox/messages/delta?$skiptoken=updates"
                    )),
                    delta: None,
                },
            )
            .unwrap();
        assert_eq!(index.status("a").unwrap().pending, 1);
    }
    #[test]
    fn old_completed_cache_is_rescanned_without_losing_mail_or_pause_preference() {
        let index = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        test_folder(&index, 4000);
        index
            .upsert("a", "inbox", &[mail("saved", "Saved mail", "private")])
            .unwrap();
        index.control("a", "pause").unwrap();
        let c = index.0.into_inner().unwrap();
        c.execute_batch("UPDATE folders SET done=1,scan=0,cursor=NULL,delta='old-checkpoint'; ALTER TABLE folders DROP COLUMN scan; PRAGMA user_version=1;").unwrap();
        let upgraded = MailIndex::init(c).unwrap();
        let status = upgraded.status("a").unwrap();
        assert!(status.paused);
        assert_eq!(status.messages, 1);
        assert_eq!(status.pending, 1);
        assert!(!upgraded.folder_ready("a", "inbox").unwrap());
        assert!(upgraded.raw("a", "saved").unwrap().is_some());
    }
    #[test]
    fn coverage_mismatch_stays_visible_and_rescan_preserves_other_accounts() {
        let index = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        test_folder(&index, 4000);
        index
            .upsert("a", "inbox", &[mail("saved", "Saved mail", "private")])
            .unwrap();
        index
            .upsert("b", "inbox", &[mail("other", "Other account", "private")])
            .unwrap();
        index
            .0
            .lock()
            .unwrap()
            .execute_batch("UPDATE folders SET scan=0,done=1,delta='checkpoint'")
            .unwrap();
        assert_eq!(index.status("a").unwrap().coverage_gaps, 1);
        index.control("a", "rebuild").unwrap();
        assert!(!index.status("a").unwrap().paused);
        assert_eq!(index.status("a").unwrap().pending, 1);
        assert!(index.raw("a", "saved").unwrap().is_some());
        assert!(index.raw("b", "other").unwrap().is_some());
    }
    #[test]
    fn cache_clear_is_account_scoped_and_pauses_indexing_including_contacts() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        i.upsert("a", "inbox", &[mail("a", "Invoice", "private cached text")])
            .unwrap();
        i.upsert("b", "inbox", &[mail("b", "Invoice", "other account")])
            .unwrap();
        assert!(!i.contacts("a", "alex").unwrap().is_empty());
        i.control("a", "clear").unwrap();
        assert!(i.status("a").unwrap().paused);
        assert_eq!(i.search("a", "invoice", 0, "newest").unwrap().total, 0);
        assert!(i.contacts("a", "alex").unwrap().is_empty());
        assert_eq!(i.search("b", "invoice", 0, "newest").unwrap().total, 1);
        i.control("a", "resume").unwrap();
        assert!(!i.status("a").unwrap().paused);
    }
    #[test]
    fn bcc_and_unicode_snippets_are_searchable_without_cross_account_suggestions() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        let mut own = mail("a", "Invoice", "İstanbul booking reference ABC123");
        own["bccRecipients"] = serde_json::json!([{"emailAddress":{"name":"Hidden recipient","address":"copy@example.test"}}]);
        i.upsert("a", "inbox", &[own]).unwrap();
        i.upsert("b", "inbox", &[mail("b", "Secretvocabulary", "unrelated")])
            .unwrap();
        assert_eq!(
            i.search("a", "bcc:copy@example.test ABC123", 0, "relevance")
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            i.search("a", "person:copy@example.test", 0, "newest")
                .unwrap()
                .total,
            1
        );
        assert!(!i
            .search("a", "Secretvocabulry", 0, "newest")
            .unwrap()
            .suggestions
            .contains(&"secretvocabulary".into()));
    }
    #[test]
    fn full_reconciliation_preserves_moves_and_recent_reads_and_saves_checkpoint_atomically() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        i.0.lock().unwrap().execute("INSERT INTO folders(account,id,name,parent,json) VALUES('a','inbox','Inbox','','{}')",[]).unwrap();
        let (run, started) = i.start_round("a", "inbox").unwrap();
        let old = mail("old", "Old message", "old");
        let mut keep = mail("keep", "Current message", "current");
        keep["_indexRun"] = run.clone().into();
        let mut recent = mail("recent", "Just opened", "recent");
        recent["_cachedAt"] = (started + 1).into();
        i.upsert("a", "inbox", &[old, keep, recent]).unwrap();
        let mut moved = mail("moved", "Moved mail", "archive");
        moved["parentFolderId"] = "archive".into();
        i.upsert("a", "archive", &[moved]).unwrap();
        i.finish_round("a", "inbox", &run, started, Some("checkpoint"))
            .unwrap();
        assert!(i.raw("a", "old").unwrap().is_none());
        assert!(i.raw("a", "keep").unwrap().is_some());
        assert!(i.raw("a", "recent").unwrap().is_some());
        assert!(i.raw("a", "moved").unwrap().is_some());
        assert!(i.folder_ready("a", "inbox").unwrap());
        let delta: String =
            i.0.lock()
                .unwrap()
                .query_row(
                    "SELECT delta FROM folders WHERE account='a' AND id='inbox'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
        assert_eq!(delta, "checkpoint");
    }
    fn mail(id: &str, subject: &str, body: &str) -> serde_json::Value {
        serde_json::json!({"id":id,"subject":subject,"from":{"emailAddress":{"name":"Alex Morgan","address":"alex@example.test"}},"toRecipients":[{"emailAddress":{"name":"Me","address":"me@example.test"}}],"receivedDateTime":"2026-10-01T12:00:00Z","isRead":false,"hasAttachments":true,"conversationId":"thread","parentFolderId":"inbox","body":{"contentType":"Text","content":body},"_attachmentNames":"receipt.pdf","_attachmentsIndexed":true})
    }
    #[test]
    fn search_is_account_scoped_body_aware_and_supports_boolean_filters() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        i.upsert(
            "a",
            "inbox",
            &[
                mail("1", "Café invoice", "Your reservation reference is ABC123"),
                mail("2", "Receipt", "A different payment"),
            ],
        )
        .unwrap();
        i.upsert("b", "inbox", &[mail("private", "Confidential", "ABC123")])
            .unwrap();
        assert_eq!(i.search("a", "ABC123", 0, "relevance").unwrap().total, 1);
        assert_eq!(
            i.search("a", "subject:cafe has:attachment -is:read", 0, "newest")
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            i.search(
                "a",
                "(invoice OR receipt) from:alex filename:pdf after:2026-01-01",
                0,
                "relevance"
            )
            .unwrap()
            .total,
            2
        );
        assert_eq!(i.search("a", "NOT receipt", 0, "newest").unwrap().total, 0);
        assert_eq!(
            i.search("b", "ABC123", 0, "newest").unwrap().messages[0].id,
            "private"
        );
    }
    #[test]
    fn familiar_phrase_filters_execute_with_grouped_people_and_inclusive_end_dates() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        let make = |id: &str, name: &str, read: bool, attached: bool, received: &str| {
            let mut m = mail(id, "Quarterly report", "Reservation number ABC123");
            m["from"]["emailAddress"]["name"] = name.into();
            m["from"]["emailAddress"]["address"] = format!("{id}@example.test").into();
            m["isRead"] = read.into();
            m["hasAttachments"] = attached.into();
            m["receivedDateTime"] = received.into();
            m
        };
        i.upsert(
            "a",
            "inbox",
            &[
                make("alex", "Alex Morgan", false, true, "2026-09-15T12:00:00Z"),
                make("sam", "Sam Jones", false, true, "2026-09-30T12:00:00Z"),
                make(
                    "sam-no-file",
                    "Sam Jones",
                    false,
                    false,
                    "2026-09-15T12:00:00Z",
                ),
                make("read", "Alex Morgan", true, true, "2026-09-15T12:00:00Z"),
                make("other", "Someone Else", false, true, "2026-09-15T12:00:00Z"),
                make(
                    "outside",
                    "Alex Morgan",
                    false,
                    true,
                    "2026-10-02T12:00:00Z",
                ),
            ],
        )
        .unwrap();
        i.upsert(
            "b",
            "inbox",
            &[make(
                "private",
                "Alex Morgan",
                false,
                true,
                "2026-09-15T12:00:00Z",
            )],
        )
        .unwrap();
        let q = "is:unread (from:\"Alex Morgan\" OR from:\"Sam Jones\") after:2026-09-01 before:2026-10-01";
        let results = i
            .search("a", &format!("{q} has:attachment"), 0, "relevance")
            .unwrap();
        let ids = results
            .messages
            .iter()
            .map(|m| m.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(ids, std::collections::HashSet::from(["alex", "sam"]));
        let results = i
            .search("a", &format!("{q} -has:attachment"), 0, "relevance")
            .unwrap();
        assert_eq!(results.total, 1);
        assert_eq!(results.messages[0].id, "sam-no-file");
        let results = i
            .search(
                "a",
                &format!(
                    "{q} NOT (from:\"Alex Morgan\") subject:quarterly subject:report filename:pdf"
                ),
                0,
                "relevance",
            )
            .unwrap();
        assert_eq!(results.total, 2);
    }
    #[test]
    fn diagnostics_count_saved_mail_and_preserve_filters_in_spelling_suggestions() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        i.upsert("a", "inbox", &[mail("one", "Invoice", "payment")])
            .unwrap();
        i.upsert("b", "inbox", &[mail("private", "Secretword", "private")])
            .unwrap();
        let d = i
            .diagnostics(
                "a",
                "from:alex invoice -has:attachment",
                &[
                    "from:alex invoice".into(),
                    "invoice -has:attachment".into(),
                    "from:alex -has:attachment".into(),
                ],
            )
            .unwrap();
        assert_eq!(
            d.alternatives.iter().map(|a| a.count).collect::<Vec<_>>(),
            vec![1, 0, 0]
        );
        let d = i
            .diagnostics("a", "from:alex invoce has:attachment", &[])
            .unwrap();
        assert!(d
            .corrections
            .iter()
            .any(|a| a.query == "from:alex invoice has:attachment" && a.count == 1));
        assert!(i
            .diagnostics("a", "secreword", &[])
            .unwrap()
            .corrections
            .is_empty());
        assert!(i
            .diagnostics("a", "invoice", &["is:unread".into()])
            .unwrap()
            .alternatives
            .is_empty());
        assert!(i
            .diagnostics("a", "absent", &vec!["is:unread".into(); 9])
            .is_err());
        assert!(i.diagnostics("a", "(broken", &[]).is_err());
        let d = i
            .diagnostics("a", "absent", &["(is:read OR is:unread)".into()])
            .unwrap();
        assert_eq!(d.alternatives[0].count, 1);
    }
    #[test]
    fn selected_people_match_exact_addresses_in_each_recipient_field() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        let mut exact = mail("exact", "hello", "hello");
        exact["ccRecipients"] =
            serde_json::json!([{"emailAddress":{"name":"Cc","address":"cc@example.test"}}]);
        exact["bccRecipients"] =
            serde_json::json!([{"emailAddress":{"name":"Bcc","address":"bcc@example.test"}}]);
        let mut misleading = exact.clone();
        misleading["id"] = "misleading".into();
        misleading["from"]["emailAddress"]["address"] = "alex@example.test.attacker".into();
        misleading["toRecipients"] = serde_json::json!([]);
        misleading["ccRecipients"] = serde_json::json!([]);
        misleading["bccRecipients"] = serde_json::json!([]);
        i.upsert("a", "inbox", &[exact.clone(), misleading])
            .unwrap();
        i.upsert("b", "inbox", &[exact]).unwrap();
        for query in [
            "fromaddr:\"ALEX@example.test\"",
            "toaddr:me@example.test",
            "ccaddr:cc@example.test",
            "bccaddr:bcc@example.test",
            "personaddr:bcc@example.test",
        ] {
            let page = i.search("a", query, 0, "relevance").unwrap();
            assert_eq!(page.total, 1, "{query}");
            assert_eq!(page.messages[0].id, "exact");
        }
        assert_eq!(
            i.search("a", "NOT (fromaddr:alex@example.test)", 0, "newest")
                .unwrap()
                .total,
            1
        );
    }
    #[test]
    fn partial_delta_updates_preserve_bodies_and_old_folder_removals_do_not_delete_moves() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        i.upsert("a", "inbox", &[mail("1", "Invoice", "needle")])
            .unwrap();
        i.upsert("a", "inbox", &[serde_json::json!({"id":"1","isRead":true})])
            .unwrap();
        assert_eq!(
            i.search("a", "needle is:read", 0, "newest").unwrap().total,
            1
        );
        i.upsert(
            "a",
            "archive",
            &[serde_json::json!({"id":"1","parentFolderId":"archive"})],
        )
        .unwrap();
        i.upsert(
            "a",
            "inbox",
            &[serde_json::json!({"id":"1","@removed":{"reason":"deleted"}})],
        )
        .unwrap();
        assert_eq!(i.search("a", "needle", 0, "newest").unwrap().total, 1);
        i.upsert(
            "a",
            "archive",
            &[serde_json::json!({"id":"1","@removed":{}})],
        )
        .unwrap();
        assert_eq!(i.search("a", "needle", 0, "newest").unwrap().total, 0);
    }
    #[test]
    fn search_has_no_thousand_result_ceiling_and_suggests_spelling() {
        let i = MailIndex::init(Connection::open_in_memory().unwrap()).unwrap();
        let mails = (0..1050)
            .map(|n| mail(&n.to_string(), "invoice", "hello"))
            .collect::<Vec<_>>();
        i.upsert("a", "inbox", &mails).unwrap();
        let page = i.search("a", "invoice", 1000, "newest").unwrap();
        assert_eq!(page.total, 1050);
        assert_eq!(page.messages.len(), 50);
        assert!(!page.has_more);
        assert!(i
            .search("a", "invoce", 0, "newest")
            .unwrap()
            .suggestions
            .contains(&"invoice".into()));
    }
    #[test]
    fn sync_urls_never_send_mail_tokens_to_external_hosts() {
        assert!(delta_url(
            "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=x"
        )
        .is_ok());
        assert!(delta_url("https://evil.test/v1.0/me/messages/delta").is_err());
    }
}
