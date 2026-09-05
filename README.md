# Tech Stack Detector - Wappalyzer & BuiltWith Alternative

**Run it on Apify: [apify.com/clearfetch/tech-stack-detector](https://apify.com/clearfetch/tech-stack-detector)**

Find out what any website is built with. Give this Actor a list of domains and it returns the technologies behind each one: CMS, ecommerce platform, JavaScript frameworks, analytics and ad tags, CDN, hosting, payment processors, marketing automation, plus the email provider and domain-verification services visible in DNS. It is a drop-in alternative to the Wappalyzer and BuiltWith APIs at a fraction of the price: **$0.02 per website**, failed websites are free.

## What data you get

- **Technologies** with name, category, confidence score (0-100), detected version where possible, vendor website and the exact evidence (header, script, cookie, meta tag, DNS record) that triggered the detection.
- **7,600+ fingerprints in 109 categories**, refreshed monthly from the open-source webappanalyzer database.
- **DNS-level insights**: email provider (Google Workspace, Microsoft 365, Proton...), DNS host, CDN, and SaaS tools the company verified on its domain (reported separately in `dnsTechnologies`).
- **Server facts**: HTTP status, final URL after redirects, `Server` and `X-Powered-By` headers, generator meta tag, page title.
- Clean JSON per website, also exportable as CSV or Excel from the Apify dataset.

## How to use

1. Paste domains or URLs into **Websites** (one per line; bare domains are fine).
2. Click **Start**. 1,000 websites take about 2-4 minutes at the default concurrency.
3. Download the results or read them through the API. Each website is one dataset item.

## Input

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | array | — | Domains or URLs to analyze. Also accepts `url` (single string, comma or newline separated) and `startUrls` for compatibility with other Actors and integrations. |
| `includeDns` | boolean | true | Look up TXT, MX, NS and CNAME records to detect mail providers, DNS hosts and domain-verified services. |
| `includeEvidence` | boolean | true | Attach the matched header/script/cookie/DNS snippet to every detection. |
| `minConfidence` | integer | 0 | Drop detections below this confidence (0-100). |
| `maxConcurrency` | integer | 10 | Websites analyzed in parallel (1-50). |
| `timeoutSecs` | integer | 20 | Per-website HTTP timeout (5-60). |
| `proxyConfiguration` | object | off | Optional Apify Proxy or custom proxies for sites that block datacenter traffic. Not needed for most sites. |

## Output example

One item per website (trimmed to three technologies here):

```json
{
  "url": "https://www.shopify.com/",
  "finalUrl": "https://www.shopify.com/fr",
  "ok": true,
  "pageAnalyzed": true,
  "statusCode": 200,
  "title": "Shopify France",
  "technologies": [
    {
      "name": "Cart Functionality",
      "slug": "cart-functionality",
      "confidence": 100,
      "version": null,
      "categories": [
        {
          "id": 6,
          "name": "Ecommerce"
        }
      ],
      "website": "https://www.wappalyzer.com/technologies/ecommerce/cart-functionality",
      "evidence": [
        {
          "type": "dom",
          "key": "a[href*='/order']",
          "pattern": "",
          "match": "a[href*='/order']"
        },
        {
          "type": "dom",
          "key": "a[href*='/checkout']",
          "pattern": "",
          "match": "a[href*='/checkout']"
        }
      ]
    },
    {
      "name": "Cloudflare",
      "slug": "cloudflare",
      "confidence": 100,
      "version": null,
      "categories": [
        {
          "id": 31,
          "name": "CDN"
        }
      ],
      "website": "https://www.cloudflare.com",
      "evidence": [
        {
          "type": "headers",
          "key": "server",
          "pattern": "^cloudflare$",
          "match": "cloudflare"
        },
        {
          "type": "headers",
          "key": "cf-cache-status",
          "pattern": "",
          "match": "BYPASS"
        }
      ]
    },
    {
      "name": "DHL",
      "slug": "dhl",
      "confidence": 100,
      "version": null,
      "categories": [
        {
          "id": 99,
          "name": "Shipping carriers"
        }
      ],
      "website": "https://www.dhl.com",
      "evidence": [
        {
          "type": "text",
          "pattern": "\\bDHL\\b",
          "match": "window.__brochureDuxConfig={\"eventHandlerEndpoint\":\"/.well-known/dux?v2&_pri=1\"}Passer au contenu.supports-\\[container-type\\:scroll-state\\]\\:after\\:\\[\\@containe"
        }
      ]
    }
  ],
  "techNames": [
    "Cart Functionality",
    "Cloudflare",
    "DHL",
    "HSTS",
    "HTTP/3",
    "Open Graph",
    "Priority Hints",
    "Shopify",
    "Tailwind CSS",
    "Trident AB",
    "Google Tag Manager",
    "YouTube"
  ],
  "count": 12,
  "categorized": {
    "Ecommerce": [
      "Cart Functionality",
      "Shopify"
    ],
    "CDN": [
      "Cloudflare"
    ],
    "Shipping carriers": [
      "DHL"
    ],
    "Security": [
      "HSTS"
    ],
    "Miscellaneous": [
      "HTTP/3",
      "Open Graph"
    ],
    "Performance": [
      "Priority Hints"
    ],
    "UI frameworks": [
      "Tailwind CSS"
    ],
    "A/B Testing": [
      "Trident AB"
    ],
    "Tag managers": [
      "Google Tag Manager"
    ],
    "Video players": [
      "YouTube"
    ]
  },
  "dnsTechNames": [
    "Adobe",
    "Amazon SES",
    "Amazon Web Services",
    "Apple iCloud Mail",
    "Atlassian Cloud",
    "Autodesk"
  ],
  "server": {
    "server": "cloudflare",
    "poweredBy": null,
    "generator": null
  },
  "dns": {
    "MX": [
      "aspmx.l.google.com",
      "alt3.aspmx.l.google.com"
    ],
    "NS": [
      "gold.foundationdns.net",
      "gold.foundationdns.org"
    ]
  },
  "scanTimeMs": 1298,
  "scannedAt": "2026-09-05T12:55:53.025Z"
}
```

Websites that cannot be reached produce an error item and are not charged:

```json
{
  "url": "https://this-domain-does-not-exist-12345.com/",
  "ok": false,
  "statusCode": null,
  "error": "getaddrinfo ENOTFOUND this-domain-does-not-exist-12345.com",
  "errorCode": "ENOTFOUND",
  "scanTimeMs": 1065,
  "scannedAt": "2026-09-05T12:49:13.516Z"
}
```

## Pricing

- **$0.02 per website analyzed.** 100 websites = $2, 1,000 websites = $20. Unreachable websites are free.
- No subscription, no API key, no minimum. Runs on the Apify free plan.
- For comparison: BuiltWith's API plans cost hundreds of dollars per month, and the next Wappalyzer-style Actor on Apify Store charges $0.10 per site.

## Use cases

- **Lead generation**: find every Shopify, WooCommerce or Magento store in a list of domains, or every company on HubSpot, Salesforce or Intercom.
- **Sales prospecting**: qualify accounts by tech stack before outreach (framework, CRM, analytics, payment provider).
- **Competitive analysis**: track which tools competitors adopt or drop over time by scheduling a weekly run.
- **Agency audits**: inventory a client's marketing tags, CDN and hosting in one pass.
- **Security and migration planning**: know which CMS versions, JavaScript libraries and hosting providers are in use across a portfolio of sites.
- **AI agents and workflows**: call it from n8n, Make, Zapier, LangChain or any MCP client to enrich domains on the fly.

## Integrations

Run it from the API with any language:

```bash
curl -X POST "https://api.apify.com/v2/acts/clearfetch~tech-stack-detector/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["stripe.com", "shopify.com"]}'
```

Python:

```python
from apify_client import ApifyClient
client = ApifyClient("YOUR_TOKEN")
run = client.actor("clearfetch/tech-stack-detector").call(run_input={"urls": ["stripe.com"]})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["url"], item["techNames"])
```

Works with the Apify integrations for n8n, Make, Zapier, Google Sheets, webhooks, and with AI agents through the Apify MCP server.

## FAQ

**Do I need proxies?** No. The Actor fetches one page per website with a normal browser-like request. A few sites block datacenter traffic; for those, enable Apify Proxy in the input.

**How accurate is it?** Detection uses the same fingerprint approach as Wappalyzer: HTTP headers, cookies, HTML, meta tags, script URLs, inline scripts, DOM selectors and DNS. Every detection carries a confidence score and the evidence it was based on, so you can filter or verify.

**What does a confidence below 100 mean?** Some technologies are only visible indirectly, for example a vendor URL that appears in an inline script, a preload hint or an image reference rather than in a `<script src>` tag. Modern tag managers and headless storefronts work exactly this way, so the Actor reports them with a confidence of 50 and the evidence type `resourceUrl`. Raise `minConfidence` to 100 if you only want detections backed by direct evidence.

**What can it miss?** Technologies that are only detectable by executing JavaScript in a browser (for example some frameworks that leave no trace in the HTML) unless another fingerprint implies them. It analyzes the URL you give it, typically the homepage; pass deeper URLs if a technology only appears on inner pages.

**Is this legal?** It reads the public HTTP response and public DNS records of the websites you provide, the same data any browser receives. No login, no personal data.

**How fresh is the fingerprint database?** It comes from the open-source webappanalyzer project (the successor of Wappalyzer's public fingerprints) and is refreshed monthly.

**Can I get only certain categories?** Yes, filter the `technologies` array by `categories[].name` (for example "CMS", "Ecommerce", "Analytics", "JavaScript frameworks", "CDN", "Hosting", "Payment processors").

## Changelog

- **1.0.0** (2026-09) — initial release: 7,613 fingerprints, DNS detection, evidence and confidence per technology, pay per website. Detects technologies that are injected at runtime (tag managers, headless storefronts) from vendor URLs found in inline scripts and resource hints, and extracts version numbers where the fingerprint allows.

