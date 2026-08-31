const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const { Parser } = require('json2csv');

const { scrapeGoogleMaps } = require('./scraper');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure public directory exists for static asset serving
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CSV_FILE = path.join(dataDir, 'leads.csv');

app.use(express.json());

// Securely serve static files from /public directory only
app.use(express.static(PUBLIC_DIR));

const CSV_FIELDS = [
    'id', 'shopName', 'category', 'phone', 'website',
    'address', 'rating', 'reviews', 'siteStatus', 'status',
    'ownerName', 'email', 'techStack', 'opportunity', 'services',
    'issues', 'pitch', 'socials', 'mapsUrl', 'dateAdded'
];

function readCSV() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(CSV_FILE)) {
            return resolve([]);
        }
        const results = [];
        fs.createReadStream(CSV_FILE)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

async function writeCSV(data) {
    const json2csvParser = new Parser({ fields: CSV_FIELDS });
    const csv = json2csvParser.parse(data);
    await fs.promises.writeFile(CSV_FILE, csv, 'utf8');
}

// Thread-safe write queue to prevent CSV file corruption during concurrent operations
let writeQueue = Promise.resolve();
function queueWrite(task) {
    const result = writeQueue.then(task);
    writeQueue = result.catch(() => { });
    return result;
}

function sortLeadsByLatest(leads) {
    return [...leads].sort((a, b) => {
        const dateA = new Date(a.dateAdded || 0);
        const dateB = new Date(b.dateAdded || 0);
        return dateB - dateA;
    });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// GET /api/leads - reads directly from leads.csv
app.get('/api/leads', async (req, res) => {
    try {
        const leads = await readCSV();
        res.json(sortLeadsByLatest(leads));
    } catch (err) {
        console.error('Failed to read leads:', err);
        res.status(500).json({ error: 'Failed to load leads' });
    }
});

// POST /api/leads/update - updates pipeline status for a single lead
app.post('/api/leads/update', async (req, res) => {
    try {
        const { id, status } = req.body;
        if (!id || !status) {
            return res.status(400).json({ error: 'id and status are required' });
        }

        const lead = await queueWrite(async () => {
            const leads = await readCSV();
            const target = leads.find(l => String(l.id) === String(id));
            if (target) {
                target.status = status;
                await writeCSV(leads);
            }
            return target;
        });

        if (lead) {
            res.json({ success: true, lead });
        } else {
            res.status(404).json({ error: 'Lead not found' });
        }
    } catch (err) {
        console.error('Failed to update lead:', err);
        res.status(500).json({ error: 'Failed to update lead' });
    }
});

// DELETE /api/leads/:id - deletes an individual lead by ID
app.delete('/api/leads/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { found, remaining } = await queueWrite(async () => {
            const leads = await readCSV();
            const before = leads.length;
            const remaining = leads.filter(l => String(l.id) !== String(id));
            const found = remaining.length < before;
            if (found) await writeCSV(remaining);
            return { found, remaining };
        });

        if (found) {
            res.json({ success: true, remainingCount: remaining.length });
        } else {
            res.status(404).json({ error: 'Lead not found' });
        }
    } catch (err) {
        console.error('Failed to delete lead:', err);
        res.status(500).json({ error: 'Failed to delete lead' });
    }
});

io.on('connection', (socket) => {
    socket.on('start-scrape', async (params) => {
        const { businessType, location, maxResults, isNearMe, coords } = params || {};

        const updateProgress = (msg) => {
            socket.emit('progress', msg);
        };

        if (!businessType || (!isNearMe && !location)) {
            socket.emit('progress', 'Error: missing business query or location.');
            return;
        }

        try {
            updateProgress('Initializing scraper...');

            const scrapedLeads = await scrapeGoogleMaps(
                {
                    businessType,
                    location,
                    isNearMe,
                    maxResults: parseInt(maxResults, 10) || 10,
                    coords
                },
                updateProgress
            );

            updateProgress('Saving scraped leads to CSV...');

            const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

            const formattedNewLeads = scrapedLeads.map((item) => ({
                id: item.id,
                shopName: item.shopName || 'Business Listing',
                category: item.category || businessType,
                phone: item.phone || 'Not Found',
                website: item.website || 'None',
                address: item.address || (isNearMe ? 'Near Current Location' : location),
                rating: item.rating || 'N/A',
                reviews: item.reviews || '0',
                siteStatus: item.siteStatus || 'Missing',
                status: item.status || 'New',
                ownerName: item.ownerName || 'Not Listed',
                email: item.email || 'Not Found',
                techStack: item.techStack || 'Custom Web Engine',
                opportunity: item.opportunity || 'Needs Web Presence',
                services: item.services || '',
                issues: item.issues || '',
                pitch: item.pitch || '',
                socials: item.socials || '',
                mapsUrl: item.mapsUrl || 'https://maps.google.com',
                dateAdded: now
            }));

            const updatedLeads = await queueWrite(async () => {
                const currentLeads = await readCSV();
                const existingIds = new Set(currentLeads.map(l => String(l.id)));
                const uniqueNewLeads = formattedNewLeads.filter(l => !existingIds.has(String(l.id)));
                const merged = [...uniqueNewLeads, ...currentLeads];
                await writeCSV(merged);
                return merged;
            });

            socket.emit('progress', `Done! Added ${formattedNewLeads.length} new lead(s).`);
            socket.emit('scrape-complete', sortLeadsByLatest(updatedLeads));

        } catch (err) {
            console.error('Scraping Error:', err);
            socket.emit('progress', `Error: ${err.message}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
