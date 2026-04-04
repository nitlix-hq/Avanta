import TokenStore from "../util/TokenStore";

type Scope =
    | "openid"
    | "profile"
    | "email";

interface ScopeDataMap {
    openid: {
        /** The user's unique Google account ID (stable, never changes). */
        sub: string;
    };
    profile: {
        /** The user's full display name (e.g. `"Jane Doe"`). */
        name: string;
        /** The user's given (first) name. */
        given_name: string;
        /** The user's family (last) name. */
        family_name: string;
        /**
         * URL to the user's profile picture.
         *
         * Append `=s256` (or any pixel size) to resize, e.g.:
         * ```
         * `${picture}=s256`
         * ```
         * The default URL usually returns a 96x96 image.
         */
        picture: string;
        /** The user's locale / language preference (e.g. `"en"`). */
        locale: string;
    };
    email: {
        /** The user's primary Google email address. */
        email: string;
        /** Whether Google has verified this email address. */
        email_verified: boolean;
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

export default class GoogleProvider<const S extends readonly Scope[]> {
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
        const scopeUrls = (this.scopes as readonly string[]).map(
            s => `https://www.googleapis.com/auth/${s}`
        );

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: "code",
            scope: scopeUrls.join(" "),
            access_type: "offline",
            prompt: "consent",
        });
        if (state) params.set("state", state);
        return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }

    public async getTokens(code: string) {
        const res = await fetch("https://oauth2.googleapis.com/token", {
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
            id_token?: string;
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
        const res = await fetch("https://oauth2.googleapis.com/token", {
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
        const data = await res.json() as {
            access_token: string;
            token_type: string;
            expires_in: number;
            scope: string;
        };
        return {
            ...data,
            refresh_token: tokenStore.refresh_token,
        };
    }

    public async refreshTokenStore(tokenStore: TokenStore) {
        const res = await this.refreshTokens(tokenStore);
        return new TokenStore({
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            access_token_expires_at: Date.now() + res.expires_in * 1000,
        });
    }

    public async getData(tokenStore: TokenStore): Promise<DataForScopes<S>> {
        if (tokenStore.access_token_expires_at < Date.now()) {
            tokenStore = await this.refreshTokenStore(tokenStore);
        }

        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${tokenStore.access_token}` },
        });
        if (!res.ok) throw new Error(`Failed to fetch user data: ${await res.text()}`);

        const data = await res.json();

        return {
            tokenStore,
            ...data,
        };
    }
}
