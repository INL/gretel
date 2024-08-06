from django.urls import path
from .api import RegistrationAPI, LoginAPI, UserAPI
from knox import views as knox_views
from django.urls import include

urlpatterns = [
    path('register/', RegistrationAPI.as_view()),
    path('login/', LoginAPI.as_view()),
    path('user/', UserAPI.as_view()),
    path('', include('knox.urls')),
]