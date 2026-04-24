const MAX_RELATED_CONCEPTS = parseInt(process.env.RELATED_CONCEPTS_LIMIT || '12', 10);
const MIN_RELATED_SCORE = parseFloat(process.env.RELATED_CONCEPTS_MIN_SCORE || '0.8');

const EXCLUDED_REL = new Set(['SY']);
const EXCLUDED_RELA = new Set([
  'entry_version_of',
  'expanded_form_of',
  'has_entry_version',
  'has_expanded_form',
  'has_permuted_term',
  'has_translation',
  'permuted_term_of',
  'same_as',
  'translation_of'
]);

const REL_WEIGHTS = new Map([
  ['AQ', 0.3],
  ['CHD', 0.7],
  ['PAR', 0.7],
  ['QB', 0.3],
  ['RB', 0.7],
  ['RN', 0.7],
  ['RO', 0.9],
  ['RQ', 0.8],
  ['SIB', 0.65],
  ['XR', 0.5]
]);

const RELA_WEIGHTS = new Map([
  ['associated_with', 1.0],
  ['caused_by', 1.0],
  ['causative_agent_of', 1.05],
  ['classified_as', 0.55],
  ['component_of', 0.95],
  ['contraindicated_with_disease', 1.05],
  ['dose_form_of', 0.9],
  ['finding_site_of', 1.05],
  ['has_active_ingredient', 1.0],
  ['has_component', 0.95],
  ['has_contraindicated_drug', 1.05],
  ['has_dose_form', 0.9],
  ['has_finding_site', 1.05],
  ['has_induced_finding', 1.0],
  ['has_ingredient', 1.0],
  ['has_manifestation', 1.0],
  ['has_measured_component', 0.95],
  ['has_method', 0.85],
  ['has_physiologic_effect', 0.95],
  ['has_procedure_site', 0.95],
  ['has_tradename', 0.9],
  ['induced_by', 1.0],
  ['ingredient_of', 1.0],
  ['inverse_isa', 0.75],
  ['isa', 0.75],
  ['mapped_to', 0.5],
  ['may_be_treated_by', 1.05],
  ['may_prevent', 1.0],
  ['may_treat', 1.05],
  ['measured_component_of', 0.95],
  ['measures', 0.95],
  ['method_of', 0.85],
  ['occurs_in', 0.95],
  ['part_of', 0.8],
  ['physiologic_effect_of', 0.95],
  ['procedure_site_of', 0.95],
  ['site_of', 1.0],
  ['tradename_of', 0.9]
]);

const SAB_TRUST_WEIGHTS = new Map([
  ['SNOMEDCT_US', 1.0],
  ['RXNORM', 1.0],
  ['MED-RT', 1.08],
  ['LNC', 0.97],
  ['MSH', 0.95],
  ['NCI', 0.94],
  ['GO', 0.93],
  ['HPO', 0.92],
  ['HGNC', 0.9],
  ['MDR', 0.88],
  ['ICD10CM', 0.86],
  ['ICD10PCS', 0.84],
  ['ICD9CM', 0.72],
  ['CPT', 0.82],
  ['HCPCS', 0.78],
  ['SNMI', 0.75],
  ['MEDCIN', 0.7],
  ['MTH', 0.45]
]);

const FAMILY_SCORE_BONUSES = new Map([
  // MED-RT tends to encode high-signal therapeutic relationships.
  ['MED-RT', 0.25]
]);

const SAB_PREFIX_TRUST_WEIGHTS = [
  { prefix: 'SNOMEDCT_', weight: 0.95 },
  { prefix: 'SCT', weight: 0.72 },
  { prefix: 'MSH', weight: 0.55 },
  { prefix: 'ICD10', weight: 0.84 },
  { prefix: 'ICD9', weight: 0.72 },
  { prefix: 'MTH', weight: 0.45 }
];

const STYPE_WEIGHTS = new Map([
  ['AUI', 0.78],
  ['CODE', 0.82],
  ['CUI', 1.0],
  ['SCUI', 0.92],
  ['SDUI', 0.88]
]);

const SOURCE_FAMILIES = [
  { test: sab => sab === 'RXNORM', family: 'RXNORM' },
  { test: sab => sab === 'MED-RT', family: 'MED-RT' },
  { test: sab => sab === 'LNC', family: 'LNC' },
  { test: sab => sab === 'NCI', family: 'NCI' },
  { test: sab => sab === 'HPO', family: 'HPO' },
  { test: sab => sab === 'GO', family: 'GO' },
  { test: sab => sab === 'HGNC', family: 'HGNC' },
  { test: sab => sab === 'MDR', family: 'MDR' },
  { test: sab => sab === 'MEDCIN', family: 'MEDCIN' },
  { test: sab => sab === 'SNMI', family: 'SNMI' },
  { test: sab => sab === 'CPT', family: 'CPT' },
  { test: sab => sab === 'HCPCS', family: 'HCPCS' },
  { test: sab => sab.startsWith('SNOMEDCT_') || sab.startsWith('SCT'), family: 'SNOMEDCT' },
  { test: sab => sab.startsWith('MSH'), family: 'MSH' },
  { test: sab => sab.startsWith('ICD10'), family: 'ICD10' },
  { test: sab => sab.startsWith('ICD9'), family: 'ICD9' },
  { test: sab => sab.startsWith('MTH'), family: 'MTH' }
];

function resolveSabTrustWeight(sab) {
  if (!sab) return 0.6;
  if (SAB_TRUST_WEIGHTS.has(sab)) return SAB_TRUST_WEIGHTS.get(sab);
  const prefixMatch = SAB_PREFIX_TRUST_WEIGHTS.find(entry => sab.startsWith(entry.prefix));
  return prefixMatch ? prefixMatch.weight : 0.6;
}

function resolveStypeWeight(stype) {
  return STYPE_WEIGHTS.get(stype) || 0.75;
}

function resolveSabFamily(sab) {
  if (!sab) return 'UNKNOWN';
  const match = SOURCE_FAMILIES.find(entry => entry.test(sab));
  return match ? match.family : sab;
}

function resolveRelationWeight(rel, rela) {
  const normalizedRela = (rela || '').trim().toLowerCase();
  if (normalizedRela && EXCLUDED_RELA.has(normalizedRela)) return 0;
  if (EXCLUDED_REL.has(rel)) return 0;
  if (normalizedRela && RELA_WEIGHTS.has(normalizedRela)) {
    return RELA_WEIGHTS.get(normalizedRela);
  }
  if (normalizedRela) {
    if (/(translation|permuted|entry_version|same_as|synonym)/.test(normalizedRela)) return 0;
    if (/(treat|prevent|contraindicat|ingredient|component|site|manifestation|caus|measure|method|occurs_in|associated)/.test(normalizedRela)) {
      return 0.95;
    }
    if (/(isa|part_of|mapped_to|classified_as)/.test(normalizedRela)) {
      return 0.7;
    }
  }
  return REL_WEIGHTS.get(rel) || 0.45;
}

function getRelationLabel(rel, rela) {
  return (rela || '').trim() || rel || 'related_to';
}

function getRelationClass(rel, rela) {
  const normalizedRela = (rela || '').trim().toLowerCase();
  if (normalizedRela) {
    if (/(may_treat|may_be_treated_by|may_prevent|contraindicat|induced_by|caused_by|causative_agent_of)/.test(normalizedRela)) {
      return 'therapeutic';
    }
    if (/(ingredient|tradename|dose_form)/.test(normalizedRela)) {
      return 'drug';
    }
    if (/(component|measure|method|site|manifestation|occurs_in|physiologic_effect|associated_with)/.test(normalizedRela)) {
      return 'associative';
    }
    if (/(isa|inverse_isa|part_of|classified_as)/.test(normalizedRela)) {
      return 'hierarchical';
    }
    if (/mapped_to/.test(normalizedRela)) {
      return 'mapping';
    }
  }

  if (['PAR', 'CHD', 'RB', 'RN'].includes(rel)) return 'hierarchical';
  if (rel === 'RO' || rel === 'RQ' || rel === 'SIB') return 'associative';
  if (rel === 'AQ' || rel === 'QB' || rel === 'XR') return 'mapping';
  return 'other';
}

function createEdgeAccumulator(targetCui) {
  return {
    targetCui,
    evidenceCount: 0,
    relationClasses: new Set(),
    relations: new Set(),
    familyStats: new Map(),
    sabStats: new Map()
  };
}

function createSabAccumulator(weight) {
  return {
    rowCount: 0,
    maxWeight: weight
  };
}

function createFamilyAccumulator(weight) {
  return {
    rowCount: 0,
    maxWeight: weight,
    sabs: new Set()
  };
}

function scoreEdge(edge, hasReciprocalAssertion = false) {
  let score = 0;

  for (const familyStat of edge.familyStats.values()) {
    const withinFamilyRowBonus = Math.min(0.08 * Math.max(familyStat.rowCount - 1, 0), 0.2);
    const withinFamilySabBonus = Math.min(0.06 * Math.max(familyStat.sabs.size - 1, 0), 0.12);
    score += familyStat.maxWeight + withinFamilyRowBonus + withinFamilySabBonus;
  }

  for (const [family, bonus] of FAMILY_SCORE_BONUSES.entries()) {
    if (edge.familyStats.has(family)) {
      score += bonus;
    }
  }

  const familyCount = edge.familyStats.size;
  const vocabularyCount = edge.sabStats.size;
  if (familyCount > 1) {
    score += 0.45 * (familyCount - 1);
  }

  if (vocabularyCount > familyCount) {
    score += Math.min(0.2, 0.05 * (vocabularyCount - familyCount));
  }

  if (edge.relations.size > 1) {
    score += Math.min(0.2, 0.04 * (edge.relations.size - 1));
  }

  if (hasReciprocalAssertion) {
    score += 0.15;
  }

  const relationClasses = edge.relationClasses;
  if (relationClasses.size === 1) {
    if (relationClasses.has('hierarchical')) {
      score *= familyCount > 1 ? 0.88 : 0.72;
    } else if (relationClasses.has('mapping')) {
      score *= familyCount > 1 ? 0.8 : 0.6;
    } else if (relationClasses.has('therapeutic')) {
      score *= 1.08;
    }
  } else {
    if (relationClasses.has('hierarchical') && relationClasses.has('associative')) {
      score += 0.08;
    }
    if (relationClasses.has('drug') && relationClasses.has('therapeutic')) {
      score += 0.08;
    }
  }

  return Number(score.toFixed(3));
}

function finalizeEdge(targetCui, edge, preferredNameMap, hasReciprocalAssertion = false) {
  const score = scoreEdge(edge, hasReciprocalAssertion);
  if (score < MIN_RELATED_SCORE) return null;

  const vocabularies = Array.from(edge.sabStats.keys()).sort();
  const relations = Array.from(edge.relations).sort();

  return {
    CUI: targetCui,
    preferred_name: preferredNameMap.get(targetCui) || null,
    score,
    evidence_count: edge.evidenceCount,
    vocabulary_count: vocabularies.length,
    vocabularies,
    relations
  };
}

function buildRelatedConceptsForSource(sourceCui, relationRows, preferredNameMap) {
  if (!sourceCui || !Array.isArray(relationRows) || relationRows.length === 0) {
    return [];
  }

  const targets = new Map();

  for (const row of relationRows) {
    const {
      targetCui,
      stype1,
      stype2,
      rel,
      rela,
      sab
    } = row;

    const relationWeight = resolveRelationWeight(rel, rela);
    if (relationWeight <= 0) continue;

    const sabTrustWeight = resolveSabTrustWeight(sab);
    const stypeWeight = resolveStypeWeight(stype1) * resolveStypeWeight(stype2);
    const rowWeight = Number((relationWeight * sabTrustWeight * stypeWeight).toFixed(4));
    if (rowWeight <= 0) continue;

    let edge = targets.get(targetCui);
    if (!edge) {
      edge = createEdgeAccumulator(targetCui);
      edge.sourceCui = sourceCui;
      targets.set(targetCui, edge);
    }

    edge.evidenceCount += 1;
    edge.relationClasses.add(getRelationClass(rel, rela));
    edge.relations.add(getRelationLabel(rel, rela));

    const sabKey = sab || 'UNKNOWN';
    let sabStat = edge.sabStats.get(sabKey);
    if (!sabStat) {
      sabStat = createSabAccumulator(rowWeight);
      edge.sabStats.set(sabKey, sabStat);
    }
    sabStat.rowCount += 1;
    if (rowWeight > sabStat.maxWeight) {
      sabStat.maxWeight = rowWeight;
    }

    const familyKey = resolveSabFamily(sabKey);
    let familyStat = edge.familyStats.get(familyKey);
    if (!familyStat) {
      familyStat = createFamilyAccumulator(rowWeight);
      edge.familyStats.set(familyKey, familyStat);
    }
    familyStat.rowCount += 1;
    familyStat.sabs.add(sabKey);
    if (rowWeight > familyStat.maxWeight) {
      familyStat.maxWeight = rowWeight;
    }
  }

  const related = [];
  for (const [targetCui, edge] of targets.entries()) {
    const finalizedEdge = finalizeEdge(targetCui, edge, preferredNameMap);
    if (finalizedEdge) {
      related.push(finalizedEdge);
    }
  }

  related.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.vocabulary_count !== a.vocabulary_count) return b.vocabulary_count - a.vocabulary_count;
    if (b.evidence_count !== a.evidence_count) return b.evidence_count - a.evidence_count;
    return a.CUI.localeCompare(b.CUI);
  });

  return related.slice(0, MAX_RELATED_CONCEPTS);
}

module.exports = {
  buildRelatedConceptsForSource,
  resolveRelationWeight,
  resolveSabTrustWeight
};
