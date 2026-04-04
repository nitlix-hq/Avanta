import TokenStore from "../util/TokenStore";

type Scope =
    | "user:read:email";

interface BaseUserData {
    /** The user's unique Twitch numeric ID (as a string). */
    id: string;
    /** The user's login name (lowercase, e.g. `"twitchdev"`). */
    login: string;
    /** The user's display name (case-preserved, e.g. `"TwitchDev"`). */
    display_name: string;
    /**
     * The user's account type.
     * - `""` (empty string) = normal user
     * - `"admin"` = Twitch admin
     * - `"staff"` = Twitch staff
     * - `"global_mod"` = global moderator
     */
    type: string;
    /**
     * The user's broadcaster type.
     * - `""` = normal
     * - `"affiliate"` = Twitch Affiliate
     * - `"partner"` = Twitch Partner
     */
    broadcaster_type: string;
    /** The user's channel description / bio. */
    description: string;
    /**
     * URL to the user's profile image.
     *
     * Twitch profile images are served via static CDN and can be accessed directly.
     * Replace the size suffix in the URL to get different resolutions
     * (e.g. replace `300x300` with `70x70` or `150x150`).
     */
    profile_image_url: string;
    /**
     * URL to the user's offline stream image, or empty string if not set.
     */
    offline_image_url: string;
    /** ISO 8601 timestamp of when the account was created. */
    created_at: string;
}

interface ScopeDataMap {
    "user:read:email": {
        /** The user's verified email address. Only present with the `user:read:email` scope. */
        email: string;
    };
}

type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends (k: infer I) => void
        ? I
        : never;

type DataForScopes<S extends readonly Scope[]> = BaseUserData &
    UnionToIntersection<ScopeDataMap[S[number] & keyof ScopeDataMap]> & {
        tokenStore: TokenStore;
    };

export default class TwitchProvider<const S extends readonly Scope[]> {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private scopes: S;

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
    }

    public getOAuthUrl(state?: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: "code",
            scope: (this.scopes as readonly string[]).join(" "),
        });
        if (state) params.set("state", state);
        return `https://id.twitch.tv/oauth2/authorize?${params}`;
    }

    public async getTokens(code: string) {
        const res = await fetch("https://id.twitch.tv/oauth2/token", {
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
            scope: string[];
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

    public async refreshTokens(tokenStore: TokenStore) {
        const res = await fetch("https://id.twitch.tv/oauth2/token", {
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
            scope: string[];
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
     * Fetch the authenticated user's profile from `GET /helix/users`.
     *
     * The base profile fields are always returned. Adding `user:read:email`
     * to scopes includes the user's `email` in the response.
     */
    public async getData(tokenStore: TokenStore): Promise<DataForScopes<S>> {
        if (tokenStore.access_token_expires_at < Date.now()) {
            tokenStore = await this.refreshTokenStore(tokenStore);
        }

        const res = await fetch("https://api.twitch.tv/helix/users", {
            headers: {
                Authorization: `Bearer ${tokenStore.access_token}`,
                "Client-Id": this.clientId,
            },
        });
        if (!res.ok) throw new Error(`Failed to fetch user data: ${await res.text()}`);

        const body = await res.json() as { data: any[] };
        const user = body.data[0];

        return {
            tokenStore,
            id: user.id,
            login: user.login,
            display_name: user.display_name,
            type: user.type,
            broadcaster_type: user.broadcaster_type,
            description: user.description,
            profile_image_url: user.profile_image_url,
            offline_image_url: user.offline_image_url,
            created_at: user.created_at,
            ...(user.email !== undefined ? { email: user.email } : {}),
        } as DataForScopes<S>;
    }
}
