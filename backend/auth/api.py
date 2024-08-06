from rest_framework import viewsets, permissions, generics
from rest_framework.response import Response
from knox.models import AuthToken

from .serializers import CreateUserSerializer, UserSerializer, LoginUserSerializer

class RegistrationAPI(generics.GenericAPIView):
    serializer_class = CreateUserSerializer

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response({
            "user": UserSerializer(user, context=self.get_serializer_context()).data,
            "token": AuthToken.objects.create(user)[1]
        })
    

# class LoginAPI(generics.GenericAPIView):
    # serializer_class = LoginUserSerializer

    # def post(self, request, *args, **kwargs):
    #     serializer = self.get_serializer(data=request.data)
    #     serializer.is_valid(raise_exception=True)
    #     user = serializer.validated_data
    #     return Response({
    #         "user": UserSerializer(user, context=self.get_serializer_context()).data,
    #         # always create a new token on login. 
    #         # Or we should retrieve tokens by session id or something, but then why not just use session id?
    #         "token": AuthToken.objects.create(user=user)[1] 
    #     })
from rest_framework.authtoken.serializers import AuthTokenSerializer
from knox.views import LoginView as KnoxLoginView
from django.contrib.auth import login

class LoginAPI(KnoxLoginView):
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()

    def post(self, request, format=None):
        serializer = AuthTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        login(request, user)
        response = super(LoginAPI, self).post(request, format=None)

        token = response.data['token']
        # del response.data['token']
        response.data['user'] = UserSerializer(user).data

        response.set_cookie(
            'auth_token',
            token,
            httponly=True,
            samesite='strict'
        )

        return response

class UserAPI(generics.RetrieveAPIView):
    permission_classes = [permissions.IsAuthenticated, ]
    # TODO: retrieve token from authorization header?
    # authentication_classes = [TokenAuthentication, TokenFromHeaderAuthentication]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def get(self, request, *args, **kwargs):
        user = self.get_object()
        token = AuthToken.objects.filter(user)[1]
        if not user or not token: 
            return Response({
                "user": None,
                "token": None
            })
        
        return Response({
            "user": UserSerializer(user, context=self.get_serializer_context()).data,
            "token": token
        })