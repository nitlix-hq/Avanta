import TokenStore from "../util/TokenStore";

type Scope =
    | "read:user"
    | "user:email"
    | "read:org";

interface ScopeDataMap {
    "read:user": {
        /** The user's GitHub username (e.g. `"octocat"`). */
        login: string;
        /** The user's unique numeric GitHub ID. */
        id: number;
        /** The user's GraphQL node ID. */
        node_id: string;
        /**
         * Direct URL to the user's avatar image.
         *
         * Append `&s=256` (or any pixel size) to resize, e.g.:
         * ```
         * `${avatar_url}&s=256`
         * ```
         */
        avatar_url: string;
        /** URL to the user's GitHub profile page (e.g. `"https://github.com/octocat"`). */
        html_url: string;
        /** The user's display name, or `null` if not set. */
        name: string | null;
        /** The user's company, or `null` if not set. May include `@org` prefix for GitHub orgs. */
        company: string | null;
        /** The user's blog / website URL (empty string if not set). */
        blog: string;
        /** The user's location, or `null` if not set. */
        location: string | null;
        /** The user's bio, or `null` if not set. */
        bio: string | null;
        /** The user's Twitter/X username, or `null` if not set. */
        twitter_username: string | null;
        /** Number of public repositories the user owns. */
        public_repos: number;
        /** Number of public gists the user owns. */
        public_gists: number;
        /** Number of users following this user. */
        followers: number;
        /** Number of users this user is following. */
        following: number;
        /** ISO 8601 timestamp of when the account was created. */
        created_at: string;
        /** ISO 8601 timestamp of when the profile was last updated. */
        updated_at: string;
    };
    "user:email": {
        /** Array of email addresses associated with the account (from `GET /user/emails`). */
        emails: Array<{
            /** The email address. */
            email: string;
            /** Whether this is the user's primary email. */
            primary: boolean;
            /** Whether this email has been verified. */
            verified: boolean;
            /** Visibility: `"public"`, `"private"`, or `null`. */
            visibility: string | null;
        }>;
    };
    "read:org": {
        /** Array of organizations the user belongs to (from `GET /user/orgs`). */
        orgs: Array<{
            /** The organization's username / slug. */
            login: string;
            /** The organization's unique numeric GitHub ID. */
            id: number;
            /** The organization's GraphQL node ID. */
            node_id: string;
            /** Direct URL to the organization's avatar image. */
            avatar_url: string;
            /** The organization's description, or `null`. */
            description: string | null;
        }>;
    };
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

export default class GitHubProvider<const S extends readonly Scope[]> {
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
            scope: (this.scopes as readonly string[]).join(" "),
        });
        if (state) params.set("state", state);
        return `https://github.com/login/oauth/authorize?${params}`;
    }

    public async getTokens(code: string) {
        const res = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code,
                redirect_uri: this.redirectUri,
            }),
        });
        if (!res.ok) throw new Error(`Failed to get tokens: ${await res.text()}`);

        const data = await res.json() as {
            access_token: string;
            token_type: string;
            scope: string;
            expires_in?: number;
            refresh_token?: string;
            refresh_token_expires_in?: number;
            error?: string;
            error_description?: string;
        };

        if (data.error) {
            throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
        }

        return data;
    }

    /**
     * Exchange an authorization code for a TokenStore.
     *
     * If the GitHub App has **token expiration enabled**, the token will have
     * a real `expires_in` and `refresh_token`. Otherwise, the token never expires
     * and no refresh token is issued.
     */
    public async getTokenStore(code: string) {
        const res = await this.getTokens(code);
        return new TokenStore({
            access_token: res.access_token,
            refresh_token: res.refresh_token ?? "",
            access_token_expires_at: res.expires_in
                ? Date.now() + res.expires_in * 1000
                : Number.MAX_SAFE_INTEGER,
        });
    }

    public async refreshTokens(tokenStore: TokenStore) {
        if (!tokenStore.refresh_token) {
            throw new Error(
                "No refresh token available. GitHub only issues refresh tokens when token expiration is enabled on the GitHub App.",
            );
        }

        const res = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: "refresh_token",
                refresh_token: tokenStore.refresh_token,
            }),
        });
        if (!res.ok) throw new Error(`Failed to refresh tokens: ${await res.text()}`);

        const data = await res.json() as {
            access_token: string;
            token_type: string;
            scope: string;
            expires_in: number;
            refresh_token: string;
            refresh_token_expires_in: number;
            error?: string;
            error_description?: string;
        };

        if (data.error) {
            throw new Error(`GitHub refresh error: ${data.error_description ?? data.error}`);
        }

        return data;
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
     * - Calls `GET /user` when `read:user` is present.
     * - Calls `GET /user/emails` when `user:email` is present.
     * - Calls `GET /user/orgs` when `read:org` is present.
     * - Returns a single merged object typed exactly to the scopes you passed.
     */
    public async getData(tokenStore: TokenStore): Promise<DataForScopes<S>> {
        if (tokenStore.access_token_expires_at < Date.now()) {
            tokenStore = await this.refreshTokenStore(tokenStore);
        }

        const headers = {
            Authorization: `Bearer ${tokenStore.access_token}`,
            Accept: "application/vnd.github+json",
        };
        const scopeSet = new Set(this.scopes);
        const merged: any = {};

        if (scopeSet.has("read:user")) {
            const res = await fetch("https://api.github.com/user", { headers });
            if (!res.ok) throw new Error(`Failed to fetch user data: ${await res.text()}`);

            const user = await res.json();
            Object.assign(merged, {
                login: user.login,
                id: user.id,
                node_id: user.node_id,
                avatar_url: user.avatar_url,
                html_url: user.html_url,
                name: user.name,
                company: user.company,
                blog: user.blog ?? "",
                location: user.location,
                bio: user.bio,
                twitter_username: user.twitter_username,
                public_repos: user.public_repos,
                public_gists: user.public_gists,
                followers: user.followers,
                following: user.following,
                created_at: user.created_at,
                updated_at: user.updated_at,
            });
        }

        if (scopeSet.has("user:email")) {
            const res = await fetch("https://api.github.com/user/emails", { headers });
            if (!res.ok) throw new Error(`Failed to fetch emails: ${await res.text()}`);
            merged.emails = await res.json();
        }

        if (scopeSet.has("read:org")) {
            const res = await fetch("https://api.github.com/user/orgs", { headers });
            if (!res.ok) throw new Error(`Failed to fetch orgs: ${await res.text()}`);
            merged.orgs = await res.json();
        }

        return {
            tokenStore,
            ...merged,
        };
    }
}
