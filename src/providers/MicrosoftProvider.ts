import TokenStore from "../util/TokenStore";

type Scope =
    | "User.Read"
    | "Organization.Read.All"
    | "offline_access";

interface ScopeDataMap {
    "User.Read": {
        /** The user's unique Microsoft account ID (GUID format). */
        id: string;
        /** The user's full display name (e.g. `"Jane Doe"`). */
        displayName: string;
        /** The user's given (first) name, or `null` if not set. */
        givenName: string | null;
        /** The user's surname (last name), or `null` if not set. */
        surname: string | null;
        /**
         * The user's SMTP email address, or `null`.
         *
         * Often `null` for personal Microsoft accounts — use `userPrincipalName` as a fallback.
         */
        mail: string | null;
        /**
         * The user's sign-in name.
         *
         * For work/school accounts this is typically `user@contoso.com`.
         * For personal accounts this may look like `user_outlook.com#EXT#@...`.
         * Always present — use as email fallback when `mail` is `null`.
         */
        userPrincipalName: string;
        /** The user's job title, or `null` if not set. */
        jobTitle: string | null;
        /** The user's office location / building name, or `null` if not set. */
        officeLocation: string | null;
        /** Array of the user's business phone numbers (may be empty). */
        businessPhones: string[];
        /** The user's mobile phone number, or `null` if not set. */
        mobilePhone: string | null;
        /** The user's preferred language in BCP-47 format (e.g. `"en-US"`), or `null`. */
        preferredLanguage: string | null;
        /**
         * URL to fetch the user's profile photo (raw JPEG/PNG bytes).
         *
         * **Requires the access token** in the `Authorization: Bearer` header to fetch.
         * Returns `404` if the user has no photo set.
         *
         * Example:
         * ```
         * const res = await fetch(data.avatarUrl, {
         *     headers: { Authorization: `Bearer ${tokenStore.access_token}` },
         * });
         * const blob = await res.blob();
         * ```
         */
        avatarUrl: string;
    };
    "Organization.Read.All": {
        /**
         * The user's organization, or `null` if unavailable (e.g. personal accounts).
         *
         * Fetched from `GET /me/organization`. Only the first organization is returned
         * when the user belongs to multiple tenants.
         */
        organization: {
            /** The organization's unique ID (GUID). */
            id: string;
            /** The organization's display name (e.g. `"Contoso Ltd."`). */
            displayName: string;
            /** City of the organization's registered address, or `null`. */
            city: string | null;
            /** Country or region name, or `null`. */
            country: string | null;
            /** ISO 3166 two-letter country code (e.g. `"US"`), or `null`. */
            countryLetterCode: string | null;
            /** State or province, or `null`. */
            state: string | null;
            /** Street address, or `null`. */
            street: string | null;
            /** Postal / ZIP code, or `null`. */
            postalCode: string | null;
            /** The organization's verified default domain (e.g. `"contoso.com"`). */
            verifiedDomains: Array<{
                name: string;
                isDefault: boolean;
                isInitial: boolean;
            }>;
        } | null;
    };
    "offline_access": {};
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

export default class MicrosoftProvider<const S extends readonly Scope[]> {
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
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
    }

    public async getTokens(code: string) {
        const res = await fetch(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: this.redirectUri,
                }),
            },
        );
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
        const res = await fetch(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    grant_type: "refresh_token",
                    refresh_token: tokenStore.refresh_token,
                    scope: (this.scopes as readonly string[]).join(" "),
                }),
            },
        );
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
     * - Calls `GET /me` when `User.Read` is present.
     * - Calls `GET /me/organization` when `Organization.Read.All` is present.
     * - Returns a single merged object typed exactly to the scopes you passed.
     */
    public async getData(tokenStore: TokenStore): Promise<DataForScopes<S>> {
        if (tokenStore.access_token_expires_at < Date.now()) {
            tokenStore = await this.refreshTokenStore(tokenStore);
        }

        const headers = { Authorization: `Bearer ${tokenStore.access_token}` };
        const scopeSet = new Set(this.scopes);
        const merged: any = {};

        if (scopeSet.has("User.Read")) {
            const res = await fetch("https://graph.microsoft.com/v1.0/me", { headers });
            if (!res.ok) throw new Error(`Failed to fetch user data: ${await res.text()}`);

            const user = await res.json() as {
                id: string;
                displayName: string;
                givenName: string | null;
                surname: string | null;
                mail: string | null;
                userPrincipalName: string;
                jobTitle: string | null;
                officeLocation: string | null;
                businessPhones: string[];
                mobilePhone: string | null;
                preferredLanguage: string | null;
            };

            Object.assign(merged, {
                id: user.id,
                displayName: user.displayName,
                givenName: user.givenName,
                surname: user.surname,
                mail: user.mail,
                userPrincipalName: user.userPrincipalName,
                jobTitle: user.jobTitle,
                officeLocation: user.officeLocation,
                businessPhones: user.businessPhones ?? [],
                mobilePhone: user.mobilePhone,
                preferredLanguage: user.preferredLanguage,
                avatarUrl: `https://graph.microsoft.com/v1.0/me/photo/$value`,
            });
        }

        if (scopeSet.has("Organization.Read.All")) {
            let organization = null;
            try {
                const res = await fetch(
                    "https://graph.microsoft.com/v1.0/me/organization",
                    { headers },
                );
                if (res.ok) {
                    const orgData = await res.json() as {
                        value: Array<{
                            id: string;
                            displayName: string;
                            city: string | null;
                            country: string | null;
                            countryLetterCode: string | null;
                            state: string | null;
                            street: string | null;
                            postalCode: string | null;
                            verifiedDomains: Array<{
                                name: string;
                                isDefault: boolean;
                                isInitial: boolean;
                            }>;
                        }>;
                    };
                    if (orgData.value?.length > 0) {
                        organization = orgData.value[0];
                    }
                }
            } catch {
                // Organization info is optional — personal accounts may not have it
            }
            merged.organization = organization;
        }

        return {
            tokenStore,
            ...merged,
        };
    }
}
