const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;

// 1. ĐỊA CHỈ LOCAL TELEGRAM BOT API SERVER (Dùng biến môi trường hoặc mặc định localhost:10000)
const TELEGRAM_SERVER_URL = process.env.TELEGRAM_SERVER_URL || 'http://localhost:10000';
const TELEGRAM_BASE_URL = `${TELEGRAM_SERVER_URL}/bot${BOT_TOKEN}`;

// 2. Cấu hình CORS xử lý dứt điểm lỗi Preflight (OPTIONS) và Custom Header
const corsOptions = {
  origin: '*', 
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Drive-Token', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Content-Length', 'Content-Type'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2000 * 1024 * 1024 } }); // Hỗ trợ chunk lớn khi dùng Local Bot API

// Endpoint Health Check
app.get('/', (req, res) => {
  res.status(200).send('Teledrive Backend Data Plane (Local Bot API) is Running!');
});

// 3. Endpoint UPLOAD 
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const formData = new FormData();
    formData.append('chat_id', process.env.TELEGRAM_CHAT_ID);
    formData.append('document', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype || 'application/octet-stream',
    });

    // Đã thay thế api.telegram.org bằng TELEGRAM_BASE_URL (Local Server)
    const tgRes = await axios.post(
      `${TELEGRAM_BASE_URL}/sendDocument`,
      formData,
      { headers: formData.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity }
    );

    if (!tgRes.data.ok) throw new Error(tgRes.data.description || 'Telegram API Error');

    const doc = tgRes.data.result.document;
    return res.json({
      ok: true,
      telegram_file_id: doc.file_id,
      telegram_message_id: tgRes.data.result.message_id,
      size: doc.file_size
    });
  } catch (error) {
    console.error('Upload Error:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// 4. Endpoint STREAM / PREVIEW / DOWNLOAD
app.get('/file/:file_id', async (req, res) => {
  try {
    const { file_id } = req.params;

    // Đã thay thế api.telegram.org bằng TELEGRAM_BASE_URL (Local Server)
    const pathRes = await axios.get(`${TELEGRAM_BASE_URL}/getFile?file_id=${file_id}`);
    if (!pathRes.data.ok) return res.status(404).json({ error: 'File not found on Telegram' });

    const filePath = pathRes.data.result.file_path;
    // URL tải file qua Local Bot API Server
    const fileUrl = `${TELEGRAM_SERVER_URL}/file/bot${BOT_TOKEN}/${filePath}`;

    const streamRes = await axios({
      method: 'get',
      url: fileUrl,
      responseType: 'stream',
      headers: req.headers.range ? { range: req.headers.range } : {}
    });

    if (streamRes.headers['content-type']) res.setHeader('Content-Type', streamRes.headers['content-type']);
    if (streamRes.headers['content-length']) res.setHeader('Content-Length', streamRes.headers['content-length']);
    if (streamRes.headers['content-range']) {
      res.setHeader('Content-Range', streamRes.headers['content-range']);
      res.status(206);
    }

    streamRes.data.pipe(res);
  } catch (error) {
    console.error('Stream Error:', error.message);
    return res.status(500).json({ error: 'Failed to stream file' });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
