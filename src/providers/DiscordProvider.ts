import TokenStore from "../util/TokenStore";

type Scope =
    | "identify"
    | "email"
    | "guilds"
    | "guilds.join"
    | "guilds.members.read"
    | "connections"
    | "gdm.join"
    | "role_connections.write"
    | "dm_channels.read"; // requires Discord approval for some scopes (activities.*, rpc.*, voice, etc. are omitted as they are not generally available or require special approval)

interface ScopeDataMap {
    identify: {
        /** The user's unique Discord snowflake ID. */
        id: string;
        /** The user's username (not unique since the new username system). */
        username: string;
        /**
         * The user's avatar hash, or `null` if unset.
         *
         * Reconstruct the URL:
         * ```
         * `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
         * ```
         * Append `?size=1024` (or 128, 256, 512, etc.) for a specific resolution.
         * Use `.gif` instead of `.png` if the hash starts with `a_`.
         */
        avatar: string | null;
        /**
         * The user's four-digit discriminator tag.
         * `"0"` for users on the new unique username system.
         */
        discriminator: string;
        /** The user's display name, or `null` if not set. */
        global_name: string | null;
        /**
         * The user's banner hash, or `null` if unset.
         *
         * Reconstruct the URL:
         * ```
         * `https://cdn.discordapp.com/banners/${id}/${banner}.png`
         * ```
         * Append `?size=1024` for a specific resolution.
         * Use `.gif` instead of `.png` if the hash starts with `a_`.
         */
        banner: string | null;
        /** The user's banner color as an integer representation of a hex color code, or `null` if unset. */
        accent_color: number | null;
        /** The user's chosen language option (e.g. `"en-US"`). */
        locale: string;
        /** Whether the user has two-factor authentication enabled. */
        mfa_enabled: boolean;
        /**
         * The type of Nitro subscription on the user's account.
         * - `0` = None
         * - `1` = Nitro Classic
         * - `2` = Nitro
         * - `3` = Nitro Basic
         */
        premium_type: number;
        /** The public flags on the user's account (bit field). */
        public_flags: number;
        /** Additional fields that may appear (e.g. `avatar_decoration_data`, `flags`). */
        [key: string]: any;
    };
    email: {
        /** The user's email address. Requires the user to have a verified email on their account. */
        email: string;
        /** Whether the user's email address has been verified. */
        verified: boolean;
    };
    guilds: {
        /** Array of partial guild objects (from `/users/@me/guilds`). Updated structure includes `features` and presence counts when requested. */
        guilds: Array<{
            /** The guild's unique Discord snowflake ID. */
            id: string;
            /** The name of the guild. */
            name: string;
            /**
             * The guild's icon hash, or `null` if unset.
             *
             * Reconstruct the URL:
             * ```
             * `https://cdn.discordapp.com/icons/${id}/${icon}.png`
             * ```
             * Append `?size=1024` for a specific resolution.
             * Use `.gif` instead of `.png` if the hash starts with `a_`.
             */
            icon: string | null;
            /**
             * The guild's banner hash, or `null` if unset.
             */
            banner: string | null;
            /** `true` if the authenticated user owns this guild. */
            owner: boolean;
            /** The user's permissions in this guild (bit field as a string). */
            permissions: string;
            /** Guild features (e.g. `COMMUNITY`, `NEWS`). */
            features?: string[];
            /** Approximate number of members (when `with_counts=true`). */
            approximate_member_count?: number;
            /** Approximate number of presences (when `with_counts=true`). */
            approximate_presence_count?: number;
        }>;
    };
    connections: {
        /** Array of connection objects (from `/users/@me/connections`). */
        connections: Array<{
            id: string;
            name: string;
            type: string;
            verified: boolean;
            revoked?: boolean;
            /** Additional fields (integrations, visibility, etc.). */
            [key: string]: any;
        }>;
    };
    "guilds.join": {};
    "guilds.members.read": {};
    "gdm.join": {};
    "role_connections.write": {};
    "dm_channels.read": {};
}

type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never;

type DataForScopes<S extends readonly Scope[]> = UnionToIntersection<
    ScopeDataMap[S[number] & keyof ScopeDataMap]
> & {
    tokenStore: TokenStore;
};

interface JoinGuildOptions {
    /** Value to set the user’s nickname (requires `MANAGE_NICKNAMES` permission on the bot). */
    nick?: string | null;
    /** Array of role IDs to assign (requires `MANAGE_ROLES`). */
    roles?: string[];
    /** Whether the user is muted in voice channels (requires `MUTE_MEMBERS`). */
    mute?: boolean;
    /** Whether the user is deafened in voice channels (requires `DEAFEN_MEMBERS`). */
    deaf?: boolean;
}

type ActionMap = {
    "guilds.join": {
        guilds: {
            /**
             * Joins the user (via their OAuth2 access token) to a guild.
             * Requires the bot to already be in the guild with `CREATE_INSTANT_INVITE` permission.
             * Endpoint: `PUT /guilds/{guild.id}/members/@me`
             *
             * @returns The guild member object on success (201), or `null` if already a member (204).
             */
            join: ({
                guildId,
                tokenStore,
                botToken,
                options,
            }: {
                guildId: string;
                tokenStore: TokenStore;
                botToken: string;
                options?: JoinGuildOptions;
            }) => Promise<any>;
        };
    };
    "guilds.members.read": {
        guilds: {
            members: {
                /**
                 * Gets the current user's member object in a specific guild.
                 * Endpoint: `GET /users/@me/guilds/{guild.id}/member`
                 */
                read: ({
                    guildId,
                    tokenStore,
                }: {
                    guildId: string;
                    tokenStore: TokenStore;
                }) => Promise<any>;
            };
        };
    };
};

type ScopeToAction<U> = U extends keyof ActionMap ? ActionMap[U] : {};

type ActionsForScopes<S extends readonly Scope[]> = UnionToIntersection<
    ScopeToAction<S[number]>
>;

export default class DiscordProvider<const S extends readonly Scope[]> {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private scopes: S;

    /** Scope-dependent actions (only methods for the requested scopes are present at the type level). */
    public readonly actions: ActionsForScopes<S>;

    constructor({
        clientId,
        clientSecret,
        redirectUri,
        scopes,
    }: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        scopes: [...S];
    }) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.scopes = scopes as S;

        const scopeSet = new Set(this.scopes);
        const actions: any = {};

        if (scopeSet.has("guilds.join") || scopeSet.has("guilds.members.read")) {
            actions.guilds = {};
        }

        if (scopeSet.has("guilds.join")) {
            actions.guilds.join = async ({
                guildId,
                tokenStore,
                botToken,
                options,
            }: {
                guildId: string;
                tokenStore: TokenStore;
                botToken: string;
                options?: JoinGuildOptions;
            }) => {
                if (tokenStore.access_token_expires_at < Date.now()) {
                    tokenStore = await this.refreshTokenStore(tokenStore);
                }

                const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
                    method: "PUT",
                    headers: {
                        "Authorization": `Bot ${botToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        access_token: tokenStore.access_token,
                        ...options,
                    }),
                });

                if (res.status === 204) return { tokenStore, data: null };
                if (!res.ok) {
                    throw new Error(`Failed to join guild: ${res.status} ${await res.text()}`);
                }
                return {
                    tokenStore,
                    data: await res.json(),
                };
            };
        }

        if (scopeSet.has("guilds.members.read")) {
            actions.guilds.members = {};
            actions.guilds.members.read = async ({
                guildId,
                tokenStore,
            }: {
                guildId: string;
                tokenStore: TokenStore;
            }) => {
                if (tokenStore.access_token_expires_at < Date.now()) {
                    tokenStore = await this.refreshTokenStore(tokenStore);
                }

                const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
                    headers: { Authorization: `Bearer ${tokenStore.access_token}` },
                });
                if (!res.ok) {
                    throw new Error(`Failed to get guild member: ${res.status} ${await res.text()}`);
                }
                return {
                    tokenStore,
                    data: await res.json(),
                };
            };
        }

        this.actions = actions as ActionsForScopes<S>;
    }

    public getOAuthUrl(state?: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: "code",
            scope: (this.scopes as readonly string[]).join(" "),
        });
        if (state) params.set("state", state);
        return `https://discord.com/api/oauth2/authorize?${params}`;
    }

    public async getTokens(code: string) {
        const res = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: "authorization_code",
                code,
                redirect_uri: this.redirectUri,
            }),
        });
        if (!res.ok) throw new Error(`Failed to get tokens: ${await res.text()}`);
        return res.json() as Promise<{
            access_token: string;
            token_type: string;
            expires_in: number;
            refresh_token: string;
            scope: string;
        }>;
    }

    public async getTokenStore(code: string) {
        const res = await this.getTokens(code);
        return new TokenStore({
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            access_token_expires_at: Date.now() + res.expires_in * 1000,
        });
    }

    /**
     * Convert a refresh token into a new access token (and possibly a new refresh token).
     * Uses the standard OAuth2 refresh flow (Discord API v10).
     */
    public async refreshTokens(tokenStore: TokenStore) {
        const res = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: "refresh_token",
                refresh_token: tokenStore.refresh_token,
            }),
        });
        if (!res.ok) throw new Error(`Failed to refresh tokens: ${await res.text()}`);
        return res.json() as Promise<{
            access_token: string;
            token_type: string;
            expires_in: number;
            refresh_token: string;
            scope: string;
        }>;
    }

    public async refreshTokenStore(tokenStore: TokenStore) {
        const res = await this.refreshTokens(tokenStore);
        return new TokenStore({
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            access_token_expires_at: Date.now() + res.expires_in * 1000,
        });
    }

    /**
     * Fetch all data authorized by the requested scopes.
     * - Always calls `/users/@me` (identify + email).
     * - Conditionally calls `/users/@me/guilds` (guilds scope) and `/users/@me/connections` (connections scope).
     * - Returns a single merged object typed exactly to the scopes you passed.
     */
    public async getData(tokenStore: TokenStore): Promise<DataForScopes<S>> {
        if (tokenStore.access_token_expires_at < Date.now()) {
            tokenStore = await this.refreshTokenStore(tokenStore);
        }

        const headers = { Authorization: `Bearer ${tokenStore.access_token}` };

        const promises: Promise<any>[] = [
            fetch("https://discord.com/api/v10/users/@me", { headers }).then(r => {
                if (!r.ok) throw new Error(`Failed to fetch user data: ${r.status}`);
                return r.json();
            }),
        ];

        const scopeSet = new Set(this.scopes);

        if (scopeSet.has("guilds")) {
            promises.push(
                fetch("https://discord.com/api/v10/users/@me/guilds", { headers }).then(r => {
                    if (!r.ok) throw new Error(`Failed to fetch guilds: ${r.status}`);
                    return r.json().then(guilds => ({ guilds }));
                })
            );
        }

        if (scopeSet.has("connections")) {
            promises.push(
                fetch("https://discord.com/api/v10/users/@me/connections", { headers }).then(r => {
                    if (!r.ok) throw new Error(`Failed to fetch connections: ${r.status}`);
                    return r.json().then(connections => ({ connections }));
                })
            );
        }

        const results = await Promise.all(promises);
        const data = results[0]; // base user data

        // Merge additional data from other endpoints
        for (let i = 1; i < results.length; i++) {
            Object.assign(data, results[i]);
        }

        return {
            tokenStore,
            ...data,
        };
    }
}