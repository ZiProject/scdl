import { Readable } from "stream";

// Types
export interface SearchOptions {
	query: string;
	limit?: number;
	offset?: number;
	type?: "all" | "tracks" | "playlists" | "users";
}

export interface DownloadOptions {
	quality?: "high" | "low";
}

export interface Track {
	artwork_url: string | null;
	caption: string | null;
	commentable: boolean;
	comment_count: number;
	created_at: string;
	description: string | null;
	downloadable: boolean;
	download_count: number;
	duration: number;
	full_duration: number;
	embeddable_by: string;
	genre: string;
	has_downloads_left: boolean;
	id: number;
	kind: string;
	label_name: string | null;
	last_modified: string;
	license: string;
	likes_count: number;
	permalink: string;
	permalink_url: string;
	playback_count: number;
	public: boolean;
	publisher_metadata: PublisherMetadata | null;
	purchase_title: string | null;
	purchase_url: string | null;
	release_date: string | null;
	reposts_count: number;
	secret_token: string | null;
	sharing: string;
	state: "finished" | "processing" | "failed" | string;
	streamable: boolean;
	tag_list: string;
	title: string;
	uri: string;
	urn: string;
	user_id: number;
	visuals: any | null;
	waveform_url: string;
	display_date: string;
	media: {
		transcodings: Transcoding[];
	};
	station_urn: string;
	station_permalink: string;
	track_authorization: string;
	monetization_model: string;
	policy: string;
	user: User;
}

export interface PublisherMetadata {
	id: number;
	urn: string;
	contains_music: boolean;
}

export interface Transcoding {
	url: string;
	preset: string;
	duration: number;
	snipped: boolean;
	format: {
		protocol: string;
		mime_type: string;
	};
	quality: string;
}

export interface User {
	avatar_url: string;
	city: string | null;
	comments_count: number;
	country_code: string | null;
	created_at: string | null;
	creator_subscriptions: any[];
	creator_subscription: {
		product: { id: string; [key: string]: any };
	};
	description: string | null;
	followers_count: number;
	followings_count: number;
	first_name: string;
	full_name: string;
	groups_count: number;
	id: number;
	kind: string;
	last_modified: string;
	last_name: string;
	likes_count: number;
	playlist_likes_count: number;
	permalink: string;
	permalink_url: string;
	playlist_count: number;
	reposts_count: number | null;
	track_count: number;
	uri: string;
	urn: string;
	username: string;
	verified: boolean;
	visuals: {
		urn: string;
		enabled: boolean;
		visuals: any[];
		tracking: any | null;
	} | null;
	badges: {
		pro: boolean;
		creator_mid_tier: boolean;
		pro_unlimited: boolean;
		verified: boolean;
	};
	station_urn: string;
	station_permalink: string;
	date_of_birth: string | null;
}

export interface Playlist {
	artwork_url: string | null;
	created_at: string;
	description: string | null;
	duration: number;
	embeddable_by: string;
	genre: string;
	id: number;
	kind: "playlist" | string;
	label_name: string | null;
	last_modified: string;
	license: string;
	likes_count: number;
	managed_by_feeds: boolean;
	permalink: string;
	permalink_url: string;
	public: boolean;
	purchase_title: string | null;
	purchase_url: string | null;
	release_date: string | null;
	reposts_count: number;
	secret_token: string | null;
	sharing: string;
	tag_list: string;
	title: string;
	uri: string;
	user_id: number;
	set_type: string;
	is_album: boolean;
	published_at: string | null;
	display_date: string;
	user: User;
	tracks: Track[];
	track_count: number;
}

declare class SoundCloud {
	clientId: string | null;
	apiBaseUrl: string;
	appVersion: number;

	constructor(options?: {
		init?: boolean;
		autoInit: boolean;
		apiBaseUrl: string;
		timeout: number;
		onClientId: null;
		clientId: null;
	});

	/**
	 * Initialize the SoundCloud client to retrieve clientId.
	 */
	init(): Promise<void>;

	/**
	 * Search for tracks, playlists, or users on SoundCloud.
	 */
	search(options: SearchOptions): Promise<(Track | Playlist | User)[]>;

	/**
	 * Retrieve detailed information about a single track.
	 */
	getTrackDetails(url: string): Promise<Track>;

	/**
	 * Retrieve detailed information about a playlist.
	 */
	getPlaylistDetails(url: string): Promise<Playlist>;

	/**
	 * Download a track as a stream.
	 */
	downloadTrack(url: string, options?: DownloadOptions): Promise<Readable>;

	/**
	 * Get related tracks for a given track (by URL or ID).
	 */
	getRelatedTracks(track: string | number, opts?: { limit?: number; offset?: number }): Promise<Track[]>;
}

export = SoundCloud;
