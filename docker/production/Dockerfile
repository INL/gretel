# buster is the debian version, pin it so that the image is reproducible
FROM python:3.11-buster as backend

WORKDIR /app

RUN pip install pip-tools
COPY backend/requirements.in backend/requirements.in

RUN pip-compile backend/requirements.in --output-file backend/requirements.txt
RUN pip-sync backend/requirements.txt

COPY backend backend

RUN pip install debugpy

WORKDIR /app/backend

RUN python manage.py migrate

# --wait-for-client
CMD python -Xfrozen_modules=off -m debugpy  --listen 0.0.0.0:5678 manage.py runserver 0.0.0.0:8000 --pythonpath ..

# CMD python manage.py runserver
# CMD tail -f /dev/null


FROM node:18-alpine as staticfiles-frontend

WORKDIR /app

# :( for retrieving the build number
COPY .git .git 
RUN apk add git

COPY package.json package.json
COPY web-ui/package.json web-ui/package.json

RUN yarn fyarn install

COPY web-ui web-ui

RUN yarn fyarn build

# CMD tail -f /dev/null



FROM backend as staticfiles-backend

# Collect static files. 
RUN echo "\
import os.path as op \n\
# collect files in ./static \
# ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'] \n\
STATIC_ROOT = '/app/static' \n\
" >> gretel/settings.py

RUN mkdir /app/static
RUN ls -l
RUN python manage.py collectstatic --noinput

FROM nginx:1.27-alpine as frontend

# Copy the nginx configuration file.
COPY docker/production/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the static files from the staticfiles stage to the nginx directory.
COPY --from=staticfiles-backend /app/static /app/
COPY --from=staticfiles-frontend /app/web-ui/dist /app/

CMD ["nginx", "-g", "daemon off;"]