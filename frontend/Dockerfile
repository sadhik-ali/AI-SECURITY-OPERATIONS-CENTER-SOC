FROM node:22-alpine AS build

WORKDIR /srv/ai-soc

ARG VITE_DATA_SOURCE=api
ARG VITE_API_BASE_URL=/api
ARG VITE_WS_URL=/ws/alerts
ARG VITE_POLL_INTERVAL_MS=15000
ENV VITE_DATA_SOURCE=$VITE_DATA_SOURCE \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_POLL_INTERVAL_MS=$VITE_POLL_INTERVAL_MS

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html vite.config.ts tsconfig.json tailwind.config.ts postcss.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/ai-soc/dist /usr/share/nginx/html
EXPOSE 80
