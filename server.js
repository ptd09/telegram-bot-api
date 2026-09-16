const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 10000;

// Các biến môi trường bắt buộc trên Render
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Địa chỉ Telegram Server: Nếu dùng Local Bot API Docker thì điền URL Local (VD: http://localhost:10000)
// Nếu không điền TELEGRAM_SERVER_URL, server sẽ tự động dùng Telegram API công cộng.
const TELEGRAM_SERVER_URL = process.env.TELEGRAM_SERVER_URL || 'https://api.telegram.org';
const TELEGRAM_BASE_URL = `${TELEGRAM_SERVER_URL}/bot${BOT_TOKEN}`;

// =========================================================================
// 1. MIDDLEWARE XỬ LÝ DỨT ĐIỂM LỖI CORS VÀ PREFLIGHT (OPTIONS)
// Bắt buộc đặt TRƯỚC TẤT CẢ các đường dẫn khác
// =========================================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Drive-Token, Authorization, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Content-Range, Content-Length, Content-Type');

  // Trả về HTTP 200 OK ngay lập tức khi trình duyệt hỏi tiền trạm (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());

// =========================================================================
// 2. CẤU HÌNH MULTER UPLOAD (LƯU TẠM BỘ NHỚ RAM)
// =========================================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2000 * 1024 * 1024 } // Giới hạn chunk tới 2GB (khi dùng Local API)
});

// =========================================================================
// 3. ENDPOINT HEALTH CHECK (Giữ Render không ngủ / Chống Cold Start)
// =========================================================================
app.get('/', (req, res) => {
  res.status(200).send('Teledrive Backend Data Plane is Running 24/7!');
});

// =========================================================================
// 4. ENDPOINT UPLOAD CHUNK FILE (`POST /upload`)
// =========================================================================
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

    // Đẩy chunk sang Telegram Bot API
    const tgRes = await axios.post(
      `${TELEGRAM_BASE_URL}/sendDocument`,
      formData,
      {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600000 // Timeout 10 phút cho tệp lớn
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

// =========================================================================
// 5. ENDPOINT STREAM / PREVIEW / DOWNLOAD (`GET /file/:file_id`)
// =========================================================================
app.get('/file/:file_id', async (req, res) => {
  try {
    const { file_id } = req.params;

    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'Chưa cấu hình BOT_TOKEN' });
    }

    // B1: Lấy đường dẫn file_path từ Telegram API
    const pathRes = await axios.get(`${TELEGRAM_BASE_URL}/getFile?file_id=${file_id}`);
    if (!pathRes.data || !pathRes.data.ok) {
      return res.status(404).json({ error: 'File không tồn tại trên Telegram' });
    }

    const filePath = pathRes.data.result.file_path;
    
    // Tạo URL tải file thô
    const fileUrl = `${TELEGRAM_SERVER_URL}/file/bot${BOT_TOKEN}/${filePath}`;

    // B2: Stream byte dữ liệu về trình duyệt
    const streamRes = await axios({
      method: 'get',
      url: fileUrl,
      responseType: 'stream',
      headers: req.headers.range ? { range: req.headers.range } : {}
    });

    // B3: Chuyển tiếp các Header quan trọng để trình duyệt phát Video/Audio hoặc tải về
    if (streamRes.headers['content-type']) res.setHeader('Content-Type', streamRes.headers['content-type']);
    if (streamRes.headers['content-length']) res.setHeader('Content-Length', streamRes.headers['content-length']);
    if (streamRes.headers['content-range']) {
      res.setHeader('Content-Range', streamRes.headers['content-range']);
      res.status(206); // Partial Content
    }

    streamRes.data.pipe(res);

  } catch (error) {
    console.error('Stream Error:', error.message);
    return res.status(500).json({ error: 'Failed to stream file' });
  }
});

// =========================================================================
// 6. XỬ LÝ LỖI NGUYÊN NÂN TỪ MULTER & CÁC LỖI TỔNG THỂ
// =========================================================================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: `Multer Upload Error: ${err.message}` });
  } else if (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
  next();
});

// Khởi chạy Máy chủ
app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`Teledrive Data Plane Server listening on port ${PORT}`);
  console.log(`Telegram Server Target: ${TELEGRAM_SERVER_URL}`);
  console.log(`================================================`);
});
