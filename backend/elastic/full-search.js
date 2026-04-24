const es = require('./client');
const { ES_INDEX } = require('../../elastic-config');

function scoreHits(hits) {
    return hits.map(hit => ({
        ...hit,
        _customScore: hit._score || 0
    }));
}

function resolveMatchType(hit) {
    const matchedQueries = Array.isArray(hit.matched_queries) ? hit.matched_queries : [];
    return matchedQueries.includes('fuzzy_atom_text') ? 'fuzzy' : 'full-text';
}

function anyWordLongEnough(query, minLength = 6) {
    return query.split(/\s+/).some(word => word.length >= minLength);
}

async function runFullSearch({ query, exactCUIs, fuzzy = false, includeDefinitions = true }) {
    const shouldQueries = [
        // Favor exact user input (no synonym expansion)
        {
            match_phrase: {
                "atom_text.no_synonyms": {
                    _name: 'phrase_no_synonyms',
                    query,
                    boost: 6
                }
            }
        },
        {
            match: {
                "atom_text.no_synonyms": {
                    _name: 'and_no_synonyms',
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
                    _name: 'phrase_atom_text',
                    query,
                    boost: 3
                }
            }
        },
        {
            match: {
                atom_text: {
                    _name: 'and_atom_text',
                    query,
                    operator: "and",
                    boost: 2
                }
            }
        }
    ];

    if (includeDefinitions) {
        shouldQueries.push(
            {
                match_phrase: {
                    definitions: {
                        _name: 'phrase_definitions',
                        query,
                        boost: 1.5
                    }
                }
            },
            {
                match: {
                    definitions: {
                        _name: 'and_definitions',
                        query,
                        operator: "and",
                        boost: 1
                    }
                }
            }
        );
    }

    if (fuzzy && anyWordLongEnough(query)) {
        shouldQueries.push({
            match: {
                atom_text: {
                    _name: 'fuzzy_atom_text',
                    query,
                    operator: "and",
                    fuzziness: "1",
                    boost: 1
                }
            }
        });
    }

    const result = await es.search({
        index: ES_INDEX,
        from: 0,
        size: 1000,
        track_total_hits: true,
        _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions', 'atom_text', 'related_concepts'],
        query: {
            bool: {
                should: shouldQueries,
                minimum_should_match: 1
            }
        }
    });

    const hits = result.hits.hits;
    const filteredHits = hits.filter(hit => !exactCUIs.has(hit._source?.CUI));
    const scoredHits = scoreHits(filteredHits).map(hit => ({
        ...hit,
        matchType: resolveMatchType(hit)
    }));

    return {
        scoredHits,
        total: scoredHits.length
    };
}

module.exports = runFullSearch;
