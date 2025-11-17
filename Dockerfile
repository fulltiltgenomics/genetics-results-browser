FROM nikolaik/python-nodejs:python3.11-nodejs20-slim AS builder
LABEL maintainer="Juha Karjalainen <jkarjala@broadinstitute.org>"

RUN apt-get update && apt-get install -y nginx libz-dev libbz2-dev liblzma-dev zlib1g-dev libpcre2-dev libpcre3-dev libssl-dev libcurl4-openssl-dev bzip2 gcc g++ make

# dev or prod
ARG DEPLOY_ENV 
# finngen or public
ARG DATA_SOURCE

WORKDIR /var/www/genetics-results-browser

COPY package*.json ./
RUN npm install
COPY . .
COPY .env.${DEPLOY_ENV}.${DATA_SOURCE} .env
COPY ./src/config.${DATA_SOURCE}.json ./src/config.json
RUN npm run build
COPY nginx.${DEPLOY_ENV}.conf /etc/nginx/conf.d/default.conf 

FROM nginx:alpine

COPY --from=builder /var/www/genetics-results-browser/static /usr/share/nginx/html
COPY --from=builder /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf

RUN mkdir -p /var/cache/nginx && \
    chown -R nginx:nginx /var/cache/nginx && \
    chmod -R 755 /var/cache/nginx && \
    touch /opt/nginx.pid && chown nginx:nginx /opt/nginx.pid

RUN echo "pid /opt/nginx.pid;" > /etc/nginx/nginx.conf && \
    echo "worker_processes auto;" >> /etc/nginx/nginx.conf && \
    echo "events { worker_connections 1024; }" >> /etc/nginx/nginx.conf && \
    echo "http { include /etc/nginx/conf.d/*.conf; }" >> /etc/nginx/nginx.conf

USER nginx
EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
