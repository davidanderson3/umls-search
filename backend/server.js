const express = require('express');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');
const natural = require('natural');
const stemmer = natural.PorterStemmer;

const app = express();
const port = 3000;

// ✅ Elasticsearch client
const es = new Client({ node: 'http://127.0.0.1:9200' });

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/api/search', async (req, res) => {
    function buildLengthAwareFuzzyMatchClauses(field, words) {
        return words.map(word => {
            const clause = {
                match: {
                    [field]: {
                        query: word,
                        operator: "and",
                        boost: 1
                    }
                }
            };
            if (word.length > 6) {
                clause.match[field].fuzziness = "AUTO";
                clause.match[field].boost = 2;
            }
            return clause;
        });
    }

    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) return res.status(400).json({ error: 'Missing query parameter ?q=' });

    const query = rawQuery.replace(/%/g, ' percent');
    const lcQuery = query.toLowerCase();
    const queryWords = lcQuery.split(/\s+/);
    const rawPage = parseInt(req.query.page);
    const page = isNaN(rawPage) ? 0 : Math.max(rawPage - 1, 0);
    const size = parseInt(req.query.size) || 100;
    const from = page * size;
    const fuzzyMatchClauses = [
        ...buildLengthAwareFuzzyMatchClauses("preferred_name", queryWords),
        ...buildLengthAwareFuzzyMatchClauses("codes.strings", queryWords)
    ];

    console.log(`BACKEND REQUEST: q="${rawQuery}" (normalized: "${query}") page=${page} size=${size} from=${from}`);

    try {
        let exactMatchDocs = [];

        // ✅ Exact matches (only used on page 0)
        const exactTypes = [
            {
                label: 'preferred_name',
                query: { term: { "preferred_name.lowercase_keyword": lcQuery } }
            },
            {
                label: 'CUI',
                query: { term: { "CUI.lowercase_keyword": lcQuery } }
            },
            {
                label: 'codes.CODE',
                query: {
                    nested: {
                        path: "codes",
                        query: { term: { "codes.CODE.lowercase_keyword": lcQuery } }
                    }
                }
            },
            {
                label: 'codes.strings',
                query: {
                    nested: {
                        path: "codes",
                        query: { term: { "codes.strings.lowercase_keyword": lcQuery } }
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
            const newHits = result.hits.hits.filter(hit =>
                !exactMatchDocs.find(doc => doc._id === hit._id)
            );
            if (newHits.length) {
                exactMatchDocs.push(...newHits);
                console.log(`✅ Found ${newHits.length} exact ${label} match(es)`);
            }
        }

        const fuzzyClauses = [
            { match_phrase: { "preferred_name": { query, boost: 10 } } },
            ...buildLengthAwareFuzzyMatchClauses("preferred_name", queryWords),
            ...buildLengthAwareFuzzyMatchClauses("codes.strings", queryWords),
            {
                match: {
                    "definitions": {
                        query,
                        operator: "and",
                        boost: 2
                    }
                }
            }
        ];

        let finalHits, totalHits;

        if (page === 0) {
            const fetchSize = size * 2; // over-fetch to ensure enough after filtering

            const fullResult = await es.search({
                index: 'umls-cui',
                from: 0,
                size: fetchSize,
                track_total_hits: true,
                _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions'],

                query: {
                    bool: {
                        should: [
                            {
                                bool: {
                                    must: [
                                        { match_phrase: { "preferred_name": { query, boost: 10 } } }
                                    ]
                                }
                            },
                            {
                                bool: {
                                    must: [
                                        { match: { "preferred_name": { query, operator: "and", boost: 5 } } }
                                    ]
                                }
                            },
                            {
                                nested: {
                                    path: "codes",
                                    score_mode: "max",
                                    query: {
                                        bool: {
                                            should: [
                                                {
                                                    bool: {
                                                        must: [
                                                            { match_phrase: { "codes.strings": { query, boost: 10 } } }
                                                        ]
                                                    }
                                                },
                                                {
                                                    bool: {
                                                        must: [
                                                            { match: { "codes.strings": { query, operator: "and", boost: 5 } } }
                                                        ]
                                                    }
                                                }
                                            ]
                                        }
                                    }
                                }
                            },
                            {
                                bool: {
                                    must: [
                                        { match: { definitions: { query, operator: "and", boost: 2 } } }
                                    ]
                                }
                            },
                            {
                                bool: {
                                    should: [
                                        {
                                            match: {
                                                "preferred_name": {
                                                    query,
                                                    operator: "and",
                                                    fuzziness: "AUTO",
                                                    boost: 1
                                                }
                                            }
                                        },
                                        {
                                            nested: {
                                                path: "codes",
                                                score_mode: "max",
                                                query: {
                                                    match: {
                                                        "codes.strings": {
                                                            query,
                                                            operator: "and",
                                                            fuzziness: "AUTO",
                                                            boost: 1
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    ],
                                    minimum_should_match: 1
                                }
                            }

                        ]

                    }
                }
            });

            const exactIds = new Set(exactMatchDocs.map(doc => doc._id));
            const dedupedHits = fullResult.hits.hits.filter(hit => !exactIds.has(hit._id));
            const scoredHits = dedupedHits.map(hit => {
                const src = hit._source;
                const strings = [
                    src.preferred_name || '',
                    ...(src.codes || []).flatMap(c => c.strings || [])
                ];

                const queryStems = new Set(queryWords.map(w => stemmer.stem(w)));

                let uniqueMatchingStrings = new Set();
                let matchedStems = new Set();

                for (const str of strings) {
                    const fieldStems = new Set(str.toLowerCase().split(/\s+/).map(w => stemmer.stem(w)));
                    const intersecting = [...queryStems].filter(qs => fieldStems.has(qs));

                    if (intersecting.length > 0) {
                        uniqueMatchingStrings.add(str);
                        intersecting.forEach(stem => matchedStems.add(stem));
                    }
                }

                const frequencyScore = uniqueMatchingStrings.size;
                const coverageRatio = queryStems.size ? matchedStems.size / queryStems.size : 0;
                const combinedScore = frequencyScore + (coverageRatio * 0.3);

                return { ...hit, _customScore: combinedScore };
            });




            const remainingSize = size - exactMatchDocs.length;
            finalHits = [...exactMatchDocs.slice(0, size), ...scoredHits.slice(0, remainingSize)];
            const overlapCount = fullResult.hits.hits.filter(hit => exactIds.has(hit._id)).length;
            totalHits = fullResult.hits.total.value + exactMatchDocs.length - overlapCount;

        }
        else {
            const fullResult = await es.search({
                index: 'umls-cui',
                from,
                size,
                track_total_hits: true,
                _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions'],
                query: {
                    bool: {
                        should: [
                            { match_phrase: { "preferred_name": { query, boost: 10 } } },
                            { match: { "preferred_name": { query, operator: "and", boost: 5 } } },
                            {
                                nested: {
                                    path: "codes",
                                    score_mode: "max",
                                    query: {
                                        bool: {
                                            should: [
                                                { match_phrase: { "codes.strings": { query, boost: 10 } } },
                                                { match: { "codes.strings": { query, operator: "and", boost: 5 } } }
                                            ],
                                            minimum_should_match: 1
                                        }
                                    }
                                }
                            },
                            {
                                match: {
                                    definitions: { query, operator: "and", boost: 2 }
                                }
                            }
                        ],
                        minimum_should_match: 1
                    }
                }

            });

            const scoredHits = fullResult.hits.hits.map(hit => {
                const src = hit._source;
                const strings = [
                    src.preferred_name || '',
                    ...(src.codes || []).flatMap(c => c.strings || [])
                ];

                const queryStems = new Set(queryWords.map(w => stemmer.stem(w)));

                let uniqueMatchingStrings = new Set();
                let matchedStems = new Set();

                for (const str of strings) {
                    const fieldStems = new Set(str.toLowerCase().split(/\s+/).map(w => stemmer.stem(w)));
                    const intersecting = [...queryStems].filter(qs => fieldStems.has(qs));

                    if (intersecting.length > 0) {
                        uniqueMatchingStrings.add(str);
                        intersecting.forEach(stem => matchedStems.add(stem));
                    }
                }

                const frequencyScore = uniqueMatchingStrings.size;
                const coverageRatio = queryStems.size ? matchedStems.size / queryStems.size : 0;
                const combinedScore = frequencyScore + (coverageRatio * 0.3);

                return { ...hit, _customScore: combinedScore };
            });



            finalHits = scoredHits;

            totalHits = fullResult.hits.total.value;
        }

        console.log(`Final result count: ${finalHits.length}`);
        res.json({
            total: totalHits,
            results: finalHits
        });

    } catch (err) {
        console.error("BACKEND ERROR:", err);
        res.status(500).json({
            error: 'Elasticsearch error',
            details: err.meta?.body?.error || err.message
        });
    }
});


app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:3000`);
});
