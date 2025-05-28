import { escapeHtml, getQueryInput, prepareForSearch } from './utils.js';

export function renderPage() {
    const resultsDiv = document.getElementById('results');
    const fetchTime = window.fetchTimeStack[0];

    const pageStart = window.currentPageIndex * 100 + 1;
    const pageEnd = Math.min(pageStart + window.pages.length - 1, window.totalHits);

    const container = document.createElement('div');

    container.innerHTML = `
        <div style="font-style:italic;">Loaded page ${window.currentPageIndex + 1} in ${fetchTime.toFixed(2)} s</div>
        <div>Showing results ${pageStart}–${pageEnd} of ${window.totalHits}</div>
        <div class="two-column-layout">
            <div class="left-column"></div>
            <div class="right-column" id="details"><p>Select a row to view details</p></div>
        </div>`;

    const leftCol = container.querySelector('.left-column');
    leftCol.appendChild(renderCUIs(window.pages));

    resultsDiv.innerHTML = '';
    resultsDiv.appendChild(container);

    // Debugging logs
    console.log(`📊 Total Hits: ${window.totalHits}`);
    console.log(`📄 Current Page: ${window.currentPageIndex + 1}`);
    console.log(`📋 Results on Page: ${window.pages.length}`);
    console.log(`📍 Showing results ${pageStart}–${pageEnd}`);

    document.querySelectorAll('.result-row').forEach(row => {
        row.addEventListener('click', () => {
            const index = row.getAttribute('data-index');
            const detailsPane = document.getElementById('details');
            detailsPane.innerHTML = '';
            detailsPane.appendChild(renderDetails(window.pages[index]));
            document.querySelectorAll('.result-row').forEach(r => r.classList.remove('selected-row'));
            row.classList.add('selected-row');
        });
    });

    ['prevPage', 'prevPageTop'].forEach(id => {
        document.getElementById(id).disabled = window.currentPageIndex <= 0;
    });

    ['nextPage', 'nextPageTop'].forEach(id => {
        document.getElementById(id).disabled = window.currentPageIndex >= (window.totalPages - 1);
    });

    ['pagination', 'paginationTop'].forEach(id => {
        document.getElementById(id).style.display = 'block';
    });

    window.pages.forEach(page => {
        if (page && page.preferred_name) {
            console.log(page.preferred_name); // Safeguard to ensure page exists
        } else {
            console.warn('Malformed page object:', page);
        }
    });
}

export function renderCUIs(hitsArr) {
    const queryExact = prepareForSearch(getQueryInput());

    const template = document.getElementById('table-template');
    const table = template.content.cloneNode(true);
    const tbody = table.querySelector('tbody');

    hitsArr.forEach((hit, index) => {
        const row = document.createElement('tr');
        row.classList.add('result-row');
        row.setAttribute('data-index', index);

        const prefName = hit.preferred_name || ''; // Use hit directly
        const prefNameMatch = prepareForSearch(prefName) === queryExact;
        const codesMatch = (hit.codes || []).flatMap(c => c.strings || []).some(s => prepareForSearch(s) === queryExact);
        const isExactMatch = prefNameMatch || codesMatch;

        row.innerHTML = `
            <td>${isExactMatch ? '✅' : ''}</td>
            <td>${escapeHtml(prefName)}</td>
            <td><a href="https://uts.nlm.nih.gov/uts/umls/concept/${hit.CUI}" target="_blank">${hit.CUI || ''}</a></td>
            <td>${(hit.STY || []).map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ')}</td>
        `;

        tbody.appendChild(row);
    });

    return table;
}

export function renderDetails(hit) {
    const src = hit; // Use the hit object directly
    const queryWords = prepareForSearch(getQueryInput()).split(/\s+/);

    const template = document.getElementById('details-template');
    const clone = template.content.cloneNode(true);

    clone.querySelector('.details-name').textContent = src.preferred_name || '';
    const cuiLink = clone.querySelector('.details-cui');
    cuiLink.href = `https://uts.nlm.nih.gov/uts/umls/concept/${src.CUI}`;
    cuiLink.textContent = src.CUI;

    const stySpan = clone.querySelector('.details-sty');
    stySpan.innerHTML = (src.STY || []).map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ');

    const namesDiv = clone.querySelector('.details-names');
    const defsDiv = clone.querySelector('.details-defs');

    const names = (src.codes || []).flatMap(c => c.strings || []);
    const defs = src.definitions || [];

    namesDiv.innerHTML = names.length
        ? names.map(n => `<p>${highlightQueryStems(n, queryWords)}</p>`).join('')
        : '<p>(none)</p>';

    defsDiv.innerHTML = defs.length
        ? defs.map(d => `<p>${highlightQueryStems(d, queryWords)}</p>`).join('')
        : '<p>(none)</p>';

    return clone;
}


export function renderError(err) {
    document.getElementById('results').innerHTML = `<pre style="color:red;">❌ ${err.message}</pre>`;
}

function highlightQueryStems(text, queryWords) {
    return text.split(/\b/).map(word => {
        const lowerWord = word.toLowerCase();
        const match = queryWords.some(q => lowerWord.includes(q)); // approximate match
        return match ? `<span class="highlight">${escapeHtml(word)}</span>` : escapeHtml(word);
    }).join('');
}

