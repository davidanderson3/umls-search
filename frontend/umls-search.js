function getQueryInput() {
    return document.getElementById('query').value; // Ensure 'query' matches the ID of your input field
}

function prepareForSearch(text) {
    return text.normalize("NFKC").toLowerCase()
        .replace(/\b(\w+)[’']s\b/gi, '$1')
        .trim();
}

function escapeHtml(str) {
    return str.replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

document.addEventListener("DOMContentLoaded", () => {
    // ======================
    // Config
    // ======================
    const CONFIG = {
        pageSize: 100,
        backendUrl: '/api/search'
    };

    const SELECTORS = {
        queryInput: 'query',
        apiCall: 'apiCall',
        results: 'results',
        searchForm: 'searchForm',
        prevButtons: ['prevPage', 'prevPageTop'],
        nextButtons: ['nextPage', 'nextPageTop'],
        pagination: ['pagination', 'paginationTop']
    };

    // ======================
    // State
    // ======================
    let pages = [], fetchTimeStack = [], totalHits = 0, totalPages = 0;
    let currentPageIndex = 0;

    // ======================
    // Helpers
    // ======================
    const $ = id => document.getElementById(id);

    function setApiCallText(q, pageIndex) {
        const text = `GET ${CONFIG.backendUrl}?q=${q}&page=${pageIndex}&size=${CONFIG.pageSize}`;
        const el = $(SELECTORS.apiCall);
        el.textContent = text;
        el.style.display = 'block';
    }

    function setPaginationButtons() {
        const disablePrev = currentPageIndex <= 0;
        const disableNext = currentPageIndex >= (totalPages - 1);

        SELECTORS.prevButtons.forEach(id => $(id).disabled = disablePrev);
        SELECTORS.nextButtons.forEach(id => $(id).disabled = disableNext);
        SELECTORS.pagination.forEach(id => $(id).style.display = 'block');
    }

    function addRowClickListeners(hitsArr) {
        const rows = document.querySelectorAll('.result-row');
        if (!rows.length) {
            console.error('No rows found to attach click listeners.');
            return;
        }

        rows.forEach(row => {
            row.addEventListener('click', () => {
                const index = row.getAttribute('data-index');
                const detailsDiv = document.getElementById('details');
                if (!detailsDiv) {
                    console.error('Details container not found.');
                    return;
                }

                // Render the details for the selected row
                detailsDiv.innerHTML = renderDetails(hitsArr[index]);

                // Highlight the selected row
                document.querySelectorAll('.result-row').forEach(r => r.classList.remove('selected-row'));
                row.classList.add('selected-row');
            });
        });
    }

    function renderCUIs(hitsArr) {
        const queryExact = prepareForSearch(getQueryInput());

        return `
        <table class="results-table">
            <thead>
                <tr>
                    <th></th> <!-- New column for the green checkmark -->
                    <th>Preferred Name</th>
                    <th>CUI</th>
                    <th>Semantic Types</th>
                </tr>
            </thead>
            <tbody>
                ${hitsArr.map((hit, index) => {
            const src = hit._source;
            const prefName = src.preferred_name || '(none)';
            const prefNameMatch = prepareForSearch(prefName) === queryExact;

            const codesStrings = (src.codes || []).flatMap(c => c.strings || []);
            const codesMatch = codesStrings.some(s => prepareForSearch(s) === queryExact);
            const isExactMatch = prefNameMatch || codesMatch;

            const semanticTypes = (src.STY || []).map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ');

            return `
                    <tr class="result-row" data-index="${index}">
                        <td>${isExactMatch ? '<span class="exact-match">✅</span>' : ''}</td>
                        <td>${escapeHtml(prefName)}</td>
                        <td>${src.CUI ? `<a href="https://uts.nlm.nih.gov/uts/umls/concept/${escapeHtml(src.CUI)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.CUI)}</a>` : '(none)'}</td>
                        <td>${semanticTypes}</td>
                    </tr>`;
        }).join('')}
            </tbody>
        </table>`;
    }

    function renderPage() {
        const resultsDiv = $(SELECTORS.results);
        const fetchTime = fetchTimeStack[0];
        let html = '';

        if (typeof fetchTime === 'number') {
            html += `<div style="font-style:italic;margin-bottom:0.5em;">
                    Loaded page ${currentPageIndex + 1} in ${fetchTime.toFixed(2)} s
                 </div>`;
        }

        // Add result summary here
        const pageStart = currentPageIndex * CONFIG.pageSize + 1;
        const rawPageEnd = pageStart + pages.length - 1;
        const pageEnd = Math.min(rawPageEnd, totalHits);

        html += `<div>Showing results ${pageStart}–${pageEnd} of ${totalHits}</div>`;


        html += `
    <div class="two-column-layout">
        <div class="left-column">
            ${pages.length ? renderCUIs(pages) : '<p>No results</p>'}
        </div>
        <div class="right-column" id="details">
            <p>Select a row to view details</p>
        </div>
    </div>`;

        resultsDiv.innerHTML = html;

        setPaginationButtons();
        addRowClickListeners(pages); // Attach row click listeners
    }


    async function doSearch(pageIndex = 0) {
        const q = prepareForSearch(getQueryInput());
        setApiCallText(q, pageIndex);

        const start = performance.now();
        const res = await fetch(`${CONFIG.backendUrl}?q=${encodeURIComponent(q)}&page=${pageIndex + 1}&size=${CONFIG.pageSize}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        console.log('🔍 Backend response:', data); // Log the backend response

        const duration = (performance.now() - start) / 1000;

        totalHits = data.total;
        pages = data.results;
        console.log(`🔍 Results received from backend: ${data.results.length}`);

        totalPages = Math.ceil(totalHits / CONFIG.pageSize);
        fetchTimeStack = [duration];
        currentPageIndex = pageIndex;
        renderPage();
    }

    $(SELECTORS.searchForm).addEventListener('submit', e => {
        e.preventDefault();
        pages = [];
        fetchTimeStack = [];
        totalHits = 0;
        totalPages = 0;
        currentPageIndex = 0;

        doSearch(0).catch(err => {
            $(SELECTORS.results).innerHTML = `<pre style="color:red;">❌ ${err.message}</pre>`;
        });
    });

    SELECTORS.prevButtons.forEach(id => {
        $(id).addEventListener('click', () => {
            if (currentPageIndex > 0) doSearch(currentPageIndex - 1);
        });
    });

    SELECTORS.nextButtons.forEach(id => {
        $(id).addEventListener('click', () => {
            if (currentPageIndex < totalPages - 1) doSearch(currentPageIndex + 1);
        });
    });
});

function renderDetails(hit) {
    const src = hit._source;
    const prefName = src.preferred_name || '(none)';
    const queryExact = prepareForSearch(getQueryInput());

    console.log('Rendering details for:', src); // Log the source data

    const highlightTerm = (text, term) => {
        const regex = new RegExp(`(${escapeHtml(term)})`, 'gi');
        return text.replace(regex, '<span class="highlight">$1</span>');
    };

    const namesHtml = (src.codes || [])
        .flatMap(c => c.strings || [])
        .map(name => `<p>${highlightTerm(escapeHtml(name), queryExact)}</p>`)
        .join('');

    const definitionsHtml = (src.definitions || [])
        .map(def => `<p>${highlightTerm(escapeHtml(def), queryExact)}</p>`)
        .join('');

    return `
    <div class="details">
        <h2>${escapeHtml(prefName)}</h2>
        <p><strong>CUI:</strong> ${src.CUI ? `<a href="https://uts.nlm.nih.gov/uts/umls/concept/${escapeHtml(src.CUI)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.CUI)}</a>` : '(none)'}</p>
        <p><strong>Semantic Types:</strong> ${(src.STY || []).map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ')}</p>
        <div>
            <h3>Names</h3>
            ${namesHtml || '<p>(none)</p>'}
        </div>
        <div>
            <h3>Definitions</h3>
            ${definitionsHtml || '<p>(none)</p>'}
        </div>
    </div>`;
}

async function loadDefinitions(defPath, consoPath) {
  return new Promise((resolve) => {
    const map = new Map();
    const validCUIs = new Set();

    // Step 1: Load valid CUIs with `LAT === 'ENG'` from MRCONSO.RRF
    const rlConso = readline.createInterface({ input: fs.createReadStream(consoPath) });
    rlConso.on('line', (line) => {
      const cols = line.split('|');
      const CUI = cols[0];
      const LAT = cols[1];
      const SUPPRESS = cols[16];
      if (LAT === 'ENG' && SUPPRESS === 'N') {
        validCUIs.add(CUI);
      }
    });

    rlConso.on('close', () => {
      console.log(`✅ Loaded ${validCUIs.size.toLocaleString()} CUIs with LAT === 'ENG'`);

      // Step 2: Load definitions from MRDEF.RRF for valid CUIs
      const rlDef = readline.createInterface({ input: fs.createReadStream(defPath) });
      rlDef.on('line', (line) => {
        const cols = line.split('|');
        const CUI = cols[0];
        const DEF = cols[5];

        if (validCUIs.has(CUI)) {
          console.log(`Processing definition for CUI: ${CUI}, DEF: ${DEF}`);
          if (!map.has(CUI)) map.set(CUI, []);
          map.get(CUI).push(DEF);
        }
      });

      rlDef.on('close', () => {
        console.log(`✅ Loaded definitions for ${map.size.toLocaleString()} CUIs`);
        resolve(map);
      });
    });
  });
}
