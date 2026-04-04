export default class TokenStore {
    public access_token: string;
    public access_token_expires_at: number;
    public refresh_token: string;

    constructor({ access_token, access_token_expires_at, refresh_token }: { access_token?: string, access_token_expires_at?: number, refresh_token?: string }) {
        this.access_token = access_token ?? "";
        this.access_token_expires_at = access_token_expires_at ?? 0;
        this.refresh_token = refresh_token ?? "";
    }

    public get compress() {
        return JSON.stringify({
            access_token: this.access_token,
            refresh_token: this.refresh_token,
            access_token_expires_at: this.access_token_expires_at,
        });
    }

    public static extract(compressed: string) {
        return new TokenStore(JSON.parse(compressed))
    }
}