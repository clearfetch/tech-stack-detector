# Tech Stack Detector - Wappalyzer & BuiltWith Alternative

Find out what any website is built with. Give this Actor a list of domains and it returns the technologies behind each one: CMS, ecommerce platform, JavaScript frameworks, analytics and ad tags, CDN, hosting, payment processors, marketing automation, plus the email provider and domain-verification services visible in DNS. It is a drop-in alternative to the Wappalyzer and BuiltWith APIs at a fraction of the price: **$0.05 per website** ($0.02 until 16 October 2026), failed websites are free.

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
| `urlListUrl` | string | — | A link to a text or CSV file with one domain or URL per line, for lists too long to paste (a Google Sheets "Publish to the web" CSV link works). Read in addition to `urls`. |
| `includeDns` | boolean | true | Look up TXT, MX, NS and CNAME records to detect mail providers, DNS hosts and domain-verified services. |
| `includeEvidence` | boolean | true | Attach the matched header/script/cookie/DNS snippet to every detection. |
| `minConfidence` | integer | 0 | Drop detections below this confidence (0-100). |
| `maxConcurrency` | integer | by memory | Websites analyzed in parallel (1-50). Left empty, it follows the run's memory: 40 at the default 4 GB, 20 at 2 GB. |
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

- **$0.05 per website analyzed** from 17 October 2026, $0.02 until then. 100 websites = $5, 1,000 websites = $50. Unreachable websites are free.
- No subscription, no API key, no minimum. Runs on the Apify free plan.
- For comparison: BuiltWith's API plans cost hundreds of dollars per month, and the next Wappalyzer-style Actor on Apify Store charges $0.10 per site.

Paid Apify plans pay less: 10% off on Bronze, 20% on Silver and 30% on Gold and higher tiers.

Apify also charges a run-start fee of $0.00005 per started GB of allocated memory (minimum one event), including runs that produce no chargeable results.

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

**Can it handle a list of 10,000 websites or more?** Yes. Paste the list or link a text or CSV file in `urlListUrl`. If a list is too long for the run's time limit, the run stops a minute before it, ends as succeeded, and saves the websites it did not reach in the `UNPROCESSED` record of the run's key-value store, ready to pass as `urls` to the next run. The same happens when a run reaches the maximum cost you set for it.

**Can I get only certain categories?** Yes, filter the `technologies` array by `categories[].name` (for example "CMS", "Ecommerce", "Analytics", "JavaScript frameworks", "CDN", "Hosting", "Payment processors").

## More tools from clearfetch

- [Website Contact Extractor](https://apify.com/clearfetch/website-contact-extractor): emails, phone numbers and social profiles from company websites
- [Document Text Extractor](https://apify.com/clearfetch/document-text-extractor): PDF, DOCX and HTML to clean text and markdown
- [Website Sitemap Extractor](https://apify.com/clearfetch/website-sitemap-extractor): every URL of a website from its sitemaps, from just the domain
- [Broken Link Checker](https://apify.com/clearfetch/broken-link-checker): 404s, redirect chains and soft 404s in bulk
- [ATS Jobs Scraper](https://apify.com/clearfetch/ats-jobs-scraper): every open job from company careers pages on Greenhouse, Lever, Ashby, Workday and more

## Changelog

- **Pricing** (2026-10-17) — $0.05 per website analyzed instead of $0.02, announced on 2026-10-02; paid-plan discounts unchanged.
- **1.1.0** (2026-10-02) — built for big lists: `urlListUrl` reads domains from a linked text or CSV file; a run stops cleanly before its time or cost limit and saves the websites it did not reach as `UNPROCESSED`; analysis is 5-6x faster with identical results (checked on 452 homepages, 4,192 detections); only the first megabyte of a page, the part analyzed, is downloaded; concurrency follows the run's memory.
- **1.0.0** (2026-09) — initial release: 7,613 fingerprints, DNS detection, evidence and confidence per technology, pay per website. Detects technologies that are injected at runtime (tag managers, headless storefronts) from vendor URLs found in inline scripts and resource hints, and extracts version numbers where the fingerprint allows.
