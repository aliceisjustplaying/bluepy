# Privacy Policy

Phanpy does not collect or process any personal information from its users. The website is used to connect to third-party Mastodon servers that may or may not collect personal information and are not covered by this privacy policy. Each third-party Mastodon server comes equipped with its own privacy policy that can be viewed through that server's website.

## Hosting

Phanpy is hosted on [Cloudflare Pages](https://pages.cloudflare.com/) as a static website. Read more about [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

## Translations

Phanpy uses [TransLang API](https://github.com/cheeaun/translang-api) for translating post content, profile bio and media description. Read more about [TransLang API's privacy policy](https://github.com/cheeaun/translang-api/blob/main/PRIVACY.md).

## ATProto AppViews

Bluepy, this ATProto deployment of Phanpy, sends ATProto requests to the AppView selected on the login screen. If a non-Bluesky AppView omits profile avatars, Bluepy may request public profiles from the Bluesky public AppView to render the missing avatars. This can send one or more account DIDs to `public.api.bsky.app`, including notification authors' DIDs when opening notifications, even when those profiles are not directly viewed.

## Push notifications

Bluepy's Push Gateway stores per-account push settings, browser push subscriptions, and delivery records needed to send Web Push notifications. Browser push endpoint URLs and encryption keys are stored only for delivery and are not logged raw.

Rich push previews may temporarily store notification type, actor DID, actor handle or display name, target AT URI, and a short sanitized text excerpt. These previews are delivery snapshots, not canonical notification history. Bluepy's notification screen remains backed by the Bluesky AppView.

Delivery dedupe rows are retained for about 7 days. Rich preview/debug fields are retained for about 24 hours or less. Deleting push data for an account removes its gateway settings, subscriptions, pending attempts, and non-retention-required delivery rows.

## Error logging

Phanpy dev site (*dev.phanpy.social*) uses [Rollbar](https://rollbar.com/) to log errors for debugging purposes. Read more about [Rollbar's privacy policy](https://rollbar.com/privacy/). The production site (*phanpy.social*) does not use error logging.

## Analytics

Phanpy uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) to collect anonymous usage statistics. Read more about [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
