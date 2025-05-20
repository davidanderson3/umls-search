const express = require('express');
const path = require('path');
const searchRoute = require('./routes/search');

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/api', searchRoute);
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
