FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

ENV TF_CPP_MIN_LOG_LEVEL=3 \
    TF_ENABLE_ONEDNN_OPTS=0 \
    CUDA_VISIBLE_DEVICES=-1 \
    TF_USE_LEGACY_KERAS=1

RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    Pillow==10.3.0 \
    opencv-python-headless==4.9.0.80 \
    tensorflow-cpu==2.16.1 \
    tf-keras==2.16.0 \
    deepface==0.0.93 \
    python-telegram-bot==20.7

COPY preload_model.py .
RUN python preload_model.py

COPY . .

CMD ["bash", "start.sh"]
