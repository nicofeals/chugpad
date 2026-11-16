# Chugpad

A tab editor for guitar, bass and drums that runs in the browser on phone and desktop.
It reads Guitar Pro files, exports `.gp` and MIDI, and lets several people work on the same song.

The whole app is `index.html`. Sync and sharing use Firebase (Google sign-in and the Firestore database).
Without Firebase the app still works, with songs saved in the browser on each device.

## 1. Put it online with GitHub Pages

1. Create a repository and add `index.html`, `firebase-config.js`, `firestore.rules` and this README.
2. In the repository, open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`.
4. After a minute the app is live at `https://<your-username>.github.io/<repository-name>/`.

## 2. Turn on sync and sharing (about ten minutes)

1. Go to <https://console.firebase.google.com> and create a project. Analytics is not needed.
2. **Authentication > Sign-in method**: enable **Google**.
3. **Authentication > Settings > Authorized domains**: add `<your-username>.github.io`.
4. **Firestore Database**: create a database in production mode, in a region near you.
5. **Firestore Database > Rules**: replace the content with `firestore.rules` from this repository and publish.
6. **Project settings > Your apps**: add a **Web app**, then copy the `firebaseConfig` values into `firebase-config.js`.
7. Commit and push. Reload the site, open the Song menu and sign in.

The values in `firebase-config.js` are meant to be public. What protects the data is `firestore.rules`.

## How sharing works

Each song belongs to the person who created it. In the Song menu the owner can:

- add people by email address as **viewer** (read and play) or **editor** (change the tab),
- switch a person between the two, or remove them,
- give **anyone with the link** view or edit access. They still need to sign in.

People sign in with the Google account for the email address you added, and the song appears in their Song menu
under "Shared with you". Edits show up for everyone who has the song open. Two people working on different bars or
tracks both keep their work; if they change the same bar of the same track at once, the last save wins.

Only the owner can change who a song is shared with or delete it. Editors cannot.

## Limits to know about

- Email addresses are matched exactly, in lower case, against the address on the Google account.
- A song is one database document, limited to 1 MB. Very long imports stay on the device they were imported on.
- Firebase's free plan allows 50,000 reads and 20,000 writes per day, which is far more than a band needs.
- The Guitar Pro reader (alphaTab) and Firebase load from public CDNs, so the first use of each needs a connection.
