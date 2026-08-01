//! Update staging: what may be downloaded, kept, and installed.

use super::*;

/// A scratch data directory, named per test so parallel runs cannot collide.
fn update_test_dir(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-update-{name}-{unique}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch data directory");
    dir
}

#[test]
fn version_comparison_ignores_v_prefix_and_compares_numerically() {
    assert!(is_newer_version("v0.1.362", "0.1.361"));
    assert!(is_newer_version("0.2.0", "0.1.999"));
    // Not lexicographic: 370 beats 69.
    assert!(is_newer_version("0.1.370", "0.1.69"));
    assert!(!is_newer_version("0.1.361", "0.1.361"));
    assert!(!is_newer_version("0.1.360", "0.1.361"));
    // Missing segments read as zero, so an equal shorter prefix is not newer.
    assert!(!is_newer_version("0.1", "0.1.0"));
    assert!(is_newer_version("0.1.1", "0.1"));
    // Garbage must not read as newer, or a malformed release would prompt.
    assert!(!is_newer_version("banana", "0.1.361"));
}

#[test]
fn update_checks_are_throttled_but_never_wedged() {
    let now = 1_780_000_000;
    assert!(update_check_is_due(0, now));
    assert!(!update_check_is_due(now - 60, now));
    assert!(!update_check_is_due(now, now));
    assert!(update_check_is_due(now - UPDATE_CHECK_INTERVAL_SECS, now));
    // A clock that jumped backwards, or a settings value from the future, must
    // read as due rather than blocking every future check forever.
    assert!(update_check_is_due(now + 10_000, now));
}

#[test]
fn only_github_https_urls_may_be_downloaded() {
    // What a real release hands us: the asset URL, and the storage host it
    // redirects to.
    assert!(update_url_is_allowed(
        "https://github.com/ryanallen/leaftext/releases/download/v0.1.373/leaftext-v0.1.373-windows-x86_64.msi"
    ));
    assert!(update_url_is_allowed(
        "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=abc"
    ));
    assert!(update_url_is_allowed(
        "https://objects.githubusercontent.com/anything"
    ));

    // The URL reaches Rust from a network response by way of the page, and is
    // handed to a native client with no same-origin rule behind it. Plain HTTP
    // would hand the installer to anyone on the path.
    assert!(!update_url_is_allowed(
        "http://github.com/ryanallen/leaftext/releases/download/v1/x.msi"
    ));
    assert!(!update_url_is_allowed("https://example.com/x.msi"));
    // A lookalike host must not pass on a suffix match alone.
    assert!(!update_url_is_allowed(
        "https://evilgithubusercontent.com/x"
    ));
    assert!(!update_url_is_allowed(
        "https://githubusercontent.com.evil.test/x"
    ));
    assert!(!update_url_is_allowed("https://notgithub.com/x.msi"));
    // Neither a non-web scheme nor unparseable junk is a download.
    assert!(!update_url_is_allowed("file:///C:/Windows/System32/x.msi"));
    assert!(!update_url_is_allowed("not a url at all"));
    assert!(!update_url_is_allowed(""));
}

#[test]
fn a_verified_download_is_staged_and_readable_afterwards() {
    let data_dir = update_test_dir("staged");
    let payload = b"pretend this is a 6 MB installer".repeat(64);
    let digest = blake3_hex(&payload);

    let mut download = UpdateDownload::begin(
        &data_dir,
        "v0.1.362",
        "leaftext-v0.1.362-windows-x86_64.msi",
        payload.len() as u64,
    )
    .expect("download opens");

    // Delivered in pieces, the way the page streams it.
    for chunk in payload.chunks(100) {
        download.write_chunk(chunk).expect("chunk accepted");
    }
    let staged = download.finish().expect("download verifies");

    assert_eq!(staged.version, "0.1.362", "the v prefix is stripped");
    assert_eq!(staged.blake3, digest);
    assert_eq!(staged.size, payload.len() as u64);

    // The installer sits at its final name, with no .part left behind.
    let installer = staged.installer_path(&data_dir);
    assert_eq!(fs::read(&installer).expect("installer readable"), payload);
    assert!(!staging_dir(&data_dir, "0.1.362")
        .join("leaftext-v0.1.362-windows-x86_64.msi.part")
        .exists());

    // And a later launch can find it from the manifest alone.
    let reread = read_staged(&data_dir, "0.1.362").expect("manifest round trips");
    assert_eq!(reread, staged);
    assert_eq!(hash_file(&installer).expect("rehash"), digest);

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_staged_installer_altered_on_disk_is_caught_before_it_runs() {
    // Releases publish no checksum, so nothing compares the download against a
    // published digest. What the manifest digest is for is this: the installer
    // sits in a user-writable folder until the user clicks, and the applier
    // re-hashes it before handing it to the installer program.
    let data_dir = update_test_dir("altered");
    let payload = b"the installer that was downloaded".to_vec();

    let mut download = UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext-v0.1.362-windows-x86_64.msi",
        payload.len() as u64,
    )
    .expect("download opens");
    download.write_chunk(&payload).expect("chunk accepted");
    let staged = download.finish().expect("download stages");

    let installer = staged.installer_path(&data_dir);
    fs::write(&installer, b"something else entirely, same length").expect("tamper");
    assert_ne!(
        hash_file(&installer).expect("rehash"),
        staged.blake3,
        "the applier's re-hash must not match after the file changed"
    );

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_truncated_download_is_refused() {
    let data_dir = update_test_dir("short");
    let payload = b"only the first half".to_vec();

    let mut download = UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext.msi",
        payload.len() as u64 + 100,
    )
    .expect("download opens");
    download.write_chunk(&payload).expect("chunk accepted");

    let error = download.finish().expect_err("short download is refused");
    assert!(
        error.contains("stopped early"),
        "unhelpful message: {error}"
    );
    assert!(read_staged(&data_dir, "0.1.362").is_none());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_download_may_not_grow_past_its_advertised_size() {
    let data_dir = update_test_dir("oversize");
    let mut download =
        UpdateDownload::begin(&data_dir, "0.1.362", "leaftext.msi", 4).expect("download opens");

    assert!(download.write_chunk(b"aaaa").is_ok());
    let error = download
        .write_chunk(b"and then some more")
        .expect_err("overrun is refused");
    assert!(error.contains("larger"), "unhelpful message: {error}");

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn release_metadata_cannot_escape_the_staging_folder() {
    let data_dir = update_test_dir("traversal");

    // A hostile or broken tag_name becomes a directory name, so separators and
    // dot segments must not survive into it.
    let staging = staging_dir(&data_dir, "../../evil");
    assert!(
        staging.starts_with(updates_dir(&data_dir)),
        "escaped to {}",
        staging.display()
    );

    // Asset names become file names in that folder, and are rejected outright
    // rather than rewritten: a name we had to launder is a bad sign by itself.
    for hostile in [
        "../outside.msi",
        "..\\outside.msi",
        "sub/dir.msi",
        ".hidden",
        "",
    ] {
        assert!(
            UpdateDownload::begin(&data_dir, "0.1.362", hostile, 1).is_err(),
            "accepted asset name {hostile:?}"
        );
    }

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn an_absurd_download_size_is_refused() {
    let data_dir = update_test_dir("huge");
    assert!(UpdateDownload::begin(&data_dir, "0.1.362", "a.msi", 0).is_err());
    assert!(UpdateDownload::begin(&data_dir, "0.1.362", "a.msi", MAX_UPDATE_BYTES + 1).is_err());
    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_release_publishes_one_installable_file_per_platform() {
    // The release page is two downloads and nothing else: no checksum files, no
    // archive published only for the updater. What the updater fetches is exactly
    // what a person downloads by hand, which is why nobody has to be told what an
    // extra file is for.
    let suffix = platform_asset_suffix();
    #[cfg(windows)]
    assert_eq!(suffix, "-windows-x86_64.msi");
    #[cfg(target_os = "macos")]
    assert_eq!(suffix, "-macos-universal.dmg");
    assert!(
        !suffix.contains("blake3") && !suffix.contains(".app.zip"),
        "the updater must install the file people download: {suffix}"
    );
}

#[test]
fn pruning_keeps_only_the_pending_version() {
    let data_dir = update_test_dir("prune");
    for version in ["0.1.358", "0.1.359", "0.1.362"] {
        fs::create_dir_all(staging_dir(&data_dir, version)).expect("staging folder");
    }

    prune_staged(&data_dir, Some("0.1.362"));
    let left: Vec<_> = fs::read_dir(updates_dir(&data_dir))
        .expect("updates folder")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(left, vec!["0.1.362".to_string()]);

    // Nothing pending clears the lot, which is what runs after an update lands
    // and takes the leftover helper copy with it.
    prune_staged(&data_dir, None);
    assert_eq!(
        fs::read_dir(updates_dir(&data_dir))
            .expect("updates folder")
            .count(),
        0
    );

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn the_applier_verdict_survives_pruning_and_is_read_once() {
    let data_dir = update_test_dir("applyoutcome");
    let staging = staging_dir(&data_dir, "0.1.400");
    fs::create_dir_all(&staging).expect("staging folder");

    record_apply_outcome(
        &staging,
        "0.1.400",
        Some("the installer failed with code 1603"),
    );

    // The record lives beside the staging folders, and the launch that reports it
    // prunes them first — so pruning must leave it alone or the failure is lost.
    prune_staged(&data_dir, None);

    let outcome = take_apply_outcome(&data_dir).expect("the verdict survives pruning");
    assert!(!outcome.ok);
    assert_eq!(outcome.version, "0.1.400");
    assert!(outcome.message.contains("1603"));

    // Read once: reporting the same failed install on every launch afterwards
    // would be a lie from the second time on.
    assert!(take_apply_outcome(&data_dir).is_none());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_successful_install_records_no_failure() {
    let data_dir = update_test_dir("applyok");
    let staging = staging_dir(&data_dir, "0.1.400");
    fs::create_dir_all(&staging).expect("staging folder");

    record_apply_outcome(&staging, "0.1.400", None);
    let outcome = take_apply_outcome(&data_dir).expect("a verdict either way");
    assert!(outcome.ok);
    assert!(outcome.message.is_empty());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn the_applier_s_verdict_never_reaches_the_page() {
    // It goes to stderr and nowhere else. A reader can do nothing about a failed
    // install — the next check retries it — so the panel stays quiet.
    assert!(!app_shell_html().contains("__leafUpdateApply"));
}

#[test]
fn a_staged_record_without_its_installer_reads_as_nothing_staged() {
    let data_dir = update_test_dir("halfdeleted");
    let payload = b"installer".to_vec();
    let mut download =
        UpdateDownload::begin(&data_dir, "0.1.362", "leaftext.msi", payload.len() as u64)
            .expect("download opens");
    download.write_chunk(&payload).expect("chunk accepted");
    let staged = download.finish().expect("download verifies");

    // Someone clearing out AppData must not leave the button offering a restart
    // that cannot happen.
    fs::remove_file(staged.installer_path(&data_dir)).expect("remove installer");
    assert!(read_staged(&data_dir, "0.1.362").is_none());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn the_app_shell_reaches_the_release_api_and_nothing_else() {
    // The page fetches release metadata and nothing more: the installer is
    // downloaded natively, because the host GitHub redirects assets to sends no
    // CORS header and no policy here can make that fetch succeed. Granting the
    // asset hosts anyway would widen where the page may talk for no gain.
    let html = app_shell_html();
    let csp_line = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy");
    let connect_src = csp_line
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("connect-src"))
        .expect("CSP declares an explicit connect-src directive");
    assert!(
        connect_src.contains("https://api.github.com"),
        "connect-src must allow the release API: {connect_src}"
    );
    for host in ["https://github.com", "githubusercontent.com"] {
        assert!(
            !connect_src.contains(host),
            "the page no longer fetches installers, so {host} should be gone: {connect_src}"
        );
    }
}

#[test]
fn download_progress_reaches_the_page_as_a_percentage() {
    let script = update_progress_script("0.1.373", 42);
    assert!(script.starts_with("window.leafUpdateState({"));
    assert!(script.contains(r#""status":"downloading""#));
    assert!(script.contains(r#""version":"0.1.373""#));
    assert!(script.contains(r#""percent":42"#));
}

#[test]
fn the_page_is_told_which_installer_this_build_takes() {
    let script = initial_update_script();
    assert!(script.starts_with("window.__leafUpdateAsset = "));
    assert!(script.contains(platform_asset_suffix()));

    // The suffix has to match what the release workflow actually publishes; see
    // `a_release_publishes_one_installable_file_per_platform`.
}
