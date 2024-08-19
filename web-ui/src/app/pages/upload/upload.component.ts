import { Component } from '@angular/core';
import { NotificationService, UploadService, UploadStreamError, UploadStreamEvent } from '../../services/_index';

@Component({
    selector: 'grt-upload',
    templateUrl: './upload.component.html',
    styleUrls: ['./upload.component.scss'],
})
export class UploadComponent {
    treebankName = '';
    treebankDescription= '';
    treebankHelpUrl = '';
    format = '';
    isPublic = false;
    
    file: File = null;

    warning = '';
    isUploading = false;
    uploadProgress = 0;

    uploads: any[] = [];
    error: string|null = null;

    constructor(
        private notificationService: NotificationService,
        private uploadService: UploadService
    ) {
        this.uploadService.get_uploads().then(u => this.uploads = u, e => this.error = e)
    }

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
            treebankDescription: this.treebankDescription,
            treebankHelpUrl: this.treebankHelpUrl,
            treebankDisplay: this.treebankName,
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
