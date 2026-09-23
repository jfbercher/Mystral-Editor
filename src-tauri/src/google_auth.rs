//! Native Google OAuth 2.0 sign-in for the desktop build.
//!
//! Google forbids OAuth sign-in from embedded webviews (WKWebView on macOS,
//! Android WebView).  Inside Tauri this shows up as a 403 on
//! `accounts.google.com/gsi/button`, `browser_not_supported` from One Tap and a
//! refused popup window — no amount of CSP or "Authorized JavaScript origins"
//! configuration can lift it, because the restriction is on the browser engine,
//! not on the origin.
//!
//! The path Google supports for an installed application is the loopback flow:
//! the *system* browser performs the sign-in and is redirected to
//! `http://127.0.0.1:<port>`, which this module listens on.  Any port is
//! accepted on a loopback redirect URI, so nothing beyond the "Desktop app"
//! OAuth client itself has to be registered.
//!
//! The exchange uses PKCE, so the authorization code is useless to any other
//! local process that might race us for the redirect.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine as _;
use sha2::{Digest, Sha256};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "openid email profile";

/// How long the loopback socket stays open waiting for the user to finish
/// signing in. Generous: the user may have to pick an account and clear 2FA.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// Random string drawn from the URL "unreserved" set, so it never needs
/// escaping and is a valid PKCE verifier as-is.
fn random_token(len: usize) -> String {
    use rand::Rng;
    const ALPHABET: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn escape_html(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The page the user is left looking at in their browser once we have the code.
fn html_page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{t}</title></head>\
<body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;\
line-height:1.5;color:#1f2328\">\
<h2 style=\"margin:0 0 .5rem\">{t}</h2><p style=\"color:#57606a\">{m}</p></body></html>",
        t = escape_html(title),
        m = escape_html(message)
    )
}

/// Block on the loopback socket until the browser delivers the OAuth redirect.
///
/// Browsers also request `/favicon.ico` and similar on the way, so anything
/// that carries neither `code` nor `error` is answered with a 404 and ignored
/// rather than treated as a failed sign-in.
fn serve_until_redirect(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("cannot poll the loopback socket: {e}"))?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;

    loop {
        if Instant::now() >= deadline {
            return Err("timed out waiting for the browser redirect".to_string());
        }

        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("loopback accept failed: {e}")),
        };
        stream.set_nonblocking(false).ok();
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

        let mut buf = [0u8; 8192];
        let read = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..read]);
        // Request line looks like: GET /?code=...&state=... HTTP/1.1
        let target = request
            .lines()
            .next()
            .unwrap_or("")
            .split_whitespace()
            .nth(1)
            .unwrap_or("");
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");

        let (mut code, mut state, mut error) = (None, None, None);
        for pair in query.split('&').filter(|p| !p.is_empty()) {
            let Some((key, value)) = pair.split_once('=') else {
                continue;
            };
            let value = urlencoding::decode(value)
                .map(|v| v.into_owned())
                .unwrap_or_default();
            match key {
                "code" => code = Some(value),
                "state" => state = Some(value),
                "error" => error = Some(value),
                _ => {}
            }
        }

        if code.is_none() && error.is_none() {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            continue;
        }

        let result = if let Some(err) = error {
            Err(format!("Google refused the request: {err}"))
        } else if state.as_deref() != Some(expected_state) {
            // Someone else answered on our port, or the redirect is stale.
            Err("state mismatch: the redirect did not belong to this sign-in".to_string())
        } else {
            Ok(code.unwrap_or_default())
        };

        let body = match &result {
            Ok(_) => html_page(
                "Signed in",
                "Authentication complete — you can close this tab and go back to Mystral Editor.",
            ),
            Err(message) => html_page("Sign-in failed", message),
        };
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .as_bytes(),
        );
        let _ = stream.flush();
        return result;
    }
}

#[derive(serde::Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Run the whole loopback sign-in and return Google's `id_token` (a JWT).
///
/// The caller decodes the JWT payload for the user's identity. It was issued
/// and signed by Google's token endpoint over TLS in response to a request
/// carrying our PKCE verifier, so it is authentic by construction.
#[tauri::command]
pub async fn google_login(
    client_id: String,
    client_secret: Option<String>,
    hosted_domain: Option<String>,
) -> Result<String, String> {
    // Port 0 => the OS hands us a free port. Google accepts any port on a
    // loopback redirect URI, so this needs no registration.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("cannot open a loopback port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("cannot read the loopback port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_token(64);
    let challenge = pkce_challenge(&verifier);
    let state = random_token(32);

    let mut auth_url = format!(
        "{AUTH_ENDPOINT}?response_type=code&client_id={client}&redirect_uri={redirect}\
&scope={scope}&state={state_p}&code_challenge={challenge_p}&code_challenge_method=S256\
&prompt=select_account",
        client = urlencoding::encode(&client_id),
        redirect = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(SCOPES),
        state_p = urlencoding::encode(&state),
        challenge_p = urlencoding::encode(&challenge),
    );
    // Pre-filter the account chooser when the quiz targets a single domain.
    // This is only a hint; the domain is still verified after decoding.
    if let Some(domain) = hosted_domain.as_deref().filter(|d| !d.is_empty()) {
        auth_url.push_str(&format!("&hd={}", urlencoding::encode(domain)));
    }

    tauri_plugin_opener::open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("cannot open the system browser: {e}"))?;

    let expected_state = state.clone();
    let code = tokio::task::spawn_blocking(move || serve_until_redirect(listener, &expected_state))
        .await
        .map_err(|e| format!("loopback listener panicked: {e}"))??;

    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("code_verifier", verifier),
    ];
    // Google's "Desktop app" clients still expect the (non-confidential) secret.
    if let Some(secret) = client_secret.filter(|s| !s.is_empty()) {
        form.push(("client_secret", secret));
    }

    let response = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;

    let payload: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("malformed token response: {e}"))?;

    if let Some(err) = payload.error {
        let detail = payload
            .error_description
            .map(|d| format!(": {d}"))
            .unwrap_or_default();
        return Err(format!("Google rejected the token exchange: {err}{detail}"));
    }

    payload
        .id_token
        .ok_or_else(|| "the token response carried no id_token".to_string())
}
