#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const es = require('../backend/elastic/client');
const { ES_INDEX } = require('../elastic-config');

const STOPWORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost',
  'along', 'also', 'although', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'done', 'during', 'each', 'either',
  'enough', 'especially', 'for', 'from', 'further', 'had', 'has', 'have',
  'having', 'here', 'how', 'however', 'if', 'in', 'into', 'is', 'it', 'its',
  'itself', 'just', 'may', 'might', 'more', 'most', 'much', 'must', 'near',
  'no', 'nor', 'not', 'of', 'often', 'on', 'once', 'only', 'or', 'other',
  'our', 'out', 'over', 'per', 'same', 'should', 'since', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'toward', 'under', 'until', 'up', 'upon',
  'very', 'via', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whose', 'why', 'will', 'with', 'within', 'without', 'would'
]);

const FOREIGN_STOPWORDS = new Set([
  'como', 'para', 'por', 'los', 'las', 'una', 'unas', 'unos', 'del', 'desde',
  'con', 'com', 'sin', 'sobre', 'entre', 'dans', 'avec',
  'contra', 'afectan', 'desarrollo', 'realizado', 'posibles', 'defectos',
  'fetales', 'utilizado', 'organismos', 'negativos', 'encontrado', 'emprega',
  'abordagem', 'coordenada', 'interdisciplinar', 'acalmar', 'sofrimento',
  'qualidade', 'quem', 'sente', 'dor', 'vida', 'saude', 'mulher', 'gravida',
  'estabelecida', 'materias', 'paises', 'cadeias', 'alfa', 'beta', 'globinas',
  'till', 'samt', 'och', 'eller', 'innefattar', 'sammanfogning', 'icke',
  'konsekutiva', 'acetat', 'genom', 'grader', 'junto', 'junto', 'forma',
  'forbedrer', 'effekten', 'kalsemiske', 'fosfataseaktivitet', 'alkalisk',
  'utilizada', 'estudos', 'fosfato', 'actividad', 'herbicida', 'efeitos',
  'irritantes', 'olho', 'bruk', 'lyd', 'fremkalle', 'nervesystemet',
  'cette', 'chevaux', 'mulets', 'anes'
]);

const BAD_LEADING_WORDS = new Set([
  'and', 'or', 'but', 'because', 'which', 'that', 'who', 'whose', 'where',
  'when', 'while', 'thereby', 'therefore', 'thus', 'therein', 'thereof',
  'derived', 'used', 'found', 'located', 'present', 'made', 'formed',
  'consisting', 'including', 'containing', 'causing', 'occurring', 'in',
  'on', 'at', 'by', 'for', 'from', 'to', 'catalyze', 'catalyzes', 'depletes',
  'deplete', 'inhibits', 'inhibit', 'activates', 'activate', 'stimulates',
  'stimulate'
]);

const BAD_ANYWHERE_TERMS = [
  'http://',
  'https://',
  'orcid.org',
  'dorland',
  'ed.',
  '28a ed',
  'et al',
  ' p'
];

const FINITE_VERBS = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'emits', 'emit',
  'include', 'includes', 'improves', 'improve', 'affects', 'affect',
  'stimulates', 'stimulate', 'activates', 'activate', 'established',
  'employs', 'employ', 'causes', 'cause', 'means', 'mean', 'can',
  'occurs', 'occur', 'appears', 'appear', 'reduces', 'reduce', 'forms',
  'form', 'produces', 'produce', 'binds', 'bind', 'transports', 'transport',
  'leads', 'lead', 'results', 'result', 'acts', 'act'
]);

const GOOD_HEAD_NOUNS = new Set([
  'abnormality', 'abnormalities', 'absence', 'acid', 'agent', 'agonist',
  'analog', 'analogue', 'anemia', 'antagonist', 'antibiotic', 'antibody',
  'carcinogen', 'chemical', 'compound', 'condition', 'deficiency', 'disease',
  'disorder', 'drug', 'enzyme', 'factor', 'growth', 'hallucinogen', 'hormone',
  'infection', 'inflammation', 'inhibitor', 'injury', 'lesion', 'mass',
  'mutation', 'peptide', 'poison', 'procedure', 'process', 'protein',
  'receptor', 'substance', 'surfactant', 'syndrome', 'therapy', 'toxin',
  'tumor', 'tumour'
]);

const RELIABLE_ENGLISH_CONNECTORS = new Set([
  'of', 'in', 'with', 'without', 'for', 'from', 'due', 'caused', 'associated',
  'related', 'resulting', 'during', 'after', 'before', 'under'
]);

const NON_CLINICAL_SEMANTIC_TYPES = new Set([
  'Geographic Area',
  'Intellectual Product',
  'Idea or Concept',
  'Conceptual Entity',
  'Temporal Concept',
  'Quantitative Concept',
  'Language',
  'Language Group',
  'Population Group',
  'Professional or Occupational Group',
  'Organization',
  'Professional Society',
  'Governmental or Regulatory Activity',
  'Educational Activity',
  'Occupational Activity',
  'Social Behavior',
  'Human-caused Phenomenon or Process',
  'Spatial Concept'
]);

const CLINICAL_SEMANTIC_TYPES = new Set([
  'Acquired Abnormality',
  'Amino Acid, Peptide, or Protein',
  'Anatomical Abnormality',
  'Antibiotic',
  'Biologically Active Substance',
  'Body Part, Organ, or Organ Component',
  'Body Substance',
  'Carbohydrate',
  'Cell or Molecular Dysfunction',
  'Chemical',
  'Chemical Viewed Functionally',
  'Chemical Viewed Structurally',
  'Clinical Attribute',
  'Clinical Drug',
  'Congenital Abnormality',
  'Diagnostic Procedure',
  'Disease or Syndrome',
  'Drug Delivery Device',
  'Element, Ion, or Isotope',
  'Enzyme',
  'Finding',
  'Functional Concept',
  'Gene or Genome',
  'Hazardous or Poisonous Substance',
  'Hormone',
  'Immunologic Factor',
  'Indicator, Reagent, or Diagnostic Aid',
  'Injury or Poisoning',
  'Inorganic Chemical',
  'Laboratory Procedure',
  'Laboratory or Test Result',
  'Lipid',
  'Manufactured Object',
  'Medical Device',
  'Mental or Behavioral Dysfunction',
  'Molecular Biology Research Technique',
  'Neoplastic Process',
  'Neuroreactive Substance or Biogenic Amine',
  'Nucleic Acid, Nucleoside, or Nucleotide',
  'Organic Chemical',
  'Organism Function',
  'Pathologic Function',
  'Pharmacologic Substance',
  'Physiologic Function',
  'Receptor',
  'Research Activity',
  'Sign or Symptom',
  'Steroid',
  'Therapeutic or Preventive Procedure',
  'Tissue',
  'Vitamin'
]);

const BAD_QUERY_PREFIXES = [
  'act or practice of',
  'addition of',
  'agent that',
  'agent used as',
  'alcohol used in',
  'balance between',
  'class of',
  'compounds of',
  'condition of',
  'consideration and concern',
  'constituent state of',
  'content of',
  'country in',
  'delivery of',
  'depending on',
  'group of',
  'muscular relaxation and',
  'one or more',
  'severity of',
  'simple amine found in',
  'success in',
  'typically resulting in',
  'type of'
  ,
  'use of',
  'usually associated with',
  'vocabulary or records related to',
  'yields hydrogen ions',
  'yields '
];

const BAD_QUERY_SUBSTRINGS = [
  'a href',
  'h3',
  'class=',
  'country in ',
  'capital is ',
  'challenge agents',
  'records related',
  'rice fields',
  'scholastic',
  'submission of information',
  'vocabulary or records',
  'peninsula',
  'continent',
  'united states of america'
];

const BAD_QUERY_REGEXES = [
  /\bresulting\b/i,
  /\bdue\b/i,
  /\bincluding\b/i,
  /\bingestion\b/i,
  /\binfiltration\b/i,
  /\btransient\b/i,
  /\bstimulating\b/i,
  /\bfor either\b/i,
  /\bwith severe\b/i,
  /\bhorses\b/i,
  /\bmules\b/i,
  /\bbirds\b/i,
  /\bmultiple\b/i,
  /\bepidermal\b/i,
  /\bcortical\b/i,
  /\bdeep\b/i,
  /\bcarbon\b$/i,
  /\blocal\b$/i,
  /\btransient\b$/i,
  /\bcortical\b$/i,
  /\bdeep\b$/i
];

const CLINICAL_START_TOKENS = new Set([
  'abnormal',
  'abnormally',
  'abortion',
  'absence',
  'blood',
  'acidosis',
  'acute',
  'accumulation',
  'bleeding',
  'chronic',
  'congenital',
  'deficiency',
  'disorder',
  'disease',
  'disturbance',
  'disturbances',
  'enlargement',
  'expulsion',
  'fetal',
  'growth',
  'hepatitis',
  'inability',
  'inflammation',
  'infection',
  'injury',
  'loss',
  'pain',
  'retention',
  'respiratory',
  'secretion',
  'skin',
  'swelling',
  'thickening',
  'tumor'
]);

const CLINICAL_QUERY_TERMS = new Set([
  'abdomen',
  'abdominal',
  'acid',
  'acids',
  'adrenal',
  'blood',
  'body',
  'breathing',
  'carbon',
  'cholesterol',
  'cortisol',
  'dioxide',
  'fetal',
  'fetus',
  'gastric',
  'gland',
  'glands',
  'hair',
  'hepatitis',
  'hormone',
  'hormones',
  'hydrochloric',
  'infection',
  'inflammation',
  'kidney',
  'kidneys',
  'lactic',
  'lipoprotein',
  'respiratory',
  'serum',
  'skin',
  'swelling',
  'symptoms',
  'thyroid',
  'urine',
  'uterus'
]);

const DEFAULTS = {
  batchSize: 250,
  maxExamples: 100,
  maxSearchRank: 50,
  output: path.join(process.cwd(), 'outputs', 'definition-helpful-queries.csv'),
  perDoc: 2,
  randomSeed: 42,
  sampleSize: 250,
  minGain: 10,
  requireTopWithDefinitions: 5
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  const aliases = new Map([
    ['--batch-size', 'batchSize'],
    ['--max-examples', 'maxExamples'],
    ['--max-search-rank', 'maxSearchRank'],
    ['--min-gain', 'minGain'],
    ['--output', 'output'],
    ['--per-doc', 'perDoc'],
    ['--random-seed', 'randomSeed'],
    ['--sample-size', 'sampleSize'],
    ['--top-with-definitions', 'requireTopWithDefinitions']
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }

    const key = aliases.get(raw);
    if (!key) {
      throw new Error(`Unknown argument: ${raw}`);
    }

    const value = argv[i + 1];
    if (value == null) {
      throw new Error(`Missing value for argument: ${raw}`);
    }

    i += 1;
    if (key === 'output') {
      args[key] = value;
      continue;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid numeric value for ${raw}: ${value}`);
    }
    args[key] = parsed;
  }

  return args;
}

function printHelp() {
  console.log(`Mine candidate queries where indexing UMLS definitions improves ranking.

Usage:
  node scripts/mine-definition-helpful-queries.js [options]

Options:
  --sample-size N            Number of indexed concepts with definitions to inspect (default: ${DEFAULTS.sampleSize})
  --per-doc N                Max mined phrases per concept before evaluation (default: ${DEFAULTS.perDoc})
  --random-seed N            Seed used when drawing a random concept sample (default: ${DEFAULTS.randomSeed})
  --max-search-rank N        Depth used when checking whether the target CUI is found (default: ${DEFAULTS.maxSearchRank})
  --top-with-definitions N   Keep only examples where the target ranks at or above N with definitions (default: ${DEFAULTS.requireTopWithDefinitions})
  --min-gain N               Minimum rank improvement required to keep an example (default: ${DEFAULTS.minGain})
  --max-examples N           Max rows to emit in the CSV (default: ${DEFAULTS.maxExamples})
  --batch-size N             Progress log frequency while mining candidates (default: ${DEFAULTS.batchSize})
  --output PATH              Output CSV path (default: ${DEFAULTS.output})
  --help                     Show this help
`);
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(text) {
  const matches = String(text || '').toLowerCase().match(/[a-z0-9]+/g);
  return matches || [];
}

function sentenceSplit(text) {
  return String(text || '')
    .replace(/~/g, ' ')
    .split(/(?<=[.;:])\s+|\n+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function clauseSplit(text) {
  return String(text || '')
    .split(/\s*[(),;]\s*/)
    .map(part => part.trim())
    .filter(Boolean);
}

function cleanWindow(words) {
  return words.join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .trim();
}

function stripDefinitionNoise(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, ' and ')
    .replace(/&quot;/gi, ' ')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;|&gt;/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(https?:\/\/|orcid\.org)[^)]*\)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeAdjacentTokens(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (const token of tokens) {
    if (out.length > 0 && out[out.length - 1] === token) {
      continue;
    }
    out.push(token);
  }
  return out.join(' ');
}

function dedupeRepeatedBigrams(tokens) {
  if (tokens.length < 4) {
    return tokens;
  }
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const prevA = out[out.length - 2];
    const prevB = out[out.length - 1];
    if (a && b && a === prevA && b === prevB) {
      i += 1;
      continue;
    }
    out.push(a);
  }
  return out.filter(Boolean);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function countSetOverlap(tokens, set) {
  return tokens.filter(token => set.has(token)).length;
}

function looksEnglishEnough(tokens) {
  const foreignHits = countSetOverlap(tokens, FOREIGN_STOPWORDS);
  if (foreignHits >= 1) {
    return false;
  }
  return true;
}

function definitionLooksEnglish(text) {
  if (/<[^>]+>/.test(String(text || ''))) {
    return false;
  }
  const cleaned = stripDefinitionNoise(text);
  const tokens = tokenize(cleaned);
  if (tokens.length < 4) {
    return false;
  }
  if (!looksEnglishEnough(tokens)) {
    return false;
  }
  return true;
}

function docLooksClinical(doc) {
  const semanticTypes = Array.isArray(doc.STY) ? doc.STY : [];
  if (semanticTypes.some(sty => NON_CLINICAL_SEMANTIC_TYPES.has(sty))) {
    return false;
  }
  if (semanticTypes.length > 0 && !semanticTypes.some(sty => CLINICAL_SEMANTIC_TYPES.has(sty))) {
    return false;
  }
  return true;
}

function looksLikeNaturalQuery(text) {
  const cleaned = stripDefinitionNoise(text)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .trim();
  if (!cleaned) {
    return null;
  }

  let query = cleaned
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/^(is|are|was|were)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  query = dedupeAdjacentTokens(query);
  let tokens = tokenize(query);
  tokens = dedupeRepeatedBigrams(tokens);
  query = tokens.join(' ').trim();

  if (tokens.length < 2 || tokens.length > 4) {
    return null;
  }
  if (query.length < 8 || query.length > 40) {
    return null;
  }
  if (/^\d/.test(query)) {
    return null;
  }
  if (BAD_LEADING_WORDS.has(tokens[0]) || STOPWORDS.has(tokens[0])) {
    return null;
  }
  if (STOPWORDS.has(tokens[tokens.length - 1])) {
    return null;
  }
  if (!looksEnglishEnough(tokens)) {
    return null;
  }
  const lowerQuery = query.toLowerCase();
  if (BAD_ANYWHERE_TERMS.some(term => lowerQuery.includes(term))) {
    return null;
  }
  if (BAD_QUERY_PREFIXES.some(prefix => lowerQuery.startsWith(prefix))) {
    return null;
  }
  if (BAD_QUERY_SUBSTRINGS.some(fragment => lowerQuery.includes(fragment))) {
    return null;
  }
  if (BAD_QUERY_REGEXES.some(pattern => pattern.test(query))) {
    return null;
  }
  if (/\bp\d{2,}\b/i.test(query)) {
    return null;
  }
  if (tokens.some(token => FINITE_VERBS.has(token))) {
    return null;
  }
  if (tokens.filter(token => STOPWORDS.has(token)).length > Math.ceil(tokens.length / 2)) {
    return null;
  }
  if (tokens.some(token => token.length > 24)) {
    return null;
  }
  if (tokens.filter(token => /^\d+$/.test(token)).length > 1) {
    return null;
  }
  if (new Set(tokens).size <= Math.ceil(tokens.length / 2)) {
    return null;
  }
  const hasReliableConnector = tokens.some(token => RELIABLE_ENGLISH_CONNECTORS.has(token));
  const lastToken = tokens[tokens.length - 1];
  const clinicalTermHits = tokens.filter(token => CLINICAL_QUERY_TERMS.has(token)).length;
  const prevToken = tokens[tokens.length - 2] || '';
  if (prevToken === 'of' && /(ic|al|ary|ous|ive)$/.test(lastToken)) {
    return null;
  }
  if (!GOOD_HEAD_NOUNS.has(lastToken) && !(hasReliableConnector && (clinicalTermHits >= 1 || CLINICAL_QUERY_TERMS.has(lastToken)))) {
    return null;
  }
  const firstToken = tokens[0];
  if (!CLINICAL_START_TOKENS.has(firstToken)) {
    return null;
  }

  return query;
}

function hasDefinitionMatch(matchedQueries) {
  return Array.isArray(matchedQueries)
    && matchedQueries.some(name => name === 'phrase_definitions' || name === 'and_definitions');
}

function buildShouldQueries(query, includeDefinitions) {
  const should = [
    {
      match_phrase: {
        'atom_text.no_synonyms': {
          _name: 'phrase_no_synonyms',
          query,
          boost: 6
        }
      }
    },
    {
      match: {
        'atom_text.no_synonyms': {
          _name: 'and_no_synonyms',
          query,
          operator: 'and',
          boost: 4
        }
      }
    },
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
          operator: 'and',
          boost: 2
        }
      }
    }
  ];

  if (includeDefinitions) {
    should.push(
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
            operator: 'and',
            boost: 1
          }
        }
      }
    );
  }

  return should;
}

async function runSearch(query, size, includeDefinitions) {
  const result = await es.search({
    index: ES_INDEX,
    size,
    track_total_hits: false,
    _source: ['CUI', 'preferred_name'],
    query: {
      bool: {
        should: buildShouldQueries(query, includeDefinitions),
        minimum_should_match: 1
      }
    }
  });

  return result.hits.hits.map((hit, index) => ({
    rank: index + 1,
    cui: hit._source?.CUI || null,
    preferredName: hit._source?.preferred_name || '',
    score: hit._score || 0,
    matchedQueries: Array.isArray(hit.matched_queries) ? hit.matched_queries : []
  }));
}

function extractCandidatesForDoc(doc, perDoc) {
  if (!docLooksClinical(doc)) {
    return [];
  }

  const atomTokens = new Set(tokenize(doc.atom_text));
  const preferredNameNorm = normalizeText(doc.preferred_name);
  const seen = new Set();
  const scored = [];

  for (const definition of Array.isArray(doc.definitions) ? doc.definitions : []) {
    if (!definitionLooksEnglish(definition)) {
      continue;
    }

    for (const sentence of sentenceSplit(definition)) {
      const cleanedSentence = stripDefinitionNoise(sentence);
      if (!cleanedSentence) {
        continue;
      }

      const segments = [
        cleanedSentence,
        ...clauseSplit(cleanedSentence)
      ];

      for (const segment of segments) {
        const words = segment.match(/[A-Za-z0-9'-]+/g) || [];
        if (words.length < 2) {
          continue;
        }

        for (let size = Math.min(4, words.length); size >= 2; size -= 1) {
          for (let start = 0; start <= words.length - size; start += 1) {
            const rawPhrase = cleanWindow(words.slice(start, start + size));
            const query = looksLikeNaturalQuery(rawPhrase);
            if (!query) {
              continue;
            }

            const phraseNorm = normalizeText(query).replace(/^(a|an|the)\s+/, '');
            if (!phraseNorm || seen.has(phraseNorm)) {
              continue;
            }
            if (phraseNorm === preferredNameNorm || preferredNameNorm.includes(phraseNorm)) {
              continue;
            }

            const tokens = tokenize(phraseNorm);
            const informativeTokens = tokens.filter(token => token.length >= 4 && !STOPWORDS.has(token));
            if (informativeTokens.length < 1) {
              continue;
            }

            const overlapCount = informativeTokens.filter(token => atomTokens.has(token)).length;
            const noveltyCount = informativeTokens.length - overlapCount;
            const overlapRatio = overlapCount / informativeTokens.length;
            if (noveltyCount < 1 || overlapRatio > 0.5) {
              continue;
            }

            const score = (noveltyCount * 6)
              + (tokens.length === 3 || tokens.length === 4 ? 5 : 0)
              + (CLINICAL_START_TOKENS.has(tokens[0]) ? 4 : 0)
              + (tokens.filter(token => CLINICAL_QUERY_TERMS.has(token)).length * 2)
              - (overlapCount * 5)
              - (segment !== cleanedSentence ? 1 : 0);

            seen.add(phraseNorm);
            scored.push({
              query: phraseNorm,
              sourceDefinition: definition,
              extractionScore: score
            });
          }
        }
      }
    }
  }

  scored.sort((a, b) => b.extractionScore - a.extractionScore || a.query.localeCompare(b.query));
  return scored.slice(0, perDoc);
}

async function fetchRandomDocsWithDefinitions(sampleSize, randomSeed) {
  const result = await es.search({
    index: ES_INDEX,
    size: sampleSize,
    track_total_hits: false,
    _source: ['CUI', 'preferred_name', 'atom_text', 'definitions', 'STY'],
    query: {
      function_score: {
        query: {
          exists: {
            field: 'definitions'
          }
        },
        random_score: {
          seed: randomSeed,
          field: '_seq_no'
        },
        boost_mode: 'replace'
      }
    }
  });

  return result.hits.hits.map(hit => hit._source);
}

function rankForTarget(hits, targetCui) {
  return hits.find(hit => hit.cui === targetCui) || null;
}

async function evaluateCandidate(candidate, options) {
  const [withDefinitions, withoutDefinitions] = await Promise.all([
    runSearch(candidate.query, options.maxSearchRank, true),
    runSearch(candidate.query, options.maxSearchRank, false)
  ]);

  const withHit = rankForTarget(withDefinitions, candidate.targetCui);
  const withoutHit = rankForTarget(withoutDefinitions, candidate.targetCui);
  if (!withHit || !hasDefinitionMatch(withHit.matchedQueries)) {
    return null;
  }

  const withoutRank = withoutHit ? withoutHit.rank : options.maxSearchRank + 1;
  const gain = withoutRank - withHit.rank;

  if (withHit.rank > options.requireTopWithDefinitions || gain < options.minGain) {
    return null;
  }

  return {
    query: candidate.query,
    targetCui: candidate.targetCui,
    targetName: candidate.targetName,
    withDefinitionsRank: withHit.rank,
    withoutDefinitionsRank: withoutHit ? withoutHit.rank : '',
    rankGain: gain,
    withDefinitionsScore: withHit.score.toFixed(4),
    withoutDefinitionsScore: withoutHit ? withoutHit.score.toFixed(4) : '',
    withDefinitionsMatchedQueries: withHit.matchedQueries.join(';'),
    withoutDefinitionsMatchedQueries: withoutHit ? withoutHit.matchedQueries.join(';') : '',
    sourceDefinition: candidate.sourceDefinition
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await es.info();

  console.log(`Inspecting a random sample of up to ${options.sampleSize.toLocaleString()} indexed concepts with definitions from "${ES_INDEX}" (seed ${options.randomSeed})`);

  const globalCandidates = new Map();
  let processedDocs = 0;
  const docs = await fetchRandomDocsWithDefinitions(options.sampleSize, options.randomSeed);

  for (const doc of docs) {
    processedDocs += 1;

    const candidates = extractCandidatesForDoc(doc, options.perDoc);
    for (const candidate of candidates) {
      const existing = globalCandidates.get(candidate.query);
      const merged = {
        ...candidate,
        targetCui: doc.CUI,
        targetName: doc.preferred_name || ''
      };

      if (!existing || candidate.extractionScore > existing.extractionScore) {
        globalCandidates.set(candidate.query, merged);
      }
    }

    if (processedDocs % options.batchSize === 0 || processedDocs === docs.length) {
      console.log(`Mined candidates from ${processedDocs.toLocaleString()} concepts`);
    }
  }

  const candidates = Array.from(globalCandidates.values())
    .sort((a, b) => b.extractionScore - a.extractionScore || a.query.localeCompare(b.query));

  console.log(`Evaluating ${candidates.length.toLocaleString()} candidate queries with and without definition clauses`);

  const evaluations = await mapWithConcurrency(candidates, 6, async (candidate, index) => {
    if ((index + 1) % options.batchSize === 0 || index === candidates.length - 1) {
      console.log(`Checked ${index + 1} / ${candidates.length} candidate queries`);
    }
    return evaluateCandidate(candidate, options);
  });

  const rows = evaluations
    .filter(Boolean)
    .sort((a, b) => b.rankGain - a.rankGain || a.withDefinitionsRank - b.withDefinitionsRank || a.query.localeCompare(b.query))
    .slice(0, options.maxExamples);

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  const header = [
    'query',
    'target_cui',
    'target_name',
    'with_definitions_rank',
    'without_definitions_rank',
    'rank_gain',
    'with_definitions_score',
    'without_definitions_score',
    'with_definitions_matched_queries',
    'without_definitions_matched_queries',
    'source_definition'
  ];

  const csv = [
    header.join(','),
    ...rows.map(row => [
      row.query,
      row.targetCui,
      row.targetName,
      row.withDefinitionsRank,
      row.withoutDefinitionsRank,
      row.rankGain,
      row.withDefinitionsScore,
      row.withoutDefinitionsScore,
      row.withDefinitionsMatchedQueries,
      row.withoutDefinitionsMatchedQueries,
      row.sourceDefinition
    ].map(csvEscape).join(','))
  ].join('\n');

  fs.writeFileSync(options.output, `${csv}\n`, 'utf8');

  console.log(`Wrote ${rows.length.toLocaleString()} examples to ${options.output}`);
  if (rows.length > 0) {
    console.log('Top examples:');
    for (const row of rows.slice(0, 5)) {
      const without = row.withoutDefinitionsRank || `>${options.maxSearchRank}`;
      console.log(`  ${row.query} -> ${row.targetCui} (${row.targetName}) rank ${row.withDefinitionsRank} with definitions vs ${without} without`);
    }
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
