//! Signing a vault in, and where the token is kept afterwards.
//!
//! **Nothing is typed into Leaftext.** The consent page opens in the person's normal browser, where their password manager and their existing session already are, and the service hands the answer back to a listener this app opened on the loopback address for that one exchange. An app asking for somebody's service password in its own window is the shape every credential-phishing page imitates, and it is not one this app should teach anyone to trust.
//!
//! What comes back is kept in the machine's own credential store — never in a file this app writes, because a token in the config folder is a token in every backup, every sync client and every crash report.

// Everything the sign-in needs is here and nothing calls it yet: this is the shared half of a remote vault, and the sources that send somebody to a consent page are storage-services.md's. Allowed at the module rather than left to warn, because a warning nobody can act on is one everybody learns to skip.
#![allow(dead_code)]
use super::*;

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Instant;

/// How long a sign-in waits for the browser to come back before it gives the port up. Long enough for a password manager, a second factor and a moment's reading; short enough that a sign-in somebody abandoned does not hold a socket and a thread for the rest of the session.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(180);

/// The name a vault's token is kept under. The vault's row id, so renaming a vault or pointing it somewhere else does not orphan the credential, and two vaults on the same service keep their own.
pub(crate) fn vault_secret_service(id: i64) -> String {
    format!("leaftext-vault-{id}")
}

/// What the browser handed back.
pub(crate) struct SignInAnswer {
    /// The one-time code, to be exchanged for a token by whoever knows this service's endpoints.
    pub(crate) code: String,
    /// The redirect the listener was reachable at, which the exchange has to repeat exactly.
    pub(crate) redirect_uri: String,
}

/// Open a listener on a port the OS picks, and say where it is.
///
/// Port zero rather than a fixed one: a fixed port is one another program may already hold — and the failure then is a sign-in that cannot start at all — and it is one anything else on the machine can sit on and wait to catch somebody's code. Loopback only, so nothing off this machine can reach it.
pub(crate) fn open_sign_in_listener() -> Result<(TcpListener, String), String> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| format!("could not open a port for the sign-in: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("the sign-in port is not readable: {error}"))?
        .port();
    Ok((listener, format!("http://127.0.0.1:{port}/")))
}

/// Serve exactly one request, read the code out of it, and close.
///
/// One and then closed: the port exists for a single exchange, and one left listening is one anything else on the machine can keep talking to. The browser is answered with a page saying it worked, because a blank tab after a consent screen reads as a sign-in that failed.
pub(crate) fn await_sign_in(
    listener: TcpListener,
    redirect_uri: String,
) -> Result<SignInAnswer, String> {
    listener
        .set_nonblocking(false)
        .map_err(|error| format!("the sign-in port would not settle: {error}"))?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;

    loop {
        if Instant::now() >= deadline {
            return Err("the sign-in was not finished in time".to_string());
        }
        let (stream, from) = listener
            .accept()
            .map_err(|error| format!("the sign-in was interrupted: {error}"))?;
        // Bound to loopback already, so this can only be this machine; checked anyway, because the one thing that must never happen here is answering somebody else.
        if !from.ip().is_loopback() {
            continue;
        }
        match serve_one(stream) {
            Ok(Some(code)) => {
                return Ok(SignInAnswer { code, redirect_uri });
            }
            // A browser asking for a favicon, or a consent screen that came back with an error instead of a code. Neither is the answer, and neither should end the wait.
            Ok(None) => continue,
            Err(error) => return Err(error),
        }
    }
}

/// Read one request line, answer it, and take the code out of it if it carried one.
fn serve_one(stream: TcpStream) -> Result<Option<String>, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| format!("the sign-in would not settle: {error}"))?;
    let mut reader = BufReader::new(
        stream
            .try_clone()
            .map_err(|error| format!("the sign-in would not settle: {error}"))?,
    );
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|error| format!("the sign-in said nothing: {error}"))?;

    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let answer = code_from_target(target);
    let page = match &answer {
        Some(_) => "You are signed in. Close this tab and go back to Leaftext.",
        None => "That did not carry a sign-in. Go back to Leaftext and try again.",
    };
    let mut stream = stream;
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.flush();
    Ok(answer)
}

/// The `code` in a request target's query, or `None` when it carried none.
pub(crate) fn code_from_target(target: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=')?;
        if name == "code" && !value.is_empty() {
            return Some(percent_decoded(value));
        }
    }
    None
}

/// A query value as it was written. Only the two escapes a redirect actually uses — percent pairs, and the plus that stands for a space — because this reads one field out of one request and a general decoder here would be a second one to keep true.
fn percent_decoded(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let pair = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                match u8::from_str_radix(pair, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        index += 3;
                    }
                    Err(_) => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Start a sign-in for a vault.
///
/// Every vault kind that ships today keeps its files on this machine — a folder somebody picked, or a clone the machine's own git already knows the user for — so there is nobody to sign in as and this says exactly that rather than leaving the panel waiting. The listener, the wait and the credential store above it are what a source with a consent page to send somebody to will use; [`storage-services.md`](https://leaftext.com) is where those endpoints arrive.
pub(crate) fn sign_in_vault(state: &VaultState, webview: Option<&WebView>, id: i64) {
    let signs_in = state
        .conn
        .as_ref()
        .and_then(|conn| find_vault(conn, id).ok().flatten())
        .is_some_and(|vault| vault.kind.signs_in());
    if !signs_in {
        // Always an answer. The page raises a waiting state before it sends and clears it when the answer arrives, so a command that returns silently is a control that waits for ever.
        report_file_action_failure(
            webview,
            "This vault's files are on this machine, so there is nobody to sign in as.",
        );
    }
}

/// Forget a vault's token. The mirror stays exactly where it is: the files were copied down and they read offline, so signing out stops the refresh rather than emptying the shelf.
pub(crate) fn sign_out_vault(state: &VaultState, id: i64) -> Result<(), String> {
    let Some(conn) = state.conn.as_ref() else {
        return Ok(());
    };
    let account = find_vault(conn, id)
        .ok()
        .flatten()
        .and_then(|vault| vault.account)
        .unwrap_or_default();
    platform::forget_secret(&vault_secret_service(id), &account)?;
    set_vault_account(conn, id, None)?;
    Ok(())
}
