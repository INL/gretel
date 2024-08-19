from django.urls import include, path
from .views import (
    upload_view,
    upload_status,
    list_uploads,
    delete_upload
)

urlpatterns = [
    path('create/<slug:treebank>/', upload_view, name="upload"),
    path('status/<slug:upload_id>/', upload_status, name="status"),
    path('uploads', list_uploads, name="uploads"),
	path('delete/<slug:treebank>/', delete_upload, name="delete")
]
