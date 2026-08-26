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

const CSV_FILE = path.join(__dirname, 'leads.csv');

app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

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
    const fields = [
        'id', 'shopName', 'category', 'phone', 'website',
        'address', 'rating', 'reviews', 'siteStatus', 'status',
        'ownerName', 'email', 'techStack', 'opportunity', 'mapsUrl', 'dateAdded'
    ];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);
    await fs.promises.writeFile(CSV_FILE, csv, 'utf8');
}
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/leads', async (req, res) => {
    try {
        const leads = await readCSV();
        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read CSV data' });
    }
});

app.post('/api/leads/update', async (req, res) => {
    try {
        const { id, status } = req.body;
        const leads = await readCSV();
        const lead = leads.find(l => String(l.id) === String(id));
        if (lead) {
            lead.status = status;
            await writeCSV(leads);
            res.json({ success: true, lead });
        } else {
            res.status(404).json({ error: 'Lead not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to update lead' });
    }
});

io.on('connection', (socket) => {
    socket.on('start-scrape', async (params) => {
        const { businessType, location, maxResults, isNearMe } = params;

        const updateProgress = (msg) => {
            socket.emit('progress', msg);
        };

        try {
            updateProgress('Initializing Scraper...');

            const scrapedLeads = await scrapeGoogleMaps(
                {
                    businessType,
                    location,
                    isNearMe,
                    maxResults: parseInt(maxResults, 10) || 10
                },
                updateProgress
            );

            updateProgress('Saving scraped leads to CSV...');

            const currentLeads = await readCSV();
            const now = new Date().toISOString().replace('T', ' ').substring(0, 16);

            const formattedNewLeads = scrapedLeads.map((item) => ({
                id: `lead_${item.id}`,
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
                techStack: item.techStack || 'Custom / Standard Web',
                opportunity: item.opportunity || 'Needs Web Presence',
                mapsUrl: item.mapsUrl || 'https://maps.google.com',
                dateAdded: now
            }));

            const existingIds = new Set(currentLeads.map(l => String(l.id)));
            const uniqueNewLeads = formattedNewLeads.filter(l => !existingIds.has(String(l.id)));

            const updatedLeads = [...uniqueNewLeads, ...currentLeads];
            await writeCSV(updatedLeads);

            socket.emit('progress', `Done! Added ${uniqueNewLeads.length} leads.`);
            socket.emit('scrape-complete', updatedLeads);

        } catch (err) {
            console.error('Scraping Error:', err);
            socket.emit('progress', `Error: ${err.message}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));