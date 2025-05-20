// backend/elastic/full-search.js
const es = require('./client');
const natural = require('natural');
const stemmer = natural.PorterStemmer;

function getQueryStems(queryWords) {
    return new Set(queryWords.map(w => stemmer.stem(w)));
}

function scoreHits(hits, queryStems) {
    return hits.map(hit => {
        const fieldStems = new Set(
            (hit._source.atom_text || '').toLowerCase().split(/\s+/).map(w => stemmer.stem(w))
        );
        const matchedStems = [...queryStems].filter(stem => fieldStems.has(stem));
        const coverageRatio = queryStems.size ? matchedStems.length / queryStems.size : 0;
        return { ...hit, _customScore: coverageRatio };
    }).sort((a, b) => b._customScore - a._customScore);
}

async function runFullSearch({ query, queryWords, page, size, exactCUIs }) {
    const from = page * size;
    const queryStems = getQueryStems(queryWords);
    

    const result = await es.search({
        index: 'umls-cui',
        from,
        size: 1000, // or a large enough number to cover any single page of deduped results
        track_total_hits: true,
        _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions', 'atom_text'],
        query: {
            bool: {
                should: [
                    { match_phrase: { atom_text: { query, boost: 5 } } },
                    { match: { atom_text: { query, operator: "and", boost: 3 } } },
                    { match: { atom_text: { query, operator: "and", fuzziness: "AUTO", boost: 1 } } },
                    { match: { definitions: { query, operator: "and", boost: 2 } } }
                ],
                minimum_should_match: 1
            }
        }
    });

    const hits = result.hits.hits;

    // 🧹 Deduplicate against exact matches
    const filteredHits = hits.filter(hit => !exactCUIs.has(hit._source.CUI));


    return {
        scoredHits: scoreHits(filteredHits, queryStems),
        total: result.hits.total.value - exactCUIs.size // ✅ Adjust total to reflect what’s returned
    };
}



module.exports = runFullSearch;
