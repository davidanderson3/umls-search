import { prepareForSearch, escapeHtml } from './utils.js';
import { renderPage, renderError } from './render.js';
import { doSearch, initState } from './search.js';

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById('searchForm');
    const prevButtons = ['prevPage', 'prevPageTop'];
    const nextButtons = ['nextPage', 'nextPageTop'];

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        initState();
        doSearch(0).catch(renderError);
    });

    prevButtons.forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            if (window.currentPageIndex > 0) doSearch(window.currentPageIndex - 1);
        });
    });

    nextButtons.forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            if (window.currentPageIndex < window.totalPages - 1) doSearch(window.currentPageIndex + 1);
        });
    });
});
