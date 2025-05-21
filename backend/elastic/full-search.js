const es = require('./client');

function scoreHits(hits) {
    return hits.map(hit => ({
        ...hit,
        _customScore: hit._score || 0
    }));
}

async function runFullSearch({ query, exactCUIs, fuzzy = false }) {
    const shouldQueries = [
        { match_phrase: { atom_text: { query, boost: 5 } } },
        { match: { atom_text: { query, operator: "and", boost: 3 } } }
    ];

    if (fuzzy) {
        shouldQueries.push({
            match: { atom_text: { query, operator: "and", fuzziness: "1", boost: 1 } }
        });
    }

    const result = await es.search({
        index: 'umls-cui',
        from: 0,
        size: 1000,
        track_total_hits: true,
        _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions', 'atom_text'],
        query: {
            bool: {
                should: shouldQueries,
                minimum_should_match: 1
            }
        }
    });

    const hits = result.hits.hits;
    const filteredHits = hits.filter(hit => !exactCUIs.has(hit._source?.CUI));
    const scoredHits = scoreHits(filteredHits);

    return {
        scoredHits,
        total: scoredHits.length
    };
}

module.exports = runFullSearch;
