import { expect, test } from '@playwright/test';

// Exercises the DOMPurify-backed sanitizers in a real browser (DOMPurify needs
// a DOM, which the Node-side test body lacks). We navigate to the dev server so
// Vite can serve the source module, then drive it via `page.evaluate`. This is
// a `.js` spec by convention (matches atproto-compose-safety.spec.js) so the
// runtime-only `/src/...` dynamic import is not type-resolved.

test.describe('post HTML sanitizer', () => {
  test('strips XSS vectors and preserves legitimate post markup', async ({
    page,
  }) => {
    await page.goto('/');

    const r = await page.evaluate(async () => {
      const { sanitizePostHtml } = await import('/src/utils/sanitize-html.ts');

      const sanitize = (html) => {
        const out = sanitizePostHtml(html);
        const doc = new DOMParser().parseFromString(out, 'text/html');
        return { out, doc };
      };

      const results = {};

      // <script> tag
      {
        const { out, doc } = sanitize('<p>hi</p><script>alert(1)</script>');
        results.scriptStripped =
          !/<script/i.test(out) && doc.querySelector('script') === null;
        results.scriptKeepsText = doc.querySelector('p')?.textContent === 'hi';
      }

      // <img onerror>
      {
        const { out, doc } = sanitize('<img src="x" onerror="alert(1)">');
        const img = doc.querySelector('img');
        results.imgOnerrorStripped =
          !/onerror/i.test(out) && !!img && !img.hasAttribute('onerror');
      }

      // javascript: href
      {
        const { doc } = sanitize('<a href="javascript:alert(1)">x</a>');
        const a = doc.querySelector('a');
        results.jsHrefStripped = !a || !a.getAttribute('href');
      }

      // data: href
      {
        const { doc } = sanitize(
          '<a href="data:text/html,<script>alert(1)</script>">x</a>',
        );
        const a = doc.querySelector('a');
        results.dataHrefStripped = !a || !a.getAttribute('href');
      }

      // <iframe> — not allowed in the post profile
      {
        const { out, doc } = sanitize(
          '<iframe src="https://evil.test"></iframe>',
        );
        results.iframeStripped =
          !/<iframe/i.test(out) && doc.querySelector('iframe') === null;
      }

      // nested <template> payload
      {
        const { out, doc } = sanitize(
          '<template><img src=x onerror=alert(1)></template>',
        );
        results.templateStripped =
          !/<template/i.test(out) &&
          !/onerror/i.test(out) &&
          doc.querySelector('template') === null;
      }

      // onclick attribute on an allowed tag
      {
        const { out, doc } = sanitize('<span onclick="alert(1)">x</span>');
        const span = doc.querySelector('span');
        results.onclickStripped =
          !/onclick/i.test(out) && !!span && !span.hasAttribute('onclick');
      }

      // <svg><script> mXSS
      {
        const { out, doc } = sanitize('<svg><script>alert(1)</script></svg>');
        results.svgScriptStripped =
          !/<svg/i.test(out) &&
          !/<script/i.test(out) &&
          doc.querySelector('svg') === null &&
          doc.querySelector('script') === null;
      }

      // <noscript> mXSS-style payload
      {
        const { out } = sanitize(
          '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
        );
        results.noscriptStripped =
          !/<noscript/i.test(out) && !/onerror/i.test(out);
      }

      // style attribute is dropped entirely (clickjacking / url() defense)
      {
        const { out, doc } = sanitize(
          '<p style="position:fixed;inset:0;background:url(javascript:alert(1))">x</p>',
        );
        results.styleStripped =
          !/style=/i.test(out) &&
          !doc.querySelector('p')?.hasAttribute('style');
        results.noInlineHandlerLeak = !/on\w+\s*=/i.test(out);
      }

      // srcset / <source> are dropped; the inner <img> still survives
      {
        const { out, doc } = sanitize(
          '<picture><source srcset="https://ok.test/a.png 1x, javascript:alert(1) 2x"><img src="https://ok.test/a.gif" class="shortcode-emoji"></picture>',
        );
        results.srcsetDropped =
          !/srcset/i.test(out) &&
          !/javascript:/i.test(out) &&
          doc.querySelector('source') === null;
        results.emojiImgStillThere =
          doc.querySelector('img.shortcode-emoji')?.getAttribute('src') ===
          'https://ok.test/a.gif';
      }

      // data-* attributes are dropped (not on the explicit allowlist).
      {
        const { out, doc } = sanitize(
          '<span data-evil="1" data-state="open">x</span>',
        );
        const span = doc.querySelector('span');
        results.dataAttrStripped =
          !/data-/i.test(out) &&
          !!span &&
          span.attributes.length === 0;
      }

      // LEGITIMATE: anchor with target gets safe rel; href preserved.
      {
        const { doc } = sanitize(
          '<a href="https://example.com" target="_blank" class="u-url">link</a>',
        );
        const a = doc.querySelector('a');
        results.anchorSurvives =
          a?.getAttribute('href') === 'https://example.com';
        results.anchorClassSurvives = a?.classList.contains('u-url') === true;
        results.anchorRelForced =
          a?.getAttribute('rel') === 'noopener noreferrer nofollow ugc';
      }

      // LEGITIMATE: mention markup (anchor + inner span) survives.
      {
        const { doc } = sanitize(
          '<a href="https://example.com/@alice" class="mention">@<span>alice</span></a>',
        );
        const a = doc.querySelector('a.mention');
        results.mentionSurvives =
          !!a && a.querySelector('span')?.textContent === 'alice';
      }

      // LEGITIMATE: inline code / pre survives.
      {
        const { doc } = sanitize('<pre><code>const x = 1;</code></pre>');
        results.codeSurvives =
          doc.querySelector('pre code')?.textContent === 'const x = 1;';
      }

      return results;
    });

    expect(r.scriptStripped, 'script tag stripped').toBe(true);
    expect(r.scriptKeepsText, 'surrounding text preserved').toBe(true);
    expect(r.imgOnerrorStripped, 'img onerror stripped').toBe(true);
    expect(r.jsHrefStripped, 'javascript: href stripped').toBe(true);
    expect(r.dataHrefStripped, 'data: href stripped').toBe(true);
    expect(r.iframeStripped, 'iframe stripped from post profile').toBe(true);
    expect(r.templateStripped, 'nested template payload stripped').toBe(true);
    expect(r.onclickStripped, 'onclick attribute stripped').toBe(true);
    expect(r.svgScriptStripped, 'svg+script stripped').toBe(true);
    expect(r.noscriptStripped, 'noscript mXSS payload stripped').toBe(true);
    expect(r.styleStripped, 'style attribute stripped').toBe(true);
    expect(r.noInlineHandlerLeak, 'no inline handler leaks').toBe(true);
    expect(r.dataAttrStripped, 'data-* attributes stripped').toBe(true);
    expect(r.srcsetDropped, 'srcset/source dropped').toBe(true);
    expect(r.emojiImgStillThere, 'emoji img survives without picture').toBe(
      true,
    );

    expect(r.anchorSurvives, 'anchor href preserved').toBe(true);
    expect(r.anchorClassSurvives, 'anchor class preserved').toBe(true);
    expect(r.anchorRelForced, 'anchor rel forced to safe value').toBe(true);
    expect(r.mentionSurvives, 'mention markup preserved').toBe(true);
    expect(r.codeSurvives, 'code block preserved').toBe(true);
  });
});

test.describe('embed HTML sanitizer', () => {
  test('permits cross-origin sandboxed iframe but locks it down', async ({
    page,
  }) => {
    await page.goto('/');

    const r = await page.evaluate(async () => {
      const { sanitizeEmbedHtml } = await import('/src/utils/sanitize-html.ts');
      const parse = (html) =>
        new DOMParser().parseFromString(sanitizeEmbedHtml(html), 'text/html');

      const results = {};

      // Legit cross-origin oEmbed iframe survives, with forced sandbox + allow.
      {
        const doc = parse(
          '<iframe src="https://www.youtube.com/embed/abc" width="560" height="315" allow="camera; microphone; geolocation" allowfullscreen></iframe>',
        );
        const iframe = doc.querySelector('iframe');
        results.iframeSurvives =
          iframe?.getAttribute('src') === 'https://www.youtube.com/embed/abc';
        results.sandboxForced =
          (iframe?.getAttribute('sandbox') ?? '').includes('allow-scripts') &&
          (iframe?.getAttribute('sandbox') ?? '').includes('allow-same-origin');
        results.allowForced =
          iframe?.getAttribute('allow') === 'clipboard-write; fullscreen';
        results.referrerForced =
          iframe?.getAttribute('referrerpolicy') ===
          'strict-origin-when-cross-origin';
      }

      // Provider-supplied unsafe referrerpolicy is overridden.
      {
        const doc = parse(
          '<iframe src="https://ok.test" referrerpolicy="unsafe-url"></iframe>',
        );
        const iframe = doc.querySelector('iframe');
        results.unsafeReferrerOverridden =
          iframe?.getAttribute('referrerpolicy') ===
          'strict-origin-when-cross-origin';
      }

      // Same-origin / relative iframe src is dropped entirely.
      {
        const doc = parse('<iframe src="/settings"></iframe>');
        results.relativeIframeDropped = doc.querySelector('iframe') === null;
      }

      // Protocol-relative src is dropped regardless of host — even a foreign
      // provider — because we require a literal absolute http(s) URL.
      {
        const foreign = parse('<iframe src="//provider.test/embed"></iframe>');
        results.protocolRelativeForeignDropped =
          foreign.querySelector('iframe') === null;
        const sameHost = parse(
          '<iframe src="//' + window.location.host + '/x"></iframe>',
        );
        results.protocolRelativeSameHostDropped =
          sameHost.querySelector('iframe') === null;
      }

      // http:// (non-https) src dropped — no downgrade / mixed content.
      {
        const doc = parse('<iframe src="http://provider.test/embed"></iframe>');
        results.httpIframeDropped = doc.querySelector('iframe') === null;
      }

      // javascript: src rejected.
      {
        const doc = parse('<iframe src="javascript:alert(1)"></iframe>');
        results.jsSrcDropped = doc.querySelector('iframe') === null;
      }

      // srcdoc (inline HTML) rejected even on an allowed iframe.
      {
        const doc = parse(
          '<iframe src="https://ok.test" srcdoc="<script>alert(1)</script>"></iframe>',
        );
        const iframe = doc.querySelector('iframe');
        results.srcdocStripped = !!iframe && !iframe.hasAttribute('srcdoc');
      }

      // script alongside the iframe is dropped.
      {
        const html = sanitizeEmbedHtml(
          '<iframe src="https://ok.test"></iframe><script>alert(1)</script>',
        );
        results.scriptStripped = !/<script/i.test(html);
      }

      // style attribute dropped on embed wrapper.
      {
        const html = sanitizeEmbedHtml(
          '<div style="position:fixed;inset:0"><iframe src="https://ok.test"></iframe></div>',
        );
        results.embedStyleStripped = !/style=/i.test(html);
      }

      return results;
    });

    expect(r.iframeSurvives, 'legit cross-origin iframe preserved').toBe(true);
    expect(r.sandboxForced, 'sandbox forced on iframe').toBe(true);
    expect(r.allowForced, 'allow forced to safe value').toBe(true);
    expect(r.referrerForced, 'referrerpolicy forced').toBe(true);
    expect(
      r.unsafeReferrerOverridden,
      'unsafe referrerpolicy overridden',
    ).toBe(true);
    expect(r.relativeIframeDropped, 'relative iframe src dropped').toBe(true);
    expect(
      r.protocolRelativeForeignDropped,
      'protocol-relative foreign iframe dropped',
    ).toBe(true);
    expect(
      r.protocolRelativeSameHostDropped,
      'protocol-relative same-host iframe dropped',
    ).toBe(true);
    expect(r.httpIframeDropped, 'http:// iframe src dropped').toBe(true);
    expect(r.jsSrcDropped, 'javascript: iframe src dropped').toBe(true);
    expect(r.srcdocStripped, 'iframe srcdoc stripped').toBe(true);
    expect(r.scriptStripped, 'sibling script stripped').toBe(true);
    expect(r.embedStyleStripped, 'embed style attribute stripped').toBe(true);
  });
});

test.describe('embed-code preview escaping', () => {
  test('escapes untrusted post fields in generateHTMLCode', async ({
    page,
  }) => {
    await page.goto('/');

    const r = await page.evaluate(async () => {
      const { generateHTMLCode } = await import(
        '/src/components/post-embed-modal.tsx'
      );

      // Malicious custom-emoji metadata: a URL/shortcode crafted to break out
      // of the double-quoted attribute in emojifyText's <img>/<source>.
      const evilEmoji = {
        shortcode: 'x',
        url: 'https://e.test/a.gif" onerror="alert(7)',
        staticUrl: 'https://e.test/a.png" onerror="alert(8)',
      };
      const post = {
        account: {
          displayName: '<img src=x onerror=alert(1)>Mallory :x:',
          acct: 'mallory"><script>alert(1)</script>',
          emojis: [evilEmoji],
        },
        id: 'abc',
        spoilerText: '</summary><img src=x onerror=alert(1)>',
        language: 'en"><script>alert(2)</script>',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: 'hello :x:',
        url: 'javascript:alert(1)',
        emojis: [evilEmoji],
        poll: {
          options: [{ title: '<script>alert(3)</script>', votesCount: 5 }],
        },
        mediaAttachments: [
          {
            id: 'm1',
            type: 'image',
            description: '"><script>alert(4)</script>',
            url: 'javascript:alert(5)',
            remoteUrl: 'javascript:alert(6)',
          },
        ],
      };

      const html = generateHTMLCode(post, undefined);
      // Parse the generated snippet and assert no LIVE injected markup exists
      // in the structure built from untrusted fields. Escaped text (e.g.
      // `&lt;script&gt;`) is harmless and expected.
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // The only <script>/<img> elements that could appear come from the
      // untrusted fields; legit structure here is blockquote/details/figure/
      // a/time, and the one app-built <img> only when the media URL is a valid
      // http(s) image (here it is javascript:, so it must be empty src).
      const injectedScripts = doc.querySelectorAll('script').length;
      const liveImgs = [...doc.querySelectorAll('img')];
      return {
        html,
        // No live <script> elements from any untrusted field.
        noLiveScript: injectedScripts === 0,
        // No element carries a live onerror handler (escaped text is fine).
        noOnerrorAttr: [...doc.querySelectorAll('*')].every(
          (el) => !el.hasAttribute('onerror'),
        ),
        // javascript: URLs are rejected to empty in src/href/cite attributes.
        noLiveJsUri:
          !/(?:src|href|cite)="javascript:/i.test(html) &&
          liveImgs.every((img) => !/^javascript:/i.test(img.getAttribute('src') ?? '')),
        // The spoiler summary breakout did not create any live <img>; the
        // payload survives only as inert escaped text.
        summaryHasNoImg:
          doc.querySelector('summary')?.querySelector('img') == null &&
          (doc.querySelector('summary')?.textContent ?? '').includes(
            '<img',
          ),
        // Legit text still present (escaped form of the display name).
        hasName: (doc.body.textContent ?? '').includes('Mallory'),
      };
    });

    expect(r.noLiveScript, 'no live <script> element in embed code').toBe(true);
    expect(r.noOnerrorAttr, 'no onerror attribute in embed code').toBe(true);
    expect(r.noLiveJsUri, 'no javascript: URI in url attributes').toBe(true);
    expect(r.summaryHasNoImg, 'spoiler summary breakout neutralized').toBe(
      true,
    );
    expect(r.hasName, 'legit display name text preserved').toBe(true);
  });
});
