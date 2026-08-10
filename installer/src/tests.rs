//! What can be proved about the installer without running it on somebody's machine — which is nearly all of it, because the install is a plan before it is an act.

use crate::args;
use crate::exit;
use crate::locations;
use crate::plan::{self, Root};

#[test]
fn the_install_is_one_start_menu_entry_inside_the_users_own_folder() {
    // The three things `.github/workflows/validate-installer.yml` asserts about the MSI once WiX has compiled it — the scope, the one shortcut, nothing outside the profile — asserted about this installer with nothing running.
    let folder = locations::default_install_folder();
    let start_menu = locations::start_menu_folder();
    let plan = plan::plan(&folder, &start_menu, "0.0.0");

    let home = locations::home();
    for path in plan.written_paths() {
        assert!(
            path.starts_with(&home),
            "{} is outside the user's own folder",
            path.display()
        );
    }

    assert_eq!(plan.shortcuts.len(), 1, "exactly one Start Menu entry");
    let shortcut = &plan.shortcuts[0];
    assert!(shortcut.path.starts_with(&start_menu));
    assert_eq!(shortcut.target, folder.join(plan::APP_RELATIVE_PATH));

    for value in &plan.values {
        assert_eq!(value.root, Root::CurrentUser, "{} is not HKCU", value.key);
    }
}

#[test]
fn the_marker_says_this_copy_came_from_the_exe() {
    // Its absence is what an MSI install looks like, so the updater keeps handing those the MSI without anything having been written for them.
    let plan = plan::plan(
        std::path::Path::new(r"C:\x"),
        std::path::Path::new(r"C:\y"),
        "0.0.0",
    );
    let marker = plan
        .values
        .iter()
        .find(|value| {
            value.key == plan::APP_KEY && value.name.as_deref() == Some(plan::INSTALLED_BY_VALUE)
        })
        .expect("the plan must mark which installer put this copy here");
    assert_eq!(
        marker.data,
        plan::Data::String(plan::INSTALLED_BY_EXE.to_string())
    );
}

#[test]
fn each_thing_that_can_go_wrong_exits_with_its_own_code() {
    // The number is the whole message a silent run can send, so two causes sharing one would make "close Leaftext and try again" indistinguishable from "this file is broken".
    let codes = [
        exit::OK,
        exit::FAILED,
        exit::IN_USE,
        exit::NO_PAYLOAD,
        exit::BAD_ARGUMENTS,
    ];
    for (index, code) in codes.iter().enumerate() {
        assert!(
            !codes[index + 1..].contains(code),
            "two causes exit with {code}"
        );
    }
    assert_eq!(exit::Failure::failed("anything").code, exit::FAILED);
}

#[cfg(windows)]
#[test]
fn an_installer_with_no_app_inside_it_says_so_rather_than_writing_half_a_folder() {
    let refusal = crate::apply::unpack(&[], 0).expect_err("nothing to unpack");
    assert_eq!(refusal.code, exit::NO_PAYLOAD);
    assert!(refusal.message.contains("without the app inside it"));
}

#[test]
fn the_command_line_is_four_flags_and_refuses_a_fifth() {
    let request = args::parse(
        ["--silent", "--dir", r"C:\somewhere"]
            .map(String::from)
            .into_iter(),
    )
    .expect("a silent install into a named folder");
    assert!(request.silent);
    assert!(!request.uninstall);
    assert_eq!(
        request.folder.as_deref(),
        Some(std::path::Path::new(r"C:\somewhere"))
    );

    assert!(
        args::parse(["--uninstall"].map(String::from).into_iter())
            .expect("uninstall")
            .uninstall
    );
    // Silently ignoring one would be a silent wrong install: the app runs this unattended.
    assert!(args::parse(["--quiet"].map(String::from).into_iter()).is_err());
    assert!(args::parse(["--dir"].map(String::from).into_iter()).is_err());
}

#[cfg(windows)]
#[test]
fn installing_into_a_scratch_root_lays_the_plan_down_and_uninstalling_leaves_nothing() {
    use crate::apply;
    use crate::registry;

    let root = std::env::temp_dir().join(format!("leaftext-setup-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let folder = root.join("Programs").join("leaftext");
    let start_menu = root.join("Start Menu");
    let prefix = format!(r"Software\ryanallen\leaftext-test-{}", std::process::id());
    let plan = plan::plan(&folder, &start_menu, "9.9.9");

    // Something small standing in for the app and for the installer's own copy: what is written matters, the bytes do not.
    std::fs::create_dir_all(&root).expect("scratch root");
    let stand_in = root.join("stand-in.exe");
    std::fs::write(&stand_in, b"not really an installer").expect("stand-in");

    apply::install(
        &plan,
        &apply::Sources {
            app: b"not really an app",
            uninstaller: &stand_in,
        },
        Some(&prefix),
    )
    .expect("install");

    for file in &plan.files {
        assert!(
            file.path.is_file(),
            "{} was not written",
            file.path.display()
        );
    }
    assert!(plan.shortcuts[0].path.is_file(), "no Start Menu entry");
    assert_eq!(
        registry::read_string(Some(&prefix), plan::APP_KEY, plan::INSTALL_FOLDER_VALUE).as_deref(),
        Some(folder.display().to_string().as_str())
    );
    assert_eq!(
        registry::read_string(Some(&prefix), r"Software\Classes\.md", "").as_deref(),
        Some(plan::PROGID)
    );
    for key in &plan.owned_keys {
        assert!(registry::key_exists(Some(&prefix), key), "{key} is missing");
    }

    apply::uninstall(&plan, Some(&prefix)).expect("uninstall");

    for file in &plan.files {
        assert!(!file.path.exists(), "{} survived", file.path.display());
    }
    assert!(!plan.shortcuts[0].path.exists(), "the entry survived");
    assert!(!folder.exists(), "the install folder survived");
    assert_eq!(
        registry::read_string(Some(&prefix), plan::APP_KEY, plan::INSTALL_FOLDER_VALUE),
        None
    );
    assert_eq!(
        registry::read_string(Some(&prefix), r"Software\Classes\.md", ""),
        None
    );
    // An emptied key left standing is something left behind.
    for key in &plan.owned_keys {
        assert!(!registry::key_exists(Some(&prefix), key), "{key} survived");
    }

    registry::remove_tree(None, &prefix);
    let _ = std::fs::remove_dir_all(&root);
}
