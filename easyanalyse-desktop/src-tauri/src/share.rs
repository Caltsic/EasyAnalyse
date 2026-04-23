use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use easyanalyse_core::{validate_value, CoreError, DocumentFile, ValidationReport};
use local_ip_address::list_afinet_netifas;
use qrcodegen::{QrCode, QrCodeEcc};
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

const SHARE_TTL_MINUTES: i64 = 20;
const MAX_REQUEST_BYTES: usize = 32 * 1024;
#[cfg(debug_assertions)]
const DEV_PROXY_ADDR: &str = "127.0.0.1:1420";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileShareSession {
    pub url: String,
    pub app_url: String,
    pub snapshot_url: String,
    pub host: String,
    pub port: u16,
    pub alternate_urls: Vec<String>,
    pub expires_at: String,
    pub created_at: String,
    pub title: String,
    pub issue_count: usize,
    pub schema_valid: bool,
    pub semantic_valid: bool,
    pub qr_svg: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSharePayload {
    pub document: DocumentFile,
    pub report: ValidationReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Value>,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Clone, Default)]
pub struct MobileShareState {
    inner: Arc<Mutex<ShareStateInner>>,
}

#[derive(Default)]
struct ShareStateInner {
    server: Option<ShareServerHandle>,
    session: Option<ShareSessionRecord>,
}

struct ShareServerHandle {
    host: String,
    hosts: Vec<String>,
    port: u16,
}

#[derive(Clone)]
struct ShareSessionRecord {
    token: String,
    payload: MobileSharePayload,
    expires_at: DateTime<Utc>,
}

struct ParsedRequest {
    method: String,
    target: String,
    #[cfg(debug_assertions)]
    version: String,
    #[cfg(debug_assertions)]
    headers: Vec<(String, String)>,
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    message: &'a str,
}

#[tauri::command]
pub fn start_mobile_share(
    app: AppHandle,
    state: State<MobileShareState>,
    document: Value,
    snapshot: Option<Value>,
) -> Result<MobileShareSession, String> {
    let report = validate_value(document).map_err(error_to_string)?;
    let normalized_document = report
        .normalized_document
        .clone()
        .ok_or_else(|| "Document could not be prepared for mobile viewing".to_string())?;

    let (host, hosts, port) = ensure_server(app, state.inner())?;
    let created_at = Utc::now();
    let expires_at = created_at + chrono::Duration::minutes(SHARE_TTL_MINUTES);
    let token = generate_share_token();
    let url = build_share_url(&host, port, &token);
    let snapshot_url = build_snapshot_url(&host, port, &token);
    let app_url = build_app_url(&snapshot_url);
    let qr_svg = build_qr_svg(&url)?;
    let alternate_urls = hosts
        .iter()
        .filter(|candidate| candidate.as_str() != host)
        .map(|candidate| build_share_url(candidate, port, &token))
        .collect::<Vec<_>>();
    let expires_at_text = expires_at.to_rfc3339();

    let session = MobileShareSession {
        url,
        app_url,
        snapshot_url,
        host,
        port,
        alternate_urls,
        expires_at: expires_at_text,
        created_at: created_at.to_rfc3339(),
        title: normalized_document.document.title.clone(),
        issue_count: report.issue_count,
        schema_valid: report.schema_valid,
        semantic_valid: report.semantic_valid,
        qr_svg,
    };
    let payload = MobileSharePayload {
        document: normalized_document,
        report,
        snapshot,
        created_at: session.created_at.clone(),
        expires_at: session.expires_at.clone(),
    };

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Failed to acquire mobile share state".to_string())?;
    inner.session = Some(ShareSessionRecord {
        token,
        payload,
        expires_at,
    });

    Ok(session)
}

#[tauri::command]
pub fn stop_mobile_share(state: State<MobileShareState>) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Failed to acquire mobile share state".to_string())?;
    inner.session = None;
    Ok(())
}

pub fn start_backend_server(app: AppHandle, state: &MobileShareState) -> Result<(), String> {
    ensure_server(app, state).map(|_| ())
}

fn ensure_server(app: AppHandle, state: &MobileShareState) -> Result<(String, Vec<String>, u16), String> {
    {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "Failed to read mobile share state".to_string())?;
        if let Some(server) = &inner.server {
            return Ok((server.host.clone(), server.hosts.clone(), server.port));
        }
    }

    let hosts = collect_share_hosts();
    let host = hosts
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let listener = TcpListener::bind(("0.0.0.0", 0)).map_err(error_to_string)?;
    listener
        .set_nonblocking(true)
        .map_err(error_to_string)?;
    let port = listener.local_addr().map_err(error_to_string)?.port();
    let running = Arc::new(AtomicBool::new(true));
    let state_handle = state.inner.clone();
    let app_handle = app.clone();
    let thread_running = running.clone();

    thread::spawn(move || run_share_server(listener, app_handle, state_handle, thread_running));

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Failed to store mobile share state".to_string())?;
    inner.server = Some(ShareServerHandle {
        host: host.clone(),
        hosts: hosts.clone(),
        port,
    });

    Ok((host, hosts, port))
}

fn run_share_server(
    listener: TcpListener,
    app: AppHandle,
    state: Arc<Mutex<ShareStateInner>>,
    running: Arc<AtomicBool>,
) {
    while running.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let app_handle = app.clone();
                let share_state = state.clone();
                thread::spawn(move || {
                    let _ = handle_connection(stream, app_handle, share_state);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(30));
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(120));
            }
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    state: Arc<Mutex<ShareStateInner>>,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    let request = match read_http_request(&mut stream)? {
        Some(request) => request,
        None => return Ok(()),
    };

    if request.method == "OPTIONS" {
        return write_empty_response(&mut stream, 204, request.method == "HEAD");
    }

    if request.method != "GET" && request.method != "HEAD" {
        return write_json_response(
            &mut stream,
            405,
            &ErrorPayload {
                message: "Only GET and HEAD are supported",
            },
            request.method == "HEAD",
        );
    }

    let path = request.target.split('?').next().unwrap_or("/");
    if let Some(token) = path.strip_prefix("/api/session/") {
        return handle_session_request(&mut stream, &state, token, request.method == "HEAD");
    }
    if let Some(token) = path.strip_prefix("/api/mobile/snapshot/") {
        return handle_snapshot_request(&mut stream, &state, token, request.method == "HEAD");
    }

    #[cfg(debug_assertions)]
    {
        if proxy_dev_server(&mut stream, &request).is_ok() {
            return Ok(());
        }
    }

    if let Some(asset_key) = resolve_asset_key(path) {
        if let Some(asset) = app.asset_resolver().get(asset_key.clone()) {
            return write_bytes_response(
                &mut stream,
                200,
                asset.mime_type(),
                asset.bytes(),
                request.method == "HEAD",
                false,
            );
        }
    }

    write_json_response(
        &mut stream,
        404,
        &ErrorPayload {
            message: "Asset not found",
        },
        request.method == "HEAD",
    )
}

fn handle_snapshot_request(
    stream: &mut TcpStream,
    state: &Arc<Mutex<ShareStateInner>>,
    token: &str,
    head_only: bool,
) -> std::io::Result<()> {
    let session = {
        let mut inner = state
            .lock()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Share state poisoned"))?;

        match &inner.session {
            Some(current) if current.expires_at > Utc::now() && current.token == token => Some(current.clone()),
            Some(current) if current.expires_at <= Utc::now() => {
                inner.session = None;
                None
            }
            _ => None,
        }
    };

    match session {
        Some(current) => match current.payload.snapshot {
            Some(snapshot) => write_json_response(stream, 200, &snapshot, head_only),
            None => write_json_response(
                stream,
                404,
                &ErrorPayload {
                    message: "The mobile render snapshot is unavailable",
                },
                head_only,
            ),
        },
        None => write_json_response(
            stream,
            410,
            &ErrorPayload {
                message: "The shared session has expired or is unavailable",
            },
            head_only,
        ),
    }
}

fn handle_session_request(
    stream: &mut TcpStream,
    state: &Arc<Mutex<ShareStateInner>>,
    token: &str,
    head_only: bool,
) -> std::io::Result<()> {
    let session = {
        let mut inner = state
            .lock()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Share state poisoned"))?;

        match &inner.session {
            Some(current) if current.expires_at > Utc::now() && current.token == token => Some(current.clone()),
            Some(current) if current.expires_at <= Utc::now() => {
                inner.session = None;
                None
            }
            _ => None,
        }
    };

    match session {
        Some(current) => write_json_response(stream, 200, &current.payload, head_only),
        None => write_json_response(
            stream,
            410,
            &ErrorPayload {
                message: "The shared session has expired or is unavailable",
            },
            head_only,
        ),
    }
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<Option<ParsedRequest>> {
    let mut buffer = [0u8; 2048];
    let mut received = Vec::new();

    loop {
        match stream.read(&mut buffer) {
            Ok(0) => {
                if received.is_empty() {
                    return Ok(None);
                }
                break;
            }
            Ok(read) => {
                received.extend_from_slice(&buffer[..read]);
                if received.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
                if received.len() >= MAX_REQUEST_BYTES {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Request headers are too large",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => return Ok(None),
            Err(error) => return Err(error),
        }
    }

    let text = String::from_utf8_lossy(&received);
    let header_block = text
        .split("\r\n\r\n")
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid request"))?;
    let mut lines = header_block.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing method"))?
        .to_string();
    let target = request_parts
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing target"))?
        .to_string();
    #[cfg(debug_assertions)]
    let version = request_parts
        .next()
        .unwrap_or("HTTP/1.1")
        .to_string();
    #[cfg(not(debug_assertions))]
    let _ = request_parts.next();

    #[cfg(debug_assertions)]
    let headers = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_string(), value.trim().to_string()))
        })
        .collect::<Vec<_>>();

    Ok(Some(ParsedRequest {
        method,
        target,
        #[cfg(debug_assertions)]
        version,
        #[cfg(debug_assertions)]
        headers,
    }))
}

fn resolve_asset_key(path: &str) -> Option<String> {
    let normalized = path.trim();
    if normalized.is_empty() {
        return Some("index.html".to_string());
    }

    if normalized == "/" || normalized == "/viewer" || (!normalized.contains('.') && normalized.starts_with('/')) {
        return Some("index.html".to_string());
    }

    Some(normalized.trim_start_matches('/').to_string())
}

#[cfg(debug_assertions)]
fn proxy_dev_server(client: &mut TcpStream, request: &ParsedRequest) -> std::io::Result<()> {
    let mut upstream = TcpStream::connect(DEV_PROXY_ADDR)?;
    upstream.set_read_timeout(Some(Duration::from_secs(8)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(8)))?;

    let mut request_text = format!(
        "{} {} {}\r\nHost: {}\r\nConnection: close\r\n",
        request.method, request.target, request.version, DEV_PROXY_ADDR
    );
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case("connection") {
            continue;
        }
        request_text.push_str(name);
        request_text.push_str(": ");
        request_text.push_str(value);
        request_text.push_str("\r\n");
    }
    request_text.push_str("\r\n");

    upstream.write_all(request_text.as_bytes())?;
    upstream.flush()?;
    std::io::copy(&mut upstream, client)?;
    client.flush()?;
    Ok(())
}

fn write_json_response<T: Serialize>(
    stream: &mut TcpStream,
    status: u16,
    payload: &T,
    head_only: bool,
) -> std::io::Result<()> {
    let body = serde_json::to_vec(payload)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error.to_string()))?;
    write_bytes_response(stream, status, "application/json; charset=utf-8", &body, head_only, true)
}

fn write_bytes_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    bytes: &[u8],
    head_only: bool,
    no_store: bool,
) -> std::io::Result<()> {
    let cache_control = if no_store {
        "no-store, no-cache, must-revalidate"
    } else {
        "public, max-age=60"
    };
    let headers = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
        status_text(status),
        content_type,
        bytes.len(),
        cache_control,
    );
    stream.write_all(headers.as_bytes())?;
    if !head_only {
        stream.write_all(bytes)?;
    }
    stream.flush()?;
    Ok(())
}

fn write_empty_response(
    stream: &mut TcpStream,
    status: u16,
    head_only: bool,
) -> std::io::Result<()> {
    let headers = format!(
        "HTTP/1.1 {}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
        status_text(status),
    );
    stream.write_all(headers.as_bytes())?;
    if !head_only {
        stream.write_all(&[])?;
    }
    stream.flush()?;
    Ok(())
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "200 OK",
        204 => "204 No Content",
        404 => "404 Not Found",
        405 => "405 Method Not Allowed",
        410 => "410 Gone",
        _ => "500 Internal Server Error",
    }
}

fn build_share_url(host: &str, port: u16, token: &str) -> String {
    format!("http://{}:{}/viewer?token={}", host, port, token)
}

fn build_snapshot_url(host: &str, port: u16, token: &str) -> String {
    format!("http://{}:{}/api/mobile/snapshot/{}", host, port, token)
}

fn build_app_url(snapshot_url: &str) -> String {
    format!("easyanalyse://open?url={}", percent_encode_uri_component(snapshot_url))
}

fn percent_encode_uri_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => encoded.push(byte as char),
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

fn collect_share_hosts() -> Vec<String> {
    let mut hosts = Vec::new();

    if let Some(host) = detect_lan_host().filter(|host| is_shareable_host(host)) {
        push_unique_host(&mut hosts, host);
    }

    for host in detect_interface_hosts() {
        push_unique_host(&mut hosts, host);
    }

    if hosts.is_empty() {
        hosts.push("127.0.0.1".to_string());
    } else {
        push_unique_host(&mut hosts, "127.0.0.1".to_string());
    }

    hosts
}

fn detect_lan_host() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn detect_interface_hosts() -> Vec<String> {
    let mut ranked = list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(name, address)| match address {
            IpAddr::V4(ipv4) if is_shareable_ipv4(&ipv4) => Some((score_interface_name(&name), ipv4)),
            _ => None,
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.octets().cmp(&right.1.octets())));
    ranked
        .into_iter()
        .map(|(_, ipv4)| ipv4.to_string())
        .collect()
}

fn is_shareable_host(host: &str) -> bool {
    host.parse::<Ipv4Addr>()
        .map(|ipv4| is_shareable_ipv4(&ipv4))
        .unwrap_or(false)
}

fn is_shareable_ipv4(ipv4: &Ipv4Addr) -> bool {
    ipv4.is_private() && !ipv4.is_loopback()
}

fn score_interface_name(name: &str) -> i32 {
    let normalized = name.to_ascii_lowercase();
    let mut score = 20;

    if normalized.contains("wi-fi")
        || normalized.contains("wifi")
        || normalized.contains("wireless")
        || normalized.contains("wlan")
        || normalized.contains("ethernet")
        || normalized.contains("lan")
    {
        score -= 15;
    }

    if normalized.contains("vethernet")
        || normalized.contains("hyper-v")
        || normalized.contains("virtual")
        || normalized.contains("vmware")
        || normalized.contains("docker")
        || normalized.contains("wsl")
        || normalized.contains("tailscale")
        || normalized.contains("zerotier")
        || normalized.contains("vpn")
        || normalized.contains("loopback")
        || normalized.contains("tap")
        || normalized.contains("tun")
    {
        score += 40;
    }

    score
}

fn push_unique_host(hosts: &mut Vec<String>, host: String) {
    if !hosts.iter().any(|candidate| candidate == &host) {
        hosts.push(host);
    }
}

fn generate_share_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect()
}

fn build_qr_svg(text: &str) -> Result<String, String> {
    let qr = QrCode::encode_text(text, QrCodeEcc::Medium)
        .map_err(|_| "Failed to generate QR code".to_string())?;
    let border = 3;
    let size = qr.size();
    let dimension = size + border * 2;
    let mut path = String::new();

    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x, y) {
                use std::fmt::Write as _;
                let _ = write!(path, "M{},{}h1v1h-1z", x + border, y + border);
            }
        }
    }

    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {dimension} {dimension}\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/><path d=\"{path}\" fill=\"#0f172a\"/></svg>"
    ))
}

fn error_to_string<E>(error: E) -> String
where
    E: Into<CoreError>,
{
    let error: CoreError = error.into();
    error.to_string()
}
