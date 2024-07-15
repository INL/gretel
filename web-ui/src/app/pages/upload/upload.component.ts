import { Component } from '@angular/core';
import { NotificationService, UploadService, UploadStreamError, UploadStreamEvent } from '../../services/_index';

@Component({
    selector: 'grt-upload',
    templateUrl: './upload.component.html',
    styleUrls: ['./upload.component.scss'],
})
export class UploadComponent {
    treebankName = '';
    file: File = null;
    format = '';
    sentenceTokenized = false;
    wordTokenized = false;
    sentencesLabeled = false;
    isPublic = false;

    warning = '';
    isUploading = false;
    uploadProgress = 0;

    constructor(
        private notificationService: NotificationService,
        private uploadService: UploadService
    ) {}

    selectFile(event: Event) {
        this.file = (event.target as HTMLInputElement).files[0];
    }

    upload() {
        this.warning = '';
        if (!this.file) this.warning = 'Please select a file to upload';
        this.uploadService.upload({
            treebankName: this.treebankName,
            file: this.file,
            format: this.format,
            isPublic: this.isPublic,
            sentenceTokenized: this.sentenceTokenized,
            sentencesLabeled: this.sentencesLabeled,
            wordTokenized: this.wordTokenized,
        })
        .subscribe({
            next: (v: UploadStreamEvent) => {
                this.notificationService.add(v.message, 'success');
                this.uploadProgress = v.progress;
            },
            error: (v: UploadStreamError) => {
                this.notificationService.add(v.message, 'error');
                this.warning = v.message;
                this.uploadProgress = -1;
            },
            complete: () => {
                this.isUploading = false;
                this.uploadProgress = 100;
            }
        })
    }
}
