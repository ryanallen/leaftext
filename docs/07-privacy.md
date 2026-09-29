# Privacy

> What Leaftext reads, where it keeps it, and who it talks to — including what Sign in with Google reaches and how to take that access back.

Leaftext is a desktop app for reading and writing your own documents, made by one person. There is no Leaftext account and no Leaftext server: nothing you open, write or connect is sent to the maker of the app.

## What stays on your device

Every document you open is read from your own disk. Your settings, recent files, reading progress and the list of folders you called vaults are kept in the app's own folders on your computer, and nowhere else. Leaftext collects no analytics and sends no usage reports.

## Who the app talks to

- **GitHub, to check for a newer version.** On launch the app asks the public Leaftext repository which version is newest, and downloads an installer only when you press Update.
- **A service you connect, and only that service.** When you add a Dropbox, Google Drive, OneDrive, SharePoint, Box, WebDAV or S3 vault, the app talks straight to that service from your computer. No copy passes through anyone else.
- **A web page you open.** A web page tab loads that page the way a browser does.

## Sign in with Google

When you add a Google Drive vault with **Sign in with Google**, Google asks you to let Leaftext:

| Access | Why Leaftext asks for it |
| --- | --- |
| See, edit, create and delete your Google Drive files | The vault is your whole My Drive: the app lists your folders, copies your files to your computer so they open and search like any other note, writes back what you save, and opens your Google Docs, Sheets and Slides |
| See your email address | To name the vault after the account, so two Google accounts are two vaults you can tell apart |

What happens to it:

- **You sign in on Google's own page.** It opens in a tab inside Leaftext kept apart from your documents, so your password goes to Google and never to Leaftext, and the tab closes once Google answers.
- **The sign-in stays on your computer.** The token Google hands back is kept in your system's own credential store — Credential Manager on Windows, the Keychain on macOS — and never in a file the app writes.
- **Your files stay between your computer and Google.** The copies the app keeps so your Drive opens quickly sit in the app's data folder on your computer. The app reads and writes Google Drive only when you are using the vault, and only the files in it.
- **Nothing is shared, sold or used for anything else.** Leaftext uses what it reads from Google only to show and edit your own files for you, and does not use it for advertising or to train any model. Its use of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Taking access back

- **In Leaftext:** open the vault switcher, open the vault's menu and press **Sign out**, or remove the vault. Signing out deletes the stored token from your computer.
- **At Google:** go to [your Google Account's third-party connections](https://myaccount.google.com/connections), choose Leaftext and remove its access. The app can no longer reach your Drive until you sign in again.
- **The local copies:** removing the vault deletes the copies of your files the app kept for it.

## Questions

Ask on the project's [Get help](04-help.md) page, or write to leaftextmail@gmail.com.
