const express = require('express');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');

const app = express();
const port = 3000;

// ✅ Elasticsearch client
const es = new Client({ node: 'http://127.0.0.1:9200' });

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/api/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Missing query parameter ?q=' });

    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1) - 1;
        const size = parseInt(req.query.size) || 100;
        const from = page * size;
        const lcQuery = query.toLowerCase();
        const queryWords = query.toLowerCase().split(/\s+/);
        const coverageWeight = 0.3;

        console.log(`BACKEND REQUEST: q="${query}" page=${page} size=${size} from=${from}`);

        let exactMatchDocs = [];

        // ✅ 1️⃣ Exact match search on preferred_name
        const preferredResult = await es.search({
            index: 'umls-cui',
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query: {
                term: { "preferred_name.lowercase_keyword": lcQuery }
            }
        });

        if (preferredResult.hits.total.value > 0) {
            exactMatchDocs.push(...preferredResult.hits.hits);
            console.log(`✅ Found ${preferredResult.hits.hits.length} exact preferred_name match(es)`);
        }

        // ✅ 2️⃣ Exact match search on codes[].strings
        const codesResult = await es.search({
            index: 'umls-cui',
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query: {
                nested: {
                    path: "codes",
                    query: {
                        term: { "codes.strings.keyword_lowercase": lcQuery }
                    }
                }
            }
        });

        if (codesResult.hits.total.value > 0) {
            const codesHits = codesResult.hits.hits.filter(hit => 
                !exactMatchDocs.find(doc => doc._id === hit._id)
            );
            exactMatchDocs.push(...codesHits);
            console.log(`✅ Found ${codesHits.length} exact codes.strings match(es)`);
        }

        // ✅ 3️⃣ Full normal search
        const fullResult = await es.search({
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

        let hits = fullResult.hits.hits;

        // ✅ Remove exact matches from hits
        const exactIds = new Set(exactMatchDocs.map(doc => doc._id));
        hits = hits.filter(hit => !exactIds.has(hit._id));

        // ✅ 4️⃣ Custom scoring for remaining hits
        const scoredHits = hits.map(hit => {
            const src = hit._source;

            const codesMatchCount = (src.codes || []).flatMap(c => c.strings || [])
                .filter(s => s.toLowerCase().includes(lcQuery)).length;

            const allText = [src.preferred_name || '']
                .concat((src.codes || []).flatMap(c => c.strings || []))
                .join(' ');
            const words = allText.toLowerCase().split(/\s+/);

            const queryWordMatches = queryWords.filter(qw => words.includes(qw)).length;
            const coverageRatio = queryWords.length ? queryWordMatches / queryWords.length : 0;

            const combinedScore = codesMatchCount + (coverageRatio * coverageWeight);

            return { ...hit, _customScore: combinedScore };
        });

        scoredHits.sort((a, b) => b._customScore - a._customScore);

        // ✅ 5️⃣ Final result = exact matches first, then re-ranked hits
        const finalHits = [...exactMatchDocs, ...scoredHits];

        res.json({
            total: fullResult.hits.total.value,
            results: finalHits
        });

    } catch (err) {
        console.error("BACKEND ERROR:", err);
        res.status(500).json({ error: 'Elasticsearch error', details: err.meta?.body?.error || err.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:3000`);
});
