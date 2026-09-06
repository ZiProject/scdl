"use strict";

const axios = require("axios");
class SoundCloud {
	/**
	 * @param {Object} options
	 * @param {boolean} [options.autoInit=true]
	 * @param {string}  [options.apiBaseUrl="https://api-v2.soundcloud.com"]
	 * @param {number}  [options.timeout=12_000]
	 * @param {(id:string)=>void} [options.onClientId]
	 * @param {string}  [options.clientId]
	 */
	constructor(options = {}) {
		const defaultOptions = {
			autoInit: true,
			apiBaseUrl: "https://api-v2.soundcloud.com",
			timeout: 12_000,
			onClientId: null,
			clientId: null,
		};
		this.opts = { ...defaultOptions, ...options };
		this.apiBaseUrl = this.opts.apiBaseUrl;
		this.clientId = this.opts.clientId || null;
		this.appVersion = null; // Will be fetched during init

		this.http = axios.create({
			timeout: this.opts.timeout,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
				Accept: "application/json, text/javascript, */*; q=0.01",
				Referer: "https://soundcloud.com/",
			},
		});

		this._initPromise = null;
		if (this.opts.autoInit && !this.clientId) {
			this._initPromise = this.init();
		}
	}

	async ensureReady() {
		if (this.clientId && this.appVersion) return;
		if (!this._initPromise) this._initPromise = this.init();
		await this._initPromise;
	}

	async _getJson(url, { retries = 3, retryOn = [429, 500, 502, 503, 504] } = {}) {
		const separator = url.includes("?") ? "&" : "?";
		const finalUrl = this.appVersion ? `${url}${separator}app_version=${this.appVersion}` : url;

		let lastErr;
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const { data } = await this.http.get(finalUrl);
				return data;
			} catch (err) {
				lastErr = err;
				const status = err?.response?.status;
				const shouldRetry = retryOn.includes(status) || err.code === "ECONNABORTED";
				if (!shouldRetry || attempt === retries) break;
				const delay = 300 * 2 ** attempt + Math.floor(Math.random() * 150);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
		throw lastErr;
	}

	async init() {
		if (this.clientId && this.appVersion) return this.clientId;

		const clientRegexes = [
			/client_id=([a-zA-Z0-9]{32})/g,
			/client_id:"([a-zA-Z0-9]{32})"/,
			/"client_id"\s*:\s*"([a-zA-Z0-9]{32})"/g,
		];
		const versionRegex = /"app_version"\s*:\s*"([^"]+)"/;

		const homeHtml = await this.http
			.get("https://soundcloud.com")
			.then((r) => r.data)
			.catch(() => null);

		// Attempt to extract app_version from home HTML first
		if (homeHtml && versionRegex.test(homeHtml)) {
			this.appVersion = homeHtml.match(versionRegex)[1];
		}

		const scriptUrls =
			(typeof homeHtml === "string" ?
				(homeHtml.match(/<script[^>]+src="([^"]+)"/g) || []).map((t) => t.match(/src="([^"]+)"/)?.[1]).filter(Boolean)
			:	[]) || [];

		const candidates = [
			...scriptUrls.filter((u) => /sndcdn\.com|soundcloud\.com/.test(u)),
			"https://a-v2.sndcdn.com/assets/1-ff6b3.js",
		];

		for (const url of candidates) {
			try {
				const res = await this.http.get(url, { responseType: "text" });
				const text = res.data || "";

				if (!this.appVersion && versionRegex.test(text)) {
					this.appVersion = text.match(versionRegex)[1];
				}

				for (const re of clientRegexes) {
					const m = re.exec(text);
					if (m && m[1]) {
						this.clientId = m[1];
						if (typeof this.opts.onClientId === "function") this.opts.onClientId(this.clientId);
					}
				}
				if (this.clientId && this.appVersion) break;
			} catch {}
		}

		// Fallback app_version if not found
		if (!this.appVersion) this.appVersion = Math.floor(Date.now() / 1000).toString();
		if (!this.clientId) throw new Error("Không thể lấy client_id từ SoundCloud");

		return this.clientId;
	}

	async search({ query, limit = 30, offset = 0, type = "all" }) {
		await this.ensureReady();
		const path = type === "all" ? "" : `/${type}`;
		const url =
			`${this.apiBaseUrl}/search${path}` +
			`?q=${encodeURIComponent(query)}` +
			`&limit=${limit}&offset=${offset}` +
			`&access=playable&client_id=${this.clientId}`;
		try {
			const data = await this._getJson(url);
			const collection = Array.isArray(data?.collection) ? data.collection : [];
			return collection.filter((t) => t?.permalink_url && t?.title && t?.duration);
		} catch (e) {
			throw new Error("Search failed");
		}
	}

	async getTrackDetails(trackUrl) {
		await this.ensureReady();
		const item = await this.fetchItem(trackUrl);
		if (item?.kind !== "track") throw new Error("Invalid track URL");
		return item;
	}

	async getPlaylistDetails(playlistUrl) {
		await this.ensureReady();
		const playlist = await this.fetchItem(playlistUrl);
		if (playlist?.kind !== "playlist") throw new Error("Invalid playlist URL");

		const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
		const unloadedIds = tracks.filter((t) => !t?.title && t?.id).map((t) => t.id);

		let fetchedById = new Map();
		if (unloadedIds.length) {
			const more = await this.fetchTracksByIds(unloadedIds);
			fetchedById = new Map(more.filter((t) => t?.id).map((t) => [t.id, t]));
		}

		// Giữ nguyên thứ tự gốc của playlist, chỉ thay các track "rỗng" bằng
		// bản đầy đủ vừa fetch; bỏ qua những track không fetch được.
		playlist.tracks = tracks.map((t) => (t?.title ? t : fetchedById.get(t?.id) || null)).filter(Boolean);
		return playlist;
	}
	async downloadTrack(trackOrPlaylistUrl, options = { seek: 0 }) {
		await this.ensureReady();
		try {
			let item = await this.fetchItem(trackOrPlaylistUrl);

			let track;
			if (item.kind === "playlist") {
				if (!item.tracks || item.tracks.length === 0) {
					throw new Error("This playlist contains no songs.");
				}
				track = item.tracks[0];

				if (!track.media) {
					track = track.permalink_url ? await this.getTrackDetails(track.permalink_url) : await this.fetchTrackById(track.id);
				}
			} else if (item.kind === "track") {
				track = item;
			} else {
				throw new Error("The URL is not a valid song or playlist.");
			}

			if (track?.policy === "BLOCK" || track?.state === "blocked") {
				throw new Error(`Song "${track.title}" blocked.`);
			}

			const transcodings = this._getSortedTranscodings(track);
			if (!transcodings.length) throw new Error("No suitable stream found for this song.");

			const seekMs = Math.max(0, Number(options?.seek) || 0);

			for (const transcoding of transcodings) {
				try {
					const streamUrl = await this.getStreamUrl(transcoding.url);

					if (transcoding.format?.protocol === "hls") {
						return this._createHlsStream(streamUrl, seekMs, {
							signal: options?.signal,
							track,
						});
					}

					if (transcoding.format?.protocol === "progressive") {
						const headers = {};

						if (seekMs > 0) {
							// Bitrate mặc định (fallback) nếu không xác định được kích thước file thực tế
							let bitrate = 128000;
							try {
								const head = await this.http.head(streamUrl);
								const contentLength = Number(head.headers?.["content-length"]);
								const durationSec = (Number(track?.duration) || 0) / 1000;
								if (contentLength > 0 && durationSec > 0) {
									bitrate = (contentLength * 8) / durationSec;
								}
							} catch {
								// Giữ bitrate mặc định nếu HEAD request thất bại
							}

							const startByte = Math.floor((seekMs / 1000) * (bitrate / 8));
							headers.Range = `bytes=${startByte}-`;
						}

						const res = await this.http.get(streamUrl, {
							responseType: "stream",
							headers,
						});

						return res.data;
					}
				} catch (err) {
					continue;
				}
			}

			throw new Error("It is not possible to initialize the load stream for all formats.");
		} catch (e) {
			console.error("Failed to download:", e?.message || e);

			return null;
		}
	}

	async fetchItem(itemUrl) {
		await this.ensureReady();
		const url = `${this.apiBaseUrl}/resolve?url=${encodeURIComponent(itemUrl)}&client_id=${this.clientId}`;
		try {
			return await this._getJson(url);
		} catch (e) {
			throw new Error("Failed to fetch item details");
		}
	}

	async fetchTrackById(id) {
		await this.ensureReady();
		if (!id) throw new Error("Missing track id");
		const url = `${this.apiBaseUrl}/tracks/${id}?client_id=${this.clientId}`;
		try {
			return await this._getJson(url);
		} catch (e) {
			throw new Error("Failed to fetch track by ID");
		}
	}

	async fetchTracksByIds(trackIds) {
		await this.ensureReady();
		const ids = Array.from(new Set(trackIds.filter(Boolean)));
		if (!ids.length) return [];
		const chunkSize = 50;
		const chunks = [];
		for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

		try {
			const results = await Promise.all(
				chunks.map(async (chunk) => {
					const url = `${this.apiBaseUrl}/tracks?ids=${chunk.join(",")}&client_id=${this.clientId}`;
					return await this._getJson(url);
				}),
			);
			return results.flat();
		} catch (error) {
			throw new Error("Failed to fetch tracks by IDs");
		}
	}

	async getStreamUrl(transcodingUrl) {
		await this.ensureReady();
		const url = `${transcodingUrl}${transcodingUrl.includes("?") ? "&" : "?"}client_id=${this.clientId}`;
		try {
			const data = await this._getJson(url);
			if (!data?.url) throw new Error("No stream URL in response");
			return data.url;
		} catch (error) {
			if (error?.response?.status === 401 || error?.response?.status === 403) {
				this.clientId = null;
				this._initPromise = this.init();
				await this._initPromise;
				const retryUrl = `${transcodingUrl}${transcodingUrl.includes("?") ? "&" : "?"}client_id=${this.clientId}`;
				const data = await this._getJson(retryUrl);
				if (!data?.url) throw new Error("No stream URL in response (after refresh)");
				return data.url;
			}
			throw error;
		}
	}

	_getSortedTranscodings(track) {
		const list = Array.isArray(track?.media?.transcodings) ? track.media.transcodings : [];

		const score = (t) => {
			let s = 0;
			const proto = t?.format?.protocol;
			const mime = t?.format?.mime_type || "";
			const isLegacy = t?.is_legacy_transcoding;

			// Priority 1: Modern transcodings (aac_160k, etc.)
			if (isLegacy === false) s += 1000;

			// Priority 2: Protocol (HLS generally preferred for performance)
			if (proto === "hls") s += 100;
			else if (proto === "progressive") s += 50;

			// Priority 3: Codec quality
			if (mime.includes("opus")) s += 30;
			if (mime.includes("mp4") || mime.includes("aac")) s += 25;
			if (mime.includes("mpeg")) s += 10;

			return s;
		};

		return [...list].sort((a, b) => score(b) - score(a));
	}

	async _getHlsPlaylist(streamUrl) {
		const headers = {
			"User-Agent": this.http.defaults.headers["User-Agent"],
			Referer: "https://soundcloud.com/",
			Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
		};

		const res = await this.http.get(streamUrl, {
			responseType: "text",
			headers,
		});

		const text = String(res.data || "");

		if (!text.includes("#EXTM3U")) {
			throw new Error("Invalid HLS playlist");
		}

		// This implementation expects a media playlist, not a master playlist.
		if (text.includes("#EXT-X-STREAM-INF")) {
			throw new Error("HLS master playlist is not supported");
		}

		const lines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);

		let init = null;
		const segments = [];

		let currentTimeMs = 0;
		let pendingDurationMs = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			/*
			 * fMP4 initialization segment:
			 *
			 * #EXT-X-MAP:URI="init.mp4"
			 *
			 * Optional:
			 *
			 * #EXT-X-MAP:URI="init.mp4",BYTERANGE="1234@0"
			 */
			if (line.startsWith("#EXT-X-MAP:")) {
				const attributes = line.slice("#EXT-X-MAP:".length);

				const uriMatch = attributes.match(/(?:^|,)URI="([^"]+)"/i);

				if (!uriMatch) {
					throw new Error("HLS EXT-X-MAP has no URI");
				}

				const byteRangeMatch = attributes.match(/(?:^|,)BYTERANGE="([^"]+)"/i);

				let range = null;

				if (byteRangeMatch) {
					const match = byteRangeMatch[1].match(/^(\d+)(?:@(\d+))?$/);

					if (match) {
						range = {
							length: Number(match[1]),
							offset: match[2] != null ? Number(match[2]) : 0,
						};
					}
				}

				init = {
					url: new URL(uriMatch[1], streamUrl).toString(),
					range,
				};

				continue;
			}

			/*
			 * Segment duration:
			 *
			 * #EXTINF:5.013,
			 */
			if (line.startsWith("#EXTINF:")) {
				const match = line.match(/^#EXTINF:\s*([\d.]+)/i);

				if (match) {
					pendingDurationMs = Number(match[1]) * 1000;
				}

				continue;
			}

			/*
			 * Optional segment byte range:
			 *
			 * #EXT-X-BYTERANGE:12345@67890
			 */
			if (line.startsWith("#EXT-X-BYTERANGE:")) {
				const value = line.slice("#EXT-X-BYTERANGE:".length).trim();

				const match = value.match(/^(\d+)(?:@(\d+))?$/);

				if (match && segments.length > 0) {
					segments[segments.length - 1].range = {
						length: Number(match[1]),
						offset: match[2] != null ? Number(match[2]) : null,
					};
				}

				continue;
			}

			/*
			 * Ignore HLS tags.
			 */
			if (line.startsWith("#")) {
				continue;
			}

			/*
			 * This is the actual media segment URI.
			 */
			if (pendingDurationMs != null) {
				segments.push({
					url: new URL(line, streamUrl).toString(),
					startMs: currentTimeMs,
					durationMs: pendingDurationMs,
					range: null,
				});

				currentTimeMs += pendingDurationMs;
				pendingDurationMs = null;
			}
		}

		if (!init) {
			throw new Error("HLS playlist has no initialization segment");
		}

		if (!segments.length) {
			throw new Error("HLS playlist has no media segments");
		}

		/*
		 * Resolve implicit BYTERANGE offsets.
		 *
		 * BYTERANGE="length@offset"
		 * can omit @offset, meaning the previous range ends
		 * where this one starts.
		 */
		let previousEnd = 0;

		for (const segment of segments) {
			if (!segment.range) continue;

			if (segment.range.offset == null) {
				segment.range.offset = previousEnd;
			}

			previousEnd = segment.range.offset + segment.range.length;
		}

		return {
			url: streamUrl,
			init,
			segments,
			durationMs: currentTimeMs,
		};
	}
	_findNearestHlsSegment(segments, seekMs = 0) {
		if (!Array.isArray(segments) || segments.length === 0) {
			throw new Error("No HLS segments available");
		}

		seekMs = Math.max(0, Number(seekMs) || 0);

		/*
		 * No seek -> first segment.
		 */
		if (seekMs <= 0) {
			return 0;
		}

		/*
		 * Find the segment containing the requested position.
		 *
		 * startMs <= seek < endMs
		 */
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];

			const start = segment.startMs;
			const end = start + segment.durationMs;

			if (seekMs >= start && seekMs < end) {
				return i;
			}
		}

		/*
		 * Seek is after the playlist.
		 * Use the last available segment instead of failing.
		 */
		if (seekMs >= segments[segments.length - 1].startMs) {
			return segments.length - 1;
		}

		/*
		 * Fallback: closest segment by start time.
		 */
		let bestIndex = 0;
		let bestDistance = Infinity;

		for (let i = 0; i < segments.length; i++) {
			const distance = Math.abs(segments[i].startMs - seekMs);

			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = i;
			}
		}

		return bestIndex;
	}
	async _createHlsStream(streamUrl, seekMs = 0, options = {}) {
		const { PassThrough } = require("stream");

		seekMs = Math.max(0, Number(seekMs) || 0);

		const playlist = await this._getHlsPlaylist(streamUrl);
		const startIndex = this._findNearestHlsSegment(playlist.segments, seekMs);

		const startSegment = playlist.segments[startIndex];

		const output = new PassThrough();

		const trackDuration = Number(options?.track?.duration) || 0;
		const fullDuration = Number(options?.track?.full_duration) || 0;

		const duration = trackDuration || playlist.durationMs || 0;

		const metadata = {
			trackId: options?.track?.id ?? null,
			title: options?.track?.title ?? null,

			duration,
			fullDuration,

			seek: seekMs,

			start: startSegment.startMs,

			end: startSegment.startMs + startSegment.durationMs,

			offset: startSegment.startMs - seekMs,

			currentTime: startSegment.startMs,

			segmentIndex: startIndex,

			segmentStart: startSegment.startMs,

			segmentEnd: startSegment.startMs + startSegment.durationMs,

			segmentDuration: startSegment.durationMs,

			playlistDuration: playlist.durationMs,

			url: streamUrl,
		};

		/*
		 * Keep metadata attached to the stream so existing
		 * consumers can continue treating it as a Readable.
		 */
		output.metadata = metadata;

		/*
		 * Convenience property.
		 */
		Object.defineProperty(output, "currentTime", {
			enumerable: true,

			get() {
				return metadata.currentTime;
			},
		});

		/*
		 * Return a snapshot instead of the mutable object.
		 */
		output.getMetadata = () => ({
			...metadata,
		});

		const headers = {
			"User-Agent": this.http.defaults.headers["User-Agent"],

			Referer: "https://soundcloud.com/",
		};

		const abortController = new AbortController();

		const cleanup = () => {
			if (!abortController.signal.aborted) {
				abortController.abort();
			}
		};

		output.once("close", cleanup);
		output.once("error", cleanup);

		/*
		 * External AbortSignal.
		 */
		if (options?.signal) {
			if (options.signal.aborted) {
				output.destroy(new Error("HLS stream aborted"));

				return output;
			}

			const onAbort = () => {
				output.destroy(new Error("HLS stream aborted"));
			};

			options.signal.addEventListener("abort", onAbort, { once: true });

			output.once("close", () => {
				options.signal.removeEventListener("abort", onAbort);
			});
		}

		const requestBuffer = async (url, range = null) => {
			const requestHeaders = {
				...headers,
			};

			if (range) {
				requestHeaders.Range = `bytes=${range.offset}-${range.offset + range.length - 1}`;
			}

			const res = await this.http.get(url, {
				responseType: "arraybuffer",
				headers: requestHeaders,
				signal: abortController.signal,
			});

			return Buffer.from(res.data);
		};

		const writeBuffer = async (buffer) => {
			if (output.destroyed || abortController.signal.aborted) {
				throw new Error("HLS output stream destroyed");
			}

			if (output.write(buffer)) {
				return;
			}

			await new Promise((resolve, reject) => {
				const onDrain = () => {
					cleanupListeners();
					resolve();
				};

				const onClose = () => {
					cleanupListeners();

					reject(new Error("HLS output stream closed"));
				};

				const onError = (error) => {
					cleanupListeners();
					reject(error);
				};

				const cleanupListeners = () => {
					output.removeListener("drain", onDrain);

					output.removeListener("close", onClose);

					output.removeListener("error", onError);
				};

				output.once("drain", onDrain);
				output.once("close", onClose);
				output.once("error", onError);
			});
		};

		/*
		 * Update timeline metadata.
		 */
		const updateSegmentMetadata = (segment, index) => {
			const start = segment.startMs;
			const end = segment.startMs + segment.durationMs;

			metadata.currentTime = start;

			metadata.segmentIndex = index;

			metadata.segmentStart = start;

			metadata.segmentEnd = end;

			metadata.segmentDuration = segment.durationMs;

			metadata.start = start;
			metadata.end = end;
			metadata.offset = start - metadata.seek;
			/*
			 * Custom event:
			 *
			 * stream.on("segment", info => ...)
			 */
			output.emit("segment", {
				index,

				start,

				end,

				duration: segment.durationMs,

				currentTime: start,

				offset: start - metadata.seek,

				segment,
			});
		};

		/*
		 * Download asynchronously so caller immediately
		 * receives the Readable.
		 */
		(async () => {
			try {
				/*
				 * fMP4 requires the initialization segment
				 * before the first media fragment.
				 */
				const initBuffer = await requestBuffer(playlist.init.url, playlist.init.range);

				await writeBuffer(initBuffer);

				/*
				 * Stream from the nearest segment.
				 */
				for (let i = startIndex; i < playlist.segments.length; i++) {
					if (abortController.signal.aborted || output.destroyed) {
						break;
					}

					const segment = playlist.segments[i];

					updateSegmentMetadata(segment, i);

					const buffer = await requestBuffer(segment.url, segment.range);

					await writeBuffer(buffer);
				}

				/*
				 * Mark the stream at the end of the
				 * last emitted segment.
				 */
				if (!output.destroyed && playlist.segments.length > 0) {
					const last = playlist.segments[playlist.segments.length - 1];

					metadata.currentTime = last.startMs + last.durationMs;

					metadata.segmentEnd = metadata.currentTime;

					output.end();
				}
			} catch (error) {
				if (!output.destroyed) {
					output.destroy(error);
				}
			}
		})();

		return output;
	}
	_pickBestTranscoding(track) {
		return this._getSortedTranscodings(track)[0] || null;
	}

	async _resolveTrackId(input) {
		await this.ensureReady();
		if (!input) throw new Error("Missing track identifier");
		if (typeof input === "number" || /^[0-9]+$/.test(String(input))) {
			return Number(input);
		}
		const item = await this.fetchItem(input);
		if (item?.kind !== "track" || !item?.id) {
			throw new Error("Cannot resolve track ID from input");
		}
		return item.id;
	}

	async getRelatedTracks(track, { limit = 20, offset = 0 } = {}) {
		await this.ensureReady();
		const id = await this._resolveTrackId(track);
		const url = `${this.apiBaseUrl}/tracks/${id}/related` + `?limit=${limit}&offset=${offset}&client_id=${this.clientId}`;

		try {
			const data = await this._getJson(url);
			const collection =
				Array.isArray(data?.collection) ? data.collection
				: Array.isArray(data) ? data
				: [];
			return collection.filter((t) => t?.permalink_url && t?.title && t?.duration);
		} catch (e) {
			return [];
		}
	}
}

module.exports = SoundCloud;
