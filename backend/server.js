const express = require('express');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');

const app = express();
const port = 3000;

// ✅ Elasticsearch client
const es = new Client({ node: 'http://127.0.0.1:9200' });

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/api/search', async (req, res) => {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) return res.status(400).json({ error: 'Missing query parameter ?q=' });

    function normalizeQuery(q) {
        return q.replace(/%/g, ' percent');
    }

    const query = normalizeQuery(rawQuery);
    const lcQuery = query.toLowerCase();
    const queryWords = lcQuery.split(/\s+/);
    const page = Math.max(parseInt(req.query.page) || 1, 1) - 1;
    const size = parseInt(req.query.size) || 100;
    const from = page * size;
    const coverageWeight = 0.3;

    console.log(`BACKEND REQUEST: q="${rawQuery}" (normalized: "${query}") page=${page} size=${size} from=${from}`);

    try {
        let exactMatchDocs = [];

        // 1️⃣ Exact match on preferred_name.lowercase_keyword
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

        // 1️⃣.5 Exact match on CUI (case-insensitive)
        const cuiResult = await es.search({
            index: 'umls-cui',
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query: {
                term: { "CUI.lowercase_keyword": lcQuery }
            }
        });

        if (cuiResult.hits.total.value > 0) {
            const cuiHits = cuiResult.hits.hits.filter(hit =>
                !exactMatchDocs.find(doc => doc._id === hit._id)
            );
            exactMatchDocs.push(...cuiHits);
            console.log(`✅ Found ${cuiHits.length} exact CUI match(es)`);
        }

        // 1️⃣.6 Exact match on codes.code (case-insensitive)
        const codeResult = await es.search({
            index: 'umls-cui',
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query: {
                nested: {
                    path: "codes",
                    query: {
                        term: { "codes.CODE.lowercase_keyword": lcQuery }
                    }
                }
            }
        });

        if (codeResult.hits.total.value > 0) {
            const codeHits = codeResult.hits.hits.filter(hit =>
                !exactMatchDocs.find(doc => doc._id === hit._id)
            );
            exactMatchDocs.push(...codeHits);
            console.log(`✅ Found ${codeHits.length} exact codes.code match(es)`);
        }

        // 2️⃣ Exact match on codes.strings.lowercase_keyword
        const codesResult = await es.search({
            index: 'umls-cui',
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query: {
                nested: {
                    path: "codes",
                    query: {
                        term: { "codes.strings.lowercase_keyword": lcQuery }
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

        // 3️⃣ Full match with synonym expansion
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

        // Remove exact matches
        const exactIds = new Set(exactMatchDocs.map(doc => doc._id));
        hits = hits.filter(hit => !exactIds.has(hit._id));

        // Custom scoring
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

        // Combine final results
        const finalHits = page === 0
            ? [...exactMatchDocs, ...scoredHits]
            : scoredHits;

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
