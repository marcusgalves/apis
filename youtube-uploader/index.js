require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

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

    // 4. Configura proxy se proxy_url estiver presente
    const proxyUrl = req.headers['proxy_url'];
    let agent;
    if (proxyUrl) {
      try {
        if (/^socks/i.test(proxyUrl)) {
          agent = new SocksProxyAgent(proxyUrl);
        } else {
          agent = new HttpsProxyAgent(proxyUrl);
        }
      } catch (err) {
        console.error('Proxy inválido:', err.message);
        return res.status(400).json({ error: 'Proxy inválido', detail: err.message });
      }
    }

    // 5. Monta client do YouTube com ou sem proxy
    const youtubeOptions = { version: 'v3', auth: oauth2Client };
    if (agent) {
      youtubeOptions.gaxiosOptions = { agent };
    }
    const youtube = google.youtube(youtubeOptions);

    // 6. Monta status (inclui publishAt se veio)
    const status = { privacyStatus };
    if (publishAt) status.publishAt = publishAt;

    // 7. Monta snippet com os campos apropriados
    const snippet = { title, description, tags };
    if (defaultLanguage) snippet.defaultLanguage = defaultLanguage;
    if (defaultAudioLanguage) snippet.defaultAudioLanguage = defaultAudioLanguage;

    // 8. Faz upload (resumable por padrão)
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: { snippet, status },
      media: { body: fs.createReadStream(filePath) }
    });

    const videoId = response.data.id;
    res.json({ success: true, id: videoId, url: `https://youtu.be/${videoId}` });

  } catch (err) {
    console.error(err);
    const status = err.message?.toLowerCase().includes('proxy') ? 400 : 500;
    res.status(status).json({ error: err?.errors?.[0]?.message || err.message });
  }
});

// ────────── Inicializa servidor ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YouTube-uploader listening on port ${PORT}`);
});
