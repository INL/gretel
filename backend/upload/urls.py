from django.urls import include, path
from .views import (
    upload_view
)

urlpatterns = [
    path('<slug:treebank>/', upload_view, name="upload"),
]
