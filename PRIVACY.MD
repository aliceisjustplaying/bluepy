# Privacy Policy

Bluepy does not collect or process personal information on its own server. It connects to Bluesky/ATProto services selected by the user, and those services may process account, post, and interaction data under their own privacy policies.

## Hosting

Bluepy is hosted on Cloudflare as a static website. Read more about [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

## Translations

Bluepy uses [TransLang API](https://github.com/cheeaun/translang-api) for translating post content, profile bio and media description. Read more about [TransLang API's privacy policy](https://github.com/cheeaun/translang-api/blob/main/PRIVACY.md).

## ATProto AppViews

Bluepy sends ATProto requests to the AppView selected on the login screen. If a non-Bluesky AppView omits profile avatars, Bluepy may request public profiles from the Bluesky public AppView to render the missing avatars. This can send one or more account DIDs to `public.api.bsky.app`, including notification authors' DIDs when opening notifications, even when those profiles are not directly viewed.

## Error logging

Bluepy's dev site uses [Rollbar](https://rollbar.com/) to log errors for debugging purposes. Read more about [Rollbar's privacy policy](https://rollbar.com/privacy/). Production does not use error logging.

## Analytics

Bluepy uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) to collect anonymous usage statistics. Read more about [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
