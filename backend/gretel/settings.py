"""
Django settings for gretel project.

Generated by 'django-admin startproject' using Django 4.0.6.

For more information on this file, see
https://docs.djangoproject.com/en/4.0/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/4.0/ref/settings/
"""

import os
from pathlib import Path
from typing import List

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/4.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = 'kxreeb3bds$oibo7ex#f3bi5r+d(1x5zljo-#ms=i2%ih-!pvn'

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

ALLOWED_HOSTS: List[str] = []


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'livereload',
    'django.contrib.staticfiles',
    
    'allauth',
    'allauth.account',
    'allauth.headless',
    'allauth.usersessions',

    'services',
    'treebanks',
    'search',
    'upload',
    'parse',
    'mwe',
    'rest_framework',
    'revproxy',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
	'allauth.account.middleware.AccountMiddleware'
]

ROOT_URLCONF = 'gretel.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [
            BASE_DIR / 'templates',
        ],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'gretel.wsgi.application'

# Database
# https://docs.djangoproject.com/en/4.0/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.getenv('DATABASE_PATH', BASE_DIR / 'db.sqlite3'),
    }
}

# Password validation
# https://docs.djangoproject.com/en/4.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

AUTHENTICATION_BACKENDS = [
    # Needed to login by username in Django admin, regardless of `allauth`
    'django.contrib.auth.backends.ModelBackend',

    # `allauth` specific authentication methods, such as login by email
    'allauth.account.auth_backends.AuthenticationBackend',
]


# Internationalization
# https://docs.djangoproject.com/en/4.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'Europe/Amsterdam'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/4.0/howto/static-files/

STATIC_URL = 'static/'

# Default primary key field type
# https://docs.djangoproject.com/en/4.0/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'DEBUG',
    },
}

# We need to have uploads written to disk in order to unzip them using patool.
FILE_UPLOAD_MAX_MEMORY_SIZE = 0

# Celery settings
CELERY_BROKER_URL = 'redis://' + os.getenv('REDIS_HOST', 'localhost')
CELERY_RESULT_BACKEND = 'redis://' + os.getenv('REDIS_HOST', 'localhost')

# BaseX connection settings - change in production
BASEX_HOST = os.getenv('BASEX_HOST', 'localhost')
BASEX_PORT = 1984
BASEX_USER = 'admin'
BASEX_PASSWORD = 'admin'

# Alpino connection settings
# Provide ALPINO_HOST and ALPINO_PORT to use Alpino as a server. Provide
# ALPINO_PATH to use the Alpino executable. If both are provided (i.e.
# not None) the server will be used.
ALPINO_HOST = os.getenv('ALPINO_HOST', 'localhost')
ALPINO_PORT = 7001
ALPINO_PATH = '/opt/Alpino'

MAXIMUM_RESULTS = 500
MAXIMUM_RESULTS_ANALYSIS = 5000

# Delete BaseX databases if corresponding treebanks/components are deleted
DELETE_COMPONENTS_FROM_BASEX = False

MAXIMUM_RESULTS_PER_COMPONENT = 5000

CACHING_DIR = BASE_DIR / 'query_result_cache'
MAXIMUM_CACHE_SIZE = 256  # Maximum cache size in MiB
STATICFILES_DIRS: List[str] = []
PROXY_FRONTEND = None

# Allauth settings
HEADLESS_ONLY = True
# Since we don't implement these views, there's no use in providing urls.
# However, allauth requires them to be set. We set them to a placeholder
# We override the email templates to prevent showing the urls, and just print the code + instructions.
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": "{key}",
    # Key placeholders are automatically populated. You are free to adjust this
    # to your own needs, e.g.
    #
    # "https://app.project.org/account/email/verify-email?token={key}",
    "account_reset_password": "/",
    "account_reset_password_from_key": "{key}",
    "account_signup": "/",
    # Fallback in case the state containing the `next` URL is lost and the handshake
    # with the third-party provider fails.
    "socialaccount_login_error": "/",
}
ACCOUNT_EMAIL_VERIFICATION = 'mandatory'
ACCOUNT_AUTHENTICATION_METHOD = 'email'
ACCOUNT_USERNAME_REQUIRED = True
ACCOUNT_EMAIL_REQUIRED = True
ACCOUNT_LOGOUT_ON_PASSWORD_CHANGE = True
ACCOUNT_LOGIN_BY_CODE_ENABLED = True

# Print emails to console in debug mode
if DEBUG:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

