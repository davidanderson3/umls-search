const es = require('./client');

async function getExactMatches(query) {
    const lcQuery = query.toLowerCase(); // Normalize input query
    const exactMatchDocs = [];

    const exactTypes = [
        {
            label: 'preferred_name',
            query: {
                term: {
                    "preferred_name.lowercase_keyword": lcQuery
                }
            }
        },
        {
            label: 'CUI',
            query: {
                term: {
                    "CUI.lowercase_keyword": lcQuery
                }
            }
        },
        {
            label: 'codes.strings',
            query: {
                nested: {
                    path: "codes",
                    query: {
                        term: {
                            "codes.strings.lowercase_keyword": lcQuery
                        }
                    }
                }
            }
        },
        {
            label: 'codes.CODE',
            query: {
                nested: {
                    path: "codes",
                    query: {
                        term: {
                            "codes.CODE.lowercase_keyword": lcQuery
                        }
                    }
                }
            }
        }
    ];

    for (const { label, query } of exactTypes) {
        const result = await es.search({
            index: 'umls-cui',
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes'],
            query
        });

        const newHits = result.hits.hits.filter(
            hit => !exactMatchDocs.find(doc => doc._id === hit._id)
        );

        if (newHits.length) {
            exactMatchDocs.push(...newHits);
        }
    }

    return exactMatchDocs;
}

module.exports = getExactMatches;
