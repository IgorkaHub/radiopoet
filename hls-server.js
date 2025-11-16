const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

const RADIO_DIR = __dirname + '/radio';
const SEGMENTS_DIR = RADIO_DIR + '/segments';

// создаём папки, если их нет
if (!fs.existsSync(RADIO_DIR)) fs.mkdirSync(RADIO_DIR);
if (!fs.existsSync(SEGMENTS_DIR)) fs.mkdirSync(SEGMENTS_DIR);

// === STATIC ===
app.use('/radio', express.static(RADIO_DIR));

app.get('/', (req, res) => {
  res.send('HLS server is running');
});

app.listen(3001, () => {
  console.log('HLS server running on http://localhost:3001');
});
