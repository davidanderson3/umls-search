const es = require('./client');
const { ES_INDEX } = require('../../elastic-config');

const RELATED_HIT_LIMIT = parseInt(process.env.RELATED_RESULT_LIMIT || '24', 10);
const RELATED_SOURCE_HIT_LIMIT = parseInt(process.env.RELATED_SOURCE_HIT_LIMIT || '2', 10);
const RELATED_STRONG_EXACT_SOURCE_LIMIT = parseInt(process.env.RELATED_STRONG_EXACT_SOURCE_LIMIT || '1', 10);
const RELATED_FALLBACK_SOURCE_LIMIT = parseInt(process.env.RELATED_FALLBACK_SOURCE_LIMIT || '2', 10);
const RELATED_EXACT_SOURCE_MULTIPLIER = parseFloat(process.env.RELATED_EXACT_SOURCE_MULTIPLIER || '1.35');

const STRONG_EXACT_MATCH_LABELS = new Set(['preferred_name', 'CUI']);
const HIGH_SIGNAL_SEMANTIC_TYPES = new Set([
    'Disease or Syndrome',
    'Pathologic Function',
    'Neoplastic Process',
    'Finding',
    'Sign or Symptom',
    'Anatomical Abnormality',
    'Body Part, Organ, or Organ Component',
    'Body System',
    'Tissue'
]);

function getExactLabelRank(hit) {
    const labels = Array.isArray(hit._exactMatchLabels) ? hit._exactMatchLabels : [];
    if (labels.includes('preferred_name')) return 0;
    if (labels.includes('CUI')) return 1;
    if (labels.includes('codes.strings')) return 2;
    if (labels.includes('codes.CODE')) return 3;
    return 4;
}

function countHighSignalSemanticTypes(hit) {
    const semanticTypes = Array.isArray(hit._source?.STY) ? hit._source.STY : [];
    return semanticTypes.filter(sty => HIGH_SIGNAL_SEMANTIC_TYPES.has(sty)).length;
}

function rankSourceHits(hits) {
    return [...hits].sort((a, b) => {
        const labelRankDiff = getExactLabelRank(a) - getExactLabelRank(b);
        if (labelRankDiff !== 0) return labelRankDiff;

        const semanticSignalDiff = countHighSignalSemanticTypes(b) - countHighSignalSemanticTypes(a);
        if (semanticSignalDiff !== 0) return semanticSignalDiff;

        const relatedCountDiff =
            (Array.isArray(b._source?.related_concepts) ? b._source.related_concepts.length : 0) -
            (Array.isArray(a._source?.related_concepts) ? a._source.related_concepts.length : 0);
        if (relatedCountDiff !== 0) return relatedCountDiff;

        const scoreDiff = (b._customScore || 0) - (a._customScore || 0);
        if (scoreDiff !== 0) return scoreDiff;

        return (a._source?.CUI || '').localeCompare(b._source?.CUI || '');
    });
}

function selectSourceHits(baseHits) {
    const validBaseHits = baseHits.filter(hit =>
        hit &&
        hit._source &&
        typeof hit._source.CUI === 'string' &&
        typeof hit._source.preferred_name === 'string'
    );
    const exactHits = rankSourceHits(validBaseHits.filter(hit => hit.matchType === 'exact'));
    const lexicalHits = rankSourceHits(
        validBaseHits.filter(hit => hit.matchType === 'full-text' || hit.matchType === 'fuzzy')
    );
    const strongExactHits = exactHits.filter(hit => {
        const labels = Array.isArray(hit._exactMatchLabels) ? hit._exactMatchLabels : [];
        return labels.some(label => STRONG_EXACT_MATCH_LABELS.has(label));
    });

    if (strongExactHits.length) {
        return [
            strongExactHits.slice(0, RELATED_STRONG_EXACT_SOURCE_LIMIT),
            exactHits.filter(hit => !strongExactHits.includes(hit)).slice(0, 1),
            lexicalHits.slice(0, 1)
        ].filter(group => group.length > 0);
    }

    if (exactHits.length) {
        return [
            exactHits.slice(0, 1),
            lexicalHits.slice(0, 1)
        ].filter(group => group.length > 0);
    }

    return [lexicalHits.slice(0, RELATED_FALLBACK_SOURCE_LIMIT)];
}

function addCandidatesFromSourceHits(sourceHits, candidateMap, excludedCUIs) {
    for (const hit of sourceHits) {
        const sourceCui = hit._source?.CUI || null;
        const sourceMatchType = hit.matchType || null;
        const related = Array.isArray(hit._source?.related_concepts) ? hit._source.related_concepts : [];

        for (const item of related) {
            const targetCui = item?.CUI || null;
            if (!targetCui || excludedCUIs.has(targetCui)) continue;

            const baseRelationScore = Number(item.score || 0);
            const relationScore = sourceMatchType === 'exact'
                ? Number((baseRelationScore * RELATED_EXACT_SOURCE_MULTIPLIER).toFixed(3))
                : baseRelationScore;
            const scaledTailScore = -1 + Math.min(relationScore / 100, 0.009);
            const existing = candidateMap.get(targetCui);

            if (!existing || relationScore > existing.relationScore) {
                candidateMap.set(targetCui, {
                    targetCui,
                    baseRelationScore,
                    relationScore,
                    scaledTailScore,
                    relatedTo: sourceCui,
                    relatedToMatchType: sourceMatchType,
                    relations: Array.isArray(item.relations) ? item.relations : [],
                    vocabulary_count: item.vocabulary_count || 0,
                    evidence_count: item.evidence_count || 0
                });
            }
        }
    }
}

function buildCandidateMap(baseHits, excludedCUIs) {
    const candidateMap = new Map();
    const sourceHitGroups = selectSourceHits(baseHits);

    for (const sourceHits of sourceHitGroups) {
        addCandidatesFromSourceHits(sourceHits.slice(0, RELATED_SOURCE_HIT_LIMIT), candidateMap, excludedCUIs);
        if (candidateMap.size > 0) {
            break;
        }
    }

    return candidateMap;
}

function sortCandidates(candidateMap) {
    return Array.from(candidateMap.values())
        .sort((a, b) => {
            if (b.relationScore !== a.relationScore) return b.relationScore - a.relationScore;
            if (b.vocabulary_count !== a.vocabulary_count) return b.vocabulary_count - a.vocabulary_count;
            if (b.evidence_count !== a.evidence_count) return b.evidence_count - a.evidence_count;
            return a.targetCui.localeCompare(b.targetCui);
        })
        .slice(0, RELATED_HIT_LIMIT);
}

async function getRelatedMatches(baseHits, excludedCUIs) {
    const candidateMap = buildCandidateMap(baseHits, excludedCUIs);
    const candidates = sortCandidates(candidateMap);

    if (!candidates.length) {
        return [];
    }

    const relationMetaByCui = new Map(candidates.map(candidate => [candidate.targetCui, candidate]));
    const result = await es.search({
        index: ES_INDEX,
        size: candidates.length,
        _source: ['preferred_name', 'CUI', 'STY', 'codes', 'definitions', 'related_concepts'],
        query: {
            terms: {
                CUI: candidates.map(candidate => candidate.targetCui)
            }
        }
    });

    return result.hits.hits
        .map(hit => {
            const cui = hit._source?.CUI || null;
            const relationMeta = relationMetaByCui.get(cui);
            if (!cui || !relationMeta) return null;
            return {
                ...hit,
                matchType: 'related',
                _customScore: relationMeta.scaledTailScore,
                _relationScore: relationMeta.relationScore,
                _baseRelationScore: relationMeta.baseRelationScore,
                _relatedTo: relationMeta.relatedTo,
                _relatedBy: relationMeta.relations,
                _relatedToMatchType: relationMeta.relatedToMatchType
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (b._relationScore !== a._relationScore) return b._relationScore - a._relationScore;
            return (a._source?.CUI || '').localeCompare(b._source?.CUI || '');
        });
}

module.exports = getRelatedMatches;
