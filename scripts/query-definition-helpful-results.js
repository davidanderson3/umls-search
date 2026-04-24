const fs = require('fs');
const path = require('path');
const { Client } = require('@elastic/elasticsearch');

const client = new Client({ node: 'http://127.0.0.1:9200' });

function parseArgs(argv) {
  const args = {
    input: path.join(process.cwd(), 'outputs', 'definition-helpful-queries.refined.csv')
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      args.input = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift());
  return lines.map(line => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((name, index) => {
      row[name] = values[index] || '';
    });
    return row;
  });
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

async function runSearch(query, includeDefinitions) {
  const result = await client.search({
    index: 'umls-cui',
    size: 3,
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
    cui: hit._source?.CUI || '',
    preferredName: hit._source?.preferred_name || ''
  }));
}

function formatHit(hit) {
  if (!hit) {
    return 'No result returned';
  }

  return `#${hit.rank} ${hit.preferredName} (${hit.cui})`;
}

function formatHits(hits) {
  if (!Array.isArray(hits) || hits.length === 0) {
    return 'No result returned';
  }

  return hits.map(formatHit).join('; ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input;
  const rows = parseCsv(inputPath);
  const results = [];

  for (const row of rows) {
    const withDefinitions = await runSearch(row.query, true);
    const withoutDefinitions = await runSearch(row.query, false);
    results.push({
      query: row.query,
      with_definitions_top_result: formatHit(withDefinitions[0]),
      without_definitions_top_result: formatHit(withoutDefinitions[0]),
      with_definitions_top_3: formatHits(withDefinitions),
      without_definitions_top_3: formatHits(withoutDefinitions)
    });
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
