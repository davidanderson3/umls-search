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

    // Parse ?fuzzy=true (default: false)
    const fuzzy = req.query.fuzzy === 'true';

    try {
        console.log(`\n🔍 Query: "${query}" (fuzzy: ${fuzzy})`);
        console.log(`📄 Page: ${page + 1}, From: ${from}, Size: ${size}`);

        // Step 1: Get exact matches
        const exactMatches = await getExactMatches(query.toLowerCase());
        exactMatches.forEach(hit => {
            hit.matchType = 'exact';
            hit._customScore = Infinity;
        });
        const exactCUIs = new Set(exactMatches.map(doc => doc._source.CUI));

        console.log(`\n🎯 EXACT MATCHES:`);
        exactMatches.forEach(hit => {
            console.log(`  ${hit._source?.preferred_name}  |  CUI: ${hit._source?.CUI}`);
        });
        console.log(`✅ Exact Matches Count: ${exactMatches.length}`);
        console.log(`✅ Unique CUIs from Exact Matches: ${exactCUIs.size}`);

        // Step 2: Run full search with or without fuzziness
        const { scoredHits: fuzzyHitsRaw } = await runFullSearch({
            query,
            exactCUIs,
            fuzzy
        });
        fuzzyHitsRaw.forEach(hit => hit.matchType = 'fuzzy');
        console.log(`✅ Scored Hits Count: ${fuzzyHitsRaw.length}`);

        // Step 3: Combine results
        const combinedHits = [...exactMatches, ...fuzzyHitsRaw];
        console.log(`✅ Combined Hits Count (before deduplication): ${combinedHits.length}`);

        // Step 4: Deduplicate by CUI
        const dedupedMap = new Map();
        combinedHits.forEach((hit, index) => {
            const cui = hit._source?.CUI;
            if (!cui) {
                console.warn(`⚠️ Missing CUI for hit at index ${index}: ${JSON.stringify(hit)}`);
            } else if (!dedupedMap.has(cui)) {
                dedupedMap.set(cui, hit);
            } else {
                console.log(`🔄 Duplicate CUI found: ${cui} at index ${index}`);
            }
        });
        const allResults = [...dedupedMap.values()];
        console.log(`✅ Deduplicated Hits Count: ${allResults.length}`);

        // Step 5: Sort (Infinity first, then score, then CUI)
        const sortedResults = allResults.sort((a, b) => {
            if (a._customScore === Infinity && b._customScore !== Infinity) return -1;
            if (b._customScore === Infinity && a._customScore !== Infinity) return 1;
            const scoreDiff = b._customScore - a._customScore;
            return scoreDiff !== 0
                ? scoreDiff
                : (a._source?.CUI || '').localeCompare(b._source?.CUI || '');
        });

        console.log(`\n🪄 TOP SORTED RESULTS:`);
        sortedResults.slice(0, 5).forEach((hit, i) => {
            console.log(`${i + 1}. [${hit.matchType}] ${hit._source?.preferred_name}  |  CUI: ${hit._source?.CUI}  |  Score: ${hit._customScore}`);
        });

        console.log(`✅ Sorted Results Count: ${sortedResults.length}`);

        // Step 6: Paginate
        const finalHits = sortedResults.slice(from, from + size);
        console.log(`✅ Final Hits Count for Page ${page + 1}: ${finalHits.length}`);

        // Step 7: Respond
        res.json({
            total: sortedResults.length,
            results: finalHits
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
