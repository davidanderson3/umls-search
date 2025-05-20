export function getQueryInput() {
    return document.getElementById('query').value;
}

export function prepareForSearch(text) {
    return text.normalize("NFKC").toLowerCase()
        .replace(/\b(\w+)[’']s\b/gi, '$1')
        .trim();
}

export function escapeHtml(str) {
    return str.replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
