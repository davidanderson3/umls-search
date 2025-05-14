const express = require('express');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');
const { customRank } = require('../frontend/ranker');

const app = express();
const port = 3000;

// ✅ Elasticsearch client
const es = new Client({ node: 'http://127.0.0.1:9200' });

// ✅ Serve static frontend files from ../frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// ✅ API route with full paging support
app.get('/api/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Missing query parameter ?q=' });

    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1) - 1;
        const size = parseInt(req.query.size) || 100;
        const from = page * size;

        console.log(`BACKEND REQUEST: q="${query}" page=${page} size=${size} from=${from}`);

        const esResult = await es.search({
            index: 'umls-cui',
            from,
            size,
            track_total_hits: true,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query: {
                bool: {
                    should: [
                        { match_phrase: { "preferred_name": { query, boost: 10 } } },
                        { match: { "preferred_name": { query, operator: "and", boost: 5 } } },
                        { nested: {
                            path: "codes",
                            score_mode: "max",
                            query: {
                                bool: {
                                    should: [
                                        { match_phrase: { "codes.strings": { query, boost: 10 } } },
                                        { match: { "codes.strings": { query, operator: "and", boost: 5 } } }
                                    ],
                                    minimum_should_match: 1
                                }
                            }
                        }}
                    ],
                    minimum_should_match: 1
                }
            }
        });

        const hits = customRank(esResult.hits.hits, query);

        res.json({
            total: esResult.hits.total.value,
            results: hits
        });

    } catch (err) {
        console.error("BACKEND ERROR:", err);
        res.status(500).json({ error: 'Elasticsearch error', details: err.meta?.body?.error || err.message });
    }
});

// ✅ Catch-all route for frontend (for deep links etc.)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ✅ Start server
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
