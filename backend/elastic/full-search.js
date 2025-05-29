const es = require('./client');

function scoreHits(hits) {
    return hits.map(hit => ({
        ...hit,
        _customScore: hit._score || 0
    }));
}

function anyWordLongEnough(query, minLength = 6) {
    return query.split(/\s+/).some(word => word.length >= minLength);
}

async function runFullSearch({ query, exactCUIs, fuzzy = false }) {
    const shouldQueries = [
        // Favor exact user input (no synonym expansion)
        {
            match_phrase: {
                "atom_text.no_synonyms": {
                    query,
                    boost: 6
                }
            }
        },
        {
            match: {
                "atom_text.no_synonyms": {
                    query,
                    operator: "and",
                    boost: 4
                }
            }
        },
        // Synonym-expanded fallback
        {
            match_phrase: {
                atom_text: {
                    query,
                    boost: 3
                }
            }
        },
        {
            match: {
                atom_text: {
                    query,
                    operator: "and",
                    boost: 2
                }
            }
        },
        // Definitions search
        {
            match_phrase: {
                definitions: {
                    query,
                    boost: 1.5
                }
            }
        },
        {
            match: {
                definitions: {
                    query,
                    operator: "and",
                    boost: 1
                }
            }
        }
    ];

    if (fuzzy && anyWordLongEnough(query)) {
        shouldQueries.push({
            match: {
                atom_text: {
                    query,
                    operator: "and",
                    fuzziness: "1",
                    boost: 1
                }
            }
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
