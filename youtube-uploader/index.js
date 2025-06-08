require('dotenv').config();
const express  = require('express');
const fs       = require('fs');
const { google } = require('googleapis');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ────────── Health-check ──────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ────────── Upload de vídeo ───────
app.post('/upload', async (req, res) => {
  try {
    // 1. Extrai o access-token vindo do n8n
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    if (!accessToken) {
      return res.status(401).json({ error: 'Authorization header ausente ou mal-formado' });
    }

    // 2. Extrai demais campos do body
    const {
      filePath,
      title,
      description = '',
      tags = [],
      privacyStatus = 'private',
      publishAt,
      defaultLanguage,
      defaultAudioLanguage
    } = req.body;

    if (!filePath || !title) {
      return res.status(400).json({ error: 'filePath e title são obrigatórios' });
    }

    // 3. Cria cliente OAuth2 apenas com o access-token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // 4. Monta status (inclui publishAt se veio)
    const status = { privacyStatus };
    if (publishAt) status.publishAt = publishAt;

    // 5. Monta snippet com os campos apropriados
    const snippet = {
      title,
      description,
      tags
    };

    if (defaultLanguage) snippet.defaultLanguage = defaultLanguage;
    if (defaultAudioLanguage) snippet.defaultAudioLanguage = defaultAudioLanguage;

    // 6. Faz upload (resumable por padrão)
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet,
        status
      },
      media: {
        body: fs.createReadStream(filePath)   // pode ser grande (stream)
      }
    });

    const videoId = response.data.id;

    res.json({
      success: true,
      id:  videoId,
      url: `https://youtu.be/${videoId}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.errors?.[0]?.message || err.message });
  }
});

// ────────── Inicializa servidor ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YouTube-uploader listening on port ${PORT}`);
});
