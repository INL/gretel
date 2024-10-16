from django.contrib import admin

from .models import Treebank, Component, BaseXDB


class ComponentInline(admin.TabularInline):
    model = Component
    show_change_link = True


class BaseXDBInline(admin.TabularInline):
    model = BaseXDB


@admin.register(Treebank)
class TreebankAdmin(admin.ModelAdmin):
    list_display = ('slug', 'title')
    ordering = ('slug',)
    fieldsets = (
        (None, {
            'fields': ('slug', 'title', 'description', 'url_more_info',
                       'variants', 'groups', 'metadata')
        }),
    )
    inlines = [ComponentInline]


@admin.register(Component)
class ComponentAdmin(admin.ModelAdmin):
    list_display = ('slug', 'title', 'description', 'nr_sentences', 'nr_words',
                    'total_database_size', 'treebank')
    ordering = ('treebank', 'slug')
    inlines = [BaseXDBInline]
