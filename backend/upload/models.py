
import os
from pathlib import Path
import tempfile
import re
import patoolib
from lxml import etree
import logging

from django.conf import settings
from django.db import models
from django.contrib.auth.models import User
from django.utils.text import slugify

from corpus2alpino.converter import Converter
from corpus2alpino.collectors.filesystem import FilesystemCollector
from corpus2alpino.targets.memory import MemoryTarget
from corpus2alpino.writers.lassy import LassyWriter
from corpus2alpino.readers.auto import AutoReader

from treebanks.models import Treebank, Component, BaseXDB
from services.alpino import alpino, AlpinoError
from services.basex import basex

# lxml instead of etree because we need proper xpath
import lxml.etree as ET

from typing import Callable, NoReturn, Union

logger = logging.getLogger(__name__)

MAXIMUM_DATABASE_SIZE = 1024 * 1024 * 10  # 10 MiB


class UploadError(RuntimeError):
    pass

class TreebankExistsError(RuntimeError):
    pass

class UploadProgress:
    total_files = 0
    processed_files = 0
    total_components = 0
    processed_components = 0
    words = 0
    sentences = 0
    done = False
    error: Union[str, None] = None
    message = 'Not started yet'

class TreebankUpload(models.Model):
    '''Class to upload texts of various input formats to GrETEL. The model
    can keep information about the upload progress during the various stages
    of the process (i.e. after uploading and inspecting the files, during
    processing and after processing), allowing user interaction in between,
    but if the process can be executed in one run (e.g. after calling a
    Django management command) it does not have to be saved at all. To use,
    make sure that input_file or input_dir is set and subsequently call
    prepare() and process().
    
    Because this model will create the underlying treebank, some fields 
    are duplicated from the Treebank model. This is to allow the user to
    provide information about the treebank before it is created.
    '''
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['name'],name='treebankupload_uniqueness')
        ]

    class InputFormat(models.TextChoices):
        ALPINO = 'A', 'Alpino'
        CHAT = 'C', 'CHAT'
        TXT = 'T', 'plain text'
        FOLIA = 'F', 'FoLiA'
        AUTO = '', 'auto-detect'

    PROGRESS = UploadProgress()
    MAX_METADATA_OPTIONS = 20

    name = models.CharField(max_length=255, blank=False, null=False)
    '''Name the treebank should have. This will be validated and potentially normalized in prepare()'''
    title = models.CharField(max_length=255, blank=False, null=False)
    '''Display name of the treebank. This is the name that will be shown in the UI. If unset, will default to name.'''
    description = models.TextField(max_length=2000, blank=True, null=True)
    '''Description of the treebank.'''
    url_more_info= models.URLField(blank=True, null=True)
    '''URL to more information about the treebank.'''
    treebank = models.OneToOneField(Treebank, on_delete=models.SET_NULL, blank=True, null=True)
    '''Initialized later.'''
    
    # Either of these should be set, but not both.
    input_file = models.FileField(upload_to='uploaded_treebanks/', blank=False, null=False) 
    '''Should only be set from upload API, file will be deleted after processing.'''
    input_dir = models.CharField(max_length=255, blank=True)
    '''Should not be set from upload API, only when running import through management script.'''

    input_format = models.CharField(max_length=2, choices=InputFormat.choices[0:])
    """We validate this and set it if auto-detect is chosen"""

    upload_timestamp = models.DateTimeField(verbose_name='Upload date and time', null=False, blank=True,auto_now=True)
    uploaded_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    public = models.BooleanField(default=False)
    processed = models.DateTimeField(null=True, blank=True, editable=False)
    '''When the processing was finished and the treebank is ready to be used.'''

    _temp_unpack_directory = None
    '''Where we place unpacked input files. Need to keep a handle to this or it's immediately deleted...'''
    _input_path: Union[Path,None] = None
    '''Path to files to be processed. Set in prepare(). 
    If the input_file was an archive, this will point to a temporary directory holding the unpacked files.
    If the input_file was a single file, this will point to the file itself.
    If the input_dir was set, this will point to the directory.
    '''

    components: dict[str, list[Path]] = {}
    '''Stores files to be processed, divided into components.'''

    progress_reporter: Union[Callable[[str, dict], None], None] = None
    '''Function to report progress to. This can be a Celery Task object or a custom object with a .update_state() method.'''

    def get_metadata(self):
        '''Return a dict containing the discovered metadata of this treebank,
        available after processing has finished. Format is the same as in the
        Treebank model.'''
        # This method uses the private _metadata attribute but does some
        # optimization by probing metadata facets (e.g. slider if all
        # values of the field are numeric, otherwise checkbox) and removing
        # metadata fields with too many different values.
        if not hasattr(self, '_metadata'):
            self._report_error('Treebank was not yet processed')
        
        datas = []
        for fieldname in self._metadata:
            field = self._metadata[fieldname]
            data = {'field': fieldname, 'type': field['type']}
            if field.get('allnumeric', None):
                if field['type'] != 'int':
                    logger.info(f'Changing metadata field {fieldname} from type {field["type"]} to int')
                    data['type'] = 'int'
                data['min_value'] = field['min_value']
                data['max_value'] = field['max_value']
                data['facet'] = 'slider'
            if 'facet' not in data:
                data['facet'] = 'checkbox'
            if len(field['values']) > self.MAX_METADATA_OPTIONS and \
                    data['facet'] == 'checkbox':
                # Do not include checkboxes that consist of too many values
                continue
            datas.append(data)
        return datas

    def _discover_metadata(self, xml: str):
        '''Helper method to discover the metadata for a number of sentences
        (to be passed in xml as the argument to this method). This method
        updates the private _metadata class attribute.'''
        root = ET.fromstring(xml)
        for sentence in root.findall('alpino_ds'):
            metadata = sentence.find('metadata')
            for meta in metadata.findall('meta'):
                name = meta.get('name')
                type_ = meta.get('type')
                value = meta.get('value')
                m = self._metadata.get(name, None)
                if m:
                    if len(m['values']) <= (self.MAX_METADATA_OPTIONS + 1):
                        # Only add to values set if not too large -
                        # we only use this to test if a filter should be
                        # created
                        m['values'].add(value)
                    if m.get('allnumeric', None):
                        if value.isnumeric():
                            m['min_value'] = min(m['min_value'], int(value))
                            m['max_value'] = max(m['max_value'], int(value))
                        else:
                            m['allnumeric'] = False
                else:
                    m = {}
                    m['type'] = type_
                    m['values'] = {value}
                    if value.isnumeric():
                        m['allnumeric'] = True
                        m['min_value'] = int(value)
                        m['max_value'] = int(value)
                    self._metadata[name] = m

    def _probe_file(self, path):
        '''Probe file format to allow autodiscovery'''
        filename = str(path)
        if filename.lower().endswith('.txt'):
            return self.InputFormat.TXT
        elif filename.lower().endswith('.cha'):
            return self.InputFormat.CHAT
        elif filename.lower().endswith('.xml'):
            with open(filename, 'r') as f:
                firstline = f.readline()
                secondline = f.readline()
                if ('<FoLiA' in firstline) or ('<FoLiA' in secondline):
                    return self.InputFormat.FOLIA
                elif ('<alpino_ds' in firstline) or ('<alpino_ds' in secondline):
                    return self.InputFormat.ALPINO
        return None

    def _prepare_files(self):
        '''Check whether we have input_file or input_dir, unpack the file if it is an archive, and set the _input_path attribute.'''
        if not self.input_file and not self.input_dir:
            self._report_error('No input file or directory to read.')
        if self.input_file:
            # Should be the path of the file?
            # TODO test from script + API
            # As the file might not be saved if we call from management script
            input_file_path = self.input_file.name or self.input_file.file.temporary_file_path()
            if patoolib.is_archive(input_file_path):
                self._temp_unpack_directory = tempfile.TemporaryDirectory()
                self._input_path = Path(self._temp_unpack_directory.name)
                try:
                    self._report_progress('Unpacking')
                    # Extract the archive to the temporary directory
                    patoolib.extract_archive(input_file_path, outdir=self._input_path, interactive=False)
                except: 
                    self._report_error('Error unpacking file. Is it a valid archive?')
            else:
                self._processed_input_file = Path(input_file_path)
        else:
            self._input_path = Path(self.input_dir)
            if not self._input_path.exists():
                self._report_error('Input directory does not exist.')

    def _add_file(self, path: Path, component: str):
        '''Include the file if it is of a supported format and if no
        files of another supported format had been found. Otherwise
        ignore the file.'''
        format = self._probe_file(path)
        if format:
            if self.input_format and format != self.input_format:
                self._report_error(f'Different input formats found ({format} and {self.input_format}).')
            self.input_format = format
            if component not in self.components:
                self.components[component] = []
                self.PROGRESS.total_components += 1
            self.components[component].append(path)

        self.PROGRESS.total_files += 1
        self._report_progress()

    def _read_input_files(self):
        '''Divide input files into components and probe input format.
        Files in the root of the input_dir will be put in a 'main' component.
        Direct subdirs will become components with the name of the directory.
        All files in the subdirs will be put in the corresponding component.
        '''

        if not self._input_path:
            self._report_error('No input file or directory to read. Did you call prepare()?')

        self._report_progress('Reading input files')

        if (self._input_path.is_file()):
            self._add_file(self._input_path, 'main')
            return
        
        # Put all toplevel files in a 'main' component and all files
        # in a subdirectory in a component with the name of the directory
        self.components = {}
        for entry in self._input_path.glob('*'):
            if entry.is_file():
                self._add_file(entry, 'main')
            if entry.is_dir():
                files = list(entry.glob('**/*'))
                for f in files:
                    self._add_file(f, entry.name)

    def prepare(self):
        '''Unpack (if input file is zipped) and inspect files. If this
        method runs without error, the processing is ready to start and
        the components class attribute (a dict of all components with
        the corresponding filenames) is available.'''
        
        # Do this first, don't bother with expensive operations if this fails
        if (self.name):
            treebankslug = slugify(self.name)
        elif (self.title):
            treebankslug = slugify(self.title)
        elif (self.input_file):
            treebankslug = slugify(self.input_file.name)
        elif (self.input_dir):
            treebankslug = slugify(Path(self.input_dir).name)
        else:
            self._report_error('No name or input file or directory provided')
            
        self.title = self.title if not self.title == '' else self.name if self.name else treebankslug
        self.name = treebankslug

        # Check if treebank already exists
        if Treebank.objects.filter(slug=treebankslug).exists():
            self._report_error(f'Treebank {treebankslug} already exists.')
        
        try: 
            self._prepare_files()
            self._read_input_files()
        except Exception as e:
            self._report_error(f'Could not prepare upload: {e}')
            

    def _generate_blocks(self, filenames, componentslug):
        '''A generator function converting all files in filenames to
        Alpino, yielding multiple strings ready to be added to BaseX,
        respecting MAXIMUM_DATABASE_SIZE.'''
        # This method directly manipulates the XML using regular expressions,
        # but it may be a good idea to use lxml for this because of
        # possible changes in what Alpino returns.
        current_output = []
        current_length = 0
        current_file = 0
        nr_words = 0
        nr_sentences = 0
        for filename in filenames:
            if (self.input_format != self.InputFormat.ALPINO):
                try:
                    converter = Converter(
                        collector = FilesystemCollector([filename]),
                        annotators = [alpino.annotator],
                        reader = AutoReader(),
                        target = MemoryTarget(),
                        writer = LassyWriter(True))
                    parses = converter.convert()
                    results = list(parses)
                except Exception as e:
                    logger.error('Could not process file {} - skipping: {}'.format(filename, str(e)))
                    current_file += 1
                    continue
            else:
                # The file is already in alpino format. Mirror the output of the Converter, which is just a list containing a single string with the document.
                with open(filename, 'r') as f:
                    results = [f.read()]
            
            assert len(results) == 1
            current_file += 1
            
            # Add ids to the sentences.
            sentences = self.label_and_extract_sentences(results[0], componentslug)
            for sentence, wordcount in sentences:
                current_output.append(sentence)
                current_length += len(sentence)
                nr_words += wordcount
                nr_sentences += 1
                if current_length > MAXIMUM_DATABASE_SIZE:
                    # Yield as soon as the maximum length is reached
                    yield ('<treebank>' + ''.join(current_output) + '</treebank>', nr_words, nr_sentences, current_file)
                    current_length = 0
                    nr_words = 0
                    nr_sentences = 0
                    current_output.clear()
        # Yield once more as soon as all files have been read
        if (current_length > 0):
            yield ('<treebank>' + ''.join(current_output) + '</treebank>',
                nr_words, nr_sentences, current_file)

    def label_and_extract_sentences(self, alpino_document: str, component_slug: str) -> list[tuple[str, int]]:
        '''Extract all <alpino_ds> sentences, add an id to the sentence.
        Returns the sentences along with the number of words in the sentence.'''
        root = ET.fromstring(alpino_document.encode('utf-8')) # encoding hoop because lxml is stupid
        sentences: list[tuple[str, int]] = []
        # Use local-name() so that any namespace prefixes are ignored
        for sentence in root.xpath('//*[local-name()="alpino_ds"]'):
            sentence.set('id', f'{component_slug}:{len(sentences)}')
            root = sentence.xpath('.//*[local-name()="node" and @cat="top"]/@end')
            # Rarely might encounter a sentence where the root has no start or end attributes.
            # In that case, try counting the words manually.
            wordcount = int(root[0]) if len(root) > 0 else int(sentence.xpath('count(.//*[local-name()="node" and @begin])'))
            sentences.append((ET.tostring(sentence, encoding="unicode"), wordcount))
        
        return sentences
    
    def process(self):
        '''Process prepared treebank upload. This method converts the
        prepared input files to Alpino format, uploads them to BaseX,
        probes metadata and creates Treebank/Component/BaseXDB model
        instances.'''
        try:
            alpino.initialize()
        except AlpinoError as e:
            self._report_error('Alpino not available: {}'.format(str(e)))
        if not basex.test_connection():
            self._report_error('BaseX not available')
        if not self._input_path:
            self._report_error('prepare() has to be called first')
            
        try:
            treebank = Treebank(
                slug=self.name, 
                title=self.title,
                description=self.description,
                url_more_info=self.url_more_info,
            )
            # probably want to do this to prevent race conditions
            treebank.save(force_insert=True)
            component_objs = []
            basexdb_objs = []
            self.PROGRESS.total_files = sum([len(x) for x in self.components.values()])
            self.PROGRESS.total_components = len(self.components)

            self._metadata = {}
            for component in self.components:
                self.PROGRESS.processed_components += 1
                self._report_progress(f'Processing component {component}')

                componentslug = slugify(component)
                comp_obj = Component(slug=componentslug, title=component, treebank=treebank)
                component_objs.append(comp_obj)
                filenames = [str(x) for x in self.components[component]]
                if not len(filenames):
                    logger.warning('Component {} is empty.'.format(component))
                    continue
                db_sequence = 0
                component_sentences = 0
                component_words = 0

                # TODO we're parsing the documents twice (once for sentence extraction, once for metadata extraction). This is inefficient.
                # We should refactor this to only parse the documents once.
                for result in self._generate_blocks(filenames, componentslug):
                    doc, words, sentences, total_files_processed = result
                    self.PROGRESS.words += words
                    self.PROGRESS.sentences += sentences
                    component_words += words
                    component_sentences += sentences
                    
                    self._discover_metadata(doc)
                    # nr_words += words
                    # nr_sentences += sentences
                    comp_obj.nr_sentences = component_sentences
                    comp_obj.nr_words = component_words
                    self.PROGRESS.processed_files = total_files_processed
                    self._report_progress()
                    
                    comp_obj.save()
                    dbname = f'GRETEL5_{self.name}_{componentslug}_{db_sequence}'.upper()
                    basexdb_obj = BaseXDB(dbname)
                    basexdb_objs.append(basexdb_obj)
                    basexdb_obj.component = comp_obj
                    basex.create(dbname, doc)
                    basexdb_obj.size = basexdb_obj.get_db_size()
                    basexdb_obj.save()
                    db_sequence += 1
                    
            treebank.metadata = self.get_metadata()
            treebank.save()
            self.PROGRESS.done = True
            self._report_progress('Processing finished')
        except Exception as e:
            self._report_error(f'Could not process treebank: {e}')
            

    def cleanup(self, delete_treebank=False):
        '''After indexing or failure, clean up temporary files (and the treebank, if indexing failed).'''
        if not self._temp_unpack_directory is None:
            self._temp_unpack_directory.cleanup()
            self._temp_unpack_directory = None
        
        # NOTE: calls save() internally. TODO check if this works as expected
        if not self.input_file is None:
            self.input_file.delete()
            self.input_file = None
        if (self.treebank is not None and delete_treebank):
            self.treebank.delete()
            self.treebank = None
        self.save()
    
    
    
    def _report_progress(self, message: str|None = None):
        p = self.PROGRESS
        if message:
            p.message = message
        # Else keep previous message

        if self.progress_reporter:
            self.progress_reporter('PROGRESS', p.__dict__)
        
        logger.info(f'''{
            ''}{p.message}: {p.processed_files}/{p.total_files} files ({p.processed_files / max(1, p.total_files)}%). {
            ''}{p.processed_components}/{p.total_components} components ({p.processed_components / max(1, p.total_components)})%.''')

    # Cleanup() might not be smart here, because we might want to keep the treebank around for debugging purposes.
    def _report_error(self, message: str, e: Exception = None):
        '''
        Generally abort processing.
        1) Set error state. 2) Mark done. 3) Log error & report to progress reporter. 4) Clean files. 5) Raise an UploadError.
        When this is running as a task in celery, not catching the exception will cause celery to overwrite the progress report with a FAILURE event.
        '''
        p = self.PROGRESS
        p.error = message
        p.done = True
        if (e):
            logger.error(message, exc_info=e)
            p.stack = traceback.format_exc()


        logger.error(message)
        self.cleanup(delete_treebank=(self.treebank is not None))
        e = UploadError(message)
        if self.progress_reporter:
            self.progress_reporter('FAILURE', {
                'exc_type': type(e).__name__, # required for redis to be happy, FAILURE events need these fields
                'exc_message': str(e),
                **p.__dict__
            })
        raise e

        