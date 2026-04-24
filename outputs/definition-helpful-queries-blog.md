# Why Definitions Matter in UMLS Search

One practical limitation of the official UMLS API search is that it primarily relies on concept names, synonyms, and code-linked strings. That works well when a user searches with the exact term already present in the Metathesaurus, but it breaks down when the user searches with a short descriptive phrase instead of a canonical label.

To measure the effect of indexing definitions, we compared two versions of the same search stack:

- `Definition-aware search`: the local Elasticsearch index with `definitions` included in ranking.
- `Name/synonym-only baseline`: the same query logic with definition clauses removed. This approximates the behavior of a search system that cannot retrieve on MRDEF content.

The examples below show the pattern clearly: a short natural-language query can retrieve the right concept when definitions are indexed, while the same concept is missing from the top 50 results when definitions are excluded.

## What Changes

- With definitions indexed, descriptive phrase queries can match the explanatory language used in MRDEF.
- Without definitions, those same queries often have no strong overlap with preferred names or synonyms.
- The biggest gains appear for short clinical descriptions, especially phrases describing a condition, abnormality, inflammation, retention, or loss.

## Example Queries

| Query | Target Concept | CUI | Rank With Definitions | Baseline Result | Why Definitions Help |
| --- | --- | --- | --- | --- | --- |
| `absence of hydrochloric acid` | Achlorhydria | `C0001075` | 1 | Not found in first 50 results | The query describes the concept directly, but the canonical term `Achlorhydria` does not contain that wording. |
| `accumulation of lactic acid` | Acidosis, Lactic | `C0001125` | 1 | Not found in first 50 results | The phrase matches the definition text more naturally than the formal label. |
| `expulsion from the uterus` | Spontaneous abortion | `C0000786` | 1 | Not found in first 50 results | This is a descriptive clinical phrase rather than the indexed name. |
| `inflammation of the appendages` | Adnexitis | `C0001577` | 1 | Not found in first 50 results | Users may describe the anatomy rather than know the term `Adnexitis`. |
| `secretion of adrenal hormones` | Adrenal Gland Hyperfunction | `C0001622` | 1 | Not found in first 50 results | The wording comes from the concept definition, not the preferred name. |
| `chronic granulomatous infection` | Actinomycosis | `C0001261` | 2 | Not found in first 50 results | This is a concise disease description that definitions capture well. |
| `loss of carbon dioxide` | Alkalosis, Respiratory | `C0002064` | 2 | Not found in first 50 results | The query reflects a physiologic description instead of the formal diagnosis label. |
| `retention of carbon dioxide` | Acidosis, Respiratory | `C0001127` | 3 | Not found in first 50 results | This phrase is highly definition-like and weakly represented in names alone. |
| `swelling in the abdomen` | Abdominal mass | `C0000734` | 3 | Not found in first 50 results | The user may search by physical finding rather than the coded term. |
| `inflammation of the bronchioles` | Acute bronchiolitis | `C0001311` | 4 | Not found in first 50 results | The concept name is related, but the descriptive wording is definition-driven. |
| `inflammation of the thyroid` | Acute thyroiditis | `C0001360` | 4 | Not found in first 50 results | This is a natural paraphrase of the concept that definitions make retrievable. |

## Takeaway

Definitions do not just add more text to the index. They cover a different class of query: short descriptive searches that are semantically correct but do not use the exact disease or procedure name. In these cases, indexing MRDEF content can turn a missed search into a top-ranked hit.

## Notes

- These examples come from a local ablation study, not from modifying the official UMLS API directly.
- `Not found in first 50 results` means the target concept did not appear in the first 50 results in the name/synonym-only baseline. This does not prove that it was absent from the full result set.
- The refined example set used for this writeup is in [definition-helpful-queries.refined.csv](/Users/andersondm2/umls-search/outputs/definition-helpful-queries.refined.csv:1).
