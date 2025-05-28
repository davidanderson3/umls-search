const express = require('express');
const router = express.Router();
const getExactMatches = require('../elastic/exact-match');
const runFullSearch = require('../elastic/full-search');

router.get('/search', async (req, res) => {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) {
        return res.status(400).json({ error: 'Missing query parameter ?q=' });
    }

    const query = rawQuery.replace(/%/g, ' percent');
    const size = parseInt(req.query.size, 10) || 100;
    const page = Math.max((parseInt(req.query.page, 10) || 1) - 1, 0);
    const from = page * size;
    const fuzzy = req.query.fuzzy === 'true';

    try {
        console.log(`\n🔍 Query: "${query}" (fuzzy: ${fuzzy})`);
        console.log(`📄 Page: ${page + 1}, From: ${from}, Size: ${size}`);

        // Step 1: Exact matches
        const exactMatches = await getExactMatches(query.toLowerCase());
        exactMatches.forEach(hit => {
            hit.matchType = 'exact';
            hit._customScore = Infinity;
        });
        const exactCUIs = new Set(exactMatches.map(doc => doc._source?.CUI));

        // Step 2: Fuzzy or full-text search
        const { scoredHits: fuzzyHitsRaw } = await runFullSearch({ query, exactCUIs, fuzzy });
        fuzzyHitsRaw.forEach(hit => hit.matchType = 'fuzzy');

        // Step 3: Combine and deduplicate
        const combinedHits = [...exactMatches, ...fuzzyHitsRaw];

        const dedupedMap = new Map();
        for (const hit of combinedHits) {
            const cui = hit._source?.CUI;
            const pname = hit._source?.preferred_name;
            if (!cui || !pname) {
                console.warn('⚠️ Skipping malformed hit:', JSON.stringify(hit, null, 2));
                continue;
            }
            if (!dedupedMap.has(cui)) dedupedMap.set(cui, hit);
        }

        const sortedResults = Array.from(dedupedMap.values()).sort((a, b) => {
            if (a._customScore === Infinity && b._customScore !== Infinity) return -1;
            if (b._customScore === Infinity && a._customScore !== Infinity) return 1;
            const scoreDiff = b._customScore - a._customScore;
            return scoreDiff !== 0
                ? scoreDiff
                : (a._source?.CUI || '').localeCompare(b._source?.CUI || '');
        });

        // Step 7: Respond
        console.log(`✅ Sorted Results Count: ${sortedResults.length}`);

        // Filter malformed hits BEFORE slicing
        const validHits = sortedResults.filter(hit => {
            const valid = hit && hit._source && typeof hit._source.CUI === 'string' && typeof hit._source.preferred_name === 'string';
            if (!valid) {
                console.warn('⚠️ Skipping malformed hit:', JSON.stringify(hit, null, 2));
            }
            return valid;
        });

        console.log(`✅ Valid Hits Count: ${validHits.length}`);

        const finalHits = validHits.slice(from, from + size);
        console.log(`✅ Final Hits Count for Page ${page + 1}: ${finalHits.length}`);

        res.json({
            total: validHits.length,
            results: finalHits.map(hit => {
                const s = hit._source || {};
                return {
                    CUI: s.CUI || null,
                    preferred_name: typeof s.preferred_name === 'string' ? s.preferred_name : '',  // ⬅️ safeguard
                    STY: Array.isArray(s.STY) ? s.STY : [],
                    codes: Array.isArray(s.codes) ? s.codes : [],
                    definitions: Array.isArray(s.definitions) ? s.definitions : [],
                    matchType: hit.matchType || null,
                    _customScore: hit._customScore || 0
                };
            })

        });


    } catch (err) {
        console.error("❌ BACKEND ERROR:", err);
        res.status(500).json({
            error: 'Search failed',
            details: err.meta?.body?.error || err.message
        });
    }
});

module.exports = router;
