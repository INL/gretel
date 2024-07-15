# serializers.py
from rest_framework import serializers
from .models import Contact, TreebankUpload

class TreebankUploadSerializer(serializers.ModelSerializer):
    
    uploaded_by = serializers.SerializerMethodField('_user')
    
    class Meta: 
        model = TreebankUpload
        fields = [
            'input_file', 
            'input_format',

            # 'upload_timestamp',
            'uploaded_by',

            'public', 
            'sentence_tokenized', 
            'word_tokenized', 
            'sentences_have_labels', 
        ]

    def _user(self, obj):
        request = self.context.get('request')
        if request:
            return request.user
        else: 
            print("No request found when getting user from upload serializer")
            return None
        

    def create(self, validated_data):
        instance = TreebankUpload(**validated_data)
        instance.prepare()
        instance.process()

        return instance