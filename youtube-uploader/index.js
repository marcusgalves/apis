require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
// Aumenta o limite do JSON body para suportar arquivos de vídeo em base64 se necessário no futuro,
// embora o método atual use streaming de arquivos.
app.use(express.json({ limit: '50mb' }));

// ────────── Health-check ──────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ────────── Upload de vídeo ───────
app.post('/upload', async (req, res) => {
  try {
    // 1. Extrai o access-token vindo do header
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    if (!accessToken) {
      return res.status(401).json({ error: 'Authorization header ausente ou mal-formado' });
    }

    // 2. Extrai todos os campos possíveis do body, incluindo os novos
    const {
      filePath,
      // Snippet fields
      title,
      description = '',
      tags = [],
      categoryId,
      defaultLanguage,
      defaultAudioLanguage,
      // Localizations object (NOVO)
      localizations,
      // Status fields
      privacyStatus = 'private',
      publishAt,
      license,
      embeddable,
      publicStatsViewable,
      madeForKids,
      selfDeclaredMadeForKids,
      containsSyntheticMedia, // NOVO
      // RecordingDetails fields
      recordingDetails,
      // ContentDetails fields
      contentDetails,
    } = req.body;

    if (!filePath || !title) {
      return res.status(400).json({ error: 'filePath e title são obrigatórios' });
    }

    // Valida se o arquivo existe antes de prosseguir
    if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: `Arquivo não encontrado em: ${filePath}` });
    }

    // 3. Cria cliente OAuth2 apenas com o access-token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    // 4. Configura proxy se proxy_url estiver presente no header
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

    // 6. Monta o requestBody e a lista de 'parts' dinamicamente

    // O snippet sempre terá pelo menos o título
    const snippet = { title, description, tags };
    if (categoryId) snippet.categoryId = categoryId;
    if (defaultLanguage) snippet.defaultLanguage = defaultLanguage;
    if (defaultAudioLanguage) snippet.defaultAudioLanguage = defaultAudioLanguage;

    // O status sempre terá pelo menos o privacyStatus
    const status = { privacyStatus };
    if (publishAt) status.publishAt = publishAt;
    if (license) status.license = license;
    if (typeof embeddable === 'boolean') status.embeddable = embeddable;
    if (typeof publicStatsViewable === 'boolean') status.publicStatsViewable = publicStatsViewable;
    if (typeof madeForKids === 'boolean') status.madeForKids = madeForKids;
    if (typeof selfDeclaredMadeForKids === 'boolean') status.selfDeclaredMadeForKids = selfDeclaredMadeForKids;
    // Adiciona o novo campo containsSyntheticMedia (NOVO)
    if (typeof containsSyntheticMedia === 'boolean') status.containsSyntheticMedia = containsSyntheticMedia;
    
    // Monta o requestBody final apenas com os objetos que têm dados
    const requestBody = { snippet, status };
    const parts = ['snippet', 'status'];
    
    // Adiciona recordingDetails se ele foi fornecido e tem conteúdo
    if (recordingDetails && Object.keys(recordingDetails).length > 0) {
        requestBody.recordingDetails = recordingDetails;
        parts.push('recordingDetails');
    }

    // Adiciona contentDetails se ele foi fornecido e tem conteúdo
    if (contentDetails && Object.keys(contentDetails).length > 0) {
        requestBody.contentDetails = contentDetails;
        parts.push('contentDetails');
    }

    // Adiciona localizations se foi fornecido e tem conteúdo (NOVO)
    if (localizations && Object.keys(localizations).length > 0) {
      requestBody.localizations = localizations;
      parts.push('localizations');
    }

    // 7. Faz upload (resumable por padrão)
    const response = await youtube.videos.insert({
      part: parts, // Usa a lista de parts dinâmica
      requestBody: requestBody, // Usa o corpo da requisição dinâmico
      media: {
        body: fs.createReadStream(filePath)
      }
    });

    const videoId = response.data.id;
    res.json({ success: true, id: videoId, url: `https://youtu.be/${videoId}` });

  } catch (err) {
    console.error(err);
    // Trata erros de forma mais detalhada
    const errorMessage = err?.errors?.[0]?.message || err.message;
    const status = errorMessage?.toLowerCase().includes('proxy') ? 400 : 500;
    res.status(status).json({ error: errorMessage });
  }
});

// ────────── Inicializa servidor ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YouTube-uploader listening on port ${PORT}`);
});
