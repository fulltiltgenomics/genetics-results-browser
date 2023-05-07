FROM nikolaik/python-nodejs:python3.11-nodejs20-slim
MAINTAINER Juha Karjalainen <jkarjala@broadinstitute.org>

WORKDIR /opt/browser
RUN npm install -D webpack-cli

COPY ./ ./

RUN pip3 install -r requirements.txt
RUN npm install
RUN npx webpack --mode production

EXPOSE 8080

WORKDIR /config
CMD /opt/browser/server/run.py
