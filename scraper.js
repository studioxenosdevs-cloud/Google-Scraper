const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes Google Maps for business listings and audits each result's website
 * to build an actionable lead list complete with custom sales pitches.
 */
async function scrapeGoogleMaps(options, updateProgress) {
    const { businessType, location, isNearMe, maxResults = 10, coords } = options;

    // Scoped Set so deduplication is fresh per search run
    const existingLeadNames = new Set();

    let searchQuery = businessType;
    if (!isNearMe && location) {
        searchQuery = `${businessType} in ${location}`;
    }

    updateProgress(`Launching browser...`);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const rawLeads = [];

    try {
        const userLat = coords?.latitude || 24.8607;
        const userLng = coords?.longitude || 67.0011;

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            permissions: isNearMe ? ['geolocation'] : [],
            geolocation: isNearMe ? { latitude: userLat, longitude: userLng } : undefined,
            viewport: { width: 1366, height: 768 }
        });

        const page = await context.newPage();
        const targetUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        updateProgress(`Navigating to Google Maps: "${searchQuery}"...`);

        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
        } catch (e) {
            updateProgress("Error: Could not load Google Maps feed. Google may have blocked the automated request or no results were found.");
            return [];
        }

        let scrollAttempts = 0;
        let stalledScrolls = 0;

        updateProgress(`Extracting business listings...`);

        while (rawLeads.length < maxResults && scrollAttempts < 25 && stalledScrolls < 4) {
            const cardCount = await page.evaluate(() => {
                return document.querySelectorAll('div[role="feed"] > div > div[role="article"]').length;
            });

            if (cardCount <= rawLeads.length) {
                const heightBefore = await page.evaluate(() => {
                    const feed = document.querySelector('div[role="feed"]');
                    return feed ? feed.scrollHeight : 0;
                });

                await page.evaluate(() => {
                    const feed = document.querySelector('div[role="feed"]');
                    if (feed) feed.scrollBy(0, 1200);
                });
                await page.waitForTimeout(1500);
                scrollAttempts++;

                const heightAfter = await page.evaluate(() => {
                    const feed = document.querySelector('div[role="feed"]');
                    return feed ? feed.scrollHeight : 0;
                });

                stalledScrolls = heightAfter === heightBefore ? stalledScrolls + 1 : 0;
                continue;
            }

            stalledScrolls = 0;

            for (let i = rawLeads.length; i < cardCount; i++) {
                if (rawLeads.length >= maxResults) break;

                try {
                    const clicked = await page.evaluate((index) => {
                        const articles = document.querySelectorAll('div[role="feed"] > div > div[role="article"]');
                        const target = articles[index];
                        if (target) {
                            target.scrollIntoView({ behavior: 'instant', block: 'center' });
                            const clickableLink = target.querySelector('a') || target;
                            clickableLink.click();
                            return true;
                        }
                        return false;
                    }, i);

                    if (!clicked) continue;
                    await page.waitForTimeout(1800);

                    const leadData = await page.evaluate((index) => {
                        const articles = document.querySelectorAll('div[role="feed"] > div > div[role="article"]');
                        const article = articles[index];

                        const cardText = article ? article.innerText : '';
                        const feedPhoneMatch = cardText.match(/(\+?\d{2,4}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}/);
                        const feedPhone = feedPhoneMatch ? feedPhoneMatch[0].trim() : null;

                        const panelH1 = Array.from(document.querySelectorAll('h1')).find(
                            h1 => h1.innerText.trim().toLowerCase() !== 'results' && h1.innerText.trim() !== ''
                        );
                        const shopName = panelH1 ? panelH1.innerText.trim() : 'Unknown Business';

                        const categoryNode = document.querySelector('button[jsaction*="category"]');
                        const category = categoryNode ? categoryNode.innerText.trim() : 'Local Business';

                        const ratingNode = document.querySelector('div.F72Y0d span[aria-hidden="true"]') ||
                            document.querySelector('span.ceA1da') ||
                            document.querySelector('div.F72Y0d span');
                        const rating = ratingNode ? ratingNode.innerText.trim() : 'N/A';

                        const reviewNode = document.querySelector('button[jsaction*="reviews"]') ||
                            document.querySelector('span[aria-label*="reviews"]');
                        const reviews = reviewNode ? (reviewNode.innerText || reviewNode.getAttribute('aria-label') || '').replace(/[^0-9]/g, '') : '0';

                        const phoneBtn = document.querySelector('button[aria-label*="Phone"]') ||
                            document.querySelector('button[data-item-id*="phone:tel"]') ||
                            Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.includes('Phone'));

                        let phone = feedPhone || 'Not Found';
                        if (phoneBtn) {
                            const rawPhone = (phoneBtn.getAttribute('aria-label') || phoneBtn.innerText || '').replace(/[^0-9+() -]/g, '').trim();
                            if (rawPhone.length >= 7) phone = rawPhone;
                        }

                        const websiteBtn = document.querySelector('a[aria-label*="Website"]') ||
                            document.querySelector('a[data-item-id="authority"]');
                        const website = websiteBtn ? websiteBtn.href : 'None';

                        const addressBtn = document.querySelector('button[data-item-id="address"]');
                        const address = addressBtn ? addressBtn.innerText.replace(/\s+/g, ' ').trim() : 'Not Found';

                        return { shopName, category, rating, reviews, ownerName: 'Not Listed', phone, website, address, mapsUrl: window.location.href };
                    }, i);

                    if (!leadData.shopName || leadData.shopName.toLowerCase() === 'results' || existingLeadNames.has(leadData.shopName)) {
                        continue;
                    }

                    existingLeadNames.add(leadData.shopName);
                    rawLeads.push(leadData);

                } catch (err) {
                    console.error(`Skipped item ${i}:`, err.message);
                }
            }
        }
    } finally {
        await browser.close();
    }

    updateProgress(`Auditing websites & generating sales pitches...`);

    const finalLeads = await Promise.all(
        rawLeads.map(async (lead, idx) => {
            updateProgress(`Auditing website ${idx + 1}/${rawLeads.length}: ${lead.shopName}`);
            const analysis = await auditWebsiteAndRecommendServices(lead.website, lead.phone);
            const pitch = buildPitch(lead, analysis);

            return {
                id: `lead_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
                ...lead,
                phone: lead.phone !== 'Not Found' ? lead.phone : analysis.phone,
                email: analysis.email,
                siteStatus: analysis.status,
                opportunity: analysis.services[0] || 'Needs Web Presence',
                services: analysis.services.join('; '),
                issues: analysis.issues.join(' | '),
                pitch,
                techStack: analysis.techStack,
                socials: (analysis.socials || []).join(', '),
                dateAdded: new Date().toISOString().replace('T', ' ').substring(0, 19),
                status: 'New'
            };
        })
    );

    return finalLeads;
}

/**
 * Multi-point website auditor checking HTTPS, viewport tags, copyright year,
 * load response speed, contact emails/phones, and technology stack.
 */
async function auditWebsiteAndRecommendServices(url, fallbackPhone) {
    if (!url || url === 'None' || url.includes('google.com/maps')) {
        return {
            status: 'Missing Website',
            issues: ['No official website was found on Google Maps for this business.'],
            services: ['Custom High-Converting Website', 'Google Business Profile Setup', 'WhatsApp Auto-Responder Widget'],
            techStack: 'None',
            email: 'Not Found',
            phone: fallbackPhone || 'Not Found',
            socials: []
        };
    }

    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36' };
    const startTime = Date.now();

    try {
        const response = await axios.get(url, { timeout: 6000, headers, maxRedirects: 3 });
        const loadTimeMs = Date.now() - startTime;
        const html = response.data;
        const $ = cheerio.load(html);

        let emails = new Set();
        let phones = new Set();
        let socials = [];

        const extractContacts = (dom) => {
            dom('a[href^="mailto:"]').each((_, el) => {
                const mail = dom(el).attr('href').replace('mailto:', '').split('?')[0].trim();
                if (isValidEmail(mail)) emails.add(mail);
            });
            dom('a[href^="tel:"]').each((_, el) => {
                const tel = dom(el).attr('href').replace('tel:', '').trim();
                if (tel.length >= 7) phones.add(tel);
            });
            dom('a[href*="facebook.com"], a[href*="instagram.com"], a[href*="linkedin.com"], a[href*="twitter.com"]').each((_, el) => {
                const href = dom(el).attr('href');
                if (href && !socials.includes(href)) socials.push(href);
            });
        };

        extractContacts($);

        const bodyText = $('body').text();
        const rawEmailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        rawEmailMatches.forEach(email => { if (isValidEmail(email)) emails.add(email); });

        if (emails.size === 0) {
            const subpages = [];
            $('a').each((_, el) => {
                const href = $(el).attr('href');
                if (href && (href.includes('contact') || href.includes('about'))) {
                    try {
                        const fullUrl = new URL(href, url).href;
                        if (!subpages.includes(fullUrl) && subpages.length < 2) subpages.push(fullUrl);
                    } catch (e) { }
                }
            });

            for (const subUrl of subpages) {
                try {
                    const subRes = await axios.get(subUrl, { timeout: 4000, headers });
                    const sub$ = cheerio.load(subRes.data);
                    extractContacts(sub$);
                    if (emails.size > 0) break;
                } catch (e) { }
            }
        }

        let techStack = [];
        if (html.includes('wp-content') || html.includes('wordpress')) techStack.push('WordPress');
        if (html.includes('elementor')) techStack.push('Elementor');
        if (html.includes('Shopify')) techStack.push('Shopify');
        if (html.includes('wix.com')) techStack.push('Wix');
        if (html.includes('squarespace')) techStack.push('Squarespace');
        if (html.includes('webflow')) techStack.push('Webflow');
        if (html.includes('react') || html.includes('_next')) techStack.push('React / Next.js');
        const stackLabel = techStack.length > 0 ? techStack.join(', ') : 'Custom Web Engine';

        const isHttp = url.startsWith('http://');
        const yearMatches = bodyText.match(/20(0[0-9]|1[0-9]|2[0-3])/g) || [];
        const newestFooterYear = yearMatches.length ? Math.max(...yearMatches.map(Number)) : null;
        const currentYear = new Date().getFullYear();
        const looksOutdated = newestFooterYear !== null && (currentYear - newestFooterYear) >= 2;
        const hasViewport = $('meta[name="viewport"]').length > 0;
        const hasSitePhone = phones.size > 0;
        const hasSiteEmail = emails.size > 0;

        const issues = [];
        const services = [];

        if (isHttp) {
            issues.push('Site runs on insecure HTTP without SSL — browsers display a "Not Secure" warning and Google penalizes rankings.');
            services.push('SSL Certificate Migration & HTTPS Security');
        }
        if (!hasViewport) {
            issues.push('Missing mobile viewport tag — website layout breaks on mobile smartphones.');
            services.push('Mobile-First Responsive Redesign');
        }
        if (looksOutdated) {
            issues.push(`Outdated design/copyright (references ${newestFooterYear}) — gives visitors an unmaintained impression.`);
            services.push('Modern UI/UX Web Redesign');
        }
        if (loadTimeMs > 3500) {
            issues.push(`Slow load time (${(loadTimeMs / 1000).toFixed(1)}s) — causes high bounce rates and lost customer conversions.`);
            services.push('Speed Optimization & Cloud Hosting');
        }
        if (!hasSiteEmail) {
            issues.push('No direct contact email or automated lead capture form found on the homepage.');
            services.push('Lead Capture Form & CRM Setup');
        }
        if (!hasSitePhone) {
            issues.push('No click-to-call phone action present for mobile searchers.');
            services.push('Click-to-Call & WhatsApp Chat Widget');
        }

        let status = 'Active Site';
        if (isHttp) status = 'Insecure (HTTP)';
        else if (!hasViewport) status = 'Non-Responsive';
        else if (looksOutdated) status = 'Outdated Site';
        else if (loadTimeMs > 3500) status = 'Slow Loading';

        if (issues.length === 0) {
            issues.push('No major technical flaws found — site is secure and responsive.');
            services.push('Local SEO Ranking Growth', 'Automated Lead Nurturing CRM');
        }

        return {
            status,
            issues,
            services,
            techStack: stackLabel,
            email: emails.size > 0 ? Array.from(emails)[0] : 'Not Found',
            phone: phones.size > 0 ? Array.from(phones)[0] : fallbackPhone,
            socials
        };

    } catch (err) {
        return {
            status: 'Inaccessible / Down',
            issues: [`Website did not respond (${err.code || err.message || 'connection failed'}) — site appears to be offline or down.`],
            services: ['Website Rebuild & High-Availability Hosting Restoral', '24/7 Uptime & Performance Monitoring'],
            techStack: 'Unknown',
            email: 'Not Found',
            phone: fallbackPhone,
            socials: []
        };
    }
}

/**
 * Builds a detailed, ready-to-send sales pitch based on audit results.
 */
function buildPitch(lead, analysis) {
    const name = lead.shopName || 'Business Owner';
    const category = (lead.category || 'business').toLowerCase();
    const issuesList = analysis.issues.map(i => `  • ${i}`).join('\n');
    const servicesList = analysis.services.map(s => `  • ${s}`).join('\n');

    if (analysis.status === 'Missing Website') {
        return `Hi ${name} Team,

I was looking for ${category} services in your area on Google Maps and noticed you don't have a website linked for ${lead.shopName}.

Over 70% of prospective clients visit a website before calling or booking a local business. Without one, prospective clients end up choosing competitors.

Here is what we can build for you:
${servicesList}

Would you be open to seeing a free custom website mockup for ${lead.shopName}? I can put one together with no obligation.`;
    }

    return `Hi ${name} Team,

I was researching top ${category} businesses in your area and checked out your site (${lead.website}). I noticed a few technical items that are likely hurting your visitor conversion rate:

${issuesList}

Here is how we can address these issues to help convert more website visitors into paying clients:
${servicesList}

Would you be open to a quick 5-minute review or seeing a free design draft for ${lead.shopName}? Let me know if you'd like to take a look!`;
}

function isValidEmail(email) {
    if (!email) return false;
    const clean = email.toLowerCase();
    const invalidExt = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js'];
    const invalidWords = ['sentry', 'example', 'wixpress', 'domain', 'bootstrap'];
    if (invalidExt.some(ext => clean.endsWith(ext))) return false;
    if (invalidWords.some(w => clean.includes(w))) return false;
    return true;
}

module.exports = { scrapeGoogleMaps };