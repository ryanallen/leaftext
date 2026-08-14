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
    // A clock that jumped backwards, or a settings value from the future, must read as due rather than blocking every future check forever.
    assert!(update_check_is_due(now + 10_000, now));
}

#[test]
fn only_github_https_urls_may_be_downloaded() {
    // What a real release hands us: the asset URL, and the storage host it redirects to.
    assert!(update_url_is_allowed(
        "https://github.com/ryanallen/leaftext/releases/download/v0.1.373/leaftext-v0.1.373-windows-x86_64.msi"
    ));
    assert!(update_url_is_allowed(
        "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=abc"
    ));
    assert!(update_url_is_allowed(
        "https://objects.githubusercontent.com/anything"
    ));

    // The URL reaches Rust from a network response by way of the page, and is handed to a native client with no same-origin rule behind it. Plain HTTP would hand the installer to anyone on the path.
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
    // Releases publish no checksum, so nothing compares the download against a published digest. What the manifest digest is for is this: the installer sits in a user-writable folder until the user clicks, and the applier re-hashes it before handing it to the installer program.
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

    // A hostile or broken tag_name becomes a directory name, so separators and dot segments must not survive into it.
    let staging = staging_dir(&data_dir, "../../evil");
    assert!(
        staging.starts_with(updates_dir(&data_dir)),
        "escaped to {}",
        staging.display()
    );

    // Asset names become file names in that folder, and are rejected outright rather than rewritten: a name we had to launder is a bad sign by itself.
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
fn every_published_file_is_an_installer_a_person_can_run() {
    // No checksum files and no archive published only for the updater: what the updater fetches is exactly what somebody downloads by hand, which is why nobody has to be told what an extra file is for. Windows publishes two because one of them is refused by policy on some machines, and both are installers.
    let windows = release_windows_workflow();
    for suffix in [WINDOWS_MSI_SUFFIX, WINDOWS_EXE_SUFFIX] {
        assert!(
            windows.contains(&format!(
                "windows-x86_64{}",
                &suffix["-windows-x86_64".len()..]
            )),
            "release-windows.yml does not upload {suffix}"
        );
    }
    assert!(
        !windows.contains("blake3") && !windows.contains(".zip") && !windows.contains("sha256"),
        "release-windows.yml publishes something that is not an installer"
    );

    let macos = include_str!("../../.github/workflows/release-distributions.yml");
    assert!(macos.contains(&MACOS_SUFFIX["-macos-".len()..]));

    // Every uploaded name is exactly `leaftext` and the updater's own suffix, with no version in it, because the landing page's buttons are fixed addresses under releases/latest/download and a name carrying the tag moves out from under them every release.
    for (workflow, file, suffix) in [
        (windows, "release-windows.yml", WINDOWS_MSI_SUFFIX),
        (windows, "release-windows.yml", WINDOWS_EXE_SUFFIX),
        (macos, "release-distributions.yml", MACOS_SUFFIX),
    ] {
        assert!(
            workflow.contains(&format!("\"dist/leaftext{suffix}\"")),
            "{file} does not upload dist/leaftext{suffix} under that exact name"
        );
    }

    // The Windows names are built by a script the workflow calls, so the two have to agree or the upload finds nothing.
    let build = include_str!("../../scripts/build-windows-release.ps1");
    for suffix in [WINDOWS_MSI_SUFFIX, WINDOWS_EXE_SUFFIX] {
        let extension = suffix
            .rsplit_once('.')
            .expect("a suffix names a file type")
            .1;
        assert!(
            build.contains(&format!("\"leaftext-windows-$arch.{extension}\"")),
            "build-windows-release.ps1 does not build leaftext{suffix}"
        );
    }

    assert_eq!(platform_asset_suffix(), {
        #[cfg(target_os = "macos")]
        {
            MACOS_SUFFIX
        }
        // Windows is not this function's to answer, and a browser has nothing to install.
        #[cfg(not(target_os = "macos"))]
        {
            ""
        }
    });
}

/// The uploader's own list of assets, out of the Windows release workflow.
fn release_windows_workflow() -> &'static str {
    include_str!("../../.github/workflows/release-windows.yml")
}

/// Where a fixed download address starts. GitHub resolves `latest` to the newest release and serves the asset with `content-disposition: attachment`, so a click saves the file and the page it was clicked from stays put.
const FIXED_DOWNLOAD: &str = "https://github.com/ryanallen/leaftext/releases/latest/download/";

#[test]
fn the_front_page_buttons_are_the_files_themselves() {
    // A visitor who has decided to try it should get the installer, not a listing of five files to choose from. So every button address is one file, at an address no release moves.
    let readme = include_str!("../../README.md");
    for (label, suffix) in [
        ("Download for Windows", WINDOWS_EXE_SUFFIX),
        ("Download for macOS", MACOS_SUFFIX),
    ] {
        assert!(
            readme.contains(&format!("[{label}]({FIXED_DOWNLOAD}leaftext{suffix})")),
            "the README's {label} button does not point at {FIXED_DOWNLOAD}leaftext{suffix}"
        );
    }

    // The MSI keeps a link rather than a button: both files lay down the same install, and the one a machine's policy can refuse is not the one the front page hands out.
    assert!(readme.contains(&format!("{FIXED_DOWNLOAD}leaftext{WINDOWS_MSI_SUFFIX}")));
    assert!(
        !readme.contains(&format!(
            "[Download for Windows]({FIXED_DOWNLOAD}leaftext{WINDOWS_MSI_SUFFIX})"
        )),
        "the Windows button hands out the .msi, which a policy box can refuse outright"
    );

    // Nothing on that page is a badge fetched from somewhere else: the button the app draws from a document is the app's own.
    assert!(
        !readme.contains("img.shields.io"),
        "the README still wears somebody else's badge"
    );
}

#[test]
fn no_page_sends_a_reader_to_the_release_listing_to_find_their_file() {
    // Every place a person was handed a page of five files to read is the file itself now. The one listing link left is named as one, under the buttons, for somebody who wants to see every file.
    const LISTING: &str = "https://github.com/ryanallen/leaftext/releases";
    let readme = include_str!("../../README.md");
    let install = include_str!("../../docs/02-installation.md");
    let landing = include_str!("../../index.html");

    let mut listings = 0;
    for (name, page) in [
        ("README.md", readme),
        ("docs/02-installation.md", install),
        ("index.html", landing),
    ] {
        for (at, _) in page.match_indices(LISTING) {
            let rest = &page[at + LISTING.len()..];
            if rest.starts_with("/latest/download/") {
                continue;
            }
            listings += 1;
            assert!(
                name == "README.md" && rest.starts_with("/latest)"),
                "{name} still sends a reader to the release listing at {LISTING}{}",
                &rest[..rest.len().min(24)]
            );
        }
    }
    assert_eq!(listings, 1, "the one named All releases link is missing");
    assert!(readme.contains(&format!("[All releases]({LISTING}/latest)")));

    // The landing page's structured data offers the same file the Windows button does, rather than the listing.
    assert!(landing.contains(&format!(
        r#""downloadUrl": "{FIXED_DOWNLOAD}leaftext{WINDOWS_EXE_SUFFIX}""#
    )));
}

#[test]
fn the_installation_page_names_every_file_a_release_publishes() {
    // A reader stopped by the policy box has to find the other download on the page they are already on, and a suffix the page never mentions is a download nobody knows exists.
    let page = include_str!("../../docs/02-installation.md");
    for suffix in [WINDOWS_MSI_SUFFIX, WINDOWS_EXE_SUFFIX, MACOS_SUFFIX] {
        let extension = suffix
            .rsplit_once('.')
            .expect("a suffix names a file type")
            .1;
        assert!(
            page.contains(&format!("`.{extension}`")),
            "docs/02-installation.md never mentions a .{extension}"
        );
    }
    assert!(
        page.contains("policies to prevent this installation"),
        "the page does not say what the box a reader is stopped by actually reads"
    );
}

#[test]
fn a_copy_updates_through_the_installer_that_put_it_there() {
    // Nobody chooses this and no setting holds it. The EXE installer writes the marker; the MSI writes nothing, because a copy the MSI put there has nothing at that value and has to keep taking the MSI.
    assert_eq!(windows_asset_suffix(Some("exe")), WINDOWS_EXE_SUFFIX);
    assert_eq!(windows_asset_suffix(Some(" EXE ")), WINDOWS_EXE_SUFFIX);
    assert_eq!(windows_asset_suffix(None), WINDOWS_MSI_SUFFIX);
    assert_eq!(windows_asset_suffix(Some("")), WINDOWS_MSI_SUFFIX);
    assert_eq!(windows_asset_suffix(Some("msi")), WINDOWS_MSI_SUFFIX);
    // Anything else in that value is not a promise the release page can keep, so it reads as the file every copy could already take.
    assert_eq!(
        windows_asset_suffix(Some("something else")),
        WINDOWS_MSI_SUFFIX
    );

    // The value the EXE installer actually writes has to be the one this reads.
    let plan = include_str!("../../installer/src/plan.rs");
    assert!(plan.contains(r#"INSTALLED_BY_VALUE: &str = "InstalledBy""#));
    assert!(plan.contains(r#"INSTALLED_BY_EXE: &str = "exe""#));
    assert!(plan.contains(r#"APP_KEY: &str = r"Software\ryanallen\leaftext""#));
}

#[test]
fn the_installers_exit_codes_mean_what_the_installer_says_they_mean() {
    // The app reads a number off a program that has already gone silent, so the two sides have to agree on the list. This is the list, read out of the installer rather than remembered.
    let exits = include_str!("../../installer/src/exit.rs");
    for (name, code) in [
        ("OK", 0),
        ("FAILED", 1),
        ("IN_USE", 2),
        ("NO_PAYLOAD", 3),
        ("BAD_ARGUMENTS", 4),
    ] {
        assert!(
            exits.contains(&format!("pub const {name}: i32 = {code};")),
            "installer/src/exit.rs no longer says {name} is {code}"
        );
    }
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

    // Nothing pending clears the lot, which is what runs after an update lands and takes the leftover helper copy with it.
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

    // The record lives beside the staging folders, and the launch that reports it prunes them first — so pruning must leave it alone or the failure is lost.
    prune_staged(&data_dir, None);

    let outcome = take_apply_outcome(&data_dir).expect("the verdict survives pruning");
    assert!(!outcome.ok);
    assert_eq!(outcome.version, "0.1.400");
    assert!(outcome.message.contains("1603"));

    // Read once: reporting the same failed install on every launch afterwards would be a lie from the second time on.
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
    // It goes to stderr and nowhere else. A reader can do nothing about a failed install — the next check retries it — so the panel stays quiet.
    assert!(!app_shell_page().contains("__leafUpdateApply"));
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

    // Someone clearing out AppData must not leave the button offering a restart that cannot happen.
    fs::remove_file(staged.installer_path(&data_dir)).expect("remove installer");
    assert!(read_staged(&data_dir, "0.1.362").is_none());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn the_app_shell_reaches_the_release_api_and_nothing_else() {
    // The page fetches release metadata and nothing more: the installer is downloaded natively, because the host GitHub redirects assets to sends no CORS header and no policy here can make that fetch succeed. Granting the asset hosts anyway would widen where the page may talk for no gain.
    let html = app_shell_page();
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
fn the_page_is_told_which_installer_this_copy_takes() {
    // Whichever the host chose, rather than a constant: on Windows that is which of the two installers put this copy on the machine. The suffix has to match what the release workflow actually publishes; see `every_published_file_is_an_installer_a_person_can_run`.
    for suffix in [WINDOWS_MSI_SUFFIX, WINDOWS_EXE_SUFFIX, MACOS_SUFFIX] {
        let script = initial_update_script(suffix);
        assert!(script.starts_with("window.__leafUpdateAsset = "));
        assert!(script.contains(suffix));
    }
    // A browser has no installer to offer, which the page reads as notify-only.
    assert!(initial_update_script("").contains(r#"= """#));
}
