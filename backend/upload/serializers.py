# serializers.py
from rest_framework import serializers
from .models import TreebankUpload
from treebanks.serializers import TreebankSerializer
from treebanks.models import Treebank

class TreebankUploadSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.SerializerMethodField('_user')
    # The upload refers to the treebank by its slug
    # We store the relation as 'treebank' in the database
    slug = serializers.SlugRelatedField(source='treebank', slug_field='slug', queryset=Treebank.objects.all())

    class Meta: 
        model = TreebankUpload
        fields = [
            'slug',
            'input_file', 
            'input_format',
            'uploaded_by',
            'public'
        ]
        read_only_fields = ['uploaded_by', 'uploaded_timestamp', 'processed']

    def _user(self, obj):
        request = self.context.get('request')
        if request:
            return request.user
        else: 
            print("No request found when getting user from upload serializer")
            return None