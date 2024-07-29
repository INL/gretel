# buster is the debian version, pin it so that the image is reproducible
FROM python:3.11-buster as backend

WORKDIR /app

RUN apt update
RUN apt install unar -y

# Copy requirements.in, expand then, and install the dependencies.
RUN python -m pip install pip-tools

COPY backend/requirements.in backend/requirements.in
RUN pip-compile backend/requirements.in --output-file backend/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip-sync backend/requirements.txt


# Debug mode.
RUN python -m pip install debugpy

# Copy the backend code.
COPY backend backend
WORKDIR /app/backend
RUN python manage.py migrate

RUN echo "\
ALLOWED_HOSTS = ['*'] \n\
" >> gretel/settings.py

# CMD python -Xfrozen_modules=off -m debugpy --wait-for-client --listen 0.0.0.0:5678 manage.py runserver 0.0.0.0:8000 --pythonpath ..
CMD python manage.py migrate && python manage.py runserver 0.0.0.0:8000 --pythonpath ..

# Regular mode.
# CMD python manage.py runserver
# CMD tail -f /dev/null


FROM node:18-alpine as staticfiles-frontend

WORKDIR /app

# :( for retrieving the build number
COPY .git .git 
RUN apk add git

COPY package.json package.json
COPY web-ui/package.json web-ui/package.json

RUN --mount=type=cache,target=/root/.yarn YARN_CACHE_FOLDER=/root/.yarn yarn fyarn install

COPY web-ui web-ui

RUN yarn fyarn build

# CMD tail -f /dev/null



FROM backend as staticfiles-backend

# Collect static files. 
RUN echo "\
STATIC_ROOT = '/app/static' \n\
" >> gretel/settings.py

RUN mkdir /app/static
RUN python manage.py collectstatic --noinput

FROM nginx:1.27-alpine as frontend

# Copy the nginx configuration file.
COPY docker/production/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the static files from the staticfiles stage to the nginx directory.
COPY --from=staticfiles-backend /app/static /app/
COPY --from=staticfiles-frontend /app/web-ui/dist /app/

CMD ["nginx", "-g", "daemon off;"]