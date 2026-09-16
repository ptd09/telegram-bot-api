FROM aiogram/telegram-bot-api:latest

# Cổng kết nối
EXPOSE 10000

# Khai báo các biến môi trường bắt buộc
ENV TELEGRAM_API_ID="30923182"
ENV TELEGRAM_API_HASH="5dd845dd41553449d0ddaa214759d8b7"

# Lệnh khởi chạy với chế độ local server
CMD ["--local", "--http-port=10000", "--dir=/tmp"]
