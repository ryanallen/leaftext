# Privacy

> What Leaftext reads, where it keeps it, and who it talks to.

Leaftext is a desktop app for reading and writing your own documents, made by one person. There is no Leaftext account and no Leaftext server: nothing you open, write or connect is sent to the maker of the app.

## What stays on your device

Every document you open is read from your own disk. Your settings, recent files, reading progress and the list of folders you called vaults are kept in the app's own folders on your computer, and nowhere else. Leaftext collects no analytics and sends no usage reports.

## Who the app talks to

- **GitHub, to check for a newer version.** On launch the app asks the public Leaftext repository which version is newest, and downloads an installer only when you press Update.
- **A service you connect, and only that service.** When you add a Dropbox, OneDrive, SharePoint, Box, WebDAV or S3 vault, the app talks straight to that service from your computer. No copy passes through anyone else.
- **A web page you open.** A web page tab loads that page the way a browser does.

## Google Drive

Leaftext does not sign in to Google. If the Google Drive app is installed, its My Drive folder appears as a local vault. The Google Drive app handles its own account and syncing. Leaftext reads and writes files in that folder without receiving a Google token.

A `.gdoc`, `.gsheet` or `.gslides` shortcut identifies a document kept by Google. Leaftext reads the shortcut or the Drive app's local record to find its document address. Its **Open in Google Docs**, **Open in Google Sheets** or **Open in Google Slides** button opens that address in your browser. The document itself is opened by Google, not fetched into Leaftext.

When an older Leaftext copy left a Google sign-in vault in the app's database, startup forgets its saved credential under both names previously used. A vault with an unsent file remains as a local folder so those words stay available. A vault without unsent files and its app-held copy are removed.

## Questions

Ask on the project's [Get help](04-help.md) page, or write to leaftextmail@gmail.com.
