# Web sharing

Share one currently open library **read-only** with friends so they can browse, search and preview it in a browser, without installing Serpent.

## When to use it

- Use a tunnel such as frp to map a local port to a public address and send that link to friends.
- A friend only needs a browser and the share password to browse folders, collections and tags, search, preview images / video / audio, and read descriptions, ratings and tags.

The web client is always read-only: visitors cannot import, delete, rename or change any metadata.

## Enabling

1. Open **Settings → Web Share**.
2. Set a share password (at least 8 characters). Sharing cannot be enabled without one.
3. Turn on **Enable web sharing**. The service starts on `127.0.0.1` and the page shows the local address and the active session count.
4. Point your tunnel client at that local address, e.g. forward `127.0.0.1:47890`.
5. Send the public address to friends; they enter the share password to browse.

## Settings

| Setting | Description |
| --- | --- |
| Share password | Required to enter. Changing it signs out existing visitors. |
| Shared library | Exactly one currently open library; defaults to the first open library. |
| Allow original downloads | When off, visitors can view online but cannot download source files. |
| Port | The port the service listens on at local `127.0.0.1`; the tunnel must forward the same port. |

## Security notes

- The service binds to the loopback address only; external access is entirely controlled by the tunnel you choose.
- Always set a password: a public address can be discovered by scanners.
- Turning the switch off, or quitting Serpent, stops the service immediately.
- The web client cannot modify the library; the share password is for browsing only, not an account system.

## Limitations

- Formats the browser cannot decode (some RAW, 3D, fonts, HTML, EXR, …) can only be downloaded and viewed locally.
- Video playback depends on browser codec support; unsupported codecs can only be downloaded.
- One share maps to one library.
