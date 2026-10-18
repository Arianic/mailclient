use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{stream, StreamExt};
use std::{
    io::Cursor,
    net::{IpAddr, Ipv4Addr},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub content_type: Option<String>,
    pub size: u64,
    #[serde(default)]
    pub is_inline: bool,
    #[serde(rename = "@odata.type", default)]
    pub kind: String,
}
#[derive(Deserialize)]
struct Attachments {
    value: Vec<Attachment>,
    #[serde(rename = "@odata.nextLink")]
    next: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileAttachment {
    content_id: Option<String>,
    content_bytes: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedImage {
    pub source: String,
    pub data_url: String,
}
#[derive(Serialize)]
pub struct Images {
    pub images: Vec<RenderedImage>,
    pub blocked: usize,
}

fn message_url(id: &str, suffix: &[&str]) -> String {
    let mut url = reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
    {
        let mut path = url.path_segments_mut().unwrap();
        path.pop_if_empty().push(id);
        for segment in suffix {
            path.push(segment);
        }
    }
    url.to_string()
}
fn sources(html: &str) -> Vec<String> {
    let fragment = scraper::Html::parse_fragment(html);
    let selector = scraper::Selector::parse("img[src]").unwrap();
    let mut found = Vec::new();
    for image in fragment.select(&selector) {
        if let Some(source) = image.value().attr("src") {
            if !source.starts_with("data:")
                && source.len() <= 8192
                && !found.iter().any(|value| value == source)
            {
                found.push(source.to_string());
            }
        }
    }
    found
}
fn public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || ip == Ipv4Addr::new(168, 63, 129, 16)
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && (b == 168 || b == 0 || (b == 88 && c == 99)))
        || (a == 198 && ((b == 18 || b == 19) || (b == 51 && c == 100)))
        || (a == 203 && b == 0 && c == 113))
}
async fn remote_image(source: &str) -> Result<Vec<u8>, String> {
    let url = reqwest::Url::parse(source).map_err(|_| "Invalid image address")?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Image address is not supported".into());
    }
    let host = url.host_str().ok_or("Image has no host")?;
    let addresses: Vec<_> =
        tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host, 443)))
            .await
            .map_err(|_| "Image host lookup timed out")?
            .map_err(|_| "Image host is unavailable")?
            .collect();
    // Use only publicly routable IPv4, pinned to this TLS connection. IPv6-only
    // hosts and local/special ranges stay blocked; no proxy or redirects bypass it.
    if addresses.iter().any(|address| match address.ip() {
        IpAddr::V4(ip) => !public_ipv4(ip),
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.to_ipv4_mapped().is_some()
                || (ip.segments()[0] & 0xfe00 == 0xfc00)
                || (ip.segments()[0] & 0xffc0 == 0xfe80)
        }
    }) {
        return Err("Private image addresses are blocked".into());
    }
    let public: Vec<_> = addresses
        .into_iter()
        .filter(|address| matches!(address.ip(), IpAddr::V4(ip) if public_ipv4(ip)))
        .collect();
    if public.is_empty() {
        return Err("No public image address is available".into());
    }
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .resolve_to_addrs(host, &public)
        .build()
        .map_err(|_| "Could not prepare image loading")?;
    let response = client
        .get(url)
        .header("Accept", "image/png,image/jpeg,image/gif,image/webp")
        .send()
        .await
        .map_err(|_| "Image could not be loaded")?;
    if !response.status().is_success() {
        return Err("Image server did not return an image".into());
    }
    bounded_bytes(response, 3_000_000).await
}
async fn bounded_bytes(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Download was interrupted")?
    {
        if data.len() + chunk.len() > limit {
            return Err("File exceeds the download size limit".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
fn raster(data: Vec<u8>) -> Result<Vec<u8>, String> {
    if data.len() > 3_000_000 {
        return Err("Image is too large".into());
    }
    let mut reader = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|_| "Unsupported image")?;
    if !matches!(
        reader.format(),
        Some(
            image::ImageFormat::Png
                | image::ImageFormat::Jpeg
                | image::ImageFormat::Gif
                | image::ImageFormat::WebP
        )
    ) {
        return Err("Unsupported image format".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64_000_000);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| "Image could not be decoded safely")?;
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "Image could not be prepared")?;
    let png = output.into_inner();
    if png.len() > 1_400_000 {
        return Err("Decoded image exceeds the display limit".into());
    }
    Ok(png)
}
pub fn safe_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|character| !character.is_control() && !"/\\:".contains(*character))
        .take(160)
        .collect();
    let name = name.trim().trim_matches('.');
    if name.is_empty() {
        "attachment".into()
    } else {
        name.into()
    }
}
impl OutlookService {
    pub async fn forward_files(&self, id: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
        let (_, token) = self.media_context(id).await?;
        let files = self.attachment_list(id, &token).await?;
        let mut result = Vec::new();
        let mut size = 0u64;
        let mut copied = 0usize;
        for file in files.into_iter().filter(|f| !f.is_inline) {
            size += file.size;
            if size > 20_000_000 {
                return Err("Original attachments exceed 20 MB. Add the files you want to forward manually.".into());
            }
            let response = self
                .http
                .get(message_url(id, &["attachments", &file.id, "$value"]))
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|_| "Could not copy original attachments. Add files before sending.")?;
            if !response.status().is_success() {
                return Err(
                    "Could not copy an original attachment. Add files before sending.".into(),
                );
            }
            let bytes = bounded_bytes(response, 20_000_000 - copied).await?;
            copied += bytes.len();
            result.push((safe_name(&file.name), bytes));
        }
        Ok(result)
    }
    async fn media_context(&self, id: &str) -> Result<(String, String), String> {
        let mut session = self.session.lock().await;
        let html = session
            .opened_message
            .as_ref()
            .filter(|message| message.id == id)
            .ok_or("Open the message before loading its images or files")?
            .body
            .content
            .clone();
        let token = self.access(&mut session).await?;
        Ok((html, token))
    }
    pub(super) async fn attachment_list(
        &self,
        id: &str,
        token: &str,
    ) -> Result<Vec<Attachment>, String> {
        let url = format!(
            "{}?$top=100&$select=id,name,contentType,size,isInline",
            message_url(id, &["attachments"])
        );
        let mut next = Some(url);
        let mut files = Vec::new();
        let mut seen = std::collections::HashSet::new();
        while let Some(url) = next {
            if !seen.insert(url.clone()) {
                return Err("Outlook repeated an attachment page".into());
            }
            let page: Attachments = self.get(&url, token).await?;
            files.extend(page.value.into_iter().filter(|file| {
                file.kind == "#microsoft.graph.fileAttachment" || file.kind.is_empty()
            }));
            next = page
                .next
                .map(|url| {
                    let parsed =
                        reqwest::Url::parse(&url).map_err(|_| "Invalid attachment page")?;
                    if parsed.scheme() != "https"
                        || parsed.host_str() != Some("graph.microsoft.com")
                        || parsed.port_or_known_default() != Some(443)
                        || !parsed.username().is_empty()
                        || parsed.password().is_some()
                        || parsed.fragment().is_some()
                        || !parsed.path().starts_with("/v1.0/")
                        || !parsed.path().ends_with("/attachments")
                    {
                        return Err("Unsupported attachment page");
                    }
                    Ok(parsed.to_string())
                })
                .transpose()?;
        }
        Ok(files)
    }
    pub async fn attachments(&self, id: String) -> Result<Vec<Attachment>, String> {
        let (_, token) = self.media_context(&id).await?;
        self.attachment_list(&id, &token).await
    }
    pub async fn attachment_bytes(
        &self,
        id: String,
        attachment_id: String,
    ) -> Result<(String, Vec<u8>), String> {
        let (_, token) = self.media_context(&id).await?;
        let files = self.attachment_list(&id, &token).await?;
        let file = files
            .iter()
            .find(|file| file.id == attachment_id)
            .ok_or("This file is not an attachment of the opened message")?;
        if file.size > 20_000_000 {
            return Err("Attachments over 20 MB are not supported yet.".into());
        }
        let response = self
            .http
            .get(message_url(&id, &["attachments", &attachment_id, "$value"]))
            .bearer_auth(&token)
            .header("Prefer", "IdType=\"ImmutableId\"")
            .send()
            .await
            .map_err(|_| "Could not download the attachment")?;
        if !response.status().is_success() {
            return Err("Outlook could not download the attachment".into());
        }
        Ok((
            safe_name(&file.name),
            bounded_bytes(response, 20_000_000).await?,
        ))
    }
    pub async fn load_images(&self, id: String) -> Result<Images, String> {
        let (html, token) = self.media_context(&id).await?;
        let all = sources(&html);
        let mut cid = HashMap::new();
        if all
            .iter()
            .any(|source| source.to_lowercase().starts_with("cid:"))
        {
            let files = self.attachment_list(&id, &token).await?;
            for file in files
                .into_iter()
                .filter(|file| file.is_inline && file.size <= 3_000_000)
                .take(24)
            {
                let data: Result<FileAttachment, _> = self
                    .get(&message_url(&id, &["attachments", &file.id]), &token)
                    .await;
                if let Ok(data) = data {
                    if let Some(content_id) = data.content_id {
                        if let Ok(bytes) = STANDARD.decode(data.content_bytes) {
                            cid.insert(content_id.trim_matches(['<', '>']).to_lowercase(), bytes);
                        }
                    }
                }
            }
        }
        let requests = all.iter().take(24).cloned().map(|source| {
            let inline = source
                .get(..4)
                .filter(|prefix| prefix.eq_ignore_ascii_case("cid:"))
                .and_then(|_| source.get(4..))
                .and_then(|value| cid.get(&value.trim_matches(['<', '>']).to_lowercase()))
                .cloned();
            async move {
                let bytes = if source.to_lowercase().starts_with("cid:") {
                    inline.ok_or_else(|| "Inline image unavailable".to_string())
                } else {
                    remote_image(&source).await
                };
                let png = match bytes {
                    Ok(bytes) => tokio::task::spawn_blocking(move || raster(bytes))
                        .await
                        .map_err(|_| "Image decoding stopped".to_string())
                        .and_then(|value| value),
                    Err(error) => Err(error),
                };
                (source, png)
            }
        });
        let mut completed = stream::iter(requests).buffer_unordered(4);
        let mut images = Vec::new();
        let mut cache = Vec::new();
        let mut total = 0;
        while let Some((source, result)) = completed.next().await {
            if let Ok(png) = result {
                if total + png.len() <= 8_000_000 {
                    total += png.len();
                    images.push(RenderedImage {
                        source,
                        data_url: format!("data:image/png;base64,{}", STANDARD.encode(&png)),
                    });
                    cache.push(png);
                }
            }
        }
        let mut session = self.session.lock().await;
        if !session
            .opened_message
            .as_ref()
            .is_some_and(|message| message.id == id)
        {
            return Err("A different message is now open".into());
        }
        session.loaded_images = cache;
        Ok(Images {
            blocked: all.len().saturating_sub(images.len()),
            images,
        })
    }
    pub async fn image_bytes(&self, id: &str, index: usize) -> Result<Vec<u8>, String> {
        let session = self.session.lock().await;
        if !session
            .opened_message
            .as_ref()
            .is_some_and(|message| message.id == id)
        {
            return Err("Open the message before downloading an image".into());
        }
        session
            .loaded_images
            .get(index)
            .cloned()
            .ok_or_else(|| "Load images before downloading them".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_images_cannot_target_private_or_special_ipv4_networks() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "172.16.0.1",
            "100.64.0.1",
            "0.0.0.0",
            "198.18.0.1",
            "224.0.0.1",
            "192.0.2.1",
        ] {
            assert!(!public_ipv4(value.parse().unwrap()));
        }
        assert!(public_ipv4("8.8.8.8".parse().unwrap()));
    }
    #[test]
    fn only_message_image_sources_are_collected_and_active_formats_are_rejected() {
        assert_eq!(sources("<img src='https://example.test/a'><script src='https://evil.test/a'></script><img src='https://example.test/a'>"), vec!["https://example.test/a"]);
        assert!(raster(b"<svg onload='evil()'></svg>".to_vec()).is_err());
        assert_eq!(safe_name("../../private/file.png"), "privatefile.png");
    }
}
