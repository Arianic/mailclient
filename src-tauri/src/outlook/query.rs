use rusqlite::types::Value;

pub struct Query {
    pub sql: String,
    pub values: Vec<Value>,
    pub terms: Vec<String>,
}
#[derive(Clone, Debug)]
struct Token {
    text: String,
    phrase: bool,
}
fn tokens(query: &str) -> Result<Vec<Token>, String> {
    if query.len() > 4000 {
        return Err("Search is too long (maximum 4,000 characters).".into());
    }
    let mut result = Vec::new();
    let mut text = String::new();
    let mut quoted = false;
    let mut phrase = false;
    for c in query.chars() {
        if c == '"' {
            quoted = !quoted;
            phrase = true;
        } else if !quoted && (c.is_whitespace() || c == '(' || c == ')') {
            if !text.is_empty() {
                result.push(Token {
                    text: std::mem::take(&mut text),
                    phrase,
                });
                phrase = false;
            }
            if c == '(' || c == ')' {
                result.push(Token {
                    text: c.to_string(),
                    phrase: false,
                });
            }
        } else {
            text.push(c);
        }
    }
    if quoted {
        return Err("Close the quotation mark to search for an exact phrase.".into());
    }
    if !text.is_empty() {
        result.push(Token { text, phrase });
    }
    if result.len() > 100 {
        return Err("Use up to 100 search terms.".into());
    }
    Ok(result)
}
fn date(value: &str) -> bool {
    let p = value.split('-').collect::<Vec<_>>();
    if p.len() != 3 || p[0].len() != 4 || p[1].len() != 2 || p[2].len() != 2 {
        return false;
    }
    let Ok(y) = p[0].parse::<u32>() else {
        return false;
    };
    let Ok(m) = p[1].parse::<u32>() else {
        return false;
    };
    let Ok(d) = p[2].parse::<u32>() else {
        return false;
    };
    let max = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    y >= 1900 && d >= 1 && d <= max
}
struct Parser<'a> {
    tokens: Vec<Token>,
    at: usize,
    values: Vec<Value>,
    terms: Vec<String>,
    account: &'a str,
}
impl Parser<'_> {
    fn bind(&mut self, value: impl Into<Value>) -> String {
        self.values.push(value.into());
        "?".into()
    }
    fn or(&mut self) -> Result<String, String> {
        let mut out = self.and()?;
        while self
            .tokens
            .get(self.at)
            .is_some_and(|t| t.text == "OR" && !t.phrase)
        {
            self.at += 1;
            out = format!("({out} OR {})", self.and()?);
        }
        Ok(out)
    }
    fn and(&mut self) -> Result<String, String> {
        let mut out = self.atom()?;
        while self
            .tokens
            .get(self.at)
            .is_some_and(|t| t.phrase || (t.text != ")" && t.text != "OR"))
        {
            if self.tokens[self.at].text == "AND" {
                self.at += 1;
            }
            out = format!("({out} AND {})", self.atom()?);
        }
        Ok(out)
    }
    fn atom(&mut self) -> Result<String, String> {
        let token = self
            .tokens
            .get(self.at)
            .cloned()
            .ok_or("Add a term after AND, OR or NOT.")?;
        self.at += 1;
        if token.text == "NOT" && !token.phrase {
            return Ok(format!("NOT ({})", self.atom()?));
        }
        if token.text == "(" && !token.phrase {
            let out = self.or()?;
            if self.tokens.get(self.at).map(|t| t.text.as_str()) != Some(")") {
                return Err("Close the search parenthesis.".into());
            }
            self.at += 1;
            return Ok(out);
        }
        if !token.phrase && matches!(token.text.as_str(), ")" | "OR" | "AND") {
            return Err("Put a search term between operators.".into());
        }
        let negated = token.text.starts_with('-');
        let text = token.text.trim_start_matches('-');
        if text.is_empty() {
            return Err("Add a term after the exclusion sign.".into());
        }
        let (field, value) = text.split_once(':').unwrap_or(("", text));
        let normalized = field.to_ascii_lowercase();
        let field = normalized.as_str();
        if value.is_empty() {
            return Err(format!("Add a value after {field}:"));
        }
        let value = if value.eq_ignore_ascii_case("me")
            && matches!(field, "from" | "to" | "cc" | "bcc" | "person")
        {
            self.account.to_string()
        } else {
            value.to_string()
        };
        let out=match field.to_ascii_lowercase().as_str() {
            "is"=>match value.as_str(){"other"=>"COALESCE(json_extract(m.json,'$.inferenceClassification'),'other')!='focused'".into(),"unread"=>"m.read=0".into(),"read"=>"m.read=1".into(),"important"=>"json_extract(m.json,'$.inferenceClassification')='focused'".into(),_=>return Err("Use is:unread, is:read or is:important.".into())},
            "has"=>match value.as_str(){"attachment"|"attachments"=>"m.attached=1".into(),_=>return Err("Use has:attachment.".into())},
            "before"|"after"|"on"=>{if !date(&value){return Err("Dates must be valid YYYY-MM-DD dates.".into());} let p=self.bind(value);match field{"before"=>format!("date(m.received,'localtime')<{p}"),"after"=>format!("date(m.received,'localtime')>={p}"),_=>format!("date(m.received,'localtime')={p}")}},
            "folderid"=>{let p=self.bind(value);format!("m.folder={p}")},
            "folder"|"in"=>{let escaped=value.replace('\\',"\\\\").replace('%',"\\%").replace('_',"\\_");let p=self.bind(format!("%{escaped}%"));format!("m.folder IN (SELECT id FROM folders WHERE account=m.account AND name LIKE {p} ESCAPE '\\')")},
            ""|"from"|"to"|"cc"|"bcc"|"person"|"subject"|"body"|"filename"=>{
                let column=match field{"from"=>"sender : ","to"=>"to_line : ","cc"=>"cc_line : ","bcc"=>"bcc_line : ","person"=>"{sender to_line cc_line bcc_line} : ","subject"=>"subject : ","body"=>"body : ","filename"=>"filenames : ",_=>""};
                let literal=value.replace('"',"\"\""); let prefix=if token.phrase || value.ends_with('*'){""}else{"*"};
                let literal=literal.trim_end_matches('*'); if literal.is_empty(){return Err("Add a word before * to search by prefix.".into());}
                let p=self.bind(format!("{column}\"{literal}\"{}",if value.ends_with('*'){"*"}else{prefix}));
                if !negated {self.terms.push(value.clone());}
                format!("m.rowid IN (SELECT rowid FROM mail_fts WHERE mail_fts MATCH {p})")
            },
            _=>return Err(format!("Unknown search field '{field}'. Use from, to, cc, bcc, person, subject, body, filename, folder, before, after, on, is or has."))
        };
        Ok(if negated { format!("NOT ({out})") } else { out })
    }
}
pub fn parse(query: &str, account: &str) -> Result<Query, String> {
    let tokens = tokens(query)?;
    if tokens.is_empty() {
        return Ok(Query {
            sql: "1".into(),
            values: vec![],
            terms: vec![],
        });
    }
    let mut p = Parser {
        tokens,
        at: 0,
        values: vec![],
        terms: vec![],
        account,
    };
    let sql = p.or()?;
    if p.at != p.tokens.len() {
        return Err("Unexpected closing parenthesis.".into());
    }
    Ok(Query {
        sql,
        values: p.values,
        terms: p.terms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grammar_is_bounded_and_never_interpolates_user_values() {
        let q=parse("from:\"Alex Morgan\" (invoice OR receipt) -folder:junk after:2026-01-01 has:attachment","me@test.example").unwrap();
        assert!(q.sql.contains(" OR "));
        assert!(!q.sql.contains("Alex"));
        assert_eq!(q.values.len(), 5);
        for q in [
            "from:",
            "before:2026-02-30",
            "\"open",
            "(one OR)",
            "unknown:foo",
            "word)",
        ] {
            assert!(parse(q, "a@b.test").is_err(), "{q}");
        }
        assert!(parse("NOT is:read", "a@b.test").is_ok());
    }
}
