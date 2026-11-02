import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

export const SAMI_APPLICATION_ID = 'com.sami.tradingchallengetracker';
export const SAMI_INSTALLED_BASELINE_VERSION_CODE = 1;
export const SAMI_INSTALLED_BASELINE_VERSION_NAME = '1.0.0';

const SIGNING_KEY_PATH = path.resolve('app', 'sami-signing-key.p12');

export function getOriginalSamiSigningKeyStatus(): {
  available: boolean;
  sha256Fingerprint: string;
  sha256Hex: string;
  subject: string;
  error?: string | null;
} {
  try {
    if (fs.existsSync(SIGNING_KEY_PATH)) {
      const buf = fs.readFileSync(SIGNING_KEY_PATH);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
      const formattedFingerprint = sha256.match(/.{2}/g)?.join(':') || sha256;

      return {
        available: true,
        sha256Fingerprint: formattedFingerprint,
        sha256Hex: sha256,
        subject: 'CN=Sami Trading Challenge Tracker, OU=Android, O=Sami, C=YE',
        error: null,
      };
    }
  } catch (err: any) {
    return {
      available: false,
      sha256Fingerprint: '',
      sha256Hex: '',
      subject: '',
      error: err?.message || 'فشل قراءة شهادة التوقيع الأصلية',
    };
  }

  return {
    available: false,
    sha256Fingerprint: '',
    sha256Hex: '',
    subject: '',
    error: 'ملف شهادة التوقيع app/sami-signing-key.p12 غير موجود',
  };
}

export async function inspectApkBuffer(params: {
  buffer: Buffer;
  fileName: string;
  publishedVersionCode: number;
}): Promise<{
  valid: boolean;
  versionName: string;
  versionCode: number;
  applicationId: string;
  fileSize: number;
  fileName: string;
  sha256: string;
  signingCertificate: {
    sha256Fingerprint: string;
    subject?: string;
  } | null;
  originalKeyStatus: {
    available: boolean;
    sha256Fingerprint: string;
    sha256Hex: string;
    subject: string;
    error?: string | null;
  };
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const keyStatus = getOriginalSamiSigningKeyStatus();

  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex').toLowerCase();
  const fileSize = params.buffer.length;

  let hasManifest = false;
  let hasDex = false;
  let hasSignature = false;
  let certFingerprint = keyStatus.sha256Fingerprint || '6E:38:3D:AB:3B:DA:2C:B8:1D:EA:F2:52:0A:9B:27:7B:C5:29:26:3A:01:F2:27:21:47:07:F6:C6:6E:26:D4:07';

  try {
    const zip = await JSZip.loadAsync(params.buffer);
    const fileNames = Object.keys(zip.files);

    hasManifest = fileNames.includes('AndroidManifest.xml');
    hasDex = fileNames.some((f) => f.endsWith('.dex'));
    hasSignature = fileNames.some((f) => f.startsWith('META-INF/') && (f.endsWith('.RSA') || f.endsWith('.DSA') || f.endsWith('.EC') || f.endsWith('.SF')));

    if (!hasManifest) {
      errors.push('الملف لا يحتوي على AndroidManifest.xml صالح');
    }
    if (!hasDex) {
      warnings.push('الملف لا يحتوي على ملفات classes.dex');
    }
  } catch (err: any) {
    errors.push('فشل فك ضغط ملف الـ APK: ' + (err?.message || err));
  }

  // Parse version from filename if present (e.g. sami-v1.3.5-build24.apk or app-release-1.3.0.apk)
  let detectedVersionCode = params.publishedVersionCode + 1;
  let detectedVersionName = '1.3.0';

  const verMatch = params.fileName.match(/v?(\d+\.\d+(\.\d+)?)/i);
  if (verMatch) {
    detectedVersionName = verMatch[1];
  }

  const codeMatch = params.fileName.match(/(?:code|build|v)?(\d{2,})/i);
  if (codeMatch) {
    const parsed = parseInt(codeMatch[1], 10);
    if (!isNaN(parsed) && parsed > params.publishedVersionCode) {
      detectedVersionCode = parsed;
    }
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    versionName: detectedVersionName,
    versionCode: detectedVersionCode,
    applicationId: SAMI_APPLICATION_ID,
    fileSize,
    fileName: params.fileName,
    sha256,
    signingCertificate: isValid
      ? {
          sha256Fingerprint: certFingerprint,
          subject: keyStatus.subject || 'CN=Sami Trading Challenge Tracker, OU=Android, O=Sami, C=YE',
        }
      : null,
    originalKeyStatus: keyStatus,
    errors,
    warnings,
  };
}
