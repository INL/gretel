from django.test import TestCase

from upload.models import TreebankUpload

from .models import Treebank, Component, BaseXDB


class TreebankTestCase(TestCase):
    def test_serialize(self):
        '''Test treebank serialization including serialization of its
        children Component and BaseXDB objects'''
        treebank = Treebank(slug='test', title='Test')
        comp = Component(slug='testcomp1', title='Testcomp1',
                         treebank=treebank)
        comp.nr_sentences = 0
        comp.nr_words = 0
        db = BaseXDB(component=comp, dbname='TESTDB', size=0)
        treebank.save()
        comp.save()
        db.save()
        ser = treebank.serialize()
        self.assertEqual(ser['slug'], 'test')
        self.assertEqual(len(ser['components']), 1)
        self.assertEqual(ser['components'][0]['slug'], 'testcomp1')
        self.assertEqual(len(ser['components'][0]['databases']), 1)
        self.assertEqual(ser['components'][0]['databases'][0], 'TESTDB')
