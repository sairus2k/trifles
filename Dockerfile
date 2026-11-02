# CI builds dist/ and this image only packages it, so the NAS never builds anything.
FROM nginx:1.30-alpine
LABEL org.opencontainers.image.source=https://github.com/sairus2k/trifles
COPY nginx-types.conf /etc/nginx/conf.d/types.conf
COPY dist/ /usr/share/nginx/html/
