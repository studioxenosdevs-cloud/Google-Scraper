const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');

const existingLeadNames = new Set();

async function scrapeGoogleMaps(options, updateProgress) {
    const { businessType, location, isNearMe, maxResults = 10, coords } = options;

    let searchQuery = businessType;
    if (!isNearMe && location) {
        searchQuery = `${businessType} in ${location}`;
    }

    updateProgress(`Launching Playwright Browser...`);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

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
        updateProgress("Error: Could not load Maps feed.");
        await browser.close();
        return [];
    }

    const rawLeads = [];
    let scrollAttempts = 0;

    updateProgress(`Extracting business listings...`);

    while (rawLeads.length < maxResults && scrollAttempts < 15) {
        // Collect current listings directly via index to prevent detached element errors
        const cardCount = await page.evaluate(() => {
            return document.querySelectorAll('div[role="feed"] > div > div[role="article"]').length;
        });

        if (cardCount <= rawLeads.length) {
            await page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]');
                if (feed) feed.scrollBy(0, 1000);
            });
            await page.waitForTimeout(1500);
            scrollAttempts++;
            continue;
        }

        for (let i = rawLeads.length; i < cardCount; i++) {
            if (rawLeads.length >= maxResults) break;

            try {
                // Click the card safely using DOM-evaluated selectors to prevent handle detachment
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
                await page.waitForTimeout(1800); // Allow side panel details to load

                // Extract panel details alongside fallback feed data
                const leadData = await page.evaluate((index) => {
                    const articles = document.querySelectorAll('div[role="feed"] > div > div[role="article"]');
                    const article = articles[index];

                    // Card Fallbacks
                    const cardText = article ? article.innerText : '';
                    const feedPhoneMatch = cardText.match(/(\+?\d{2,4}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}/);
                    const feedPhone = feedPhoneMatch ? feedPhoneMatch[0].trim() : null;

                    // Detail Panel Data
                    const panelH1 = Array.from(document.querySelectorAll('h1')).find(
                        h1 => h1.innerText.trim().toLowerCase() !== 'results' && h1.innerText.trim() !== ''
                    );
                    const shopName = panelH1 ? panelH1.innerText.trim() : 'Unknown Business';

                    const categoryNode = document.querySelector('button[jsaction*="category"]');
                    const category = categoryNode ? categoryNode.innerText.trim() : 'Local Business';

                    const ratingNode = document.querySelector('span.ceA1da') || document.querySelector('div.F72Y0d span');
                    const rating = ratingNode ? ratingNode.innerText.trim() : 'N/A';

                    const reviewNode = document.querySelector('button[jsaction*="reviews"]');
                    const reviews = reviewNode ? reviewNode.innerText.replace(/[^0-9]/g, '') : '0';

                    // Phone Number Parsing
                    const phoneBtn = document.querySelector('button[aria-label*="Phone"]') ||
                        document.querySelector('button[data-item-id*="phone:tel"]') ||
                        Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.includes('Phone'));

                    let phone = feedPhone || 'Not Found';
                    if (phoneBtn) {
                        const rawPhone = (phoneBtn.getAttribute('aria-label') || phoneBtn.innerText || '').replace(/[^0-9+() -]/g, '').trim();
                        if (rawPhone.length >= 7) phone = rawPhone;
                    }

                    // Website & Address
                    const websiteBtn = document.querySelector('a[aria-label*="Website"]') ||
                        document.querySelector('a[data-item-id="authority"]');
                    const website = websiteBtn ? websiteBtn.href : 'None';

                    const addressBtn = document.querySelector('button[data-item-id="address"]');
                    const address = addressBtn ? addressBtn.innerText.replace(//g, '').trim() : 'Not Found';

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

    await browser.close();

    // Comprehensive Website Analysis & Service Offering Pitch Engine
    updateProgress(`Performing website audits & generating service recommendations...`);

    const finalLeads = await Promise.all(
        rawLeads.map(async (lead, idx) => {
            updateProgress(`Auditing website ${idx + 1}/${rawLeads.length}: ${lead.shopName}`);
            const analysis = await auditWebsiteAndRecommendServices(lead.website, lead.phone);

            return {
                id: `lead_${Date.now()}_${idx}`,
                ...lead,
                phone: lead.phone !== 'Not Found' ? lead.phone : analysis.phone,
                email: analysis.email,
                siteStatus: analysis.status,
                opportunity: analysis.recommendedService,
                techStack: analysis.techStack,
                socials: analysis.socials,
                dateAdded: new Date().toISOString().replace('T', ' ').substring(0, 19),
                status: 'New'
            };
        })
    );

    return finalLeads;
}

/**
 * Performs website audits and outputs actionable services to offer
 */
async function auditWebsiteAndRecommendServices(url, fallbackPhone) {
    if (!url || url === 'None') {
        return {
            status: 'Missing Website',
            recommendedService: 'New Custom Website Development + WhatsApp Lead Bot',
            techStack: 'None',
            email: 'Not Found',
            phone: fallbackPhone || 'Not Found',
            socials: []
        };
    }

    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' };
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
            dom('a[href*="facebook.com"], a[href*="instagram.com"], a[href*="linkedin.com"]').each((_, el) => {
                const href = dom(el).attr('href');
                if (href && !socials.includes(href)) socials.push(href);
            });
        };

        extractContacts($);

        const bodyText = $('body').text();
        const rawEmailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        rawEmailMatches.forEach(email => { if (isValidEmail(email)) emails.add(email); });

        // Crawl contact page if email missing on homepage
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

        // Tech Stack Auditing
        let techStack = [];
        if (html.includes('wp-content') || html.includes('wordpress')) techStack.push('WordPress');
        if (html.includes('elementor')) techStack.push('Elementor');
        if (html.includes('Shopify')) techStack.push('Shopify');
        if (html.includes('wix.com')) techStack.push('Wix');
        if (html.includes('squarespace')) techStack.push('Squarespace');
        if (html.includes('webflow')) techStack.push('Webflow');
        if (html.includes('react') || html.includes('_next')) techStack.push('React/Next.js');

        const stackLabel = techStack.length > 0 ? techStack.join(', ') : 'Custom Web Engine';

        // Audit & Offer Mapping
        const isHttp = url.startsWith('http://');
        const hasOldFooter = /20(0[0-9]|1[0-9]|2[0-2])/.test(bodyText);
        const hasViewport = $('meta[name="viewport"]').length > 0;

        let status = 'Active Site';
        let recommendedService = 'CRM Integration & Automated Lead Nurturing';

        if (isHttp) {
            status = 'Insecure (HTTP)';
            recommendedService = 'SSL Migration & Security Upgrade';
        } else if (!hasViewport) {
            status = 'Non-Responsive';
            recommendedService = 'Mobile-First Responsive Redesign';
        } else if (hasOldFooter) {
            status = 'Outdated Site';
            recommendedService = 'Modern Website Redesign & UI Upgrade';
        } else if (loadTimeMs > 3500) {
            status = 'Slow Loading';
            recommendedService = 'Speed Optimization & Modern Infrastructure';
        }

        return {
            status,
            recommendedService,
            techStack: stackLabel,
            email: emails.size > 0 ? Array.from(emails)[0] : 'Not Found',
            phone: phones.size > 0 ? Array.from(phones)[0] : fallbackPhone,
            socials
        };

    } catch (err) {
        return {
            status: 'Inaccessible / Down',
            recommendedService: 'Website Rebuild & Hosting Restoration',
            techStack: 'Unknown',
            email: 'Not Found',
            phone: fallbackPhone,
            socials: []
        };
    }
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