// Tự động dọn dẹp biến môi trường (xóa khoảng trắng, dấu ngoặc, hoặc chữ "bot" dán thừa)
const rawToken = (process.env.BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const BOT_TOKEN = rawToken.replace(/^bot/i, ''); // Xóa chữ 'bot' nếu lỡ dán ở đầu token

const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim().replace(/^["']|["']$/g, '');

const rawServerUrl = (process.env.TELEGRAM_SERVER_URL || 'https://api.telegram.org').trim().replace(/\/+$/, '');
const TELEGRAM_BASE_URL = `${rawServerUrl}/bot${BOT_TOKEN}`;
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 10000;

// Các biến môi trường bắt buộc trên Render
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_SERVER_URL = process.env.TELEGRAM_SERVER_URL || 'https://api.telegram.org';
const TELEGRAM_BASE_URL = `${TELEGRAM_SERVER_URL}/bot${BOT_TOKEN}`;

// =========================================================================
// MIDDLEWARE CORS DUY NHẤT (ĐÃ LOẠI BỎ TẤT CẢ CODE TRÙNG LẶP)
// =========================================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Drive-Token, Range, If-Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Content-Range, Content-Length, Content-Type, Accept-Ranges');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Trả về HTTP 204 ngay lập tức khi trình duyệt gửi Preflight Request (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

// =========================================================================
// CẤU HÌNH MULTER UPLOAD (LƯU TẠM BỘ NHỚ RAM)
// =========================================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2000 * 1024 * 1024 } // Giới hạn chunk tới 2GB (khi dùng Local API)
});

// =========================================================================
// ENDPOINTS
// =========================================================================
app.get('/', (req, res) => {
  res.status(200).send('Teledrive Backend Data Plane is Running 24/7!');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'teledrive-backend',
    telegramServer: TELEGRAM_SERVER_URL,
    configured: Boolean(BOT_TOKEN && TELEGRAM_CHAT_ID),
    uptime: process.uptime()
  });
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    if (!BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.status(500).json({
        ok: false,
        error: 'Chưa cấu hình BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong Environment Variables'
      });
    }

    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('document', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype || 'application/octet-stream',
    });

    const tgRes = await axios.post(
      `${TELEGRAM_BASE_URL}/sendDocument`,
      formData,
      {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600000
      }
    );

    if (!tgRes.data || !tgRes.data.ok) {
      throw new Error((tgRes.data && tgRes.data.description) || 'Telegram API Error');
    }

    const doc = tgRes.data.result.document;
    return res.json({
      ok: true,
      telegram_file_id: doc.file_id,
      telegram_message_id: tgRes.data.result.message_id,
      size: doc.file_size
    });

  } catch (error) {
    console.error('Upload Error:', error.response ? error.response.data : error.message);
    return res.status(500).json({
      ok: false,
      error: error.response?.data?.description || error.message || 'Upload failed'
    });
  }
});

app.get('/file/:file_id', async (req, res) => {
  try {
    const { file_id } = req.params;

    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'Chưa cấu hình BOT_TOKEN' });
    }

    const pathRes = await axios.get(`${TELEGRAM_BASE_URL}/getFile?file_id=${file_id}`);
    if (!pathRes.data || !pathRes.data.ok) {
      return res.status(404).json({ error: 'File không tồn tại trên Telegram' });
    }

    const filePath = pathRes.data.result.file_path;
    const fileUrl = `${TELEGRAM_SERVER_URL}/file/bot${BOT_TOKEN}/${filePath}`;

    const streamRes = await axios({
      method: 'get',
      url: fileUrl,
      responseType: 'stream',
      headers: req.headers.range ? { range: req.headers.range } : {},
      validateStatus: status => status >= 200 && status < 400
    });

    if (streamRes.headers['content-type']) res.setHeader('Content-Type', streamRes.headers['content-type']);
    if (streamRes.headers['content-length']) res.setHeader('Content-Length', streamRes.headers['content-length']);
    if (streamRes.headers['accept-ranges']) res.setHeader('Accept-Ranges', streamRes.headers['accept-ranges']);

    if (streamRes.headers['content-range']) {
      res.setHeader('Content-Range', streamRes.headers['content-range']);
      res.status(206);
    } else {
      res.status(200);
    }

    streamRes.data.pipe(res);

  } catch (error) {
    console.error('Stream Error:', error.message);
    return res.status(500).json({ error: 'Failed to stream file' });
  }
});

app.post('/delete', async (req, res) => {
  try {
    if (!BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.status(500).json({
        ok: false,
        error: 'Chưa cấu hình BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong Environment Variables'
      });
    }

    const messageId = Number(req.body?.message_id);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return res.status(400).json({ ok: false, error: 'message_id không hợp lệ' });
    }

    const tgRes = await axios.post(`${TELEGRAM_BASE_URL}/deleteMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      message_id: messageId
    });

    if (!tgRes.data || !tgRes.data.ok) {
      console.warn('Delete warning:', tgRes.data && tgRes.data.description);
      return res.status(200).json({ ok: false, warning: (tgRes.data && tgRes.data.description) || 'Telegram từ chối xoá' });
    }

    return res.json({ ok: true });

  } catch (error) {
    console.error('Delete Error:', error.response ? error.response.data : error.message);
    return res.status(500).json({
      ok: false,
      error: error.response?.data?.description || error.message || 'Delete failed'
    });
  }
});

// =========================================================================
// 404 & ERROR HANDLING
// =========================================================================
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: `Route không tồn tại: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND'
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: `Multer Upload Error: ${err.message}` });
  }
  if (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Unexpected server error' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`Teledrive Data Plane Server listening on port ${PORT}`);
  console.log(`Telegram Server Target: ${TELEGRAM_SERVER_URL}`);
  console.log(`================================================`);
});
