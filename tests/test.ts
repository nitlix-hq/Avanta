import DiscordProvider from "../src/providers/DiscordProvider";

const provider = new DiscordProvider({
    clientId: "1234567890",
    clientSecret: "1234567890",
    redirectUri: "https://example.com",
    scopes: ["identify", "email", "guilds", "guilds.join"],
});

const tokens = await provider.getTokenStore("code")

const e = await provider.getData(tokens);


provider.actions.guilds.join({
    guildId: "1234567890",
    tokenStore: tokens,
    botToken: "1234567890",
});