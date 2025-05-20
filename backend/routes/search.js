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
    const lcQuery = query.toLowerCase();
    const queryWords = lcQuery.split(/\s+/);
    const size = parseInt(req.query.size, 10) || 100;
    const page = Math.max((parseInt(req.query.page, 10) || 1) - 1, 0);

    try {
        const exactMatches = page === 0 ? await getExactMatches(lcQuery) : [];
        exactMatches.forEach(hit => hit._customScore = Infinity);
        const exactCUIs = new Set(exactMatches.map(doc => doc._source.CUI));

        const { scoredHits } = await runFullSearch({
            query,
            queryWords,
            page,
            size,
            exactCUIs
        });

        const combinedHits = page === 0
            ? [...exactMatches, ...scoredHits]
            : scoredHits;

        const dedupedMap = new Map();
        for (const hit of combinedHits) {
            const cui = hit._source?.CUI;
            if (cui && !dedupedMap.has(cui)) {
                dedupedMap.set(cui, hit);
            }
        }

        const dedupedHits = [...dedupedMap.values()].sort(
            (a, b) => b._customScore - a._customScore
        );

        const totalHits = dedupedHits.length;
        const from = page * size;
        const finalHits = dedupedHits.slice(from, from + size);

        res.json({
            total: totalHits,
            results: finalHits
        });

    } catch (err) {
        console.error("BACKEND ERROR:", err);
        res.status(500).json({
            error: 'Search failed',
            details: err.meta?.body?.error || err.message
        });
    }
});

module.exports = router;
