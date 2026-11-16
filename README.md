# Chugpad

A tab editor for guitar, bass and drums that runs in the browser on phone and desktop.
It reads Guitar Pro files, exports `.gp` and MIDI, and lets several people work on the same song.

Live site: <https://nicofeals.github.io/chugpad/>

## Develop

Needs Node 22 or newer.

```sh
npm install
npm run dev        # local dev server with hot reload
npm test           # unit tests
npm run typecheck  # TypeScript check
npm run build      # production build in dist/
```

The project is TypeScript built with [Vite](https://vite.dev). There is no UI framework: screens are rendered from
template strings in `src/ui`.

| Folder | What lives there |
| --- | --- |
| `src/core` | Song model and types, constants (tunings, drum kit), note logic, drum patterns |
| `src/audio` | Sound synthesis and playback scheduling |
| `src/sync` | Saved format, merging of simultaneous edits, Firebase sign-in and sharing |
| `src/io` | Guitar Pro import/export, MIDI and text tab export |
| `src/ui` | Rendering, editing, sheets, capture (tap or hum), actions and event wiring |
| `tests` | Unit tests for the logic that has no screen |
| `public` | Files copied as-is, including `firebase-config.js` |

In development builds every module's exports are reachable from the browser console as `window.__chug`.

Type checking currently runs in a loose mode (`strict: false`). The song model in `src/core/types.ts` is fully
typed; most function parameters are not yet.

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `master`.
For that to work, **Settings > Pages > Build and deployment > Source** must be set to **GitHub Actions**.

## Sync and sharing (Firebase)

Sync and sharing use Google sign-in and the Firestore database. Without them the app still works, with songs saved
in the browser on each device.

1. Create a project at <https://console.firebase.google.com>. Analytics is not needed.
2. **Authentication > Sign-in method**: enable **Google**.
3. **Authentication > Settings > Authorized domains**: add the site's domain, for example `nicofeals.github.io`.
4. **Firestore Database**: create a database (Standard edition, Native mode, production mode).
5. **Firestore Database > Rules**: paste in `firestore.rules` from this repository and publish.
6. **Project settings > Your apps**: add a **Web app** and copy its config into `public/firebase-config.js`.

The values in `firebase-config.js` are meant to be public. What protects the data is `firestore.rules`.

### How sharing works

Each song belongs to the person who created it. In the Song menu the owner can:

- add people by email address as **viewer** (read and play) or **editor** (change the tab),
- switch a person between the two, or remove them,
- give **anyone with the link** view or edit access. They still need to sign in.

People sign in with the Google account for the email address that was added, and the song appears in their Song
menu under "Shared with you". Edits show up for everyone who has the song open. Two people working on different
bars or tracks both keep their work; if they change the same bar of the same track at once, the last save wins.

Only the owner can change who a song is shared with or delete it.

## Limits to know about

- Email addresses are matched exactly, in lower case, against the address on the Google account.
- A song is one database document, limited to 1 MB. Very long imports stay on the device they were imported on.
- The Guitar Pro reader (alphaTab) loads from a public CDN the first time a file is opened or exported.
