//! What the installer was asked to do.
//!
//! Four flags and no more. An unrecognized one is refused rather than ignored: the app runs this file unattended, and a flag that silently does nothing is a silent wrong install.

use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    /// No window, no questions. What the app passes when it installs an update.
    pub silent: bool,
    /// Take the install back off rather than putting it on.
    pub uninstall: bool,
    /// Where to install, when something other than the remembered or default folder is wanted.
    pub folder: Option<PathBuf>,
}

pub fn parse<I: Iterator<Item = String>>(args: I) -> Result<Request, String> {
    let mut request = Request::default();
    let mut args = args.peekable();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--silent" | "/S" => request.silent = true,
            "--uninstall" => request.uninstall = true,
            "--dir" => {
                request.folder = Some(PathBuf::from(
                    args.next().ok_or("--dir needs a folder after it")?,
                ));
            }
            other => return Err(format!("unknown option {other}")),
        }
    }
    Ok(request)
}
