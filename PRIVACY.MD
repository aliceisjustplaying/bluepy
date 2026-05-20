# Privacy

Bluepy does not collect or sell personal information.

Bluepy connects to ATProto services, including Bluesky and user-selected PDS/AppView services. Those services may process account data under their own privacy policies.

Bluepy is a static client. Hosting, analytics, error logging, and translation services may process limited technical data depending on the deployment configuration.

## ATProto AppViews

Bluepy, this ATProto deployment of Phanpy, sends ATProto requests to the AppView selected on the login screen. If a non-Bluesky AppView omits profile avatars, Bluepy may request public profiles from the Bluesky public AppView to render the missing avatars. This can send one or more account DIDs to `public.api.bsky.app`, including notification authors' DIDs when opening notifications, even when those profiles are not directly viewed.
