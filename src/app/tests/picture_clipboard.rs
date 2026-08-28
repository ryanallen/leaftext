//! Putting a picture on the system clipboard.

use super::*;
use crate::app::picture_clipboard::{clipboard_helper, picture_bytes, ScratchPicture};

/// The scratch pictures this process is holding right now, so a test can say a copy left none behind.
fn scratch_pictures_here() -> Vec<PathBuf> {
    let prefix = format!("leaftext-clipboard-{}-", std::process::id());
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect()
}

#[test]
fn a_payload_that_is_not_a_picture_is_refused_before_any_file_is_written() {
    // The decode comes before the file on purpose: a refusal that had already written one would leave the reader's picture sitting in the temporary folder with nothing left to clean it up.
    let before = scratch_pictures_here();

    for payload in ["", "   ", "not base64!", "@@@@"] {
        assert!(
            picture_bytes(payload).is_err(),
            "a payload of {payload:?} is not a picture"
        );
    }
    assert_eq!(picture_bytes("UE5H").expect("base64 decodes"), b"PNG");

    assert_eq!(
        scratch_pictures_here(),
        before,
        "a refused payload wrote a scratch picture"
    );
}

#[test]
fn a_scratch_picture_holds_the_bytes_and_is_gone_once_the_copy_is_over() {
    // Both platforms read a picture from a path rather than from their own input, so the copy has to leave a file somewhere — and this is what says it never survives the copy, whether the helper worked or failed.
    let held = {
        let scratch = ScratchPicture::written(b"PNG-bytes").expect("a scratch picture is written");
        let path = scratch.path().to_path_buf();
        assert_eq!(
            fs::read(&path).expect("the scratch picture is readable"),
            b"PNG-bytes"
        );

        // A second copy in flight never lands on the first one's name, so two Copy picture presses cannot write over each other.
        let other = ScratchPicture::written(b"other").expect("a second scratch picture is written");
        assert_ne!(other.path(), path);
        path
    };

    assert!(
        !held.exists(),
        "the scratch picture outlived the copy that made it"
    );
}

#[test]
fn the_clipboard_helper_is_built_for_the_scratch_picture_and_not_yet_run() {
    let scratch = ScratchPicture::written(b"PNG-bytes").expect("a scratch picture is written");
    let helper = clipboard_helper(scratch.path());
    let program = helper.get_program().to_string_lossy().into_owned();
    let args: Vec<String> = helper
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();

    #[cfg(target_os = "windows")]
    {
        assert_eq!(program, "powershell");
        // The clipboard is an STA affair, and the flush is what lets the picture outlive the helper.
        assert!(args.contains(&"-STA".to_string()), "{args:?}");
        let script = args.last().expect("the helper runs a script");
        assert!(script.contains("SetDataObject($data, $true)"), "{script}");
        // The picture travels as an environment value rather than inside the script, so nothing about the path has to be quoted.
        let carried: Vec<_> = helper
            .get_envs()
            .filter(|(name, _)| *name == std::ffi::OsStr::new("LEAF_CLIP_PICTURE"))
            .filter_map(|(_, value)| value.map(|value| PathBuf::from(value)))
            .collect();
        assert_eq!(carried, vec![scratch.path().to_path_buf()]);
        assert!(
            !script.contains(&scratch.path().to_string_lossy().into_owned()),
            "the path was written into the script as well"
        );
    }

    #[cfg(target_os = "macos")]
    {
        assert_eq!(program, "osascript");
        let script = args.last().expect("the helper runs a script");
        assert!(
            script.contains(&scratch.path().to_string_lossy().into_owned()),
            "{script}"
        );
        // The PNG type is what makes this a picture another program pastes rather than a file it links to.
        assert!(script.contains("class PNGf"), "{script}");
    }

    // Built and not run, so the scratch picture is still here to be cleaned up by the copy rather than by the helper.
    assert!(scratch.path().exists());
}
