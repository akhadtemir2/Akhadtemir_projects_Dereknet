#!/bin/bash
echo "=== Запуск системы учёта ==="

pkill -f "attendance_face_only.py" 2>/dev/null
pkill -f "bot.py" 2>/dev/null
sleep 2

python attendance_face_only.py &
WEB_PID=$!
echo "Веб-сервер запущен (PID: $WEB_PID)"

sleep 3

python bot.py &
BOT_PID=$!
echo "Telegram-бот запущен (PID: $BOT_PID)"

wait
