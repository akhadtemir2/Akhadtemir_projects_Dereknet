# Этап 1: сборка Flutter web
FROM ghcr.io/cirruslabs/flutter:stable AS build

# Railway автоматически подставляет service variables как build args
ARG SUPABASE_URL
ARG SUPABASE_ANON_KEY
ARG OPENAI_API_KEY
ARG OPENAI_ADMIN_KEY

WORKDIR /app
COPY . .

# secrets.dart не в git — генерируем из переменных окружения Railway
RUN printf '%s\n' \
    '/// Сгенерировано при сборке (Railway). Не редактировать.' \
    'class Secrets {' \
    "  static const supabaseUrl = '${SUPABASE_URL}';" \
    "  static const supabaseAnonKey = '${SUPABASE_ANON_KEY}';" \
    "  static const openAiApiKey = String.fromEnvironment(" \
    "    'OPENAI_API_KEY'," \
    "    defaultValue: ''," \
    '  );' \
    "  static const openAiAdminKey = String.fromEnvironment(" \
    "    'OPENAI_ADMIN_KEY'," \
    "    defaultValue: ''," \
    '  );' \
    '}' > lib/config/secrets.dart

RUN flutter pub get
# --pwa-strategy=none: не генерируем service worker. Дашборд всегда онлайн и
# часто передеплоивается — офлайн-кэш SW только «залипал» на старой версии.
RUN flutter build web --release \
    --pwa-strategy=none \
    --dart-define=OPENAI_API_KEY=${OPENAI_API_KEY} \
    --dart-define=OPENAI_ADMIN_KEY=${OPENAI_ADMIN_KEY}

# Этап 2: раздача статики через nginx
FROM nginx:alpine
COPY --from=build /app/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Railway выдаёт порт через $PORT
CMD ["/bin/sh", "-c", "sed -i \"s/listen 8080/listen ${PORT:-8080}/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
