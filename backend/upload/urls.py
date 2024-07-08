from django.urls import include, path
from .views import (
    ContactCreateView
)

urlpatterns = [
    path('/<slug:treebank>', ContactCreateView),
]
