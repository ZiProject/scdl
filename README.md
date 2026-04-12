# @zibot/scdl

A tiny, promise-based Node.js client for searching SoundCloud, fetching track/playlist details, and downloading tracks as readable
streams.

- **Search** tracks, playlists, and users
- **Inspect** rich metadata for tracks and playlists
- **Download** a track stream (high/low quality)
- **Discover** related tracks by URL or ID

> ⚠️ Respect SoundCloud’s Terms of Service and creator rights. This library is for personal/educational use; don’t redistribute
> copyrighted content without permission.

---

## Installation

```bash
npm i @zibot/scdl
# or
yarn add @zibot/scdl
# or
pnpm add @zibot/scdl
```

**Runtime:** Node.js 18+ is recommended (built-in `fetch`/WHATWG streams). Works with ESM or CommonJS.

---

## Quick Start

### ESM

```ts
import SoundCloud from "@zibot/scdl";

const sc = new SoundCloud({ init: true }); // auto-initialize clientId

(async () => {
	// Search tracks
	const results = await sc.search({ query: "lofi hip hop", limit: 5, type: "tracks" });
	console.log(results);

	// Track details
	const track = await sc.getTrackDetails("https://soundcloud.com/user/track-slug");
	console.log(track.title, track.user.username);

	// Download a track (Readable stream)
	const stream = await sc.downloadTrack("https://soundcloud.com/user/track-slug", { quality: "high" });
	stream.pipe(process.stdout); // or pipe to fs.createWriteStream("track.mp3")

	// Related tracks
	const related = await sc.getRelatedTracks(track.id, { limit: 10 });
	console.log(related.map((t) => t.title));
})();
```

### CommonJS

```js
const SoundCloud = require("@zibot/scdl");
const fs = require("node:fs");

const sc = new SoundCloud({ init: true });

(async () => {
	const stream = await sc.downloadTrack("https://soundcloud.com/user/track-slug");
	stream.pipe(fs.createWriteStream("track.mp3"));
})();
```

---

## Initialization

The client can retrieve a valid `clientId` automatically.

```ts
// Option A: auto-init (recommended)
const sc = new SoundCloud({ init: true });

// Option B: manual init
const sc = new SoundCloud();
await sc.init(); // retrieves clientId
```

> You usually only need to call `init()` once per process. If you get authentication errors later, re-calling `init()` may refresh
> the client ID.

---

## API

### `new SoundCloud(options?)`

Create a client.

- `options.init?: boolean` – if `true`, calls `init()` internally.

**Properties**

- `clientId: string | null` – resolved after `init()`
- `apiBaseUrl: string` – internal base URL used for API calls

---

### `init(): Promise<void>`

Initialize the client (retrieve `clientId`). Call this if you didn’t pass `{ init: true }`.

---

### `search(options: SearchOptions): Promise<(Track | Playlist | User)[]>`

Search SoundCloud.

**Parameters – `SearchOptions`**

- `query: string` – search text
- `limit?: number` – default depends on endpoint (commonly 10–20)
- `offset?: number` – for pagination
- `type?: "all" | "tracks" | "playlists" | "users"` – filter result kinds (default `"all"`)

**Usage**

```ts
// Top tracks
const tracks = await sc.search({ query: "ambient study", type: "tracks", limit: 10 });

// Mixed kinds (tracks/playlists/users)
const mixed = await sc.search({ query: "chill", type: "all", limit: 5, offset: 5 });
```

---

### `getTrackDetails(url: string): Promise<Track>`

Get rich metadata for a single track by its public URL.

```ts
const t = await sc.getTrackDetails("https://soundcloud.com/artist/track");
console.log({
	id: t.id,
	title: t.title,
	url: t.permalink_url,
});
```

---

### `getPlaylistDetails(url: string): Promise<Playlist>`

Fetch playlist metadata and contained tracks.

```ts
const pl = await sc.getPlaylistDetails("https://soundcloud.com/artist/sets/playlist-slug");
console.log(pl.title, pl.tracks.length);
```

---

### `downloadTrack(url: string, options?: DownloadOptions): Promise<Readable>`

Download a track as a Node `Readable` stream.

**Parameters – `DownloadOptions`**

- `quality?: "high" | "low"` – choose available transcoding (default implementation prefers higher quality when available)

**Examples**

```ts
import fs from "node:fs";

const read = await sc.downloadTrack("https://soundcloud.com/user/track", { quality: "high" });
await new Promise((resolve, reject) => {
	read.pipe(fs.createWriteStream("track.ts")).on("finish", resolve).on("error", reject);
});
```

Pipe to any writable destination (stdout, HTTP response, cloud storage SDKs, etc.).

---

### `getRelatedTracks(track: string | number, opts?: { limit?: number; offset?: number }): Promise<Track[]>`

Fetch tracks related to a given track by **URL** or **numeric ID**.

```ts
// by URL
const relByUrl = await sc.getRelatedTracks("https://soundcloud.com/artist/track", { limit: 6 });

// by ID
const base = await sc.getTrackDetails("https://soundcloud.com/artist/track");
const relById = await sc.getRelatedTracks(base.id, { limit: 6 });
```

---

## Types

```ts
export interface SearchOptions {
	query: string;
	limit?: number;
	offset?: number;
	type?: "all" | "tracks" | "playlists" | "users";
}

export interface DownloadOptions {
	quality?: "high" | "low";
}

export interface User {
	id: number;
	username: string;
	followers_count: number;
	track_count: number;
}
```

These types are exported for TypeScript consumers.

---

## Examples

### Save the highest-quality stream to disk

```ts
import fs from "node:fs";
import SoundCloud from "@zibot/scdl";

const sc = new SoundCloud({ init: true });

async function save(url: string, file: string) {
	const stream = await sc.downloadTrack(url, { quality: "high" });
	await new Promise<void>((resolve, reject) => {
		stream.pipe(fs.createWriteStream(file)).on("finish", resolve).on("error", reject);
	});
}

save("https://soundcloud.com/user/track", "output.ts");
```

### Basic search → pick first result → download

```ts
const [first] = await sc.search({ query: "deep house 2024", type: "tracks", limit: 1 });
if (first && "url" in first) {
	const s = await sc.downloadTrack(first.url);
	s.pipe(process.stdout);
}
```

### Paginate results

```ts
const page1 = await sc.search({ query: "vaporwave", type: "tracks", limit: 20, offset: 0 });
const page2 = await sc.search({ query: "vaporwave", type: "tracks", limit: 20, offset: 20 });
```

---

## Error Handling & Tips

- **Initialization:** If a method throws due to missing/expired `clientId`, call `await sc.init()` and retry.
- **Quality selection:** Not all tracks expose multiple transcodings; the library will fall back when needed.
- **Rate limits / 429:** Back off and retry with an exponential strategy.
- **Private/geo-restricted tracks:** Details/downloads may be unavailable.
- **Networking:** Wrap downloads with proper error and close handlers to avoid dangling file descriptors.

---

## FAQ

**Q: Can I use this in the browser?** This package targets Node.js (it returns Node `Readable`). Browser use is not supported.

**Q: What audio format do I get?** Whatever the selected transcoding provides (commonly progressive MP3 or HLS AAC). You may need
to remux/encode if you require a specific container/codec.

**Q: Do I need my own client ID?** The client auto-discovers a valid `clientId`. If discovery fails due to upstream changes,
update the package to the latest version.

---

## Contributing

PRs and issues are welcome! Please include:

- A clear description of the change
- Repro steps (for bugs)
- Tests where possible

---

## License

MIT © Zibot

---

## Disclaimer

This project is not affiliated with SoundCloud. Use responsibly and comply with all applicable laws and SoundCloud’s Terms of
Service.
