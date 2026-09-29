# Web sharing

Share one currently open library with friends: they browse, search and preview in a browser and can mark their own likes and ratings. No Serpent install needed, and your library is never modified.

## When to use it

- Use a tunnel such as frp to map a local port to a public address and send that link to friends.
- A friend opens the link and types a username (any name works) to browse folders, collections and tags, search and preview images / video / audio, read descriptions, and download.

## Visitor marks

- Each visitor can set **Like** and their own 1–5 star rating on any asset (clicking the Nth star sets N stars).
- Those marks are kept on **this device**, per visitor, and **never modify the library** — the operator's own rating and favorite are unaffected.
- Visitors can only write their own marks; importing, deleting, renaming and metadata edits are unavailable in the web client.

## Visitor records (operator)

Under **Settings → Web sharing → Visitor records** you can see each visitor's username, IP, User-Agent, sign-in count, first/last seen time, and which images they liked or rated, and export it as **JSON / CSV**. Records stay on this device.

## Thumbnails (share-only)

The grid tiles are a **separate set of small images generated for web sharing only**; they never change the app's own thumbnails.

- **Resolution**: 128px / 256px (default 128px). Both sizes are cached; this setting only picks which one visitors see.
- **Sharpen**: on by default. A mild unsharp mask after downscaling keeps edges crisp (128px looks soft without it).
- **Auto-generate**: on import, if the asset belongs to the **currently shared library**, both sizes are generated automatically.
- **Regenerate (fallback)**: the settings button fills in missing tiles at the current resolution, skips ones that already exist and are current, and prunes files for deleted or replaced images.
- Tiles are WebP, stored inside the library under `.serpent/share-thumbnails/`, deleted with the library, and **not included in a library export (Serpent ZIP)**.

## Enabling

1. Open **Settings → Web Sharing**.
2. (Optional) Set an **access password**. Leave it empty for no password — visitors then only type a username.
3. Turn on **Enable web sharing**. The service starts on `127.0.0.1` and the page shows the local address and the active session count.
4. Point your tunnel client at that local address, e.g. forward `127.0.0.1:47890`.
5. Send the public address to friends; they type a username (and the password, if set) to browse.

## Settings

| Setting | Description |
| --- | --- |
| Access password (optional) | Leave empty for username-only entry. When set, visitors must enter it too; changing it signs out existing visitors. |
| Shared library | Exactly one currently open library; defaults to the first open library. |
| Allow original downloads | When off, visitors can view online but cannot download source files. |
| Thumbnail resolution | Longest edge of the visitor grid tiles, 128px / 256px. |
| Sharpen thumbnails | Apply a mild unsharp mask (on by default). |
| Regenerate thumbnails | Fill in missing share thumbnails at the current resolution (fallback). |
| Port | The port the service listens on at local `127.0.0.1`; the tunnel must forward the same port. |
| Visitor records | View and export visitor marks and access details. |

## Security and privacy

- The service binds to the loopback address only; external access is entirely controlled by the tunnel you choose.
- **With no password, anyone who has the public address can enter.** A public address can be discovered by scanners, so keep it private or set a password.
- Visitor records include personal data such as IP and User-Agent; they stay on this device. Use them lawfully.
- Turning the switch off, or quitting Serpent, stops the service immediately.

## Limitations

- The web client cannot import, delete, rename or change any library content; visitors can only write their own likes and ratings.
- Formats the browser cannot decode (some RAW, 3D, fonts, HTML, EXR, …) can only be downloaded and viewed locally.
- Video playback depends on browser codec support; unsupported codecs can only be downloaded.
- One share maps to one library.
