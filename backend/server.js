const express = require('express');
const path = require('path');
const searchRoute = require('./routes/search');
const { ES_INDEX, ES_URL } = require('../elastic-config');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/api', searchRoute);
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const server = app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    console.log(`🔎 Elasticsearch: ${ES_URL} (index: ${ES_INDEX})`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Try: PORT=${port + 1} node backend/server.js`);
        process.exit(1);
    }

    throw error;
});
