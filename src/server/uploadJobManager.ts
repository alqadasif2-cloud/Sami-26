import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  publishApkToGitHubRelease,
  redactGitHubSecrets,
  setUploadJobProgress,
  type PublishedGitHubReleaseResult,
} from './githubReleases.ts';
import { inspectApkBuffer } from './apkInspector.ts';
import { getLatestAppUpdate, saveAppUpdateRecord } from './db.ts';

export type UploadJobState =
  | 'CREATED'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'PUBLISHING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface UploadJob {
  uploadJobId: string;
  idempotencyKey: string;
  state: UploadJobState;
  stageIndex: 1 | 2 | 3 | 4 | 5 | 6;
  stageNameAr: string;
  phaseLabelAr: string;
  percent: number; // 0..100 overall
  stage1Percent: number; // 0..100 (Browser -> Server)
  stage2Percent: number; // 0..100 (Server -> GitHub)
  bytesTransferred: number; // Bytes received on server
  totalBytes: number; // Total APK file size
  bytesSentToGitHub: number; // Bytes uploaded to GitHub
  fileName: string;
  fileSize: number;
  sha256: string;
  description: string;
  isMandatory: boolean;
  minSupportedVersionCode: number;
  publishedBy: string;
  tempFilePath?: string;
  abortController?: AbortController;
  result?: PublishedGitHubReleaseResult;
  inspection?: any;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

const JOBS_FILE = path.resolve('data', 'upload_jobs.json');
const jobsMap = new Map<string, UploadJob>();

function loadJobsFromDisk(): void {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const content = fs.readFileSync(JOBS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      for (const [k, v] of Object.entries(parsed)) {
        jobsMap.set(k, v as UploadJob);
      }
    }
  } catch {}
}

function persistJobsToDisk(): void {
  try {
    const data: Record<string, UploadJob> = {};
    // Only persist jobs from the last 2 hours
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [k, v] of jobsMap.entries()) {
      if (v.updatedAt >= cutoff) {
        // Strip non-serializable abortController
        const { abortController, ...serializable } = v;
        data[k] = serializable as UploadJob;
      } else {
        jobsMap.delete(k);
      }
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

loadJobsFromDisk();

export function getUploadJob(uploadJobId: string): UploadJob | null {
  return jobsMap.get(uploadJobId) || null;
}

export function findActiveJobByIdempotencyKey(key: string): UploadJob | null {
  if (!key) return null;
  for (const job of jobsMap.values()) {
    if (job.idempotencyKey === key) {
      if (['CREATED', 'UPLOADING', 'PROCESSING', 'PUBLISHING', 'VERIFYING'].includes(job.state)) {
        return job;
      }
      if (job.state === 'COMPLETED') {
        return job;
      }
    }
  }
  return null;
}

export function createUploadJob(params: {
  fileName: string;
  fileSize: number;
  sha256: string;
  description: string;
  isMandatory: boolean;
  minSupportedVersionCode?: number;
  idempotencyKey?: string;
  publishedBy?: string;
}): { job: UploadJob; isExisting: boolean } {
  const cleanSha = (params.sha256 || '').trim().toLowerCase();
  const cleanKey = params.idempotencyKey || `${cleanSha}_${params.fileSize}`;

  // Idempotency: Return active or completed job if already initiated
  const existing = findActiveJobByIdempotencyKey(cleanKey);
  if (existing) {
    return { job: existing, isExisting: true };
  }

  const uploadJobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const job: UploadJob = {
    uploadJobId,
    idempotencyKey: cleanKey,
    state: 'CREATED',
    stageIndex: 1,
    stageNameAr: 'إنشاء العملية',
    phaseLabelAr: 'تم إنشاء العملية وجاهز لاستقبال الملف عبر مسار مستقل',
    percent: 0,
    stage1Percent: 0,
    stage2Percent: 0,
    bytesTransferred: 0,
    totalBytes: params.fileSize,
    bytesSentToGitHub: 0,
    fileName: params.fileName,
    fileSize: params.fileSize,
    sha256: cleanSha,
    description: params.description || '',
    isMandatory: Boolean(params.isMandatory),
    minSupportedVersionCode: params.minSupportedVersionCode || 0,
    publishedBy: params.publishedBy || 'Sami',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobsMap.set(uploadJobId, job);
  syncJobToLegacyProgress(job);
  persistJobsToDisk();

  return { job, isExisting: false };
}

export function updateUploadJob(
  uploadJobId: string,
  patch: Partial<UploadJob>
): UploadJob | null {
  const job = jobsMap.get(uploadJobId);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: Date.now() });
  syncJobToLegacyProgress(job);
  persistJobsToDisk();
  return job;
}

export function cancelUploadJob(uploadJobId: string): boolean {
  const job = jobsMap.get(uploadJobId);
  if (!job) return false;

  if (job.abortController) {
    try {
      job.abortController.abort();
    } catch {}
  }

  if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
    try {
      fs.unlinkSync(job.tempFilePath);
    } catch {}
  }

  job.state = 'CANCELLED';
  job.phaseLabelAr = 'تم إلغاء عملية الرفع من قبل المستخدم';
  job.stageNameAr = 'تم إلغاء العملية';
  job.updatedAt = Date.now();
  syncJobToLegacyProgress(job);
  persistJobsToDisk();
  return true;
}

function syncJobToLegacyProgress(job: UploadJob): void {
  const phaseMap: Record<UploadJobState, any> = {
    CREATED: 'receiving_apk',
    UPLOADING: 'receiving_apk',
    PROCESSING: 'inspecting_apk',
    PUBLISHING: 'uploading_asset',
    VERIFYING: 'verifying_asset',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'canceled',
  };

  setUploadJobProgress({
    uploadId: job.uploadJobId,
    phase: phaseMap[job.state] || 'receiving_apk',
    phaseLabelAr: job.phaseLabelAr,
    stageIndex: job.stageIndex,
    stageNameAr: job.stageNameAr,
    percent: job.percent,
    bytesTransferred: job.bytesTransferred,
    totalBytes: job.totalBytes,
    fileName: job.fileName,
    fileSize: job.fileSize,
    sha256: job.sha256,
    result: job.result,
    error: job.error || undefined,
    updatedAt: job.updatedAt,
  });
}

/**
 * Executes the background APK verification and GitHub Releases publication pipeline.
 * Runs completely asynchronously without holding open client HTTP connections.
 */
export async function startJobBackgroundPublish(
  uploadJobId: string,
  tempFilePath: string
): Promise<void> {
  const job = jobsMap.get(uploadJobId);
  if (!job) return;

  const abortCtrl = new AbortController();
  job.abortController = abortCtrl;
  job.tempFilePath = tempFilePath;

  // Run in next event loop tick so the file-upload HTTP response finishes immediately
  setImmediate(async () => {
    try {
      if (job.state === 'CANCELLED' || abortCtrl.signal.aborted) {
        return;
      }

      // Stage 3: Inspect APK Binary & Signature
      updateUploadJob(uploadJobId, {
        state: 'PROCESSING',
        stageIndex: 3,
        stageNameAr: 'فحص الحزمة والتوقيع',
        phaseLabelAr: 'جارٍ فحص حزمة الـ APK وشهادة التوقيع وبصمة SHA-256...',
        percent: 50,
        stage1Percent: 100,
        bytesTransferred: job.totalBytes,
      });

      const apkBuf = await fs.promises.readFile(tempFilePath);
      const current = await getLatestAppUpdate();
      const publishedCode = Math.max(current?.versionCode || 0, 1);

      const inspection = await inspectApkBuffer({
        buffer: apkBuf,
        fileName: job.fileName,
        publishedVersionCode: publishedCode,
      });

      if (!inspection.valid || !inspection.signingCertificate) {
        const errMsg = inspection.errors[0] || 'ملف الـ APK غير صالح للنشر أو يفتقر إلى شهادة توقيع صالحة';
        updateUploadJob(uploadJobId, {
          state: 'FAILED',
          stageIndex: 3,
          stageNameAr: 'فشل الفحص',
          phaseLabelAr: errMsg,
          error: errMsg,
          inspection,
        });
        cleanupTempFile(tempFilePath);
        return;
      }

      if (job.sha256 && job.sha256 !== inspection.sha256.toLowerCase()) {
        const shaErr = 'بصمة SHA-256 للملف المستلم لا تطابق البصمة المعتمدة (احتمال تلف البيانات أثناء النقل)';
        updateUploadJob(uploadJobId, {
          state: 'FAILED',
          stageIndex: 3,
          stageNameAr: 'فشل مطابقة البصمة',
          phaseLabelAr: shaErr,
          error: shaErr,
        });
        cleanupTempFile(tempFilePath);
        return;
      }

      job.inspection = inspection;

      if (abortCtrl.signal.aborted) {
        updateUploadJob(uploadJobId, {
          state: 'CANCELLED',
          phaseLabelAr: 'تم إلغاء عملية الرفع من قبل المستخدم',
        });
        cleanupTempFile(tempFilePath);
        return;
      }

      // Stage 4: Publish to GitHub Releases with real streaming progress
      updateUploadJob(uploadJobId, {
        state: 'PUBLISHING',
        stageIndex: 4,
        stageNameAr: 'نقل الملف إلى GitHub Releases',
        phaseLabelAr: 'جارٍ إنشاء مسودة الإصدار وبث الملف إلى GitHub Releases...',
        percent: 52,
        stage2Percent: 2,
      });

      const ghRelease = await publishApkToGitHubRelease({
        uploadId: uploadJobId,
        apkFilePath: tempFilePath,
        apkSize: inspection.fileSize,
        sha256: inspection.sha256,
        versionName: inspection.versionName,
        versionCode: inspection.versionCode,
        applicationId: inspection.applicationId,
        signingCertSha256: inspection.signingCertificate.sha256Fingerprint,
        description: job.description,
        isMandatory: job.isMandatory,
        originalFileName: job.fileName,
        signal: abortCtrl.signal,
      });

      // Stage 5: Verifying Release Asset Presence & Hash on GitHub
      updateUploadJob(uploadJobId, {
        state: 'VERIFYING',
        stageIndex: 5,
        stageNameAr: 'التحقق من اكتمال الرفع',
        phaseLabelAr: 'تم تأكيد وجود الحزمة على GitHub — جارٍ توثيق الإصدار في قاعدة البيانات...',
        percent: 96,
        stage2Percent: 96,
        bytesSentToGitHub: inspection.fileSize,
      });

      const effectiveDownloadUrl = ghRelease.isRepoPrivate
        ? `/api/app-updates/download-release/${encodeURIComponent(ghRelease.releaseTag)}/${encodeURIComponent(ghRelease.assetName)}`
        : ghRelease.browserDownloadUrl;

      const savedUpdate = await saveAppUpdateRecord({
        versionName: inspection.versionName,
        versionCode: inspection.versionCode,
        description: job.description || `تحديث تطبيق Sami الإصدار ${inspection.versionName}`,
        fileSize: ghRelease.assetSize,
        fileName: ghRelease.assetName,
        applicationId: inspection.applicationId,
        storageSource: 'github_releases',
        githubOwner: ghRelease.githubOwner,
        githubRepo: ghRelease.githubRepo,
        githubReleaseId: ghRelease.githubReleaseId,
        releaseTag: ghRelease.releaseTag,
        githubAssetId: ghRelease.githubAssetId,
        isRepoPrivate: ghRelease.isRepoPrivate,
        downloadUrl: effectiveDownloadUrl,
        sha256: ghRelease.sha256,
        signingCertSha256: inspection.signingCertificate.sha256Fingerprint,
        uploadedAt: ghRelease.uploadedAt,
        publishedAt: ghRelease.publishedAt,
        status: 'published',
        isMandatory: job.isMandatory,
        minSupportedVersionCode: job.minSupportedVersionCode > 0 ? job.minSupportedVersionCode : undefined,
        publishedBy: job.publishedBy || 'Sami',
      });

      // Stage 6: Completed (100%)
      updateUploadJob(uploadJobId, {
        state: 'COMPLETED',
        stageIndex: 6,
        stageNameAr: 'اكتمل النشر بنجاح',
        phaseLabelAr: 'تم التحقق من وجود الحزمة بنجاح في GitHub Releases وتوثيق الإصدار في السحابة (100%)',
        percent: 100,
        stage1Percent: 100,
        stage2Percent: 100,
        bytesTransferred: inspection.fileSize,
        bytesSentToGitHub: inspection.fileSize,
        result: ghRelease,
        completedAt: Date.now(),
        error: null,
      });

      console.log(
        `[Sami Upload Job] Job ${uploadJobId} finished successfully: Release ${savedUpdate.versionName} (v${savedUpdate.versionCode}) verified on GitHub`
      );
    } catch (err: any) {
      if (abortCtrl.signal.aborted) {
        updateUploadJob(uploadJobId, {
          state: 'CANCELLED',
          phaseLabelAr: 'تم إلغاء عملية الرفع من قبل المستخدم',
        });
      } else {
        const errorMsg = redactGitHubSecrets(err?.message || err);
        console.error(`[Sami Upload Job] Job ${uploadJobId} failed:`, errorMsg);
        updateUploadJob(uploadJobId, {
          state: 'FAILED',
          stageNameAr: 'فشل العملية',
          phaseLabelAr: errorMsg,
          error: errorMsg,
        });
      }
    } finally {
      cleanupTempFile(tempFilePath);
    }
  });
}

function cleanupTempFile(filePath?: string): void {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}
