//! The vault switcher, its settings panel, GitHub and the sync.

use super::*;

#[test]
fn one_growl_serves_every_thing_worth_saying_in_passing() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // One growl for both tones, rather than a second thing in the same corner doing the same job. The third argument is the one offer a toast may carry, and the fourth is a press inside the sentence — the path of a file it just named.
    assert!(html.contains("function leafToast(message, tone, action, link) {"));
    assert!(html.contains("window.leafShowError = (message) => leafToast(message, 'error');"));
    assert!(!html.contains("error.className = 'app-error';"));
    assert!(css.contains(".app-toast {"));
    assert!(css.contains(".app-toast.is-error {"));

    // One slot, replaced — and the one it replaces is held rather than looked up, since this is the only code that ever puts one on the page.
    assert!(html.contains("let toastElement = null;"));
    assert!(html.contains("toastElement.remove();"));
    assert!(!html.contains("document.querySelector('.app-toast')"));
    // A failure holds longer than a success: one is read at a glance and never again, the other has to be finished and acted on.
    assert!(html.contains("const TOAST_MS = 5000;"));
    assert!(html.contains("const TOAST_ERROR_MS = 8000;"));
    // It rises into place; something that simply appears in a corner has been half-missed by the time the eye arrives.
    assert!(css.contains(".app-toast.is-shown {"));
    assert!(css.contains("@media (prefers-reduced-motion: reduce) {"));
}

#[test]
fn a_vault_with_work_to_send_says_so_in_its_own_header() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Two clicks down a settings panel is where a control goes to be forgotten. This one lives at the end of the vault's crumb row, and only exists while there is something to press it for.
    assert!(html.contains(r#"id="librarySyncButton" class="library-sync""#));
    assert!(html.contains("function renderVaultSyncButton()"));
    assert!(html.contains("if (!activeVaultId || (!waiting && !spinning)) {"));
    assert!(html.contains("send({ command: 'syncVault', id: activeVaultId });"));
    assert!(css.contains(".library-sync {"));
    assert!(css.contains(".library-sync[hidden] {"));
    // A count, not a dot: "3" is a reason to press it.
    assert!(html.contains("(repo.changed || 0) + (repo.ahead || 0)"));
    assert!(css.contains(".library-sync.is-busy .lt-icon {"));

    // The count is read off disk, on a path that never asks the network. The panel's reading is the one that runs `gh auth status`; doing that on every save would put a token check behind Ctrl+S.
    assert!(html.contains("send({ command: 'getVaultStatus', id: activeVaultId });"));
    assert!(html.contains("window.leafSetVaultStatus = (id, repo) => {"));

    // There are two ways the page learns which vault is active and they share no path: a switch mid-session comes through `leafSetVaults`, but a cold launch never calls that -- the list is already on the window as `__leafVaults` and read straight out of it. Asking from only one of them is a button that works all session and is missing every time the app starts.
    assert!(html.contains("function requestActiveVaultStatus() {"));
    assert_eq!(
        html.matches("requestActiveVaultStatus();").count(),
        2,
        "expected both callers to ask: the vault switch and the bootstrap"
    );
    let bootstrap = html
        .rfind("window.leafSetNavigation({ canGoBack: false, canGoForward: false });")
        .expect("the shell ends by bootstrapping itself");
    assert!(
        html[bootstrap..].contains("requestActiveVaultStatus();"),
        "the bootstrap has to ask too, or a cold launch never does"
    );

    // A push that finishes in a tenth of a second still has to look like work, and whatever happened has to reach you whether or not the panel is open -- a sync started from here must not fail silently with the panel shut.
    assert!(html.contains("const SYNC_MIN_SPIN_MS = 700;"));
    assert!(html.contains("syncSpinUntil = performance.now() + SYNC_MIN_SPIN_MS;"));
    assert!(html.contains("librarySyncButton.classList.toggle('is-busy', spinning);"));

    // Once it turns it does not stop until the answer is in. Anything else redrawing the button mid-push -- a watcher tick is enough -- ends the turn, and a spinner that pauses reads as a failure at the one moment it must not. Only a finished job releases it.
    assert!(html.contains("let syncInFlight = false;"));
    assert!(html.contains("    syncInFlight = true;"));
    assert!(
        html.contains("const spinning = syncInFlight || Boolean(state && state.busy) || held > 0;")
    );
    assert!(html.contains("  if (!state.busy) syncInFlight = false;"));
    // A watcher tick carries the folder's state and nothing about the job, so it must not claim the job is over.
    assert!(!html.contains("{ repo, busy: false }"));
    // And it leaves still turning, rather than blinking out mid-thought.
    assert!(html.contains("librarySyncButton.classList.add('is-leaving');"));
    assert!(css.contains(".library-sync.is-leaving {"));
    // An <svg> takes its transform origin from its own box, so a spin that does not say so orbits the corner instead of turning.
    assert!(css.contains("  transform-origin: 50% 50%;"));
    assert!(html.contains("leafToast(syncOutcomeText(state), state.error ? 'error' : 'ok');"));
    // Reading the folder carries no message, so opening the panel is silent.
    assert!(html.contains("  if (state.message) {"));

    for wording in [
        "`Sync ${waiting} to GitHub`",
        "`Pushed ${committed} to ${remote}.`",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn a_vault_that_reaches_github_wears_a_cloud() {
    let html = app_shell_page();

    // Where a box says "a collection, here", a cloud says "and somewhere else as well" -- which is the whole of what syncing buys, and the one thing worth knowing at a glance about a vault you are not currently in.
    assert_icon(&html, "cloud");
    assert!(html.contains("const CLOUD_ICON_SVG = `"));
    assert!(html.contains("function vaultGlyph(current, id) {"));
    assert!(
        html.contains("if (vaultSyncs(id) || vaultIsInACloudFolder(id)) return CLOUD_ICON_SVG;")
    );

    // A repository with no remote is a pile of commits on one disk, which is not what a cloud promises.
    assert!(html.contains("return Boolean(repo && repo.atRoot && repo.remote);"));

    // One cloud, not an open and a closed one: open/closed says which vault you are standing in, and a cloud is about where the thing lives. The tick still marks the current row.
    assert_eq!(html.matches("CLOUD_ICON_SVG;").count(), 1);
    assert!(html.contains("return current ? PACKAGE_OPEN_ICON_SVG : PACKAGE_ICON_SVG;"));

    // The menu is where vaults are compared, so every one of them is asked about -- not only the one in use. Cached, so it costs once per vault.
    assert!(html.contains("function requestKnownVaultStatuses() {"));
    assert!(html.contains(
        "if (!vaultGitByVault.has(vault.id)) send({ command: 'getVaultStatus', id: vault.id });"
    ));

    // And the switcher button wears the mark of the vault it stands for; only the glyph is replaced, the caret beside it is ours.
    assert!(html.contains("setVaultGlyph(libraryVaultSwitch, vaultGlyph(true, activeVaultId));"));
    assert!(html.contains("setVaultGlyph(homeVaultSwitch, vaultGlyph(true, activeVaultId));"));

    // An icon is a name on a masked span, never a drawing. Both swaps went looking for an `svg`, found nothing, and left every vault wearing a box however far its repository reached -- so both go through one helper now, and that helper looks for the span.
    assert!(html.contains("const glyph = host && host.querySelector('.lt-icon');"));
    assert_eq!(html.matches("setVaultGlyph(").count(), 4);
}

#[test]
fn rebuilding_the_breadcrumb_leaves_the_vault_switcher_open() {
    let html = app_shell_page();

    // Opening the switcher asks every vault about its repository. On a vault that is one, git touches the folder, the watcher reports it, and the library re-renders -- so a crumb rebuild that closed any open menu closed the one that had just asked the question, and the switcher could not be opened at all beside a GitHub vault. Only a menu hanging off the trail dies with it.
    assert!(html.contains(
        "if (crumbMenuOwner && libraryCrumbTrail.contains(crumbMenuOwner)) hideCrumbMenu();"
    ));
    // The switcher is not in the trail, which is what makes the guard hold.
    assert!(html.contains("id=\"libraryVaultSwitch\""));
    assert!(html.contains("bindVaultSwitch(libraryVaultSwitch, true);"));
}

#[test]
fn a_vault_settings_panel_survives_the_window_losing_focus() {
    let html = app_shell_page();

    // Any second window taking the foreground blurs this one, so closing the panel on a blur is a close nobody pressed for -- and the reader meets it whenever the panel's own rows send them to a browser to copy a repository address and paste it back in here.
    assert!(html.contains(
        "window.addEventListener('blur', () => { if (!crumbMenuVault) hideCrumbMenu(); });"
    ));
    // Set for the panel and null for a list, which is the whole of what the guard reads.
    assert!(html.contains("let crumbMenuVault = null;"));
    // Three places null it; the one the guard is about is a list opening rather than a panel.
    assert_in(
        &html,
        "function bindVaultSwitch(button, retire) {",
        "crumbMenuVault = null;",
    );
    // A list of vaults or folders is a menu and still closes with the window, and so does the file right-click menu.
    assert!(html.contains("window.addEventListener('blur', hideContextMenu);"));
    // Three ways out that owe nothing to the window: Back and a press outside are presses, Escape is a key.
    assert!(html.contains("if (!crumbMenu.contains(event.target)) hideCrumbMenu();"));
    assert!(html.contains("leafOnEscape(hideCrumbMenu);"));
}

#[test]
fn back_returns_the_switcher_to_its_list_of_vaults() {
    let html = app_shell_page();

    // Back is the one row that redraws the menu in place without sending the reader anywhere, so it has to carry the mark the git rows carry: unmarked, the handler hides first, hideCrumbMenu clears crumbMenuOwner, and the redraw is handed null -- which throws on the button before anything is unhidden, leaving the reader with the whole menu gone.
    assert!(html.contains(
        "      label: 'Back',\n      icon: BACK_ARROW_SVG,\n      // Redraws in place like the git rows: closing first clears crumbMenuOwner, and the redraw below is handed it.\n      keepOpen: true,"
    ));
    // The mark is only worth anything because the handler reads it before it hides.
    assert!(html.contains("      if (!entry.keepOpen) hideCrumbMenu();"));
    // And the row still drops the panel mark before it redraws, so a git answer landing a beat later cannot draw the panel back over the list.
    assert!(html.contains(
        "        crumbMenuVault = null;\n        showCrumbMenu(crumbMenuOwner, vaultMenuItems());"
    ));
}

#[test]
fn a_vault_can_be_put_on_github_from_its_own_settings() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Opening the panel reads the folder; everything after that is a button.
    assert!(html.contains("window.leafSetVaultGit = (state) => {"));
    assert!(html.contains("window.leafVaultGitBusy = (id) => {"));
    assert!(html.contains("send({ command: 'syncVault', id: vault.id }),"));
    assert!(html.contains("send({ command: 'createVaultRepo', id: vault.id }),"));
    assert_in(
        &html,
        "function pushCreateRoutes(items, vault, state, busy) {",
        "command: 'linkVaultRemote', id: vault.id, url",
    );

    // Git is the one hard requirement, and it is named rather than assumed.
    assert!(html.contains("if (!state.tooling.git) {"));
    assert!(html.contains("https://git-scm.com/downloads"));
    // Without gh the browser does the authenticated half and hands back a URL, so nothing here ever holds a token.
    assert!(html.contains("if (state.tooling.gh) {"));
    assert!(html.contains("https://github.com/new?name="));
    assert!(html.contains("visibility=private"));
    assert!(!html.contains("ghp_"));
    assert!(!html.contains("Authorization"));

    // The two things git needs that only bite at commit or push time, which is too late to be told about them.
    assert!(html.contains("if (!state.tooling.identity) {"));
    assert!(html.contains("if (!state.tooling.credentialHelper) {"));

    // A repo one folder down is reported, not silently swallowed, and a vault inside someone else's repo is told that is what it is.
    assert!(html.contains("Already repositories, and left alone:"));
    assert!(html.contains("A repository here is separate from it."));

    // Work happens in the panel, so the panel stays up to report it.
    assert!(html.contains("if (!entry.keepOpen) hideCrumbMenu();"));
    // Fifteen rows carry that mark, so the claim is that the git panel's own rows do.
    assert_in(&html, "function vaultGitItems(vault) {", "keepOpen: true,");
    assert!(css.contains(".crumb-menu-note {"));
    assert!(css.contains(".crumb-menu-item:disabled {"));

    for wording in [
        "heading: 'GitHub'",
        "'Syncing needs git, which is not installed.'",
        "'Create a private repo'",
        "`Pushed ${committed} changed.`",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
    // Two panels ask for an address, and this one is the create route's.
    assert_in(
        &html,
        "function pushCreateRoutes(items, vault, state, busy) {",
        "'Paste the repository address'",
    );
}

#[test]
fn creating_a_repo_in_the_browser_leaves_the_paste_field_standing() {
    let html = app_shell_page();

    // The label and the mark are asserted in one snippet on purpose: five other rows carry a bare `keepOpen: true,`, so only a match tying the mark to this row's label can fail before the fix.
    assert!(html.contains(
        "    label: 'Create it on GitHub ↗',\n    title: 'Opens GitHub with the name filled in. Copy the address it gives you and paste it below.',\n    // The row's own words send the reader to a browser and back to the field below it, so the press must not take that field away.\n    keepOpen: true,"
    ));
    // The mark is only worth anything because the handler reads it before it hides.
    assert!(html.contains("      if (!entry.keepOpen) hideCrumbMenu();"));
    // The field those words point at is the next row in the same block, so closing on the press takes away the only place the address can go.
    assert_in(
        &html,
        "function pushCreateRoutes(items, vault, state, busy) {",
        "placeholder: 'Paste the repository address',",
    );
    // The other half of the round trip: the browser taking the foreground blurs the window, and a blur closes a list rather than the panel.
    assert!(html.contains(
        "window.addEventListener('blur', () => { if (!crumbMenuVault) hideCrumbMenu(); });"
    ));
    // Install git ↗ is the same trip one state earlier and stays closing: nothing re-reads the folder while the panel stands, so a panel kept open would still say git is missing after it arrived, and its words promise no field to come back to.
    assert!(html.contains(
        "      label: 'Install git ↗',\n      run: () => send({ command: 'openExternal', url: 'https://git-scm.com/downloads' }),"
    ));
}

#[test]
fn a_vault_that_cannot_sign_in_is_told_how_to() {
    let html = app_shell_page();

    // The note names the fix rather than stopping at the diagnosis, and the fix is two named things rather than "authenticate".
    assert!(html.contains(
        "'git has no way to sign in to GitHub. Install GitHub CLI and run gh auth login, or a credential manager.'"
    ));
    // And the way out is the shape missing git already ships: one row that opens somebody else's page.
    assert!(html.contains("label: 'How to sign in ↗',"));
    assert!(html.contains(
        "url: 'https://docs.github.com/get-started/git-basics/caching-your-github-credentials-in-git',"
    ));
    // Never a button that runs the sign-in: every git spawned here has its prompts shut off and no console, so `gh auth login` is a thing the reader runs.
    assert!(!html.contains("'gh', 'auth', 'login'"));
    assert!(!html.contains("command: 'signInGit'"));
}

#[test]
fn a_vault_with_no_git_identity_can_set_one_from_the_panel() {
    let html = app_shell_page();

    // The note names what the fields under it do, rather than naming two settings and stopping.
    assert!(html.contains(
        "'git does not know who you are yet. Put your name and email here and it will — git keeps them for this machine.'"
    ));
    // Two fields and one button, and they are only drawn where that note is.
    assert!(html.contains("if (!state.tooling.identity) {"));
    assert!(html.contains("pushIdentityFields(items, vault, busy);"));
    assert_eq!(html.matches("pushIdentityFields(").count(), 2);
    assert!(html.contains("fieldClass: 'git-name-field',"));
    assert!(html.contains("fieldClass: 'git-email-field',"));
    assert!(html.contains("placeholder: 'Your name',"));
    assert!(html.contains("placeholder: 'you@example.com',"));
    assert!(html.contains("label: busy ? SYNC_WORKING : 'Set who I am',"));

    // Nothing is set until Set is pressed: neither field carries a commit, so leaving one cannot write a half-typed name.
    assert!(html.contains("command: 'setGitIdentity',"));
    // And the press redraws the panel itself, because the guard that saves a half-typed name would otherwise skip both the busy mark and the answer.
    assert!(html.contains(
        "showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));\n  };\n  items.push({\n    input: '',\n    fieldClass: 'git-name-field',"
    ));
    assert!(html.contains(
        "if (active && active.classList.contains('crumb-menu-input') && crumbMenu.contains(active)) return;"
    ));

    // The write landing is reported, so the press says something even where the note going is the real proof.
    assert!(html.contains("if (message === 'identity-set') return 'git knows who you are now.';"));
}

#[test]
fn a_failed_sync_says_which_fix_above_it_to_press() {
    let html = app_shell_page();

    // A cause the host could name arrives as a tag, and the words are chosen here beside the rest of the panel's words.
    assert!(html.contains(
        "if (message === 'failed:signin') return 'GitHub refused the push because nothing is signed in. Sign in above, then Sync again.';"
    ));
    assert!(html.contains("if (message === 'failed:identity') return 'git had nothing to commit as, because it does not know who you are. Fill in your name and email above, press Set, then Sync again.';"));
    // Anything git's words named no cause for is still git's own line, untouched.
    assert!(html.contains("    return message;\n  }\n  if (message === 'identity-set')"));

    // "Sign in above" has to be true: a helper holding a token GitHub no longer accepts fails like no helper at all, and draws no note of its own, so the door stands on the failure as well.
    assert!(html
        .contains("if (!state.tooling.credentialHelper || state.message === 'failed:signin') {"));
}

#[test]
fn a_vault_row_opens_its_settings_with_the_settings_glyph() {
    let html = app_shell_page();
    // The same sliders the app's own Settings wears — that panel is this vault's settings, so it should not be a second, private symbol for the same idea.
    assert_icon(&html, "settings");
    assert!(html
        .contains("const MENU_SETTINGS_SVG = `<span class=\"lt-icon lt-icon-settings\"></span>`;"));
    assert!(html.contains("edit.innerHTML = MENU_SETTINGS_SVG;"));
    // No placeholder survives in the page: a raw `{{...}}` would be text on screen. The script's own `{{` is mermaid's hexagon, so the page is what is checked.
    assert!(!app_shell_html().contains("_ICON_SVG}}"));
}

#[test]
fn the_vault_switcher_is_its_own_button_beside_the_trail() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Its own control, left of the breadcrumb — not the first crumb. A crumb is a place, and clicking a place has to go there.
    assert!(html
        .contains(r#"<button type="button" id="libraryVaultSwitch" class="library-vault-switch""#));
    assert!(html.contains("bindVaultSwitch(libraryVaultSwitch, true);"));
    assert!(html.contains("toggleCrumbMenu(button, vaultMenuItems());"));
    assert!(css.contains(".library-vault-switch {"));
    // It wears the same glyph its menu rows do — one file, stamped in by the host and inlined into the page, so the two cannot drift. A package, not a folder: a vault is a whole collection, and it has to read as different from the plain directories listed below it.
    for icon in ["package-open", "package"] {
        assert_icon(&html, icon);
    }
    assert!(html.contains("const PACKAGE_OPEN_ICON_SVG = `"));
    assert!(html.contains("const PACKAGE_ICON_SVG = `"));
    // Open is the vault you are in, closed the ones you are not, so the row says which it is without leaning on the tick alone — until a vault reaches GitHub, at which point where it lives is the more useful thing to show.
    assert!(html.contains("const rootIcon = (on, id) => vaultGlyph(on, id);"));
    assert!(html.contains("icon: rootIcon(vault.id === activeVaultId, vault.id),"));
    // The pane still lists directories as directories.
    assert!(html.contains("const FOLDER_ICON_SVG = `"));
    // The arrow leads, so the open highlight runs from it through the glyph and on into the vault's name beside the button.
    assert!(html.contains(
        r#"<span class="library-crumb-caret" aria-hidden="true">▾</span><span class="lt-icon"#
    ));
    // Its label names the root you are in, so hovering says what would change.
    assert!(html.contains("function renderLibraryVaultSwitch()"));
    assert_in(
        &html,
        "function renderLibraryVaultSwitch() {",
        "const label = `Switch vault (in ${libraryRootLabel()})`;",
    );

    // The leftmost crumb is a place: it goes to the root, and nothing in the trail opens a menu.
    assert!(html.contains("[{ path: '', name: libraryRootLabel() }]"));
    assert!(!html.contains("data-crumb-switcher"));
    assert!(!html.contains("library-crumb-switcher"));
    // Its label is the vault's name, the name a host gave the root — a published site sends its own folder's — or the whole library's.
    assert!(html.contains("function libraryRootLabel()"));
    assert!(html.contains("return (vault && vault.name) || libraryRootName || 'Library';"));

    // The menu is the whole library, then every vault, then New vault…
    assert!(html.contains("function vaultMenuItems()"));
    assert!(html.contains("selected: !activeVaultId,"));
    assert!(html.contains("selected: vault.id === activeVaultId,"));
    // Three places ask for a new vault; the menu's own row is the one this test is about.
    assert_in(
        &html,
        "function vaultMenuItems() {",
        "send({ command: 'createVault' })",
    );
    assert!(html.contains("send({ command: 'setActiveVault', id });"));
    assert!(html.contains("if (id === activeVaultId) {\n    setLibraryFolder('');"));

    // Seeded before the first paint, so nothing flashes the wrong name.
    assert!(html.contains("const LEAF_VAULTS = (window.__leafVaults"));
    assert!(html.contains("window.leafSetVaults ="));

    for wording in [
        r#"aria-label="Vaults""#,
        "'Everything the library has indexed'",
        "'New vault…'",
        "'Choose a folder to use as a library root'",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn each_vault_row_carries_one_button_for_everything_you_can_do_to_it() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // A row button, not a right-click: rename, re-point and remove all live behind it. Four places open that panel; the claim is that the row's own list is one of them.
    assert_in(
        &html,
        "function vaultMenuItems() {",
        "showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));",
    );
    // Opening the panel asks about the folder's repository straight away, so the answer is there by the time anyone has read down to it.
    assert!(html.contains("send({ command: 'getVaultGit', id: vault.id });"));
    assert!(html.contains(r#"edit.className = 'crumb-menu-edit';"#));
    assert!(css.contains(".crumb-menu-edit {"));
    let edit_style = css
        .split(".crumb-menu-edit {")
        .nth(1)
        .and_then(|rest| rest.split("\n}").next())
        .expect("the settings button has a style rule");
    assert!(edit_style.contains("opacity: 0;"));
    // The colors ride behind the opacity leg in both rules; `a_hover_fades_from_one_shared_rule_and_by_name_where_it_cannot` holds those.
    assert!(edit_style.contains(
        "transition: opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300),"
    ));
    let reveal_style = css
        .split(".crumb-menu-row:hover .crumb-menu-edit,\n.crumb-menu-row:focus-within .crumb-menu-edit {")
        .nth(1)
        .and_then(|rest| rest.split("\n}").next())
        .expect("the settings button is revealed for pointer and keyboard use");
    assert!(reveal_style.contains("opacity: 1;"));
    assert!(reveal_style
        .contains("transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate),"));
    // Pressing it opens that vault's panel rather than switching to the vault -- on the press, so a redraw mid-click cannot swallow it.
    assert!(html.contains("edit.addEventListener('pointerdown', (event) => {"));
    assert!(html.contains("entry.edit();"));
    // Nothing hangs off a contextmenu handler in the switcher.
    assert!(!html.contains("crumbMenu.addEventListener('contextmenu'"));
    // Only the crumb-trail buttons toggle the menu shut on a second click. A click inside it that swaps the rows must not close it — that is the bug where a row's own button looks like it did nothing.
    assert!(html.contains("function toggleCrumbMenu(button, items)"));
    assert!(html.contains("bindVaultSwitch(libraryVaultSwitch, true);"));
    assert!(html.contains("toggleCrumbMenu(button, vaultMenuItems());"));
    assert!(html.contains("toggleCrumbMenu(more, folderMenuItems(hidden));"));
    let show = html
        .split("function showCrumbMenu(button, items) {")
        .nth(1)
        .and_then(|rest| rest.split("\n}").next())
        .expect("the shell defines showCrumbMenu");
    assert!(
        !show.contains("hideCrumbMenu();\n    return;"),
        "showCrumbMenu must render, never close and bail: {show}"
    );

    // The panel: the name, the folder, the removal, and a way back to the list.
    assert!(html.contains("function editVaultMenuItems(vault)"));
    assert!(html.contains("send({ command: 'renameVault', id: vault.id, name });"));
    assert!(html.contains("send({ command: 'changeVaultFolder', id: vault.id })"));
    assert!(html.contains("send({ command: 'removeVault', id: vault.id })"));
    assert_in(
        &html,
        "function editVaultMenuItems(vault) {",
        "showCrumbMenu(crumbMenuOwner, vaultMenuItems())",
    );
    // The name field commits on Enter or on leaving it, and Escape abandons it.
    assert!(html.contains("field.addEventListener('blur', commit);"));
    // Four fields in the page abandon on Escape; this one is the menu's own.
    assert_in(
        &html,
        "function showCrumbMenu(button, items) {",
        "} else if (event.key === 'Escape') {",
    );
    assert!(css.contains(".crumb-menu-input {"));

    for wording in [
        "`Edit ${entry.label}`",
        "`Editing ${vault.name || ''}`",
        "'Vault name'",
        "'Change folder…'",
        "'Remove vault'",
        "'Forgets the vault. The folder and its files are left alone.'",
        "label: 'Back'",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn the_open_switcher_lights_the_vault_name_beside_it() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Opening the list changes what the whole pane is about, so the highlight reaches across the name rather than stopping at the icon. One selector: open is an attribute on the button, and the name is the first crumb of the trail next to it.
    assert!(css.contains(
        ".library-vault-switch[aria-expanded=\"true\"] + .library-crumb-trail .library-crumb:first-child {"
    ));
    // Standing at the vault's own root the name is a span, which centers nothing on its own.
    assert!(css.contains(
        ".library-vault-switch[aria-expanded=\"true\"] + .library-crumb-trail .library-crumb.is-current:first-child {"
    ));
    // The two make one pill: the facing corners square and the button grows into the 2px gap, pulled back by the same amount so no folder after the name moves.
    assert!(css.contains("padding-right: calc(var(--lt-space-4) + var(--lt-space-2));"));
    assert!(css.contains("margin-right: calc(-1 * var(--lt-space-2));"));
    // The vault's name is a crumb like every folder after it, so nothing anywhere gives the first crumb horizontal room of its own — at any value. A refusal rather than a spelling, or the special case comes back the next time somebody wants that pill a little wider.
    let bare = strip_css_comments(css);
    for rule in bare.split('}') {
        let Some((selector, body)) = rule.rsplit_once('{') else {
            continue;
        };
        let selector = selector.trim();
        if !selector
            .split(',')
            .any(|one| one.trim().ends_with(".library-crumb:first-child"))
        {
            continue;
        }
        for declaration in body.split(';').map(str::trim) {
            assert!(
                !(declaration.starts_with("padding:")
                    || declaration.starts_with("padding-left:")
                    || declaration.starts_with("padding-right:")
                    || declaration.starts_with("padding-inline")),
                "the vault's name takes horizontal room of its own in {selector}: {declaration}"
            );
        }
    }

    // Open, the two halves are one pill, so they owe one top edge and one bottom edge between them: the height on the name's half is read against the switcher's own rather than spelled out twice.
    let height_of = |selector: &str| {
        rule_body(&bare, selector)
            .split_once('{')
            .expect("the rule opens")
            .1
            .split(';')
            .map(str::trim)
            .find_map(|one| one.strip_prefix("height:"))
            .unwrap_or_else(|| panic!("{selector} should set a height"))
            .trim()
            .to_string()
    };
    assert_eq!(
        height_of("\n.library-vault-switch {"),
        height_of(
            "\n.library-vault-switch[aria-expanded=\"true\"] + .library-crumb-trail .library-crumb:first-child {"
        ),
        "the open pill's two halves are different heights, so it is ragged along its top and bottom edge"
    );

    // A sibling selector, so it is silently dead the moment anything is put between the button and the trail. Only whitespace may sit there.
    let switcher = html
        .find(r#"<button type="button" id="libraryVaultSwitch""#)
        .expect("the switcher is in the shell");
    let closed =
        switcher + html[switcher..].find("</button>").expect("it closes") + "</button>".len();
    let trail = html
        .find(r#"<nav class="library-crumb-trail""#)
        .expect("the trail is in the shell");
    assert!(
        closed < trail && html[closed..trail].trim().is_empty(),
        "nothing may sit between the switcher and the trail, found {:?}",
        &html[closed..trail]
    );

    // The name is still a place: clicking it enters that folder, and nothing about it opens the menu.
    assert!(html.contains("setLibraryFolder(crumb.dataset.crumbPath)"));
}

#[test]
fn a_cloud_folder_becomes_a_vault_without_being_asked_for() {
    let html = app_shell_page();

    // The host is asked at boot and again whenever the switcher opens, so a client installed mid-session is found without a restart.
    assert!(html.contains("send({ command: 'getCloudFolders' });"));
    assert!(html.contains("window.leafSetCloudFolders = (folders) => {"));

    // Nothing to press: there is no row for a cloud folder, because being found is what registers it.
    assert!(
        !html.contains("createCloudVault"),
        "a cloud folder is registered by being found, not by a button"
    );

    // What the answer is for is the mark on the row: saving in a synced folder reaches somewhere else, so it reads as a cloud rather than a box.
    assert!(html.contains("function vaultIsInACloudFolder(id) {"));
    assert!(
        html.contains("if (vaultSyncs(id) || vaultIsInACloudFolder(id)) return CLOUD_ICON_SVG;")
    );
    // A folder whose name merely starts the same way is not inside it -- the separator is part of the test.
    assert!(html.contains("path === root || path.startsWith(`${root}/`)"));
}

#[test]
fn cloning_a_repository_takes_an_address_and_then_a_folder() {
    let html = app_shell_page();

    // Folded away until asked for, like changing a repository — the common way in is still picking a folder.
    assert!(html.contains("label: 'Clone a repository…',"));
    assert!(html.contains("cloneRevealed = true;"));
    // And unfolded again when the menu closes, or the panel would be waiting there the next time it opens. Four places write that; the claim is the menu closing is one of them.
    assert_in(
        &html,
        "function hideCrumbMenu() {",
        "cloneRevealed = false;",
    );

    // The address goes to the host; the folder is picked there, because a dialog belongs to the window's thread.
    assert!(html.contains("send({ command: 'cloneVault', url });"));
    assert!(
        !html.contains("command: 'cloneVault', url, path"),
        "the page does not choose where a clone lands"
    );
}
