# serializers.py
from rest_framework import serializers
from .models import TreebankUpload

class TreebankUploadSerializer(serializers.ModelSerializer):
    
    uploaded_by = serializers.SerializerMethodField('_user')
    
    class Meta: 
        model = TreebankUpload
        fields = [
            'name',
            'title',
            'description',
            'url_more_info',
            
            'input_file', 
            'input_format',

            # 'upload_timestamp',
            'uploaded_by',

            'public'
        ]

    def _user(self, obj):
        request = self.context.get('request')
        if request:
            return request.user
        else: 
            print("No request found when getting user from upload serializer")
            return None