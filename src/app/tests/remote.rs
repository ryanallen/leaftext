//! A remote vault: its request, its sign-in, where the token is kept, and keeping the copy up to date.

use super::*;

// ---------------------------------------------------------------------------
// The HTTP call a remote vault needs
// ---------------------------------------------------------------------------

/// One scheme check in front of both platform halves is what makes this test possible at all: a check inside either half is unreachable from the other machine.
#[test]
fn a_request_that_is_not_https_is_refused_before_it_is_sent() {
    use crate::platform::require_https;

    assert!(require_https("https://api.github.com/repos/ryanallen/leaftext").is_ok());

    // Plain HTTP, and the three schemes a link in a document could carry into a source's own address.
    for refused in [
        "http://api.github.com/repos",
        "ftp://files.example.com/notes.md",
        "file:///C:/Windows/System32/config/SAM",
        "leaf-asset://app.js",
    ] {
        let error = require_https(refused).expect_err(refused);
        assert!(error.contains("not HTTPS"), "{refused}: {error}");
    }

    // Nothing that is not an address at all gets through either.
    assert!(require_https("").is_err());
    assert!(require_https("https://").is_err());
    assert!(require_https("not an address").is_err());
}

/// The refusal is in front of the request itself, not only in front of the free function beside it — so a source cannot reach either platform half over plain HTTP by going through the one door it was given.
#[test]
fn the_request_itself_is_refused_before_a_socket_is_opened() {
    use crate::platform::{http_request, http_request_with_retry, HttpBody, HttpRequest};

    let token = [("Authorization".to_string(), "Bearer secret".to_string())];
    let sent = "{\"query\":\"{viewer{login}}\"}";
    let over_plain_http = HttpRequest {
        method: "POST",
        url: "http://api.example.com/documents",
        headers: &token,
        body: Some(HttpBody::Text(sent)),
    };

    // Refused, and refused for the right reason — a network failure would say something else, and this test must not be able to pass by being offline.
    let error = http_request(&over_plain_http).expect_err("plain HTTP is refused");
    assert!(error.contains("not HTTPS"), "{error}");

    // The waiting one refuses in front of its first attempt, so nothing sleeps and nothing is retried over a scheme that will never be allowed.
    let started = std::time::Instant::now();
    let error = http_request_with_retry(&over_plain_http).expect_err("plain HTTP is refused");
    assert!(error.contains("not HTTPS"), "{error}");
    assert!(started.elapsed() < std::time::Duration::from_secs(1));

    // A document going the other way is named as a file rather than held in memory, which is the shape the Mac half needs. It is refused on the same ground. This run's own, so the "nothing read it" assertion below cannot be answered by something another run left lying about.
    let path = std::env::temp_dir().join(format!("leaf-not-sent-{}.md", std::process::id()));
    let as_a_file = HttpRequest {
        method: "PUT",
        url: "http://api.example.com/documents/1",
        headers: &token,
        body: Some(HttpBody::File(&path)),
    };
    assert!(http_request(&as_a_file)
        .expect_err("plain HTTP is refused")
        .contains("not HTTPS"));
    // And nothing read the file to find that out.
    assert!(!path.exists());
}

/// What is worth asking again for, and what is not. A 4xx that says the request itself is wrong comes back wrong every time, so trying it four times only spends somebody's rate limit.
#[test]
fn only_a_busy_service_is_asked_again_and_the_wait_is_capped() {
    use crate::platform::{
        backoff, retry_after, should_retry, HttpResponse, HTTP_ATTEMPTS, HTTP_BACKOFF_CEILING,
    };

    assert!(should_retry(429));
    for busy in [500, 502, 503, 599] {
        assert!(should_retry(busy), "{busy}");
    }
    for settled in [200, 201, 204, 301, 400, 401, 403, 404, 409, 422] {
        assert!(!should_retry(settled), "{settled}");
    }

    // It doubles, and it stops doubling. A source that keeps saying no must not be able to walk the wait up to an hour.
    let mut previous = std::time::Duration::ZERO;
    for attempt in 0..12 {
        let wait = backoff(attempt);
        assert!(wait <= HTTP_BACKOFF_CEILING, "attempt {attempt}: {wait:?}");
        if attempt < 4 {
            assert!(
                wait >= previous,
                "attempt {attempt} waited less than the one before"
            );
        }
        previous = wait;
    }
    // A service that says how long to wait is believed, in the seconds form, and still held under the ceiling.
    let asked = HttpResponse {
        status: 429,
        headers: vec![("retry-after".to_string(), "5".to_string())],
        body: Vec::new(),
    };
    assert_eq!(retry_after(&asked), Some(std::time::Duration::from_secs(5)));
    // The date form needs a clock both ends agree on, so it is not read and the backoff answers instead.
    let dated = HttpResponse {
        status: 503,
        headers: vec![(
            "retry-after".to_string(),
            "Wed, 21 Oct 2026 07:28:00 GMT".to_string(),
        )],
        body: Vec::new(),
    };
    assert_eq!(retry_after(&dated), None);

    assert_eq!(HTTP_ATTEMPTS, 4);
}

/// Jitter takes something off, so a hundred requests refused in one second do not all come back in one second. Without the floor the shave is zero whenever the clock's nanoseconds land on a multiple of the half, which returns the whole capped wait and fails this claim about one run in eighty.
#[test]
fn the_wait_before_a_retry_is_never_the_whole_ceiling() {
    use crate::platform::{backoff, HTTP_BACKOFF_CEILING};

    for attempt in 0..=12u32 {
        let capped = std::time::Duration::from_secs(1u64 << attempt).min(HTTP_BACKOFF_CEILING);
        let wait = backoff(attempt);
        assert!(wait < capped, "attempt {attempt}: {wait:?} of {capped:?}");
    }
}

/// Both halves get their response headers a different way and neither should be reading them twice.
#[test]
fn a_response_header_is_found_however_the_service_spelled_it() {
    use crate::platform::{parse_header_block, HttpResponse};

    let headers = parse_header_block(
        "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nX-RateLimit-Remaining: 0\r\nETag: \"abc:123\"\r\n\r\n",
    );
    let response = HttpResponse {
        status: 429,
        headers,
        body: Vec::new(),
    };

    // The status line is not a header, and a name is found whatever case it arrived in.
    assert_eq!(response.header("retry-after"), Some("30"));
    assert_eq!(response.header("Retry-After"), Some("30"));
    assert_eq!(response.header("x-ratelimit-remaining"), Some("0"));
    // A value may hold a colon of its own, so only the first one splits the line.
    assert_eq!(response.header("etag"), Some("\"abc:123\""));
    assert_eq!(response.header("nothing-sent"), None);
    assert_eq!(response.headers.len(), 3);
    assert_eq!(response.status, 429);
    assert!(response.body.is_empty());
}

// ---------------------------------------------------------------------------
// Signing a vault in, and where the token is kept
// ---------------------------------------------------------------------------

/// The whole of the sign-in this machine can drive: a port the OS picked, a browser coming back to it, the code read out, and the port closed behind it. What cannot be tested here is the consent screen — that needs a real browser, a real service and a real account.
#[test]
fn a_sign_in_takes_one_request_on_a_loopback_port_and_then_gives_it_up() {
    use std::io::{Read, Write};

    let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");

    // The address handed to the service is on this machine and nowhere else, and the port is one the OS chose rather than one anything could be sitting on waiting to catch somebody's code.
    assert!(
        redirect_uri.starts_with("http://127.0.0.1:"),
        "{redirect_uri}"
    );
    let port = listener.local_addr().expect("readable").port();
    assert!(port > 0);
    assert!(redirect_uri.contains(&port.to_string()));

    let waiting =
        std::thread::spawn(move || await_sign_in(listener, redirect_uri, SIGN_IN_READ_TIMEOUT));

    // What a browser does when the consent screen sends it back. The favicon first, which is not the answer and must not end the wait.
    let mut ignored = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    ignored
        .write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .expect("asks");
    let mut brushed_off = String::new();
    ignored
        .read_to_string(&mut brushed_off)
        .expect("is answered too");
    assert!(brushed_off.starts_with("HTTP/1.1 200"), "{brushed_off}");

    let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    browser
        .write_all(
            b"GET /?state=xyz&code=a%2Bcode%20with+spaces HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .expect("comes back");
    let mut answered = String::new();
    browser.read_to_string(&mut answered).expect("is answered");

    // The tab is not left blank, which after a consent screen reads as a sign-in that failed.
    assert!(answered.starts_with("HTTP/1.1 200"), "{answered}");
    assert!(answered.contains("signed in"), "{answered}");

    let answer = waiting.join().expect("the wait ends").expect("a code");
    // Read out of the query, and unescaped the two ways a redirect actually escapes.
    assert_eq!(answer.code, "a+code with spaces");
    assert!(answer.redirect_uri.contains(&port.to_string()));

    // And the port is gone with the listener, so nothing else on the machine can go on talking to it.
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}

/// The page saying you are signed in reaches the browser whole, every time. A socket closed with bytes of the request still unread is reset rather than closed, and the reset throws away what was written but not yet read. The headers are sent a moment after the request line here, which is the arrival order that leaves them unread — sent together they land in one read and the fault hides — and repeated, so nothing survives on luck.
#[test]
fn the_page_saying_you_are_signed_in_is_never_lost_to_a_reset() {
    use std::io::{Read, Write};

    /// Long enough that the request line is read on its own, short enough to stay well inside the sign-in's own read timeout.
    const APART: Duration = Duration::from_millis(20);

    for round in 0..10 {
        let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");
        let port = listener.local_addr().expect("readable").port();
        let waiting =
            std::thread::spawn(move || await_sign_in(listener, redirect_uri, SIGN_IN_READ_TIMEOUT));

        // The favicon goes down the same path and is answered the same way, so it is held here too.
        let mut ignored = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
        ignored
            .write_all(b"GET /favicon.ico HTTP/1.1\r\n")
            .expect("asks");
        std::thread::sleep(APART);
        ignored
            .write_all(b"Host: 127.0.0.1\r\nAccept: image/png\r\n\r\n")
            .expect("goes on");
        std::thread::sleep(APART);
        // Read as bytes and kept even when the read ends badly: the failure this covers is an empty answer, and a reader that throws away what did arrive cannot tell that apart from a short one.
        let mut arrived = Vec::new();
        let outcome = ignored.read_to_end(&mut arrived);
        let brushed_off = String::from_utf8_lossy(&arrived).to_string();
        outcome.unwrap_or_else(|error| panic!("round {round}: {error} after {brushed_off:?}"));
        assert!(
            brushed_off.contains("try again"),
            "round {round}: {brushed_off}"
        );

        let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
        browser
            .write_all(b"GET /?code=abc123 HTTP/1.1\r\n")
            .expect("comes back");
        std::thread::sleep(APART);
        browser
            .write_all(b"Host: 127.0.0.1\r\nUser-Agent: a browser\r\nAccept: text/html\r\nConnection: close\r\n\r\n")
            .expect("goes on");
        std::thread::sleep(APART);
        let mut arrived = Vec::new();
        let outcome = browser.read_to_end(&mut arrived);
        let answered = String::from_utf8_lossy(&arrived).to_string();
        outcome.unwrap_or_else(|error| panic!("round {round}: {error} after {answered:?}"));

        // Whole, not merely started: the reset this covers cuts the answer off wherever it had got to.
        assert!(
            answered.ends_with("You are signed in. Close this tab and go back to Leaftext."),
            "round {round}: {answered}"
        );

        let answer = waiting.join().expect("the wait ends").expect("a code");
        assert_eq!(answer.code, "abc123");
    }
}

/// Reading the rest of the request stops somewhere. The read's timeout is per read, so a client that keeps sending header lines and never sends the blank one would otherwise hold the port for as long as it kept typing; the sign-in gives up on the headers and answers, because the code was already out of the request line.
#[test]
fn a_sign_in_stops_reading_headers_rather_than_letting_a_client_hold_the_port() {
    use std::io::Write;

    let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");
    let port = listener.local_addr().expect("readable").port();
    let waiting =
        std::thread::spawn(move || await_sign_in(listener, redirect_uri, SIGN_IN_READ_TIMEOUT));

    let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    browser
        .write_all(b"GET /?code=abc123 HTTP/1.1\r\n")
        .expect("comes back");
    let started = std::time::Instant::now();
    // Far past the bound, and no blank line ever, so nothing but the bound can end the read. A write that fails is the sign-in having already given up and closed, which is the thing being asked for.
    for line in 0..200 {
        if browser
            .write_all(format!("X-Padding-{line}: and on it goes\r\n").as_bytes())
            .is_err()
        {
            break;
        }
    }

    let answer = waiting.join().expect("the wait ends").expect("a code");
    assert_eq!(answer.code, "abc123");
    // Well inside the ten seconds a read of its own is given, which is what the wait would have cost with nothing bounding it.
    assert!(started.elapsed() < Duration::from_secs(3), "{started:?}");
}

/// A connection that opens and says nothing is not the answer either, and must not end the sign-in. Browsers open connections on speculation and send nothing down them, and a loopback port is one anything on the machine can touch; the person is still reading the consent screen while it happens, and their browser then comes back to a port that is gone. The read timeout is handed in here so the silence costs the test a moment rather than the ten seconds the app gives it.
#[test]
fn a_connection_that_says_nothing_does_not_end_the_sign_in() {
    use std::io::{Read, Write};

    /// Long enough that the silent connection really is read and given up on, short enough that the test does not wait on it.
    const SAYS_NOTHING_FOR: Duration = Duration::from_millis(150);

    let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");
    let port = listener.local_addr().expect("readable").port();
    let waiting =
        std::thread::spawn(move || await_sign_in(listener, redirect_uri, SAYS_NOTHING_FOR));

    // Opened and held: never written to and never closed, which is what a speculative connection looks like. Closing it would be the case already covered — an empty read, the try-again page, and the wait goes on.
    let silent = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");

    // The person finishes on the consent screen while that one is still sitting there, so their real request is behind it.
    let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    browser
        .write_all(b"GET /?code=abc123 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .expect("comes back");
    let mut answered = String::new();
    browser.read_to_string(&mut answered).expect("is answered");

    // The page still arrives, so the browser is not left on a blank tab after a consent screen.
    assert!(answered.starts_with("HTTP/1.1 200"), "{answered}");
    assert!(answered.contains("signed in"), "{answered}");

    let answer = waiting.join().expect("the wait ends").expect("a code");
    assert_eq!(answer.code, "abc123");

    drop(silent);
    // And the port is given up behind the answer, exactly as it is when nothing silent ever arrived.
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}

/// Only a `code` is a code, and a consent screen that came back with something else is not one.
#[test]
fn only_a_code_is_read_out_of_what_the_browser_comes_back_with() {
    assert_eq!(
        code_from_target("/?code=abc123"),
        Some("abc123".to_string())
    );
    assert_eq!(
        code_from_target("/?state=xyz&code=abc123"),
        Some("abc123".to_string())
    );
    // A refusal carries no code, and neither does a plain request.
    assert_eq!(code_from_target("/?error=access_denied"), None);
    assert_eq!(code_from_target("/favicon.ico"), None);
    assert_eq!(code_from_target("/"), None);
    assert_eq!(code_from_target("/?code="), None);
}

/// A token goes in the machine's own credential store, and nothing the app writes to disk holds one. `src/git.rs` avoids this problem by leaning on a git that already knows the user; nothing else does, so this is the first credential the app keeps and the store is the OS's.
#[test]
fn a_token_reaches_the_credential_store_and_no_file_the_app_writes() {
    let service = format!("leaftext-test-vault-{}", std::process::id());
    let account = "reader@example.com";
    let token = format!("a-refresh-token-{}", std::process::id());

    // Signed out is an answer rather than a failure: it is what a vault nobody signed into looks like.
    crate::platform::forget_secret(&service, account).expect("forgetting nothing is fine");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        None
    );

    crate::platform::store_secret(&service, account, &token).expect("kept");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        Some(token.clone())
    );
    // Signing in again replaces it, so the one before is not left behind.
    let second = format!("{token}-again");
    crate::platform::store_secret(&service, account, &second).expect("kept");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        Some(second.clone())
    );

    // Nothing in either of the two folders the app writes holds it. These are the folders that end up in every backup, every sync client and every crash report.
    for root in [
        config_file_path().and_then(|p| p.parent().map(Path::to_path_buf)),
        app_data_dir(),
    ]
    .into_iter()
    .flatten()
    {
        let found = files_holding(&root, &second, 0);
        assert!(found.is_empty(), "a token was written to {found:?}");
    }

    crate::platform::forget_secret(&service, account).expect("forgotten");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        None
    );
    // And forgetting one that has already gone is not a failure either.
    crate::platform::forget_secret(&service, account).expect("forgetting twice is fine");
}

/// Every file under `root` whose bytes hold `needle`. Depth-capped so a WebView2 cache cannot turn a test into a crawl.
fn files_holding(root: &Path, needle: &str, depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if depth > 4 {
        return found;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(files_holding(&path, needle, depth + 1));
        } else if fs::read(&path)
            .map(|bytes| find_bytes(&bytes, needle.as_bytes()))
            .unwrap_or(false)
        {
            found.push(path);
        }
    }
    found
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    needle.len() <= haystack.len()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// The name a vault's token is kept under is the row id, so renaming a vault or pointing it at another folder does not orphan the credential.
#[test]
fn a_vault_s_token_is_named_after_the_row_and_not_the_vault_s_name() {
    assert_eq!(vault_secret_service(7), "leaftext-vault-7");
    assert_ne!(vault_secret_service(7), vault_secret_service(8));
}

// ---------------------------------------------------------------------------
// Keeping a remote vault's copy up to date
// ---------------------------------------------------------------------------

/// A refresh runs off the loop, so the vault it was about can be removed or pointed somewhere else before it lands. It is thrown away then, the way a folder read and a corpus read already are — the alternative is a panel reporting a folder nobody is reading, or a mirror that has already been deleted.
#[test]
fn a_refresh_that_outlived_its_vault_is_thrown_away() {
    let mirror = PathBuf::from("C:").join("data").join("remote").join("7");
    let elsewhere = PathBuf::from("C:").join("data").join("remote").join("8");

    // Still the same folder: the pass is about the vault the app has.
    assert!(refresh_still_lands(Some(&mirror), &mirror));
    // Pointed at another folder while the pass ran.
    assert!(!refresh_still_lands(Some(&elsewhere), &mirror));
    // Removed while the pass ran, so there is no row and no mirror left to be about.
    assert!(!refresh_still_lands(None, &mirror));
}

/// A pass writes its own mirror, and every one of those writes reaches the watcher. Phase 0 measured 2,020 events for a 2,000-file folder, and the loop spends a thread on `git status` for each one before it decides anything — so the app's own writes are dropped while the pass that made them is running, and somebody's own editing is not.
#[test]
fn the_watcher_ignores_a_refresh_writing_its_own_mirror_and_nothing_else() {
    let mirror = PathBuf::from("C:").join("data").join("remote").join("7");
    let mut book = RefreshBook::default();

    // Nothing running: every change is somebody's.
    assert!(!book.is_our_own_write(&mirror.join("note.md")));

    book.begin(7, mirror.clone());
    assert!(book.is_our_own_write(&mirror.join("note.md")));
    assert!(book.is_our_own_write(&mirror.join("folder").join("deep.md")));
    // A vault the pass is not touching goes on live-reloading while it runs.
    assert!(!book.is_our_own_write(Path::new("C:").join("Notes").join("today.md").as_path()));
    assert!(book.is_busy(7));

    book.end(
        7,
        &mirror,
        VaultRemoteState {
            id: 7,
            ..VaultRemoteState::default()
        },
    );
    // And the moment it is over, an edit inside the mirror is somebody's again.
    assert!(!book.is_our_own_write(&mirror.join("note.md")));
    assert!(!book.is_busy(7));
}

/// A source that keeps refusing is left alone rather than asked harder: a rate limit answers in lockouts, not in slow. Pressing Refresh wakes it, because whoever pressed it knows something the app does not.
#[test]
fn a_source_that_keeps_refusing_is_left_alone_until_someone_asks() {
    let mut book = RefreshBook::default();

    for _ in 0..2 {
        book.record_outcome(4, true);
        assert!(!book.is_resting(4), "rested too early");
    }
    book.record_outcome(4, true);
    assert!(book.is_resting(4));

    // The panel's Refresh clears it.
    book.wake(4);
    assert!(!book.is_resting(4));

    // And one pass that works clears it too, so a moment of no network does not cost the rest of the session.
    book.record_outcome(4, true);
    book.record_outcome(4, true);
    book.record_outcome(4, true);
    assert!(book.is_resting(4));
    book.record_outcome(4, false);
    assert!(!book.is_resting(4));

    // Each vault keeps its own count: one service being down does not stop the others being asked.
    book.record_outcome(5, true);
    book.record_outcome(5, true);
    book.record_outcome(5, true);
    assert!(book.is_resting(5));
    assert!(!book.is_resting(4));
}
