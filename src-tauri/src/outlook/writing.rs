use super::drafts::{Draft, DraftStore};
use rusqlite::{params, OptionalExtension};
use scraper::{ElementRef, Html, Node};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingItem {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub body: String,
    #[serde(default)]
    pub body_html: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingLibrary {
    pub revision: u64,
    pub entries: Vec<WritingItem>,
    pub default_signature: Option<String>,
}
pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn plain_html(value: &str) -> String {
    format!("<p>{}</p>", escape(value).replace('\n', "<br>"))
}
fn safe_link(value: &str) -> bool {
    !value.chars().any(char::is_control)
        && reqwest::Url::parse(value).is_ok_and(|url| {
            matches!(url.scheme(), "http" | "https" | "mailto")
                && url.username().is_empty()
                && url.password().is_none()
        })
}
// Outgoing rich text is deliberately small: no resources, styles, scripts, forms or app attributes.
pub fn clean_html(source: &str) -> Result<(String, String), String> {
    if source.len() > 1_000_000 {
        return Err("Formatted message is too large".into());
    }
    fn walk(
        element: ElementRef<'_>,
        depth: usize,
        html: &mut String,
        text: &mut String,
    ) -> Result<(), String> {
        if depth > 64 {
            return Err("Formatted message is too deeply nested".into());
        }
        let tag = element.value().name();
        if matches!(
            tag,
            "script"
                | "style"
                | "iframe"
                | "object"
                | "embed"
                | "svg"
                | "math"
                | "template"
                | "form"
                | "input"
                | "img"
                | "video"
                | "audio"
                | "source"
                | "head"
        ) {
            return Ok(());
        }
        let allowed = matches!(
            tag,
            "p" | "br"
                | "hr"
                | "strong"
                | "b"
                | "em"
                | "i"
                | "u"
                | "s"
                | "h1"
                | "h2"
                | "h3"
                | "ul"
                | "ol"
                | "li"
                | "blockquote"
                | "pre"
                | "code"
                | "a"
        );
        if allowed {
            html.push('<');
            html.push_str(tag);
            if tag == "a" {
                if let Some(href) = element.attr("href").filter(|v| safe_link(v)) {
                    html.push_str(" href=\"");
                    html.push_str(&escape(href));
                    html.push('"');
                }
            }
            html.push('>');
            if matches!(tag, "br" | "hr") {
                text.push('\n');
            }
        }
        for node in element.children() {
            match node.value() {
                Node::Text(value) => {
                    html.push_str(&escape(value));
                    text.push_str(value);
                }
                Node::Element(_) => {
                    if let Some(child) = ElementRef::wrap(node) {
                        walk(child, depth + 1, html, text)?;
                    }
                }
                _ => {}
            }
        }
        if allowed && !matches!(tag, "br" | "hr") {
            html.push_str("</");
            html.push_str(tag);
            html.push('>');
        }
        if matches!(
            tag,
            "p" | "div" | "li" | "h1" | "h2" | "h3" | "blockquote" | "pre"
        ) {
            text.push('\n');
        }
        if html.len() > 1_000_000 {
            return Err("Formatted message is too large".into());
        }
        Ok(())
    }
    let doc = Html::parse_fragment(source);
    let mut html = String::new();
    let mut text = String::new();
    walk(doc.root_element(), 0, &mut html, &mut text)?;
    Ok((html, text.trim_end_matches('\n').to_string()))
}
pub fn normalize_item(item: &WritingItem) -> Result<WritingItem, String> {
    if !crate::valid_draft_id(&item.id)
        || item.name.trim().is_empty()
        || item.name.len() > 160
        || !matches!(item.kind.as_str(), "signature" | "template" | "snippet")
        || item.body.len() > 100_000
        || item.body_html.as_ref().is_some_and(|h| h.len() > 200_000)
        || item
            .subject
            .as_ref()
            .is_some_and(|s| s.len() > 998 || s.contains(['\r', '\n']))
    {
        return Err("Check the reusable text name, type and size".into());
    }
    let mut result = item.clone();
    result.name = result.name.trim().into();
    if let Some(html) = &item.body_html {
        let (html, text) = clean_html(html)?;
        if html.len() > 200_000 || text.len() > 100_000 {
            return Err("Reusable text is too large".into());
        }
        result.body_html = Some(html);
        result.body = text;
    }
    if item.kind != "template" {
        result.subject = None;
    }
    Ok(result)
}
pub fn normalized_draft(draft: &Draft) -> Result<Draft, String> {
    let mut result = draft.clone();
    if let Some(html) = &draft.body_html {
        let (html, text) = clean_html(html)?;
        result.body_html = Some(html);
        result.body = text;
    }
    if let Some(signature) = &draft.signature {
        if signature.kind != "signature" {
            return Err("Choose a signature from the writing library".into());
        }
        result.signature = Some(normalize_item(signature)?);
    }
    Ok(result)
}
pub fn message_body(draft: &Draft) -> Result<serde_json::Value, String> {
    let draft = normalized_draft(draft)?;
    let rich = draft.body_html.is_some();
    let signature = draft.signature.as_ref();
    let mut content = if rich {
        draft.body_html.clone().unwrap_or_default()
    } else {
        draft.body.clone()
    };
    if let Some(signature) = signature {
        if rich {
            content.push_str("<p><br></p>");
            content.push_str(
                &signature
                    .body_html
                    .clone()
                    .unwrap_or_else(|| plain_html(&signature.body)),
            );
        } else {
            content.push_str("\n\n");
            content.push_str(&signature.body);
        }
    }
    if let Some(quote) = &draft.quote {
        if rich {
            content.push_str("<blockquote>");
            content.push_str(&plain_html(quote));
            content.push_str("</blockquote>");
        } else {
            content.push_str("\n\n");
            content.push_str(quote);
        }
    }
    Ok(serde_json::json!({"contentType":if rich{"HTML"}else{"Text"},"content":content}))
}
impl DraftStore {
    pub fn writing_library(&self, account: &str) -> Result<WritingLibrary, String> {
        let c = self.0.lock().map_err(|_| "Writing library unavailable")?;
        let value: Option<(String, i64)> = c
            .query_row(
                "SELECT value,revision FROM writing_library WHERE account=?1",
                [account.to_lowercase()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| "Could not load writing library")?;
        match value {
            Some((json, revision)) => {
                let mut library: WritingLibrary =
                    serde_json::from_str(&json).map_err(|_| "Could not read writing library")?;
                library.revision = revision.max(0) as u64;
                Ok(library)
            }
            None => Ok(WritingLibrary::default()),
        }
    }
    pub fn save_writing_library(
        &self,
        account: &str,
        library: WritingLibrary,
    ) -> Result<WritingLibrary, String> {
        if library.entries.len() > 100 || library.revision >= i64::MAX as u64 {
            return Err("Use up to 100 reusable entries".into());
        }
        let mut seen = std::collections::HashSet::new();
        let entries = library
            .entries
            .iter()
            .map(|item| {
                if !seen.insert(item.id.clone()) {
                    return Err("Duplicate writing entry".into());
                }
                normalize_item(item)
            })
            .collect::<Result<Vec<_>, String>>()?;
        if library
            .default_signature
            .as_ref()
            .is_some_and(|id| !entries.iter().any(|e| e.id == *id && e.kind == "signature"))
        {
            return Err("Choose an existing default signature".into());
        }
        let saved = WritingLibrary {
            revision: library.revision + 1,
            entries,
            default_signature: library.default_signature,
        };
        let json = serde_json::to_string(&saved).map_err(|_| "Could not save writing library")?;
        if json.len() > 2_000_000 {
            return Err("Writing library is too large".into());
        }
        let mut c = self.0.lock().map_err(|_| "Writing library unavailable")?;
        let tx = c
            .transaction()
            .map_err(|_| "Could not save writing library")?;
        let current: i64 = tx
            .query_row(
                "SELECT revision FROM writing_library WHERE account=?1",
                [account.to_lowercase()],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Could not check writing library")?
            .unwrap_or(0);
        if current < 0 || current as u64 != library.revision {
            return Err(
                "Writing library changed in another window. Reload it before saving.".into(),
            );
        }
        tx.execute("INSERT INTO writing_library(account,value,revision) VALUES(?1,?2,?3) ON CONFLICT(account) DO UPDATE SET value=excluded.value,revision=excluded.revision",params![account.to_lowercase(),json,saved.revision as i64]).map_err(|_|"Could not save writing library")?;
        tx.commit()
            .map_err(|_| "Could not finish saving writing library")?;
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    fn item() -> WritingItem {
        WritingItem {
            id: "personal-signature".into(),
            name: "Personal".into(),
            kind: "signature".into(),
            body: "Alex".into(),
            body_html: Some("<p><strong>Alex</strong></p>".into()),
            subject: None,
        }
    }
    fn draft() -> Draft {
        serde_json::from_value(serde_json::json!({"id":"writing-test","account":"you@example.test","to":"friend@example.test","cc":"","bcc":"","subject":"Hello","body":"Legacy plain text <literal>","replyId":null,"state":"draft"})).unwrap()
    }
    #[test]
    fn outgoing_html_strips_active_content_resources_attributes_and_unsafe_links() {
        let (html,text)=clean_html("<p onclick='attack()' style='background:url(https://tracker.test)'>Hello <strong>world</strong><img src='https://tracker.test'><script>attack()</script><a href='javascript:alert(1)'>unsafe</a><a href='https://example.test?a=1&amp;b=2'>safe</a></p>").unwrap();
        assert!(html.contains("<strong>world</strong>"));
        assert!(html.contains("href=\"https://example.test?a=1&amp;b=2\""));
        for forbidden in [
            "onclick",
            "style=",
            "tracker",
            "script",
            "attack()",
            "javascript:",
            "<img",
        ] {
            assert!(!html.contains(forbidden), "{html}");
        }
        assert!(text.contains("Hello world"));
        assert!(!text.contains("attack"));
        assert!(clean_html(&format!(
            "{}deep{}",
            "<div>".repeat(70),
            "</div>".repeat(70)
        ))
        .is_err());
    }
    #[test]
    fn html_and_plain_sends_keep_signature_before_quote_and_preserve_old_drafts() {
        let mut draft = draft();
        assert!(draft.body_html.is_none());
        assert!(draft.signature.is_none());
        assert_eq!(
            message_body(&draft).unwrap()["content"],
            "Legacy plain text <literal>"
        );
        draft.signature = Some(item());
        draft.quote = Some("Original <message>".into());
        let plain = message_body(&draft).unwrap();
        assert_eq!(plain["contentType"], "Text");
        assert_eq!(
            plain["content"],
            "Legacy plain text <literal>\n\nAlex\n\nOriginal <message>"
        );
        draft.body_html = Some("<p>Hello <em>friend</em></p>".into());
        let html = message_body(&draft).unwrap();
        assert_eq!(html["contentType"], "HTML");
        let content = html["content"].as_str().unwrap();
        assert!(content.contains("<em>friend</em>"));
        assert!(content.find("Alex").unwrap() < content.find("<blockquote>").unwrap());
        assert!(content.contains("Original &lt;message&gt;"));
    }
    #[test]
    fn libraries_are_account_scoped_and_stale_edits_cannot_overwrite_another_window() {
        let store = DraftStore::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let library = WritingLibrary {
            revision: 0,
            entries: vec![item()],
            default_signature: Some("personal-signature".into()),
        };
        let saved = store
            .save_writing_library("YOU@example.test", library.clone())
            .unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(
            store
                .writing_library("you@example.test")
                .unwrap()
                .entries
                .len(),
            1
        );
        assert!(store
            .writing_library("other@example.test")
            .unwrap()
            .entries
            .is_empty());
        assert!(store
            .save_writing_library("you@example.test", library)
            .err()
            .unwrap()
            .contains("another window"));
        let invalid = WritingLibrary {
            revision: 1,
            entries: vec![],
            default_signature: Some("missing".into()),
        };
        assert!(store
            .save_writing_library("you@example.test", invalid)
            .is_err());
    }
    #[test]
    fn rich_drafts_persist_sanitized_content_and_signature_snapshot_and_lock_after_send_claim() {
        let store = DraftStore::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let mut draft = draft();
        draft.body_html =
            Some("<p>Hello <strong>friend</strong><img src='https://tracker.test'></p>".into());
        draft.signature = Some(item());
        draft.writing_initialized = true;
        store.create(&draft).unwrap();
        let restored = store.load(&draft.id).unwrap();
        assert_eq!(restored.body, "Hello friend");
        assert!(!restored.body_html.as_ref().unwrap().contains("img"));
        assert_eq!(restored.signature.as_ref().unwrap().name, "Personal");
        assert!(restored.writing_initialized);
        store.begin_send(&draft.id).unwrap();
        assert!(store.save(&draft).is_err());
        assert_eq!(store.load(&draft.id).unwrap().body_html, restored.body_html);
    }
}
