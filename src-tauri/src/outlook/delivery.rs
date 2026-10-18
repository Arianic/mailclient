use super::{
    drafts::{Draft, DraftStore},
    *,
};
use base64::{engine::general_purpose::STANDARD, Engine};
fn url(id: &str, suffix: Option<&str>) -> reqwest::Url {
    let mut u = reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
    u.path_segments_mut().unwrap().pop_if_empty().push(id);
    if let Some(s) = suffix {
        u.path_segments_mut().unwrap().push(s);
    }
    u
}
fn upload_url(value: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(value).map_err(|_| "Invalid Outlook upload address")?;
    if u.scheme() != "https"
        || !matches!(
            u.host_str(),
            Some("outlook.office.com" | "outlook.office365.com")
        )
        || u.port_or_known_default() != Some(443)
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
    {
        return Err("Outlook returned an unsupported upload address".into());
    }
    Ok(u)
}
pub async fn send_large(
    http: &reqwest::Client,
    token: &str,
    draft: &Draft,
    store: &DraftStore,
    progress: &(dyn Fn(usize, usize) + Send + Sync),
) -> Result<String, String> {
    store.phase(&draft.id, "sending", "preparing")?;
    let prepare=async {
        let to=super::drafts::recipients(&draft.to)?;let cc=super::drafts::recipients(&draft.cc)?;let bcc=super::drafts::recipients(&draft.bcc)?;if to.is_empty()||to.len()+cc.len()+bcc.len()>100{return Err("Add a To recipient and use at most 100 recipients total.".into());}
        if let Some(previous)=store.remote(&draft.id)? {
            let r=http.get(url(&previous,None)).query(&[("$select","isDraft")]).bearer_auth(token).send().await.map_err(|_|"Could not check the previous upload draft")?;
            if r.status().is_success(){let value:serde_json::Value=r.json().await.map_err(|_|"Could not check upload draft")?;if value["isDraft"]!=true{return Err("The Outlook upload draft is no longer a draft. Check Sent Items before sending again.".into());}let r=http.delete(url(&previous,None)).bearer_auth(token).send().await.map_err(|_|"Could not replace the previous upload draft")?;if r.status().as_u16()!=204{return Err("Could not replace the previous upload draft; no new send was attempted.".into());}store.clear_remote(&draft.id)?;}
            else if r.status().as_u16()==404{return Err("The prepared Outlook draft is no longer available. Check Sent Items before creating another copy.".into());}else{return Err("Could not inspect the previous upload draft; no new send was attempted.".into());}
        }
        let message=serde_json::json!({"subject":draft.subject,"body":{"contentType":"Text","content":draft.body},"toRecipients":super::drafts::recipients(&draft.to)?,"ccRecipients":super::drafts::recipients(&draft.cc)?,"bccRecipients":super::drafts::recipients(&draft.bcc)?});
        let (address,payload)=if let Some(reply)=&draft.reply_id{(url(reply,Some("createReply")),serde_json::json!({"message":message}))}else{(reqwest::Url::parse(&format!("{GRAPH}/me/messages")).unwrap(),message)};
        if serde_json::to_vec(&payload).map_err(|_|"Could not prepare the message")?.len()>3_900_000 {return Err("The message text is too large to submit. Shorten it before sending.".into());}
        let response=http.post(address).bearer_auth(token).header("Prefer","IdType=\"ImmutableId\"").json(&payload).send().await.map_err(|_|"Could not prepare the Outlook draft; no email was sent.")?;
        if response.status().as_u16()!=201{return Err("Outlook could not prepare the upload draft. Check Mail.ReadWrite permission; no send was attempted.".into());}
        let created:serde_json::Value=response.json().await.map_err(|_|"Could not read the upload draft. No send was attempted.")?;let remote=created["id"].as_str().ok_or("Outlook did not return an upload draft ID")?.to_string();store.save_remote(&draft.id,&remote)?;
        let files=store.files(&draft.id)?;let total=files.iter().map(|(_,b)|b.len()).sum::<usize>();let mut uploaded=0;progress(0,total);
        for (name,bytes) in files {
            if bytes.len()<3_000_000 {
                let r=http.post(url(&remote,Some("attachments"))).bearer_auth(token).json(&serde_json::json!({"@odata.type":"#microsoft.graph.fileAttachment","name":name,"contentType":"application/octet-stream","contentBytes":STANDARD.encode(&bytes)})).send().await.map_err(|_|"Attachment upload interrupted. Your local draft is saved; no send was attempted.")?;
                if r.status().as_u16()!=201{return Err("Outlook rejected an attachment. No send was attempted; your local draft is saved.".into());}uploaded+=bytes.len();progress(uploaded,total);
            }else{
                let mut endpoint=url(&remote,Some("attachments"));endpoint.path_segments_mut().unwrap().push("createUploadSession");
                let r=http.post(endpoint).bearer_auth(token).json(&serde_json::json!({"AttachmentItem":{"attachmentType":"file","name":name,"size":bytes.len()}})).send().await.map_err(|_|"Could not start attachment upload")?;
                if r.status().as_u16()!=201{return Err("Outlook rejected this large attachment; no send was attempted.".into());}
                let session:serde_json::Value=r.json().await.map_err(|_|"Invalid upload session")?;let upload=upload_url(session["uploadUrl"].as_str().ok_or("Missing upload address")?)?;
                for (part,chunk) in bytes.chunks(3_276_800).enumerate(){let start=part*3_276_800;let end=start+chunk.len()-1;let response=http.put(upload.clone()).header("Content-Type","application/octet-stream").header("Content-Length",chunk.len()).header("Content-Range",format!("bytes {start}-{end}/{}",bytes.len())).body(chunk.to_vec()).send().await.map_err(|_|"Large attachment upload interrupted. No send was attempted; retry from your saved draft.")?;
                    let expected=if end+1==bytes.len(){201}else{200};if response.status().as_u16()!=expected{return Err("Outlook could not finish uploading the attachment. No send was attempted.".into());}uploaded+=chunk.len();progress(uploaded,total);
                }
            }
        }
        Ok::<_,String>(remote)
    }.await;
    let remote = match prepare {
        Ok(id) => id,
        Err(error) => {
            store.phase(
                &draft.id,
                "preparing",
                if error.contains("no longer a draft") || error.contains("no longer available") {
                    "uncertain"
                } else {
                    "draft"
                },
            )?;
            return Err(error);
        }
    };
    store.phase(&draft.id, "preparing", "sending")?;
    match http
        .post(url(&remote, Some("send")))
        .bearer_auth(token)
        .send()
        .await
    {
        Ok(response) if response.status().as_u16() == 202 => {
            store.finish_send(&draft.id, "accepted")?;
            Ok("Submitted to Outlook with attachments. Delivery may still be processing.".into())
        }
        Ok(response) if matches!(response.status().as_u16(), 400 | 401 | 403 | 413 | 429) => {
            store.finish_send(&draft.id, "draft")?;
            Err("Outlook rejected the send. Your draft is saved; check permission or attachment limits before retrying.".into())
        }
        _ => {
            store.finish_send(&draft.id, "uncertain")?;
            Err("Send result is uncertain. Check Sent Items before creating another copy; this draft will not be resent automatically.".into())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preauthenticated_uploads_cannot_target_arbitrary_hosts() {
        assert!(upload_url("https://outlook.office.com/upload?token=opaque").is_ok());
        for value in [
            "https://evil.test/upload",
            "http://outlook.office.com/upload",
            "https://user@outlook.office.com/upload",
            "https://outlook.office.com:444/upload",
        ] {
            assert!(upload_url(value).is_err());
        }
    }
}
