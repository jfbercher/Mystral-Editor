//! Relay to a local Jupyter server, for the webview that cannot reach it.
//!
//! The editor's Content-Security-Policy allows `frame-src` on the loopback —
//! that is how the MyST site is shown — but deliberately refuses `connect-src`
//! there. Measured in the application: `ws://127.0.0.1` and `wss://127.0.0.1`
//! are both refused, and so is a `fetch` to the same address. Since a kernel is
//! created over REST and driven over a WebSocket, both have to come through
//! here.
//!
//! Rust rather than a hole in the policy, for two reasons. The practical one:
//! three platforms, one implementation, no per-webview surprises. The other is
//! that a relay is a hole in the policy — so it is one we control. Every
//! address is checked against the loopback before anything is opened; without
//! that check this module would be exactly the outbound door the CSP closes.
//!
//! Nothing in the editor uses this yet. See BACKLOG.md point 50.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// Open links, by the id handed back to the webview.
fn links() -> &'static Mutex<HashMap<u64, mpsc::UnboundedSender<String>>> {
    static LINKS: OnceLock<Mutex<HashMap<u64, mpsc::UnboundedSender<String>>>> = OnceLock::new();
    LINKS.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// The loopback, and nothing else.
///
/// Written by hand rather than with a URL parser, because what matters is
/// short and the traps are known: the authority is what sits between `://` and
/// the first `/`, a `@` in it means the host is not what it appears to be
/// (`ws://127.0.0.1@elsewhere/`), and the host is compared whole rather than by
/// prefix (`127.0.0.1.example.com` starts with `127.0.0.1`).
fn loopback(url: &str, scheme: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix(scheme)
        .ok_or_else(|| format!("only {scheme} is relayed"))?;
    let authority = rest.split('/').next().unwrap_or("");
    if authority.contains('@') {
        return Err("an address with credentials is refused".into());
    }
    let host = match authority.rfind(':') {
        Some(at) => &authority[..at],
        None => authority,
    };
    match host {
        "127.0.0.1" | "localhost" | "[::1]" => Ok(()),
        _ => Err(format!("only the loopback is relayed, not {host}")),
    }
}

/// Open a WebSocket to a local kernel. Messages arrive on `on_message`.
///
/// The last message a link sends is always `{"mystral":"closed"}`: a channel
/// that simply stops is indistinguishable from a quiet kernel, and the caller
/// has to know which of the two it is looking at.
#[tauri::command]
pub async fn jupyter_open(url: String, on_message: Channel<String>) -> Result<u64, String> {
    loopback(&url, "ws://")?;
    let (stream, _response) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("could not open {url}: {e}"))?;
    let (mut write, mut read) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    links().lock().unwrap().insert(id, tx);

    // One task each way, rather than one task selecting over both: the split
    // halves are owned separately, and two loops are easier to be sure of than
    // one with a macro in it.
    tauri::async_runtime::spawn(async move {
        while let Some(text) = rx.recv().await {
            if write.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
        // The sender was dropped -- jupyter_close, or the whole map going away.
        let _ = write.close().await;
    });

    tauri::async_runtime::spawn(async move {
        while let Some(frame) = read.next().await {
            match frame {
                Ok(Message::Text(text)) => {
                    if on_message.send(text.to_string()).is_err() {
                        break;
                    }
                }
                // Binary frames carry the buffers of the comm protocol, which
                // nothing here speaks yet; they are dropped rather than
                // guessed at.
                Ok(Message::Binary(_)) | Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(Message::Frame(_)) => {}
            }
        }
        links().lock().unwrap().remove(&id);
        let _ = on_message.send("{\"mystral\":\"closed\"}".to_string());
    });

    Ok(id)
}

/// Send one message to a kernel, as the JSON the protocol is made of.
#[tauri::command]
pub fn jupyter_send(id: u64, text: String) -> Result<(), String> {
    let map = links().lock().unwrap();
    let link = map.get(&id).ok_or("no such link")?;
    link.send(text).map_err(|_| "the link is closed".to_string())
}

/// Close a link. Dropping the sender ends the writing task, which closes the
/// socket, which ends the reading one.
#[tauri::command]
pub fn jupyter_close(id: u64) -> Result<(), String> {
    links().lock().unwrap().remove(&id);
    Ok(())
}

#[derive(Serialize)]
pub struct JupyterReply {
    pub status: u16,
    pub body: String,
}

/// The REST half: creating a kernel, interrupting it, deleting it.
///
/// Through here for the same reason as the socket -- `connect-src` refuses the
/// loopback -- and with the same check. The token travels in a header rather
/// than in the query string, where it would end up in the server's log.
#[tauri::command]
pub async fn jupyter_fetch(
    method: String,
    url: String,
    token: String,
    body: Option<String>,
) -> Result<JupyterReply, String> {
    loopback(&url, "http://")?;
    let client = reqwest::Client::new();
    let verb = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|_| format!("unknown method {method}"))?;
    let mut request = client
        .request(verb, &url)
        .header("Authorization", format!("token {token}"))
        .header("Content-Type", "application/json");
    if let Some(payload) = body {
        request = request.body(payload);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("could not reach {url}: {e}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    Ok(JupyterReply { status, body })
}

#[cfg(test)]
mod tests {
    use super::loopback;

    #[test]
    fn only_the_loopback() {
        assert!(loopback("ws://127.0.0.1:8888/api", "ws://").is_ok());
        assert!(loopback("ws://localhost:8888/api", "ws://").is_ok());
        assert!(loopback("http://127.0.0.1:9000/api/kernels", "http://").is_ok());
        // The traps.
        assert!(loopback("ws://127.0.0.1@elsewhere.test/api", "ws://").is_err());
        assert!(loopback("ws://127.0.0.1.elsewhere.test/api", "ws://").is_err());
        assert!(loopback("ws://elsewhere.test/api", "ws://").is_err());
        assert!(loopback("wss://127.0.0.1:8888/api", "ws://").is_err());
        assert!(loopback("http://127.0.0.1:8888/api", "ws://").is_err());
    }
}
