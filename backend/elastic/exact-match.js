const es = require('./client');
const { ES_INDEX } = require('../../elastic-config');

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
            index: ES_INDEX,
            size: 100,
            _source: ['preferred_name', 'CUI', 'STY', 'codes', 'related_concepts'],
            query
        });

        for (const hit of result.hits.hits) {
            const existingDoc = exactMatchDocs.find(doc => doc._id === hit._id);
            if (existingDoc) {
                existingDoc._exactMatchLabels = Array.from(new Set([
                    ...(existingDoc._exactMatchLabels || []),
                    label
                ]));
                continue;
            }

            hit._exactMatchLabels = [label];
            exactMatchDocs.push(hit);
        }
    }

    return exactMatchDocs;
}

module.exports = getExactMatches;
