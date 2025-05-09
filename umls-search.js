let pages = [], fetchTimeStack = [], totalHits = 0, totalPages = 0;
let currentPageIndex = 0, pageSize = 8;
let currentFuzzyParams = null;

function escapeHtml(str) {
  return str.replaceAll("&","&amp;")
            .replaceAll("<","&lt;")
            .replaceAll(">","&gt;");
}

function renderCUIs(hitsArr, fuzzyParams) {
  return hitsArr.map(hit => {
    const src = hit._source;
    const h = hit.highlight||{};
    const prefHl = h.preferred_name||[];
    const codeHl = h['codes.strings']||[];
    const isExactPref = (hit.matched_queries||[]).includes('exact_pref_name');
    const prefNameDisplay = prefHl.length
      ? prefHl.map(f=>escapeHtml(f.replace(/<\/?em>/g,'').trim()))
              .join('<hr style="margin:4px 0;border-color:#ccc;"/>')
      : (isExactPref?escapeHtml(src.preferred_name):'(none)');

    const rawHtml = `<details><summary>Raw JSON</summary><pre class="raw">${escapeHtml(JSON.stringify(hit,null,2))}</pre></details>`;

    const detailsHtml = `
      <table style="border-collapse:collapse;width:100%;">
        <tr>
          <th style="border:1px solid #ccc;padding:0.3em;text-align:left;">Preferred Name Matches</th>
          <td style="border:1px solid #ccc;padding:0.3em;">${prefNameDisplay}</td>
        </tr>
        <tr>
          <th style="border:1px solid #ccc;padding:0.3em;text-align:left;">Other Matches</th>
          <td style="border:1px solid #ccc;padding:0.3em;">
            ${codeHl.length
              ? codeHl.map(f=>escapeHtml(f.replace(/<\/?em>/g,'').trim()))
                      .join('<hr style="margin:4px 0;border-color:#ccc;"/>')
              : '(none)'}
          </td>
        </tr>
        <tr>
          <th style="border:1px solid #ccc;padding:0.3em;text-align:left;">Fuzzy Match</th>
          <td style="border:1px solid #ccc;padding:0.3em;">${fuzzyParams?'Yes':'No'}</td>
        </tr>
      </table>
      ${rawHtml}
    `;

    return `
      <div class="card">
        <div class="header">
          <div class="left">${escapeHtml(src.preferred_name||'(no name)')}</div>
          <div>${src.CUI}</div>
          <div>${src.STY.map(sty=>`<span class="tag">${escapeHtml(sty)}</span>`).join(' ')}</div>
        </div>
        <button class="toggle-btn">Show details</button>
        <div class="details">${detailsHtml}</div>
      </div>
    `;
  }).join('');
}

function renderPage() {
  const resultsDiv = document.getElementById('results');
  const hitsArr = pages[currentPageIndex]||[];
  const fetchTime = fetchTimeStack[currentPageIndex];
  let html = '';
  if (typeof fetchTime==='number') {
    html += `<div style="font-style:italic;margin-bottom:0.5em;">Loaded page ${currentPageIndex+1} in ${fetchTime.toFixed(2)} s</div>`;
  }
  html += totalHits>0
    ? `<h2>Page ${currentPageIndex+1} of ${totalPages} – ${totalHits} total results</h2>`
    : `<h2>Page ${currentPageIndex+1}</h2>`;
  html += hitsArr.length
    ? renderCUIs(hitsArr, currentFuzzyParams)
    : `<pre>No results</pre>`;
  resultsDiv.innerHTML = html;

  resultsDiv.querySelectorAll('.toggle-btn').forEach(btn=>{
    btn.onclick=()=>{
      const det=btn.nextElementSibling;
      const show=det.style.display!=='block';
      det.style.display=show?'block':'none';
      btn.textContent=show?'Hide details':'Show details';
    };
  });

  document.getElementById('prevPage').disabled = currentPageIndex===0;
  document.getElementById('nextPage').disabled = currentPageIndex+1>=totalPages;
  document.getElementById('pagination').style.display='block';
}

async function doSearch(pageIndex=0) {
  if (pages[pageIndex]) {
    currentPageIndex = pageIndex;
    return renderPage();
  }

  const q = document.getElementById('query').value.trim();
  const tokens = q.split(/\s+/).filter(t=>t);
  let fuzziness = null;
  if (tokens.length===1) {
    const len = tokens[0].length;
    if (len>5&&len<=7) fuzziness=1;
    else if (len>7) fuzziness="AUTO";
  }
  currentFuzzyParams = fuzziness!=null
    ? { fuzziness, prefix_length:3, max_expansions:50, transpositions:false }
    : null;

  const body = {
    from: pageIndex*pageSize,
    size: pageSize,
    track_total_hits: pageIndex===0,
    _source:["preferred_name","CUI","STY"],
    query: {
      bool: {
        should: [
          {
            match_phrase: {
              "preferred_name": {
                query:    q,
                analyzer: "synonym_analyzer",
                boost:    10,
                _name:    "phrase_pref_name"
              }
            }
          },
          {
            nested: {
              path:       "codes",
              score_mode: "max",
              query: {
                match_phrase: {
                  "codes.strings": {
                    query:    q,
                    analyzer: "synonym_analyzer",
                    _name:    "phrase_code"
                  }
                }
              },
              inner_hits: {
                name:      "matched_codes",
                size:      6,
                highlight: { fields: { "codes.strings": {} } }
              }
            }
          }
        ]
      }
    },
    highlight: {
      fields: {
        preferred_name: {},
        "codes.strings": {}
      }
    }
  };

  document.getElementById('apiCall').textContent =
    `POST /umls-cui/_search\n\n` + JSON.stringify(body,null,2);
  document.getElementById('apiCall').style.display='block';

  const start=performance.now();
  const res=await fetch('http://127.0.0.1:9200/umls-cui/_search',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data=await res.json();
  const duration=(performance.now()-start)/1000;

  if(pageIndex===0 && data.hits.total!=null) {
    totalHits=data.hits.total.value;
    totalPages=Math.ceil(totalHits/pageSize);
  }

  pages[pageIndex]=data.hits.hits;
  fetchTimeStack[pageIndex]=duration;
  currentPageIndex=pageIndex;
  renderPage();
}

document.getElementById('searchForm')
  .addEventListener('submit', e=>{
    e.preventDefault();
    pages=[]; fetchTimeStack=[]; totalHits=0; totalPages=0; currentPageIndex=0;
    doSearch(0).catch(err=>{
      document.getElementById('results').innerHTML=
        `<pre style="color:red;">❌ ${err.message}</pre>`;
    });
  });
document.getElementById('prevPage')
  .addEventListener('click', ()=>{ if(currentPageIndex>0) doSearch(currentPageIndex-1); });
document.getElementById('nextPage')
  .addEventListener('click', ()=>{ if(currentPageIndex+1<totalPages) doSearch(currentPageIndex+1); });
