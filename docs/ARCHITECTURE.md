# Architecture

Scrawl is a single Rust binary plus a small web front end that is compiled into it.

```
browser (web/board.js, SVG)  <-- WebSocket /ws/<room> -->  src/main.rs (axum)  --> data/boards/<room>.json
                              <-- POST /api/upload      -->                      --> data/files/<id>.<ext>
```

## Server (`src/main.rs`)

- **Rooms.** A board is a room named in the URL (`/b/<code>`). A room holds an ordered list of objects, the connected users, and a `tokio::sync::broadcast` channel. Rooms load from `data/boards/<room>.json` on first use and are evicted from memory when empty and saved.
- **Protocol.** JSON text frames. Client to server: `add`, `upd` (partial patch), `del`, `clear`, `cur` (cursor). Server to client: `init` (all objects and users, sent on connect), `join`, `leave`, plus the relayed `add`/`upd`/`del`/`clear`/`cur`, each tagged with `from` so clients ignore their own echoes.
- **Validation.** Every object is checked in `clean_obj`/`check_fields`: allowed types (`stroke`, `shape`, `text`, `note`, `image`), id format, finite and bounded numbers, colour strings filtered to a safe alphabet, text length, stroke point count, image `src` restricted to `/files/...` or `http(s)://`. Anything else is dropped silently.
- **Limits.** 6000 objects and 60 users per room, 512 KB per message, a token-bucket rate limit per connection, 10 MB uploads, 30 uploads per minute per IP.
- **Persistence.** A background task writes dirty rooms every two seconds (write to `.tmp`, then rename).
- **Uploads.** `POST /api/upload` sniffs the file signature (PNG, JPEG, GIF, WebP), stores it under a random name and returns `/files/<name>`. Served with `nosniff` and `default-src 'none'`.
- **Static files.** `web/*` is embedded with `include_str!`/`include_dir!`, so deployment is one file.

## Front end (`web/board.js`)

- Everything renders to one SVG. A `<g>` holds the camera transform (pan and zoom); objects are `<g data-id>` groups. Strokes, shapes, text, notes and images are rebuilt from plain objects, so remote updates and local edits use the same code path (`addLocal`, `updLocal`, `delLocal`).
- Animated GIFs are plain `<image>` elements inside the SVG, so the browser animates them.
- **Undo/redo** keeps a local stack of operations (`add`, `del`, `upd`, `batch`); undoing sends the inverse operation to the server like any other edit.
- **Moves and resizes** apply locally on every pointer move and are sent throttled (about 20 per second), with the final state sent on release.
- Hit testing uses the DOM (`elementFromPoint`) against invisible, wider stroke paths, so thin lines are easy to grab.
- Text editing uses a temporary `<textarea>` positioned over the object.

## Landing page and site

`web/home.html` and `web/landing.css` are served at `/` by the binary. `tools/build-site.py` copies them (and `web/img/`) into `site/` for static hosting, where `site/config.js` tells the page where the board server lives.

## Known limits

Last write wins when two people edit the same object at once. There is no per-object locking, no board passwords and no history beyond each person's local undo stack.
