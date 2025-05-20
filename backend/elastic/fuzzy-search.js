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

async function runFuzzySearch({ query, queryWords, page, size, exactIds }) {
    const from = page * size;
    const queryStems = getQueryStems(queryWords);

    const fullResult = await es.search({
        index: 'umls-cui',
        from,
        size: size * 2,
        track_total_hits: true,
        _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions', 'atom_text'],
        query: {
            bool: {
                should: [
                    { match_phrase: { preferred_name: { query, boost: 10 } } },
                    { match: { preferred_name: { query, operator: "and", boost: 5 } } },
                    { match_phrase: { atom_text: { query, boost: 5 } } },
                    { match: { atom_text: { query, operator: "and", boost: 3 } } },
                    { match: { atom_text: { query, operator: "and", fuzziness: "1", boost: 1 } } },
                    { match: { definitions: { query, operator: "and", boost: 2 } } }
                ],
                minimum_should_match: 1
            }
        }
    });

    const dedupedHits = fullResult.hits.hits.filter(
        hit => !exactIds.has(hit._id)
    );

    return {
        scoredHits: scoreHits(dedupedHits, queryStems),
        total: fullResult.hits.total.value
    };
}

module.exports = runFuzzySearch;
