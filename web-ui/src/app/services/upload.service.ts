import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType, HttpRequest } from '@angular/common/http';
import { catchError, map, Observable, ReplaySubject, throwError } from 'rxjs';
import { ConfigurationService } from './configuration.service';
import { NotificationService } from './notification.service';

export class UploadStreamEvent {
    constructor(
        public message: string,
        public progress: number,
    ) {}
}

export class UploadStreamError {
    constructor(public message: string) {}
}

// TODO sync with server.
type UploadResponse = {
    
}

@Injectable({
    providedIn: 'root'
})
export class UploadService {
    constructor(
        private http: HttpClient,
        private configurationService: ConfigurationService,
        private notificationService: NotificationService
    ) { }

    private handleProgressForFile(file: File): (event: HttpEvent<{test:''}>) => UploadStreamEvent {
        return (event: HttpEvent<{test:''}>) => {
            switch (event.type) {
                case HttpEventType.Sent:
                    return new UploadStreamEvent(`Uploading file "${file.name}" of size ${file.size}.`, 0);
                case HttpEventType.UploadProgress:
                    const percentDone = event.total ? Math.round(100 * event.loaded / event.total) : 0;
                    return new UploadStreamEvent(`File "${file.name}" is ${percentDone}% uploaded.`, percentDone);
                case HttpEventType.Response:
                    return new UploadStreamEvent(`File "${file.name}" was completely uploaded!`, 100);
                default:
                    return new UploadStreamEvent('', -1);
            }
        }
    }

    private handleError(error: HttpErrorResponse): Observable<UploadStreamError> {
        if (error.status === 0) {
            // A client-side or network error occurred. Handle it accordingly.
            return throwError(() => new UploadStreamError('Failed to communicate with server; please try again later.'));
        } else {
            const r: {message: string} = error.error;
            // The backend returned an unsuccessful response code.
            // error.error contains the response body.
            // TODO should probably expose more info.
            return throwError(() => new UploadStreamError(`Failed to upload or parse file: ${r.message}`));
        }
    }

    /**
     * Logs the user in, returns true if successful
     */
    upload(params: {
        treebankName: string,
        file: File,
        format: string,
        sentenceTokenized?: boolean,
        wordTokenized?: boolean,
        sentencesLabeled?: boolean,
        isPublic?: boolean,
    }): Observable<UploadStreamEvent>  {
        const formData = new FormData();
        formData.set('input_file', params.file);
        formData.set('input_format', params.format);
        formData.set('public', params.isPublic ? 'true' : 'false');
        formData.set('sentence_tokenized', params.sentenceTokenized ? 'true' : 'false');
        formData.set('word_tokenized', params.wordTokenized ? 'true' : 'false');
        formData.set('sentences_have_labels', params.sentencesLabeled ? 'true' : 'false');
        
        const upload$ = new ReplaySubject<UploadStreamEvent>();

        this.configurationService.getDjangoUrl(`upload/${params.treebankName}/`)
        .then(url => new HttpRequest('POST', url, formData, {
            withCredentials: true,
            reportProgress: true
        }))
        .then(s => this.http.request(s)
            .pipe(
                map(this.handleProgressForFile(params.file)),
                catchError(this.handleError)
            )
            .subscribe(upload$)
        )
        return upload$;
    }
}
